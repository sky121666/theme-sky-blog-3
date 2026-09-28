import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = process.cwd();
const entryPoint = path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/seo.js');
const [
  layoutSource,
  settingsSource,
  momentPageSource,
  momentDetailSource,
  equipmentsPageSource,
  equipmentsSource,
  linksSource,
  docSource,
  docCatalogSource,
  steamSource,
  bangumisSource,
  doubanSource
] = await Promise.all([
  readFile(path.join(root, 'templates/modules/shell/layout.html'), 'utf8'),
  readFile(path.join(root, 'templates/modules/shell/theme-settings.html'), 'utf8'),
  readFile(path.join(root, 'templates/moment.html'), 'utf8'),
  readFile(path.join(root, 'templates/modules/moments-app/detail.html'), 'utf8'),
  readFile(path.join(root, 'templates/equipments.html'), 'utf8'),
  readFile(path.join(root, 'templates/modules/equipments-app/list.html'), 'utf8'),
  readFile(path.join(root, 'templates/modules/links-app/list.html'), 'utf8'),
  readFile(path.join(root, 'templates/doc.html'), 'utf8'),
  readFile(path.join(root, 'templates/doc-catalog.html'), 'utf8'),
  readFile(path.join(root, 'templates/steam.html'), 'utf8'),
  readFile(path.join(root, 'templates/bangumis.html'), 'utf8'),
  readFile(path.join(root, 'templates/douban.html'), 'utf8')
]);

