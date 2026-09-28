import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPerformanceAccumulator, installPerformanceObservers, layoutStabilityFailures } from './lib/performance-metrics.mjs';

const root = process.cwd();
const baseUrl = (process.env.AUDIT_BASE_URL || process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = path.join(root, 'output', 'audit');
const localAssetManifestFile = path.join(root, 'templates', 'assets', 'asset-manifest.json');
const requirePluginRoutes = /^(?:1|true)$/i.test(String(process.env.AUDIT_REQUIRE_PLUGIN_ROUTES || '').trim());
// A repeatable laboratory regression gate, not a claim about field p75.
// https://web.dev/articles/cls#what_is_a_good_cls_score
const maxSampleCls = 0.1;
const knownStaleContentUrls = new Set([
  'http://192.168.1.23:8090/upload/5BB751C4-JdQx.JPEG',
  'http://192.168.1.23:8090/upload/2E3462BD-FtZg.jpeg',
  'http://192.168.1.23:8090/upload/1D1AF973-QjDN.jpg',
  'http://192.168.1.23:8090/upload/1D3408F2-pylZ.JPEG'
]);

const routes = [
  { name: 'home', target: '/', required: true, focus: 'Dock / Header / widgets / theme' },
  { name: 'links', target: '/links', required: requirePluginRoutes, focus: 'LCP / CLS / FCP-window blocking / comment and link assistant resources' },
  { name: 'douban', target: '/douban', required: requirePluginRoutes, focus: 'LCP / CLS / FCP-window blocking / image and public API resources' },
  { name: 'steam', target: '/steam', required: requirePluginRoutes, focus: 'LCP / CLS / FCP-window blocking / heatmap and API resources' },
  { name: 'docs', target: '/docs', required: requirePluginRoutes, focus: 'LCP / CLS / FCP-window blocking / Shiki and comment resources' },
  { name: 'equipments', target: '/equipments', required: requirePluginRoutes, focus: 'LCP / CLS / FCP-window blocking / image loading' },
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

function realChromeUserAgent(browser) {
  const version = String(browser.version() || '').trim() || '142.0.0.0';
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function assetManifestPath(manifest) {
  const shellAsset = String(manifest?.['shell-core']?.js?.[0] || '');
  const marker = '/assets/';
  const markerIndex = shellAsset.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('本地 asset-manifest 缺少可解析的 shell-core 资源路径');
  }
  return `${shellAsset.slice(0, markerIndex + marker.length)}asset-manifest.json`;
}

function readAssetMeta(manifest, source) {
  const version = String(manifest?.__meta?.version || '').trim();
  const revision = String(manifest?.__meta?.revision || '').trim();
  const query = String(manifest?.__meta?.query || '').trim().replace(/^\?/, '');
  if (!version || !revision || !query) {
    throw new Error(`${source} asset-manifest 缺少 __meta.version/revision/query`);
  }
  const queryParams = new URLSearchParams(query);
  if (queryParams.get('v') !== version || queryParams.get('r') !== revision) {
    throw new Error(`${source} asset-manifest 的 query 与 version/revision 不一致`);
  }
  return { version, revision, query };
}

async function verifyServedAssetRevision() {
  const localManifest = JSON.parse(await fs.readFile(localAssetManifestFile, 'utf8'));
  const localMeta = readAssetMeta(localManifest, '本地');
  const manifestPath = assetManifestPath(localManifest);
  const response = await fetch(absoluteUrl(manifestPath), {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache'
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`服务端 asset-manifest 请求失败: HTTP ${response.status} (${manifestPath})`);
  }
  const remoteMeta = readAssetMeta(await response.json(), '服务端');
  if (remoteMeta.version !== localMeta.version || remoteMeta.revision !== localMeta.revision) {
    throw new Error(
      `服务端 assets 与本地构建不一致: server=${remoteMeta.version}/${remoteMeta.revision}, `
      + `local=${localMeta.version}/${localMeta.revision}`
    );
  }
  return { manifestPath, ...localMeta };
}

function isIgnoredRequestFailure(entry) {
  if (/net::ERR_ABORTED/i.test(String(entry?.errorText || ''))) return true;
  try {
    return knownStaleContentUrls.has(new URL(entry?.url || '').href);
  } catch {
    return false;
  }
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
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
    const ignoredContentWarningCount = page.consoleErrors.filter(isKnownStaleContentResourceError).length;
    const runtimeErrorCount = page.consoleErrors.filter((entry) => !isKnownStaleContentResourceError(entry)).length
      + (page.pageErrors?.length || 0)
      + (page.requestFailures?.length || 0);
    return `| ${page.name} | ${page.status} | ${page.metrics.lcp ?? '—'} | ${Number.isFinite(page.metrics.cls) ? Number(page.metrics.cls.toFixed(4)) : '—'} | ${page.metrics.blockingTimeAfterFcp ?? '—'} | ${page.metrics.inp ?? '—'} | ${page.metrics.sample?.observedInteractionCount ?? 0} | ${page.metrics.resourceCount} | ${images} | ${resources} | ${runtimeErrorCount} | ${ignoredContentWarningCount} | ${page.excludedRequestFailures?.length || 0} |`;
  }).join('\n');

  const resourceRows = watchedResources.map((resource) => `| ${resource.key} | ${resource.allowed} |`).join('\n');
  const findingRows = (report.resourceFindings || []).map((finding) => `| ${finding.key} | ${finding.totalHits} | ${formatBytes(finding.totalBytes)} | ${finding.hitPages.join(', ') || '-'} | ${finding.unexpectedPages.join(', ') || '-'} | ${finding.decision} |`).join('\n');

  return [
    '# 真实页面审计报告',
    '',
    `- Base URL: ${report.baseUrl}`,
    `- Assets revision: ${report.assetRevision?.version || '-'} / ${report.assetRevision?.revision || '-'}`,
    `- Generated at: ${report.generatedAt}`,
    `- Browser: ${report.sampling.browser}; viewport: ${report.sampling.viewport.width}×${report.sampling.viewport.height}; cache: ${report.sampling.cache}`,
    '- 采样：无 CPU/网络限速；DOMContentLoaded 后等待 networkidle（最多 8 秒）再观察 800ms；未主动执行交互。',
    '- CLS 使用最大会话窗口。阻塞时间仅覆盖 FCP 到采样结束，不等于 Lighthouse 的 FCP 到 TTI TBT。',
    '- INP 只描述实际观察到的交互；无样本或浏览器不支持时为 —，不能解释为 0。所有值均不是完整访问周期或真实用户分位数。',
    '- 排除的网络失败仍完整保存在 JSON：ERR_ABORTED 的取消原因未被证实，不能视为页面零错误；已登记旧图片地址与运行时错误分别计数。',
    `- 本地布局稳定性门槛：每页采样 CLS ≤ ${maxSampleCls}，缺测也不记作通过；这不等于真实用户第 75 百分位达标。`,
    '',
    '## 页面结果',
    '',
    '| 页面 | 状态 | LCP(ms) | CLS | FCP后阻塞(ms) | INP(ms) | 交互样本数 | Resource | Lazy Images | 命中资源 | Runtime Error | Content Warning | Excluded Network |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |',
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
  const pendingRequests = new Map();
  const onRequest = (request) => pendingRequests.set(request, { url: request.url(), type: request.resourceType(), startedAt: Date.now() });
  const onRequestDone = (request) => pendingRequests.delete(request);
  page.on('request', onRequest);
  page.on('requestfinished', onRequestDone);
  page.on('requestfailed', onRequestDone);
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const excludedRequestFailures = [];
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
  const onRequestFailed = (request) => {
    const entry = {
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      errorText: String(request.failure()?.errorText || 'unknown request failure')
    };
    if (isIgnoredRequestFailure(entry)) {
      excludedRequestFailures.push({
        ...entry,
        reason: /net::ERR_ABORTED/i.test(entry.errorText)
          ? 'request aborted; cancellation cause unverified'
          : 'registered stale content URL'
      });
    } else requestFailures.push(entry);
  };

  page.on('console', onConsole);
  page.on('response', onResponse);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);

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
      const audit = window.__themeAuditMetrics?.snapshot?.() || {};
      return {
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
        load: nav ? nav.loadEventEnd - nav.startTime : 0,
        firstPaint: paints.find((entry) => entry.name === 'first-paint')?.startTime || 0,
        lcp: audit.lcp ?? null,
        cls: audit.cls ?? null,
        fcp: audit.fcp ?? null,
        blockingTimeAfterFcp: audit.blockingTimeAfterFcp ?? null,
        inp: audit.inp ?? null,
        sample: audit.sample || null,
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
        cls: Number.isFinite(metrics.cls) ? metrics.cls : null,
        fcp: round(metrics.fcp),
        blockingTimeAfterFcp: round(metrics.blockingTimeAfterFcp),
        inp: round(metrics.inp),
        sample: metrics.sample,
        resourceCount: metrics.resourceCount
      },
      protocol,
      watchedResources: resourceMap,
      consoleErrors,
      pageErrors,
      requestFailures,
      excludedRequestFailures
    };
  } catch (error) {
    const documentState = await Promise.race([
      page.evaluate(() => ({ url: location.href, readyState: document.readyState, title: document.title })).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    ]);
    return {
      name: route.name,
      target: route.target,
      focus: route.focus,
      status: 'failed',
      url: '',
      metrics: { domContentLoaded: null, load: null, firstPaint: null, lcp: null, cls: null, fcp: null, blockingTimeAfterFcp: null, inp: null, sample: null, resourceCount: 0 },
      protocol: {},
      watchedResources: resourceMap,
      consoleErrors,
      pageErrors,
      requestFailures,
      excludedRequestFailures,
      documentState,
      pendingRequests: [...pendingRequests.values()].map(({ startedAt, ...request }) => ({ ...request, elapsedMs: Date.now() - startedAt })),
      error: String(error?.message || error)
    };
  } finally {
    page.off('request', onRequest);
    page.off('requestfinished', onRequestDone);
    page.off('requestfailed', onRequestDone);
    page.off('console', onConsole);
    page.off('response', onResponse);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
  }
}

