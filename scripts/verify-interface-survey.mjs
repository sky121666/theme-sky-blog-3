import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { collectBrowserRuntimeErrors, installReadOnlyGuard, runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const root = process.cwd();
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const dir = path.resolve(process.env.INTERFACE_AUDIT_OUTPUT || 'output/interface-audit');
const smoke = JSON.parse(await fs.readFile(path.join(root, 'output/playwright/smoke-report.json'), 'utf8'));
const initial = await readLiveBuildContext(baseUrl);
if (smoke.assetRevision?.revision !== initial.build.revision || (smoke.failures || []).length) {
  throw new Error('The current strict smoke is not passing on this source/build identity');
}
const routes = [...new Map(smoke.routes
  .filter((route) => route.status === 200 && !['links-interactions', 'search-interaction'].includes(route.name))
  .map((route) => [route.target, route])).values()];
routes.push(
  { name: 'standalone-page', target: '/about', pageMode: 'browser-reader', windowVariant: 'browser', appId: 'reader' },
  { name: 'docsme-document', target: process.env.DOCSME_DOC_SAMPLE_PATH || '/docs/halo-theme-sky-blog-1/jianjie', pageMode: 'browser-docsme', windowVariant: 'docsme', appId: 'docsme' }
);
const viewports = [{ name: 'desktop', width: 1440, height: 960 }, { name: 'mobile', width: 390, height: 844 }];

function passiveResourceBoundary(entry, route, state) {
  if (entry.errorText === 'net::ERR_ABORTED' && entry.resourceType === 'media') {
    return '浏览器取消未播放媒体的预加载；播放功能仍需单独验证';
  }
  let url;
  try { url = new URL(entry.url); } catch { return ''; }
  if (entry.errorText === 'net::ERR_ABORTED' && url.pathname.endsWith('/assets/asset-manifest.json')
    && state?.assetIdentity?.source === 'manifest' && state.assetIdentity.revision === initial.build.revision) {
    return '资源身份已由当前 manifest 确认，另一次请求被取消';
  }
  if (route.name === 'douban' && entry.resourceType === 'image'
    && url.hostname === 'douban.img.yyds.pink' && entry.errorText === 'net::ERR_BLOCKED_BY_ORB') {
    return '外部豆瓣海报代理被浏览器拦截，主题显示缺图降级';
  }
  return '';
}

const report = {
  observedAt: new Date().toISOString(), halo: initial.halo, plugins: initial.plugins.length,
  build: initial.build, sourceFingerprint: initial.sourceFingerprint, routes: [], failures: []
};
await fs.mkdir(path.join(dir, 'interface-screenshots'), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    for (const [index, route] of routes.entries()) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const blockedWrites = [];
      const stubbedWrites = [];
      await installReadOnlyGuard(context, blockedWrites);
      // Halo's view counter POST is site data; acknowledge it locally so the
      // read-only survey can inspect article UI without changing that data.
      await context.route('**/apis/api.halo.run/v1alpha1/trackers/counter', async (requestRoute) => {
        stubbedWrites.push({ method: requestRoute.request().method(), url: requestRoute.request().url() });
        await requestRoute.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });
      const page = await context.newPage();
      const expected = (kind, value) => {
        const url = String(value?.url || '');
        return ((kind === 'responseErrors' && value?.status === 401)
          || kind === 'consoleErrors') && url.includes('/apis/api.console.halo.run/v1alpha1/users/-');
      };
      const collector = collectBrowserRuntimeErrors(page, { expected });
      const item = { viewport: viewport.name, route: route.name, target: route.target, expectedProtocol: { pageMode: route.pageMode, windowVariant: route.windowVariant, appId: route.appId }, failures: [], warnings: [] };
      try {
        const response = await page.goto(new URL(route.target, baseUrl).href, { waitUntil: 'commit', timeout: 20000 });
        item.httpStatus = response?.status() ?? null;
        await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 15000 });
        await page.locator('body[data-page-mode]').waitFor({ timeout: 15000 });
        if (route.pageMode !== 'auth') {
          await page.waitForFunction(() => window.__THEME_MAIN_LOADED__ === true, undefined, { timeout: 15000 });
        }
        await page.waitForTimeout(1800);
        if (['photos', 'photos-group'].includes(route.name)) {
          try {
            await page.waitForFunction(() => {
              const clip = document.querySelector('.photos-grid-scroll')?.getBoundingClientRect();
              return [...document.querySelectorAll('.photos-grid .photo-card-img')].filter((img) => {
                const box = img.getBoundingClientRect();
                return box.width > 0 && box.height > 0
                  && box.bottom > Math.max(0, clip?.top ?? 0)
                  && box.top < Math.min(innerHeight, clip?.bottom ?? innerHeight);
              }).every((img) => img.closest('.photo-card')?.matches('.ph-loaded, .ph-error'));
            }, undefined, { timeout: 8000 });
            const decoded = await page.evaluate(async () => {
              const clip = document.querySelector('.photos-grid-scroll')?.getBoundingClientRect();
              const visible = [...document.querySelectorAll('.photos-grid .photo-card-img')].filter((img) => {
                const box = img.getBoundingClientRect();
                return box.width > 0 && box.height > 0
                  && box.bottom > Math.max(0, clip?.top ?? 0)
                  && box.top < Math.min(innerHeight, clip?.bottom ?? innerHeight)
                  && img.closest('.photo-card')?.classList.contains('ph-loaded');
              });
              const ready = await Promise.race([
                Promise.all(visible.map((img) => img.decode().then(() => true, () => false))).then((values) => values.every(Boolean)),
                new Promise((resolve) => setTimeout(() => resolve(false), 5000))
              ]);
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return ready;
            });
            if (!decoded) item.warnings.push('A visible photo was not decoded before the screenshot');
            await page.waitForTimeout(550);
          } catch {
            item.warnings.push('Visible photo cards are still loading after 8 seconds');
          }
        }
        item.state = await page.evaluate((pageMode) => ({
          pageMode: document.body.dataset.pageMode || '', windowVariant: document.body.dataset.windowVariant || '', appId: document.body.dataset.appId || '',
          title: document.title, width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          visibleControls: [...document.querySelectorAll('button, a[href], input, select')]
            .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }).length,
          brokenVisibleImages: [...document.images].filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight
              && getComputedStyle(element).visibility !== 'hidden' && element.currentSrc
              && element.complete && element.naturalWidth === 0;
          }).map((element) => element.currentSrc).slice(0, 12),
          pendingVisiblePhotos: [...document.querySelectorAll('.photos-grid .photo-card-img')].filter((img) => {
              const clip = document.querySelector('.photos-grid-scroll')?.getBoundingClientRect();
              const box = img.getBoundingClientRect();
              return box.width > 0 && box.height > 0
                && box.bottom > Math.max(0, clip?.top ?? 0)
                && box.top < Math.min(innerHeight, clip?.bottom ?? innerHeight)
                && !img.closest('.photo-card')?.matches('.ph-loaded, .ph-error');
            }).length,
          shellLoaded: pageMode === 'auth' || window.__THEME_MAIN_LOADED__ === true,
          appRoot: Boolean(document.querySelector('[data-app-root]')),
          readyState: document.readyState,
          domContentLoadedAt: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventStart || 0,
          assetIdentity: window.__THEME_ASSET_IDENTITY__ || null
        }), route.pageMode);
        if (item.httpStatus !== 200) item.failures.push(`HTTP ${item.httpStatus}`);
        for (const [key, value] of Object.entries(item.expectedProtocol)) {
          if ((item.state[key] || '') !== (value || '')) item.failures.push(`${key}: expected ${value}, got ${item.state[key]}`);
        }
        if (item.state.documentWidth > item.state.width + 8) item.failures.push(`horizontal overflow ${item.state.documentWidth - item.state.width}px`);
        if (!item.state.title) item.failures.push('empty document title');
        if (item.state.brokenVisibleImages.length) item.failures.push(`broken visible images: ${item.state.brokenVisibleImages.length}`);
        if (item.state.domContentLoadedAt === 0) {
          item.warnings.push('DOMContentLoaded remains pending after the theme page became interactive');
        }
      } catch (error) {
        item.failures.push(`navigation or bootstrap: ${error.message}`);
      }
      item.runtime = collector.snapshot();
      item.stubbedWrites = stubbedWrites;
      item.externalResourceFindings = [];
      const unexplainedRequestFailures = [];
      for (const entry of item.runtime.requestFailures || []) {
        const boundary = passiveResourceBoundary(entry, route, item.state);
        if (boundary) item.externalResourceFindings.push({ ...entry, boundary });
        else unexplainedRequestFailures.push(entry);
      }
      if (item.externalResourceFindings.length) {
        item.warnings.push(`${item.externalResourceFindings.length} resource failures have explicit passive-survey boundaries`);
      }
      item.failures.push(...runtimeErrorMessages({ ...item.runtime, requestFailures: unexplainedRequestFailures, blockedWrites }));
      const screenshot = `${viewport.name}-${String(index + 1).padStart(2, '0')}-${route.name.replace(/[^a-z0-9-]/gi, '-')}.png`;
      try { await page.screenshot({ path: path.join(dir, 'interface-screenshots', screenshot), fullPage: false, timeout: 10000 }); item.screenshot = screenshot; }
      catch (error) { item.screenshotError = error.message; }
      collector.stop();
      await context.close();
      report.routes.push(item);
      report.failures.push(...item.failures.map((message) => `${viewport.name}/${route.name}: ${message}`));
      await fs.writeFile(path.join(dir, 'interface-survey.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ viewport: item.viewport, route: item.route, status: item.httpStatus, controls: item.state?.visibleControls ?? null, failures: item.failures.length, warnings: item.warnings.length }));
    }
  }
  const final = await readLiveBuildContext(baseUrl).catch((error) => {
    const message = error?.message || String(error);
    report.finalIdentityError = message;
    report.failures.push(`final live build identity verification failed: ${message}`);
    return null;
  });
  if (final) {
    report.finalIdentity = { observedAt: final.observedAt, halo: final.halo, build: final.build, sourceFingerprint: final.sourceFingerprint, plugins: final.plugins.length };
    if (final.sourceFingerprint !== initial.sourceFingerprint) report.failures.push('source/build changed during interface survey');
  }
  report.pendingDomContentLoaded = report.routes.filter((route) => route.state?.domContentLoadedAt === 0).length;
  report.externalResourceFindings = report.routes.reduce((count, route) => count + route.externalResourceFindings.length, 0);
  report.status = report.failures.length ? 'failed' : report.externalResourceFindings ? 'passed-with-warnings' : 'passed';
  await fs.writeFile(path.join(dir, 'interface-survey.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, routes: report.routes.length, failures: report.failures.length }));
  if (report.failures.length) process.exitCode = 1;
} finally { await browser.close(); }
