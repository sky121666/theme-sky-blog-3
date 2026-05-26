import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const baseUrl = (process.env.AUDIT_BASE_URL || process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = path.join(root, 'output', 'audit');

const routes = [
  { name: 'home', target: '/', required: true, focus: 'Dock / Header / widgets / theme' },
  { name: 'links', target: '/links', required: false, focus: 'LCP / CLS / TBT / comment and link assistant resources' },
  { name: 'douban', target: '/douban', required: false, focus: 'LCP / CLS / TBT / image and public API resources' },
  { name: 'steam', target: '/steam', required: false, focus: 'LCP / CLS / TBT / heatmap and API resources' },
  { name: 'docs', target: '/docs', required: false, focus: 'LCP / CLS / TBT / Shiki and comment resources' },
  { name: 'equipments', target: '/equipments', required: false, focus: 'LCP / CLS / TBT / image loading' },
  { name: 'moments', target: '/moments', required: false, focus: 'media / comments / notifications / Shiki resources' },
  { name: 'photos', target: '/photos', required: false, focus: 'image viewer / layout / lazy images' }
];

const watchedResources = [
  { key: 'comment-widget', pattern: /comment-widget/i, allowed: '有 <halo:comment> 或评论入口的页面' },
  { key: 'rag-ui', pattern: /rag-ui/i, allowed: '真实启用 RAG 的页面' },
  { key: 'contact-form', pattern: /contact-form/i, allowed: '有联系表单的页面' },
  { key: 'shiki', pattern: /shiki/i, allowed: '文章、Docsme、Moments 等存在代码块的页面' },
  { key: 'large-media', pattern: /\.(?:avif|webp|png|jpe?g|gif|mp4|webm)(?:[?#]|$)/i, allowed: '内容真实需要，且首屏不应同步加载非必要大资源' }
];

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
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
      .map(([key, items]) => `${key}:${items.length}`)
      .join(', ') || '-';
    return `| ${page.name} | ${page.status} | ${page.metrics.lcp} | ${page.metrics.cls} | ${page.metrics.tbt} | ${resources} | ${page.consoleErrors.length} |`;
  }).join('\n');

  const resourceRows = watchedResources.map((resource) => `| ${resource.key} | ${resource.allowed} |`).join('\n');

  return [
    '# 真实页面审计报告',
    '',
    `- Base URL: ${report.baseUrl}`,
    `- Generated at: ${report.generatedAt}`,
    '',
    '## 页面结果',
    '',
    '| 页面 | 状态 | LCP(ms) | CLS | TBT(ms) | 命中资源 | Console Error |',
    '| --- | --- | ---: | ---: | ---: | --- | ---: |',
    rows,
    '',
    '## 资源边界',
    '',
    '| 资源 | 允许加载场景 |',
    '| --- | --- |',
    resourceRows,
    ''
  ].join('\n');
}

async function auditRoute(page, route) {
  const consoleErrors = [];
  const resourceMap = Object.fromEntries(watchedResources.map((resource) => [resource.key, []]));

  const onConsole = (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  };
  const onResponse = (response) => {
    const url = response.url();
    for (const resource of watchedResources) {
      if (resource.pattern.test(url)) {
        resourceMap[resource.key].push({
          url,
          status: response.status(),
          type: response.request().resourceType()
        });
      }
    }
  };

  page.on('console', onConsole);
  page.on('response', onResponse);

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
      consoleErrors
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
      error: String(error?.message || error)
    };
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
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

  await browser.close();
  const files = await writeReport(report);

  const failedRequired = report.pages.filter((page) => page.status === 'failed' || (page.name === 'home' && !page.status.startsWith('ok')));
  console.log(`真实页面审计完成: ${files.mdFile}`);
  if (failedRequired.length > 0) {
    console.error(`必要页面审计失败: ${failedRequired.map((page) => page.name).join(', ')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
