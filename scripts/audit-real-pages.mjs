import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const baseUrl = (process.env.AUDIT_BASE_URL || process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = path.join(root, 'output', 'audit');
const requirePluginRoutes = /^(?:1|true)$/i.test(String(process.env.AUDIT_REQUIRE_PLUGIN_ROUTES || '').trim());
const knownStaleContentUrls = new Set([
  'http://192.168.1.23:8090/upload/5BB751C4-JdQx.JPEG',
  'http://192.168.1.23:8090/upload/2E3462BD-FtZg.jpeg',
  'http://192.168.1.23:8090/upload/1D1AF973-QjDN.jpg',
  'http://192.168.1.23:8090/upload/1D3408F2-pylZ.JPEG'
]);

const routes = [
  { name: 'home', target: '/', required: true, focus: 'Dock / Header / widgets / theme' },
  { name: 'links', target: '/links', required: requirePluginRoutes, focus: 'LCP / CLS / TBT / comment and link assistant resources' },
  { name: 'douban', target: '/douban', required: requirePluginRoutes, focus: 'LCP / CLS / TBT / image and public API resources' },
  { name: 'steam', target: '/steam', required: requirePluginRoutes, focus: 'LCP / CLS / TBT / heatmap and API resources' },
  { name: 'docs', target: '/docs', required: requirePluginRoutes, focus: 'LCP / CLS / TBT / Shiki and comment resources' },
  { name: 'equipments', target: '/equipments', required: requirePluginRoutes, focus: 'LCP / CLS / TBT / image loading' },
  { name: 'moments', target: '/moments', required: requirePluginRoutes, focus: 'media / comments / notifications / Shiki resources' },
  { name: 'photos', target: '/photos', required: requirePluginRoutes, focus: 'image viewer / layout / lazy images' },
  { name: 'editor-plugins', target: '/archives/editor-feature-demo', required: requirePluginRoutes, focus: 'Vote / Hyperlink Card / LightGallery / Shiki runtime' },
  { name: 'lottery-plugin', target: '/archives/ijhJxHtw', required: requirePluginRoutes, focus: 'Lottery custom element runtime' }
];

function isKnownStaleContentResourceError(entry) {
  if (!entry || !/^Failed to load resource: net::ERR_CONNECTION_REFUSED/i.test(entry.text || '')) return false;
  try {
    return knownStaleContentUrls.has(new URL(entry.url || '').href);
  } catch {
    return false;
  }
}

const watchedResources = [
  { key: 'comment-widget', pattern: /comment-widget/i, allowed: '有 <halo:comment> 或评论入口的页面' },
  { key: 'rag-ui', pattern: /rag-ui/i, allowed: '真实启用 RAG 的页面' },
  { key: 'contact-form', pattern: /contact-form/i, allowed: '有联系表单的页面' },
  { key: 'hyperlink-card', pattern: /\/plugins\/editor-hyperlink-card\//i, allowed: '插件当前全局注入；文章组件页必须可升级，PJAX 不得重复加载' },
  { key: 'lottery', pattern: /\/plugins\/lottery\//i, allowed: '插件当前全局注入；抽奖组件页必须可升级，PJAX 不得重复加载' },
  { key: 'restricted-reading', pattern: /\/plugins\/restricted-reading\//i, allowed: '插件当前全局注入；受限内容样本缺失时仅验证资源与无报错' },
  { key: 'vote', pattern: /\/plugins\/vote\//i, allowed: '插件当前全局注入；投票组件页必须可升级，不执行投票写操作' },
  { key: 'ai-assistant', pattern: /\/plugins\/ai-assistant\//i, allowed: '插件当前全局注入；只验证资源与生命周期，不发起 AI 请求' },
  { key: 'shiki', pattern: /shiki/i, allowed: '文章、Docsme、Moments 等存在代码块的页面' },
  { key: 'large-media', pattern: /\.(?:avif|webp|png|jpe?g|gif|mp4|webm)(?:[?#]|$)/i, allowed: '内容真实需要，且首屏不应同步加载非必要大资源' }
];

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sumResourceBytes(items = []) {
  return items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
}

function resourceExpected(resourceKey, page) {
  const protocol = page.protocol || {};
  if (resourceKey === 'comment-widget') return Boolean(protocol.hasComment);
  if (resourceKey === 'rag-ui') return Boolean(protocol.hasRagSurface);
  if (resourceKey === 'contact-form') return Boolean(protocol.hasContactForm);
  if (['hyperlink-card', 'lottery', 'restricted-reading', 'vote', 'ai-assistant'].includes(resourceKey)) return true;
  if (resourceKey === 'shiki') return Boolean(protocol.hasCode);
  if (resourceKey === 'large-media') return true;
  return true;
}

function buildResourceFindings(pages) {
  return watchedResources.map((resource) => {
    const hits = pages.filter((page) => (page.watchedResources?.[resource.key] || []).length > 0);
    const unexpected = hits.filter((page) => !resourceExpected(resource.key, page));
    const totalBytes = hits.reduce((sum, page) => sum + sumResourceBytes(page.watchedResources?.[resource.key]), 0);
    return {
      key: resource.key,
      allowed: resource.allowed,
      hitPages: hits.map((page) => page.name),
      unexpectedPages: unexpected.map((page) => page.name),
      totalHits: hits.reduce((sum, page) => sum + (page.watchedResources?.[resource.key] || []).length, 0),
      totalBytes,
      decision: unexpected.length > 0
        ? '记录为疑似全局注入；不直接拦截，先确认插件是否支持页面级 gating'
        : '当前命中符合页面能力边界'
    };
  });
}

async function writeReport(report) {
  await fs.mkdir(outputDir, { recursive: true });
  const jsonFile = path.join(outputDir, 'real-pages-report.json');
  const mdFile = path.join(outputDir, 'real-pages-report.md');
  await fs.writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(mdFile, renderMarkdown(report), 'utf8');
  return { jsonFile, mdFile };
}

function renderMarkdown(report) {
  const rows = report.pages.map((page) => {
    const resources = Object.entries(page.watchedResources || {})
      .filter(([, items]) => items.length > 0)
      .map(([key, items]) => `${key}:${items.length}${sumResourceBytes(items) > 0 ? `/${formatBytes(sumResourceBytes(items))}` : ''}`)
      .join(', ') || '-';
    const images = page.protocol?.imageCount != null
      ? `${page.protocol.lazyImageCount}/${page.protocol.imageCount}`
      : '-';
    return `| ${page.name} | ${page.status} | ${page.metrics.lcp} | ${page.metrics.cls} | ${page.metrics.tbt} | ${page.metrics.resourceCount} | ${images} | ${resources} | ${page.consoleErrors.length + (page.pageErrors?.length || 0)} |`;
  }).join('\n');

  const resourceRows = watchedResources.map((resource) => `| ${resource.key} | ${resource.allowed} |`).join('\n');
  const findingRows = (report.resourceFindings || []).map((finding) => `| ${finding.key} | ${finding.totalHits} | ${formatBytes(finding.totalBytes)} | ${finding.hitPages.join(', ') || '-'} | ${finding.unexpectedPages.join(', ') || '-'} | ${finding.decision} |`).join('\n');

  return [
    '# 真实页面审计报告',
    '',
    `- Base URL: ${report.baseUrl}`,
    `- Generated at: ${report.generatedAt}`,
    '',
    '## 页面结果',
    '',
    '| 页面 | 状态 | LCP(ms) | CLS | TBT(ms) | Resource | Lazy Images | 命中资源 | Console Error |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
    rows,
    '',
    '## 资源边界',
    '',
    '| 资源 | 允许加载场景 |',
    '| --- | --- |',
    resourceRows,
    '',
    '## 资源判定',
    '',
    '| 资源 | 命中数 | 估算大小 | 命中页面 | 非预期页面 | 处理判断 |',
    '| --- | ---: | ---: | --- | --- | --- |',
    findingRows,
    ''
  ].join('\n');
}

async function auditRoute(page, route) {
  const consoleErrors = [];
  const pageErrors = [];
  const resourceMap = Object.fromEntries(watchedResources.map((resource) => [resource.key, []]));

  const onConsole = (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({
        text: message.text(),
        url: message.location()?.url || ''
      });
    }
  };
  const onResponse = (response) => {
    const url = response.url();
    for (const resource of watchedResources) {
      if (resource.pattern.test(url)) {
        const contentLength = Number(response.headers()['content-length'] || 0);
        resourceMap[resource.key].push({
          url,
          status: response.status(),
          type: response.request().resourceType(),
          bytes: Number.isFinite(contentLength) ? contentLength : 0
        });
      }
    }
  };
  const onPageError = (error) => {
    pageErrors.push(error?.message || String(error));
  };

  page.on('console', onConsole);
  page.on('response', onResponse);
  page.on('pageerror', onPageError);

  try {
    const response = await page.goto(absoluteUrl(route.target), {
      waitUntil: 'domcontentloaded',
      timeout: 20_000
    });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      const audit = window.__themeAuditMetrics || {};
      return {
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
        load: nav ? nav.loadEventEnd - nav.startTime : 0,
        firstPaint: paints.find((entry) => entry.name === 'first-paint')?.startTime || 0,
        lcp: audit.lcp || 0,
        cls: audit.cls || 0,
        tbt: audit.tbt || 0,
        resourceCount: performance.getEntriesByType('resource').length
      };
    });

    const protocol = await page.evaluate(() => ({
      title: document.title,
      pageMode: document.body.dataset.pageMode || '',
      appId: document.body.dataset.appId || '',
      windowVariant: document.body.dataset.windowVariant || '',
      hasComment: Boolean(document.querySelector('comment-widget, .halo-comment-widget, halo\\:comment')),
      hasContactForm: Boolean(document.querySelector('contact-form, [data-contact-form], .contact-form, form[action*="contact"]')),
      hasRagSurface: Boolean(document.querySelector('rag-ui, [data-rag-ui], [data-rag]')),
      hyperlinkCardCount: document.querySelectorAll('hyperlink-card, hyperlink-inline-card').length,
      lotteryCardCount: document.querySelectorAll('lottery-card').length,
      restrictedReadingCount: document.querySelectorAll('content-restrict-widget').length,
      voteBlockCount: document.querySelectorAll('vote-block').length,
      hasCode: Boolean(document.querySelector('shiki-code, pre code, pre, code')),
      imageCount: document.images.length,
      lazyImageCount: Array.from(document.images).filter((image) => image.loading === 'lazy').length
    }));

    const statusCode = response?.status() || 0;
    const skipped = !route.required && statusCode === 404;

    return {
      name: route.name,
      target: route.target,
      focus: route.focus,
      status: skipped ? 'skipped-404' : (statusCode >= 200 && statusCode < 400 ? 'ok' : `http-${statusCode}`),
      url: page.url(),
      metrics: {
        domContentLoaded: round(metrics.domContentLoaded),
        load: round(metrics.load),
        firstPaint: round(metrics.firstPaint),
        lcp: round(metrics.lcp),
        cls: Number(metrics.cls.toFixed(4)),
        tbt: round(metrics.tbt),
        resourceCount: metrics.resourceCount
      },
      protocol,
      watchedResources: resourceMap,
      consoleErrors,
      pageErrors
    };
  } catch (error) {
    return {
      name: route.name,
      target: route.target,
      focus: route.focus,
      status: route.required ? 'failed' : 'skipped-error',
      url: '',
      metrics: { domContentLoaded: 0, load: 0, firstPaint: 0, lcp: 0, cls: 0, tbt: 0, resourceCount: 0 },
      protocol: {},
      watchedResources: resourceMap,
      consoleErrors,
      pageErrors,
      error: String(error?.message || error)
    };
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
    page.off('pageerror', onPageError);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(() => {
    window.__themeAuditMetrics = { lcp: 0, cls: 0, tbt: 0 };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__themeAuditMetrics.lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__themeAuditMetrics.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__themeAuditMetrics.tbt += Math.max(0, entry.duration - 50);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
  const cdpPage = await context.newPage();
  const cdp = await context.newCDPSession(cdpPage);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const report = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    pages: []
  };

  for (const route of routes) {
    report.pages.push(await auditRoute(cdpPage, route));
  }
  report.resourceFindings = buildResourceFindings(report.pages);

  await browser.close();
  const files = await writeReport(report);

  const requiredRouteNames = new Set(routes.filter((route) => route.required).map((route) => route.name));
  const failedRequired = report.pages.filter((page) => requiredRouteNames.has(page.name) && page.status !== 'ok');
  const runtimeErrors = report.pages.filter((page) => page.status === 'ok' && (
    page.pageErrors.length > 0
    || page.consoleErrors.some((entry) => !isKnownStaleContentResourceError(entry))
  ));
  const pluginResourceErrors = report.pages.flatMap((page) => Object.entries(page.watchedResources || {})
    .filter(([key]) => key !== 'large-media')
    .flatMap(([key, items]) => items
      .filter((item) => item.status >= 400)
      .map((item) => ({ page: page.name, key, status: item.status, url: item.url }))));
  console.log(`真实页面审计完成: ${files.mdFile}`);
  if (failedRequired.length > 0) {
    console.error(`必要页面审计失败: ${failedRequired.map((page) => page.name).join(', ')}`);
    process.exit(1);
  }
  if (runtimeErrors.length > 0 || pluginResourceErrors.length > 0) {
    console.error(`插件运行时审计失败: console=${runtimeErrors.map((page) => page.name).join(', ') || '-'}, resource=${pluginResourceErrors.length}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
