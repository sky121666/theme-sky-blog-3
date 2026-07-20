import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = process.cwd();
const entryPoint = path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/seo.js');

const bundleResult = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'iife',
  globalName: 'ThemeSeoContract',
  platform: 'browser',
  target: 'es2022',
  write: false
});
const runtimeSource = bundleResult.outputFiles[0].text;

function fallbackConfig(overrides = {}) {
  const values = {
    mode: 'full',
    title: '主题标题',
    description: '主题描述',
    canonical: 'https://example.com/posts/contract',
    image: 'https://example.com/cover.jpg',
    pageType: 'article',
    siteName: 'Sky Blog',
    ...overrides
  };

  return `<script type="application/json"
    data-theme-seo-fallback-config="true"
    data-mode="${values.mode}"
    data-title="${values.title}"
    data-description="${values.description}"
    data-canonical="${values.canonical}"
    data-image="${values.image}"
    data-page-type="${values.pageType}"
    data-site-name="${values.siteName}"></script>`;
}

async function loadRuntime(page, headHtml) {
  await page.setContent(`<!doctype html><html><head>${headHtml}</head><body></body></html>`);
  await page.addScriptTag({ content: runtimeSource });
}

async function readCriticalCounts(page) {
  return page.evaluate(() => ({
    description: document.head.querySelectorAll("meta[name='description']").length,
    canonical: document.head.querySelectorAll("link[rel='canonical']").length,
    ogTitle: document.head.querySelectorAll("meta[property='og:title']").length,
    ogDescription: document.head.querySelectorAll("meta[property='og:description']").length,
    ogUrl: document.head.querySelectorAll("meta[property='og:url']").length,
    ogImage: document.head.querySelectorAll("meta[property='og:image']").length,
    twitterCard: document.head.querySelectorAll("meta[name='twitter:card']").length,
    twitterTitle: document.head.querySelectorAll("meta[name='twitter:title']").length,
    twitterDescription: document.head.querySelectorAll("meta[name='twitter:description']").length
  }));
}

async function verifyPluginMissingOutput(page) {
  await loadRuntime(page, `<title>主题标题</title>${fallbackConfig()}`);
  const result = await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  const counts = await readCriticalCounts(page);

  assert.equal(result.added, 12, 'SEO Tools 未输出时应补齐 12 个关键标签');
  Object.entries(counts).forEach(([key, count]) => {
    assert.equal(count, 1, `SEO Tools 未输出时 ${key} 应唯一`);
  });
  assert.equal(
    await page.getAttribute("meta[name='twitter:card']", 'content'),
    'summary_large_image'
  );
}

async function verifyThemeFallbackOnly(page) {
  await loadRuntime(page, `
    <title>主题标题</title>
    ${fallbackConfig()}
    <meta name="description" content="主题描述" data-theme-seo-fallback="description" />
    <link rel="canonical" href="https://example.com/posts/contract" data-theme-seo-fallback="canonical" />
    <meta property="og:url" content="https://example.com/posts/contract" data-theme-seo-fallback="og:url" />
    <meta property="og:site_name" content="Sky Blog" data-theme-seo-fallback="og:site_name" />
    <meta property="og:title" content="主题标题" data-theme-seo-fallback="og:title" />
    <meta property="og:type" content="article" data-theme-seo-fallback="og:type" />
    <meta property="og:description" content="主题描述" data-theme-seo-fallback="og:description" />
    <meta property="og:image" content="https://example.com/cover.jpg" data-theme-seo-fallback="og:image" />
    <meta name="twitter:card" content="summary_large_image" data-theme-seo-fallback="twitter:card" />
    <meta name="twitter:title" content="主题标题" data-theme-seo-fallback="twitter:title" />
    <meta name="twitter:description" content="主题描述" data-theme-seo-fallback="twitter:description" />
    <meta name="twitter:image" content="https://example.com/cover.jpg" data-theme-seo-fallback="twitter:image" />
  `);

  const result = await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  const fallbackCount = await page.locator('[data-theme-seo-fallback]').count();
  const counts = await readCriticalCounts(page);

  assert.deepEqual(result, { added: 0, removed: 0 }, 'SEO Tools 禁用时不得改写完整主题回退');
  assert.equal(fallbackCount, 12, 'SEO Tools 禁用时主题回退标签应完整保留');
  Object.entries(counts).forEach(([key, count]) => {
    assert.equal(count, 1, `SEO Tools 禁用时 ${key} 应唯一`);
  });
}

