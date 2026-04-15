import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const assetManifestFile = path.join(root, 'templates/assets/asset-manifest.json');
assert(fs.existsSync(assetManifestFile), '缺少 templates/assets/asset-manifest.json');

const manifest = readJson(assetManifestFile);
const requiredAssets = ['shell-core', 'auth', 'reader', 'moments', 'photos', 'explorer-tags', 'explorer-categories', 'explorer-author', 'explorer-archives'];

for (const key of requiredAssets) {
  assert(manifest[key], `asset-manifest 缺少入口: ${key}`);
  for (const jsFile of manifest[key].js || []) {
    const local = path.join(root, 'templates/assets', jsFile.replace(/^\/themes\/theme-sky-blog-3\/assets\//, ''));
    assert(fs.existsSync(local), `缺少 JS 产物: ${jsFile}`);
  }
  for (const cssFile of manifest[key].css || []) {
    const local = path.join(root, 'templates/assets', cssFile.replace(/^\/themes\/theme-sky-blog-3\/assets\//, ''));
    assert(fs.existsSync(local), `缺少 CSS 产物: ${cssFile}`);
  }
}

const legacyOutputs = [
  'templates/assets/css/explorer.css',
  'templates/assets/css/moments-app.css',
  'templates/assets/css/photos-app.css',
  'templates/assets/js/chunks/renderers.js'
];

for (const rel of legacyOutputs) {
  assert(!fs.existsSync(path.join(root, rel)), `遗留旧产物未清理: ${rel}`);
}

const protocolChecks = [
  ['templates/gateway_fragments/layout.html', ['data-app-root="auth"', 'data-app-props="auth"', 'data-page-mode="auth"']],
  ['templates/modules/browser-reader/post.html', ['data-app-root="reader"', 'data-app-props="reader"']],
  ['templates/modules/browser-reader/page.html', ['data-app-root="reader"', 'data-app-props="reader"']],
  ['templates/modules/moments-app/list.html', ['data-app-root="moments"', 'data-app-props="moments"']],
  ['templates/modules/moments-app/detail.html', ['data-app-root="moments"', 'data-app-props="moments"']],
  ['templates/photos.html', ['data-app-root="photos"', 'data-app-props="photos"']],
  ['templates/modules/browser-explorer/tags.html', ['data-app-root="explorer-tags"', 'data-app-props="explorer-tags"']],
  ['templates/modules/browser-explorer/categories.html', ['data-app-root="explorer-categories"', 'data-app-props="explorer-categories"']],
  ['templates/modules/browser-explorer/author.html', ['data-app-root="explorer-author"', 'data-app-props="explorer-author"']],
  ['templates/modules/browser-explorer/archives.html', ['data-app-root="explorer-archives"', 'data-app-props="explorer-archives"']]
];

for (const [rel, patterns] of protocolChecks) {
  const content = read(path.join(root, rel));
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${rel} 缺少协议字段: ${pattern}`);
  }
}

console.log('构建 smoke 通过');