async function main() {
  const assetRevision = await verifyServedAssetRevision();
  console.log(`Assets revision 已对齐: ${assetRevision.version}/${assetRevision.revision}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    userAgent: realChromeUserAgent(browser)
  });
  await context.addInitScript({ content: `(${installPerformanceObservers.toString()})(${createPerformanceAccumulator.toString()});` });
  const cdpPage = await context.newPage();
  const cdp = await context.newCDPSession(cdpPage);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const report = {
    schemaVersion: 2,
    baseUrl,
    generatedAt: new Date().toISOString(),
    assetRevision,
    sampling: {
      browser: `Chromium ${browser.version()}`,
      viewport: { width: 1440, height: 960 },
      cache: 'disabled via CDP',
      cpuThrottle: 1,
      networkThrottle: 'none',
      scenario: 'passive page load, no scripted interactions',
      settle: { navigation: 'domcontentloaded', networkIdleTimeoutMs: 8000, additionalObservationMs: 800 },
      metricScope: 'sample window, not field data; blockingTimeAfterFcp is not Lighthouse TBT'
    },
    pages: []
  };

  for (const route of routes) {
    report.pages.push(await auditRoute(cdpPage, route));
  }
  report.resourceFindings = buildResourceFindings(report.pages);
  report.performanceGate = {
    scope: 'Laboratory load-window regression only; not field p75 or full lifecycle',
    maxSampleCls,
    failures: layoutStabilityFailures(report.pages, maxSampleCls)
  };

  await browser.close();
  const files = await writeReport(report);

  const failedRoutes = report.pages.filter((page) => page.status !== 'ok' && page.status !== 'skipped-404');
  const runtimeErrors = report.pages.filter((page) => page.status === 'ok' && (
    page.pageErrors.length > 0
    || page.requestFailures.length > 0
    || page.consoleErrors.some((entry) => !isKnownStaleContentResourceError(entry))
  ));
  const pluginResourceErrors = report.pages.flatMap((page) => Object.entries(page.watchedResources || {})
    .filter(([key]) => key !== 'large-media')
    .flatMap(([key, items]) => items
      .filter((item) => item.status >= 400)
      .map((item) => ({ page: page.name, key, status: item.status, url: item.url }))));
  console.log(`真实页面审计完成: ${files.mdFile}`);
  if (failedRoutes.length > 0) {
    console.error(`页面审计失败: ${failedRoutes.map((page) => `${page.name}(${page.status})`).join(', ')}`);
    process.exit(1);
  }
  if (runtimeErrors.length > 0 || pluginResourceErrors.length > 0) {
    console.error(`插件运行时审计失败: runtime=${runtimeErrors.map((page) => page.name).join(', ') || '-'}, resource=${pluginResourceErrors.length}`);
    process.exit(1);
  }
  if (report.performanceGate.failures.length > 0) {
    console.error(`布局稳定性回归失败: ${report.performanceGate.failures.map(({ page, cls }) => `${page}(${cls ?? 'unavailable'})`).join(', ')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
