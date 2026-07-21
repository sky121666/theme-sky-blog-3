import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
globalThis.window = {
  location: {
    origin: 'https://example.com'
  }
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function importModule(relPath) {
  const fileUrl = pathToFileURL(path.join(root, relPath)).href;
  return import(fileUrl);
}

const appManifestsMod = await importModule('src/shell-core/runtime/app-manifests.js');
const routeManifestMod = await importModule('src/shell-core/runtime/route-manifest.js');
const categoriesWidgetMod = await importModule('src/widgets/halo/categories/render.js');

const {
  APP_MANIFESTS,
  getAppManifest,
  getKnownAppIds,
  getSameAppPjaxLoadingMode,
  shouldUseWindowLoadingOverlay
} = appManifestsMod;
const {
  resolveRoute,
  inferPageAppFromUrl,
  inferWindowVariantFromUrl,
  getRoutableAppIds
} = routeManifestMod;
const { renderWidget: renderCategoriesWidget } = categoriesWidgetMod;

assert(Array.isArray(APP_MANIFESTS) && APP_MANIFESTS.length > 0, 'APP_MANIFESTS 不能为空');

const seenIds = new Set();
for (const manifest of APP_MANIFESTS) {
  assert(typeof manifest?.appId === 'string' && manifest.appId, 'manifest.appId 必须是非空字符串');
  assert(!seenIds.has(manifest.appId), `manifest.appId 重复: ${manifest.appId}`);
  seenIds.add(manifest.appId);
  assert(typeof manifest.windowVariant === 'string', `${manifest.appId}.windowVariant 必须是字符串`);
  assert(typeof manifest.supportsSameAppPjax === 'boolean', `${manifest.appId}.supportsSameAppPjax 必须是布尔值`);
  const sameAppPjaxLoading = Object.prototype.hasOwnProperty.call(manifest, 'sameAppPjaxLoading')
    ? manifest.sameAppPjaxLoading
    : 'window-overlay';
  assert(
    ['window-overlay', 'progress'].includes(sameAppPjaxLoading),
    `${manifest.appId}.sameAppPjaxLoading 必须为 window-overlay 或 progress`
  );
  if (sameAppPjaxLoading === 'progress') {
    assert(manifest.supportsSameAppPjax, `${manifest.appId} 仅在支持 same-app PJAX 时才能使用 progress`);
  }
  assert(Array.isArray(manifest.sameVariantPageModes), `${manifest.appId}.sameVariantPageModes 必须是数组`);
  assert(typeof manifest.cachePolicy === 'string' && manifest.cachePolicy, `${manifest.appId}.cachePolicy 必须是非空字符串`);
  assert(typeof manifest.assets === 'object' && manifest.assets, `${manifest.appId}.assets 必须存在`);
  assert(typeof manifest.assets.js === 'string' && manifest.assets.js, `${manifest.appId}.assets.js 必须是非空字符串`);
  assert(typeof manifest.assets.css === 'string' && manifest.assets.css, `${manifest.appId}.assets.css 必须是非空字符串`);
  if (!manifest.supportsSameAppPjax) {
    assert(manifest.sameVariantPageModes.length === 0, `${manifest.appId} 不支持 same-app pjax 时 sameVariantPageModes 必须为空`);
  }
}

const knownIds = getKnownAppIds();
assert(knownIds.length === APP_MANIFESTS.length, 'getKnownAppIds 返回数量异常');
for (const appId of knownIds) {
  assert(getAppManifest(appId)?.appId === appId, `getAppManifest(${appId}) 未返回正确 manifest`);
}

const doubanManifest = getAppManifest('douban');
assert(doubanManifest?.windowVariant === 'douban', 'Douban manifest.windowVariant 必须为 douban');
assert(doubanManifest?.supportsSameAppPjax === true, 'Douban 必须支持 same-app PJAX');
assert(doubanManifest?.sameVariantPageModes?.includes('browser-douban'), 'Douban 必须声明 browser-douban 页面模式');
assert(doubanManifest?.cachePolicy === 'app-path-search', 'Douban cachePolicy 必须覆盖路径和查询参数');

assert(getSameAppPjaxLoadingMode('explorer-categories') === 'progress', '分类同应用 PJAX 必须使用轻量进度');
assert(getSameAppPjaxLoadingMode('explorer-archives') === 'progress', '归档同应用 PJAX 必须使用轻量进度');
assert(getSameAppPjaxLoadingMode('explorer-tags') === 'progress', '标签同应用 PJAX 必须使用轻量进度');
assert(
  shouldUseWindowLoadingOverlay('explorer-categories', 'explorer-categories') === false,
  '分类内部切换不得使用窗口骨架'
);
assert(
  shouldUseWindowLoadingOverlay('explorer-archives', 'explorer-archives') === false,
  '归档内部切换不得使用窗口骨架'
);
assert(
  shouldUseWindowLoadingOverlay('explorer-tags', 'explorer-tags') === false,
  '标签内部切换不得使用窗口骨架'
);
assert(
  shouldUseWindowLoadingOverlay('explorer-categories', 'explorer-archives') === true,
  '分类到归档的跨应用切换必须保留窗口加载反馈'
);
assert(
  shouldUseWindowLoadingOverlay('explorer-categories', 'reader') === true,
  '分类到正文的跨应用切换必须保留窗口加载反馈'
);

const routableIds = getRoutableAppIds();
for (const appId of routableIds) {
  assert(seenIds.has(appId), `getRoutableAppIds 包含未知 appId: ${appId}`);
}

const routeSamples = [
  ['https://example.com/', '', 'none'],
  ['https://example.com/moments', 'moments', 'moments'],
  ['https://example.com/moments/demo', 'moments', 'moments'],
  ['https://example.com/friends', 'friends', 'friends'],
  ['https://example.com/friends/page/2', 'friends', 'friends'],
  ['https://example.com/links', 'links', 'links'],
  ['https://example.com/bangumis', 'bangumis', 'bangumis'],
  ['https://example.com/bangumis/page/2', 'bangumis', 'bangumis'],
  ['https://example.com/douban', 'douban', 'douban'],
  ['https://example.com/douban/page/2', 'douban', 'douban'],
  ['https://example.com/steam', 'steam', 'steam'],
  ['https://example.com/steam/page/2', 'steam', 'steam'],
  ['https://example.com/equipments', 'equipments', 'equipments'],
  ['https://example.com/equipments/page/2', 'equipments', 'equipments'],
  ['https://example.com/docs', 'docsme', 'docsme'],
  ['https://example.com/docs/docsme', 'docsme', 'docsme'],
  ['https://example.com/docs/docsme/start', 'docsme', 'docsme'],
  ['https://example.com/photos', 'photos', 'photos'],
  ['https://example.com/photos/photo-demo', 'photos', 'photos'],
  ['https://example.com/tags', 'explorer-tags', 'browser'],
  ['https://example.com/tags/demo', 'explorer-tags', 'browser'],
  ['https://example.com/tags/demo/page/2', 'explorer-tags', 'browser'],
  ['https://example.com/categories', 'explorer-categories', 'browser'],
  ['https://example.com/categories/', 'explorer-categories', 'browser'],
  ['https://example.com/categories?page=2', 'explorer-categories', 'browser'],
  ['https://example.com/categories/demo', 'explorer-categories', 'browser'],
  ['https://example.com/categories/demo/page/2', 'explorer-categories', 'browser'],
  ['https://example.com/authors/demo', 'explorer-author', 'browser'],
  ['https://example.com/archives', 'explorer-archives', 'browser'],
  ['https://example.com/archives/2024', 'explorer-archives', 'browser'],
  ['https://example.com/archives/2024/12', 'explorer-archives', 'browser'],
  ['https://example.com/archives/2024/12/page/2', 'explorer-archives', 'browser'],
  ['https://example.com/archives/demo', 'reader', 'browser'],
  ['https://example.com/login', 'auth', 'none']
];

for (const [url, expectedApp, expectedVariant] of routeSamples) {
  assert(inferPageAppFromUrl(url) === expectedApp, `inferPageAppFromUrl(${url}) 结果错误`);
  assert(inferWindowVariantFromUrl(url) === expectedVariant, `inferWindowVariantFromUrl(${url}) 结果错误`);
  const resolved = resolveRoute(url);
  if (expectedApp) {
    assert(resolved?.appId === expectedApp, `resolveRoute(${url}) appId 错误`);
  }
}

const unknownRouteSamples = [
  'https://example.com/about',
  'https://example.com/archives/page/2',
  'https://example.com/archives/2024/page/2',
  'https://example.com/archives/2024/13',
  'https://example.com/archives/2024/12/page/0',
  'https://example.com/archives/2024/12/page/not-a-number',
  'https://example.com/categories/page/2',
  'https://example.com/categories/demo/extra',
  'https://example.com/categories/demo/page/0',
  'https://example.com/categories/demo/page/01',
  'https://example.com/categories/demo/page/not-a-number',
  'https://example.com/categories/demo/page/2/extra',
  'https://example.com/category/demo',
  'https://example.com/tags/page/2',
  'https://example.com/tags/demo/extra',
  'https://example.com/tags/demo/page/0',
  'https://example.com/tags/demo/page/01',
  'https://example.com/tags/demo/page/not-a-number',
  'https://example.com/tags/demo/page/2/extra',
  'https://example.com/tag/demo'
];

for (const url of unknownRouteSamples) {
  assert(inferPageAppFromUrl(url) === null, `inferPageAppFromUrl(${url}) 应返回 null`);
  assert(inferWindowVariantFromUrl(url) === '', `inferWindowVariantFromUrl(${url}) 应返回空字符串`);
  assert(resolveRoute(url) === null, `resolveRoute(${url}) 应返回 null`);
}

window.__SKY_THEME_ROUTES__ = Object.freeze({
  categoriesUri: '/topics',
  tagsUri: '/labels',
  archivesUri: '/timeline'
});

const customRouteSamples = [
  ['https://example.com/topics', 'explorer-categories', 'browser'],
  ['https://example.com/topics/', 'explorer-categories', 'browser'],
  ['https://example.com/topics?page=3', 'explorer-categories', 'browser'],
  ['https://example.com/topics/demo', 'explorer-categories', 'browser'],
  ['https://example.com/topics/demo/page/3', 'explorer-categories', 'browser'],
  ['https://example.com/labels', 'explorer-tags', 'browser'],
  ['https://example.com/labels/demo', 'explorer-tags', 'browser'],
  ['https://example.com/labels/demo/page/3', 'explorer-tags', 'browser'],
  ['https://example.com/timeline', 'explorer-archives', 'browser'],
  ['https://example.com/timeline/2026', 'explorer-archives', 'browser'],
  ['https://example.com/timeline/2026/05', 'explorer-archives', 'browser'],
  ['https://example.com/timeline/2026/05/page/2', 'explorer-archives', 'browser']
];

for (const [url, expectedApp, expectedVariant] of customRouteSamples) {
  assert(inferPageAppFromUrl(url) === expectedApp, `自定义路由 inferPageAppFromUrl(${url}) 结果错误`);
  assert(inferWindowVariantFromUrl(url) === expectedVariant, `自定义路由 inferWindowVariantFromUrl(${url}) 结果错误`);
  assert(resolveRoute(url)?.appId === expectedApp, `自定义路由 resolveRoute(${url}) appId 错误`);
}

const customUnknownRoute = 'https://example.com/timeline/not-an-archive';
assert(inferPageAppFromUrl(customUnknownRoute) === null, `自定义归档非年月路径应依赖显式 data-pjax-app: ${customUnknownRoute}`);

const customCategoryUnknownRoutes = [
  'https://example.com/topics/page/2',
  'https://example.com/topics/demo/extra',
  'https://example.com/topics/demo/page/0',
  'https://example.com/topics/demo/page/not-a-number',
  'https://example.com/categories/demo',
  'https://example.com/category/demo'
];

for (const url of customCategoryUnknownRoutes) {
  assert(inferPageAppFromUrl(url) === null, `自定义分类路由不应匹配非法或旧前缀: ${url}`);
  assert(resolveRoute(url) === null, `自定义分类 resolveRoute(${url}) 应返回 null`);
}

const customTagUnknownRoutes = [
  'https://example.com/labels/page/2',
  'https://example.com/labels/demo/extra',
  'https://example.com/labels/demo/page/0',
  'https://example.com/labels/demo/page/not-a-number',
  'https://example.com/tags/demo',
  'https://example.com/tag/demo'
];

for (const url of customTagUnknownRoutes) {
  assert(inferPageAppFromUrl(url) === null, `自定义标签非法或旧路由应返回 null: ${url}`);
  assert(inferWindowVariantFromUrl(url) === '', `自定义标签非法或旧路由窗口类型应为空: ${url}`);
  assert(resolveRoute(url) === null, `自定义标签非法或旧路由不得命中: ${url}`);
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const categoryWidgetHtml = renderCategoriesWidget({
  sources: {
    categories: [{
      metadata: { name: 'demo' },
      spec: { displayName: 'Demo' },
      status: { permalink: '/topics/demo', visiblePostCount: 1 },
      children: []
    }]
  },
  escapeHtml,
  mode: 'live'
}, {
  widget: 'halo.categories',
  meta: {}
});

assert(
  categoryWidgetHtml.includes('class="wg-cat-more pjax-link" data-pjax-app="explorer-categories" href="/topics"'),
  '分类 Widget 的“更多分类”必须复用主题 categoriesUri 契约'
);
assert(!categoryWidgetHtml.includes('href="/categories"'), '自定义 categoriesUri 下不得回退到硬编码 /categories');

console.log('协议 typecheck 通过');
