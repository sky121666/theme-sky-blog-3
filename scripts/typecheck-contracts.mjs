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

const { APP_MANIFESTS, getAppManifest, getKnownAppIds } = appManifestsMod;
const {
  resolveRoute,
  inferPageAppFromUrl,
  inferWindowVariantFromUrl,
  getRoutableAppIds
} = routeManifestMod;

assert(Array.isArray(APP_MANIFESTS) && APP_MANIFESTS.length > 0, 'APP_MANIFESTS 不能为空');

const seenIds = new Set();
for (const manifest of APP_MANIFESTS) {
  assert(typeof manifest?.appId === 'string' && manifest.appId, 'manifest.appId 必须是非空字符串');
  assert(!seenIds.has(manifest.appId), `manifest.appId 重复: ${manifest.appId}`);
  seenIds.add(manifest.appId);
  assert(typeof manifest.windowVariant === 'string', `${manifest.appId}.windowVariant 必须是字符串`);
  assert(typeof manifest.supportsSameAppPjax === 'boolean', `${manifest.appId}.supportsSameAppPjax 必须是布尔值`);
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
  ['https://example.com/photos', 'photos', 'photos'],
  ['https://example.com/tags', 'explorer-tags', 'browser'],
  ['https://example.com/tags/demo', 'explorer-tags', 'browser'],
  ['https://example.com/categories', 'explorer-categories', 'browser'],
  ['https://example.com/categories/demo', 'explorer-categories', 'browser'],
  ['https://example.com/authors/demo', 'explorer-author', 'browser'],
  ['https://example.com/archives', 'explorer-archives', 'browser'],
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
  'https://example.com/docs',
  'https://example.com/about'
];

for (const url of unknownRouteSamples) {
  assert(inferPageAppFromUrl(url) === null, `inferPageAppFromUrl(${url}) 应返回 null`);
  assert(inferWindowVariantFromUrl(url) === '', `inferWindowVariantFromUrl(${url}) 应返回空字符串`);
  assert(resolveRoute(url) === null, `resolveRoute(${url}) 应返回 null`);
}

console.log('协议 typecheck 通过');