async function verifyPluginOutputWins(page) {
  await loadRuntime(page, `
    <title>主题标题</title>
    ${fallbackConfig()}
    <meta name="description" content="Halo 输出" />
    <meta name="description" content="SEO Tools 输出" />
    <meta name="description" content="主题回退" data-theme-seo-fallback="description" />
    <link rel="canonical" href="https://example.com/halo" />
    <link rel="canonical" href="https://example.com/plugin" />
    <link rel="canonical" href="https://example.com/theme" data-theme-seo-fallback="canonical" />
    <meta property="og:title" content="SEO Tools 标题" />
    <meta property="og:title" content="主题标题" data-theme-seo-fallback="og:title" />
    <meta property="og:image" content="https://example.com/plugin-cover-1.jpg" />
    <meta property="og:image" content="https://example.com/plugin-cover-2.jpg" />
    <meta property="og:image" content="https://example.com/theme-cover.jpg" data-theme-seo-fallback="og:image" />
  `);

  const result = await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  const counts = await readCriticalCounts(page);

  assert.ok(result.removed >= 4, '插件与主题同时输出时应清除语义重复标签');
  assert.equal(counts.description, 1);
  assert.equal(counts.canonical, 1);
  assert.equal(counts.ogTitle, 1);
  assert.equal(counts.ogImage, 2, 'Open Graph multiple image candidates should be preserved');
  assert.equal(
    await page.getAttribute("meta[name='description']", 'content'),
    'SEO Tools 输出',
    '应优先保留最后一个非主题回退标签'
  );
  assert.equal(
    await page.getAttribute("link[rel='canonical']", 'href'),
    'https://example.com/plugin'
  );
  assert.equal(
    await page.getAttribute("meta[property='og:title']", 'content'),
    'SEO Tools 标题'
  );
  assert.deepEqual(
    await page.locator("meta[property='og:image']").evaluateAll((nodes) => nodes.map((node) => node.content)),
    ['https://example.com/plugin-cover-1.jpg', 'https://example.com/plugin-cover-2.jpg']
  );
}

async function verifyMetaOnlyMode(page) {
  await loadRuntime(page, `<title>Meta 页面</title>${fallbackConfig({ mode: 'meta', image: '' })}`);
  await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  const counts = await readCriticalCounts(page);

  assert.equal(counts.description, 1);
  assert.equal(counts.canonical, 1);
  assert.equal(counts.ogUrl, 1);
  assert.equal(counts.ogTitle, 0, 'meta 模式不得擅自扩展完整社交标签');
  assert.equal(counts.twitterCard, 0, 'meta 模式不得擅自扩展 Twitter 标签');
}

async function verifyPjaxSyncDoesNotMultiplyBroadSelectors(page) {
  await loadRuntime(page, `
    <title>旧页面</title>
    ${fallbackConfig({ title: '旧页面', canonical: 'https://example.com/old' })}
    <meta property="og:title" content="旧标题" />
  `);

  await page.evaluate(() => {
    window.__seoUpdated = null;
    document.addEventListener('pjax:seo-updated', (event) => {
      window.__seoUpdated = event.detail;
    }, { once: true });
  });

  const responseText = `<!doctype html><html><head>
    <title>新页面</title>
    ${fallbackConfig({ title: '新页面', canonical: 'https://example.com/new' })}
    <meta property="og:title" content="Halo 标题" />
    <meta property="og:title" content="SEO Tools 标题" />
    <meta property="og:image" content="https://example.com/cover-1.jpg" />
    <meta property="og:image" content="https://example.com/cover-2.jpg" />
    <meta property="article:tag" content="Halo" />
    <meta property="article:tag" content="Theme" />
    <script type="application/ld+json">{"name":"one"}</script>
    <script type="application/ld+json">{"name":"two"}</script>
  </head><body></body></html>`;

  await page.evaluate((html) => ThemeSeoContract.syncSeoHeadFromResponse(html), responseText);
  const state = await page.evaluate(() => ({
    title: document.title,
    ogTitles: Array.from(document.head.querySelectorAll("meta[property='og:title']"), (node) => node.content),
    ogImages: Array.from(document.head.querySelectorAll("meta[property='og:image']"), (node) => node.content),
    articleTags: document.head.querySelectorAll("meta[property='article:tag']").length,
    jsonLd: document.head.querySelectorAll("script[type='application/ld+json']").length,
    event: window.__seoUpdated
  }));

  assert.equal(state.title, '新页面');
  assert.deepEqual(state.ogTitles, ['SEO Tools 标题']);
  assert.deepEqual(state.ogImages, [
    'https://example.com/cover-1.jpg',
    'https://example.com/cover-2.jpg'
  ], '合法的多个 og:image 候选不得被错误去重');
  assert.equal(state.articleTags, 2, '合法的多值 article:tag 不得被错误去重或重复克隆');
  assert.equal(state.jsonLd, 2, '多个独立 JSON-LD 块不得被重复克隆');
  assert.deepEqual(state.event, {
    title: '新页面',
    url: 'https://example.com/new'
  });
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await verifyPluginMissingOutput(page);
  await verifyThemeFallbackOnly(page);
  await verifyPluginOutputWins(page);
  await verifyMetaOnlyMode(page);
  await verifyPjaxSyncDoesNotMultiplyBroadSelectors(page);

  console.log('SEO Tools 1.9.5 客户端契约验证通过：配置化补齐、插件优先、多值保留、关键标签去重、PJAX 不重复克隆。');
} finally {
  await browser?.close();
}