assert.match(layoutSource, /th:lang="\$\{#locale != null \? #locale\.toLanguageTag\(\)/, '文档语言必须跟随 Halo 当前 Locale');
assert.match(layoutSource, /shouldEmitSocialIdentity = \$\{serverSocialIdentity == true and !#strings\.isEmpty\(absoluteCanonical\)\}/, '服务端社交 URL 身份字段必须由精确 canonical 显式启用');
assert.match(layoutSource, /property="og:url"[\s\S]*?th:if="\$\{shouldEmitSocialIdentity\}"/, 'og:url 不得继续依赖 SEO Tools 缺席条件');
assert.match(layoutSource, /property="og:site_name"[\s\S]*?th:if="\$\{!#strings\.isEmpty\(site\.title\)\}"/, 'og:site_name 必须在服务端独立输出');
assert.match(layoutSource, /th:data-canonical-authority="\$\{pageAppValue == 'docsme'/, 'Docsme 文档 permalink 必须声明主题 canonical 权威');
assert.doesNotMatch(settingsSource, /<h1\b[^>]*id="theme-settings-title"/, '全局设置窗口不得污染页面主标题层级');
assert.ok(momentPageSource.includes("replaceAll('(?s)```.*$'"), '瞬间 SEO 摘要必须剔除 fenced code block');
assert.ok(momentDetailSource.includes("replaceAll('(?s)&#96;{3}.*$'"), '瞬间详情主标题必须剔除 fenced code block');
assert.match(momentDetailSource, /<h1\b[^>]*class="sr-only"/, '瞬间详情必须提供服务端主标题');
assert.match(equipmentsSource, /<h1\b[^>]*class="sr-only"/, '装备页必须提供服务端主标题');
assert.equal((linksSource.match(/<h1\b/g) || []).length, 1, '链接应用只能保留一个页面级主标题');
for (const [source, label] of [
  [docSource, 'Docsme 文档'],
  [docCatalogSource, 'Docsme 目录'],
  [equipmentsPageSource, '装备'],
  [steamSource, 'Steam'],
  [bangumisSource, '追番'],
  [doubanSource, '豆瓣']
]) {
  assert.match(source, /serverSocialIdentity = true/, `${label} 的明确 canonical 必须同步输出服务端 og:url`);
}

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
    canonicalAuthority: 'plugin',
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
    data-canonical-authority="${values.canonicalAuthority}"
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

async function verifyRobotsContract(page) {
  await loadRuntime(page, `
    <title>越界页</title>
    ${fallbackConfig({ mode: 'meta' })}
    <meta name="robots" content="noindex,follow" data-theme-seo-fallback="robots" />
  `);

  await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  assert.equal(await page.locator("meta[name='robots']").count(), 1, '主题越界 noindex 不得被误删');
  assert.equal(await page.getAttribute("meta[name='robots']", 'content'), 'noindex,follow');
}

async function verifyInvalidProviderMetadataRepair(page) {
  await loadRuntime(page, `
    <title>插件元数据修复</title>
    ${fallbackConfig({ siteName: 'Sky Blog' })}
    <meta name="twitter:creator" content="@null" />
    <meta name="twitter:site" content="https://example.com/profile" />
    <meta name="twitter:creator" content="@sky_blog" />
    <script type="application/ld+json">{"@type":"Article","publisher":{"@type":"Organization","name":""}}</script>
  `);

  await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  assert.deepEqual(
    await page.locator("meta[name='twitter:creator']").evaluateAll((nodes) => nodes.map((node) => node.content)),
    ['@sky_blog'],
    '无效 Twitter 标识必须删除，合法 handle 必须保留'
  );
  assert.equal(await page.locator("meta[name='twitter:site']").count(), 0, 'URL 不得冒充 Twitter handle');
  const structuredData = JSON.parse(await page.locator("script[type='application/ld+json']").textContent());
  assert.equal(structuredData.publisher.name, 'Sky Blog', '空 publisher.name 必须使用站点名修补');
}

async function verifyThemeCanonicalAuthority(page) {
  await loadRuntime(page, `
    <title>Docsme 项目入口</title>
    ${fallbackConfig({
      canonical: 'https://example.com/docs/project/first-doc',
      canonicalAuthority: 'theme'
    })}
    <link rel="canonical" href="https://example.com/docs/project" />
  `);

  await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  assert.equal(await page.locator("link[rel='canonical']").count(), 1, 'Docsme 别名页 canonical 必须唯一');
  assert.equal(
    await page.getAttribute("link[rel='canonical']", 'href'),
    'https://example.com/docs/project/first-doc',
    'Docsme 项目入口必须合并到真实文档 permalink'
  );
}

async function verifyCollectionPageIdentityRepair(page) {
  // Real SEO Tools 1.10.1 response: /tags?p=2 described itself as //tags.
  const canonical = 'https://www.5ee.net/tags?p=2';
  const rawUrl = 'https://www.5ee.net//tags';
  const original = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Tags',
        url: rawUrl,
        mainEntityOfPage: { '@id': rawUrl, '@type': 'WebPage' },
        publisher: { '@type': 'Organization', name: '' },
        image: { url: rawUrl },
        hasPart: { '@type': 'CollectionPage', url: rawUrl },
        itemListElement: [{ '@type': 'Article', url: rawUrl }]
      },
      { '@type': 'Article', url: rawUrl, mainEntityOfPage: rawUrl },
      { '@type': 'CollectionPage', url: 'https://www.5ee.net//categories' },
      { '@type': 'CollectionPage', url: 'https://other.example//tags' },
      { '@type': 'CollectionPage', url: `${rawUrl}?p=3` },
      { '@type': 'CollectionPage', url: `${rawUrl}#related` },
      { '@type': 'CollectionPage', url: rawUrl, mainEntityOfPage: 'https://other.example/tags' },
      { '@type': ['WebPage', 'CollectionPage'], url: { '@id': rawUrl }, mainEntityOfPage: rawUrl }
    ]
  };
  await loadRuntime(page, `${fallbackConfig({ canonical })}
    <link rel="canonical" href="${canonical}">
    <script type="application/ld+json">${JSON.stringify(original)}</script>`);
  await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  const actual = JSON.parse(await page.locator("script[type='application/ld+json']").textContent());
  const expected = structuredClone(original);
  expected['@graph'][0].url = canonical;
  expected['@graph'][0].mainEntityOfPage['@id'] = canonical;
  expected['@graph'][0].publisher.name = 'Sky Blog';
  expected['@graph'][7].url['@id'] = canonical;
  expected['@graph'][7].mainEntityOfPage = canonical;
  assert.deepEqual(actual, expected,
    '仅修同域同路径当前 CollectionPage 身份，保留其他实体、嵌套节点、hash、不同分页和外部 URL');
  await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
  assert.deepEqual(JSON.parse(await page.locator("script[type='application/ld+json']").textContent()), expected,
    '结构化数据身份修补必须幂等');

  for (const [configCanonical, pageCanonical] of [
    [canonical, 'https://other.example/tags?p=2'],
    [canonical, 'https://www.5ee.net/tags'],
    ['https://www.5ee.net/tags?p=2&sort=name', 'https://www.5ee.net/tags?p=2&sort=name'],
    ['https://www.5ee.net/tags?p=2&p=3', 'https://www.5ee.net/tags?p=2&p=3'],
    ['https://www.5ee.net/tags?p=invalid', 'https://www.5ee.net/tags?p=invalid']
  ]) {
    const data = { '@type': ['WebPage', 'CollectionPage'], url: rawUrl, mainEntityOfPage: rawUrl };
    await loadRuntime(page, `${fallbackConfig({ canonical: configCanonical })}
      <link rel="canonical" href="${pageCanonical}">
      <script type="application/ld+json">${JSON.stringify(data)}</script>`);
    await page.evaluate(() => ThemeSeoContract.reconcileSeoHead(document));
    assert.deepEqual(JSON.parse(await page.locator("script[type='application/ld+json']").textContent()), data,
      'canonical 与主题配置不一致或带未证实查询语义时，不得改写 CollectionPage');
  }
}

async function verifyCollectionPagePjaxIdentity(page) {
  await loadRuntime(page, `<title>初始页面</title>${fallbackConfig({ mode: 'meta' })}`);
  for (const [pathname, query] of [['/tags', '?p=2'], ['/archives', ''], ['/categories', '?p=2'], ['/tags', '?p=2']]) {
    const canonical = `https://www.5ee.net${pathname}${query}`;
    const rawUrl = `https://www.5ee.net/${pathname}`;
    const data = [{ '@type': 'CollectionPage', url: rawUrl, mainEntityOfPage: rawUrl }];
    const response = `<!doctype html><html><head><title>${pathname}</title>
      ${fallbackConfig({ canonical, mode: 'meta' })}
      <link rel="canonical" href="${canonical}">
      <script type="application/ld+json">${JSON.stringify(data)}</script>
      </head><body></body></html>`;
    await page.evaluate(html => ThemeSeoContract.syncSeoHeadFromResponse(html), response);
    assert.equal(await page.locator("script[type='application/ld+json']").count(), 1);
    assert.deepEqual(JSON.parse(await page.locator("script[type='application/ld+json']").textContent()), [
      { '@type': 'CollectionPage', url: canonical, mainEntityOfPage: canonical }
    ], '真实响应形态经 PJAX 往返后应只有当前集合页的精确身份');
  }
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
  await verifyRobotsContract(page);
  await verifyInvalidProviderMetadataRepair(page);
  await verifyThemeCanonicalAuthority(page);
  await verifyCollectionPageIdentityRepair(page);
  await verifyCollectionPagePjaxIdentity(page);
  await verifyPjaxSyncDoesNotMultiplyBroadSelectors(page);

  console.log('SEO Tools head 协作离线契约验证通过：服务端缺口策略、插件优先、无效元数据修补、Docsme canonical、当前 CollectionPage 身份、多值保留与 PJAX 同步；真页证据单独记录。');
} finally {
  await browser?.close();
}
