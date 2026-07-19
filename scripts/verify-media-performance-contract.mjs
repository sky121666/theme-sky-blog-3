import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const previousIntersectionObserver = globalThis.IntersectionObserver;
let observerInstance = null;

function datasetKey(attributeName) {
  return attributeName
    .slice(5)
    .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

class FakeImage {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.dataset = {};
    this.setOrder = [];
    for (const [name, value] of this.attributes) {
      if (name.startsWith('data-')) this.dataset[datasetKey(name)] = value;
    }
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this.setOrder.push(name);
    if (name.startsWith('data-')) this.dataset[datasetKey(name)] = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) delete this.dataset[datasetKey(name)];
  }
}

class FakeRoot {
  constructor(images) {
    this.images = images;
  }

  querySelectorAll() {
    return this.images.filter((image) => (
      (image.hasAttribute('data-src') || image.hasAttribute('data-srcset'))
      && !image.hasAttribute('data-no-lazy')
    ));
  }

  contains(image) {
    return this.images.includes(image);
  }
}

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    this.observeCalls = 0;
    this.unobserveCalls = 0;
    observerInstance = this;
  }

  observe(image) {
    this.observeCalls += 1;
    this.observed.add(image);
  }

  unobserve(image) {
    this.unobserveCalls += 1;
    this.observed.delete(image);
  }

  intersect(image) {
    this.callback([{ target: image, isIntersecting: true }]);
  }
}

try {
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  const lazyMediaUrl = pathToFileURL(path.join(root, 'src/shell/desktop-shell/runtime/shared/lazy-media.js'));
  const { disposeLazyImages, initLazyImages } = await import(`${lazyMediaUrl.href}?contract=observer`);

  const first = new FakeImage({
    'data-src': '/thumb-m.webp',
    'data-srcset': '/thumb-s.webp 400w, /thumb-m.webp 800w',
    'data-sizes': '(max-width: 600px) 100vw, 400px',
    loading: 'eager',
    fetchpriority: 'high'
  });
  const second = new FakeImage({ 'data-src': '/second.webp' });
  const third = new FakeImage({ 'data-srcset': '/third.webp 400w' });
  const firstRoot = new FakeRoot([first, second]);
  const secondRoot = new FakeRoot([third]);

  initLazyImages(firstRoot);
  initLazyImages(firstRoot);
  initLazyImages(secondRoot);

  assert.equal(observerInstance.options.rootMargin, '200px 0px');
  assert.equal(observerInstance.observeCalls, 3, '重复初始化不能重复观察同一图片');
  assert.equal(observerInstance.observed.size, 3);
  assert.equal(first.getAttribute('loading'), 'eager', '不得覆盖显式 LCP loading');
  assert.equal(first.getAttribute('fetchpriority'), 'high', '不得覆盖显式 LCP 优先级');
  assert.equal(second.getAttribute('loading'), 'lazy');
  assert.equal(second.getAttribute('decoding'), 'async');
  assert.equal(second.getAttribute('fetchpriority'), 'low');

  observerInstance.intersect(first);
  assert.deepEqual(
    first.setOrder.filter((name) => ['sizes', 'srcset', 'src'].includes(name)),
    ['sizes', 'srcset', 'src'],
    '响应式图片必须先应用 sizes，再应用 srcset，最后应用 src'
  );
  assert.equal(first.getAttribute('src'), '/thumb-m.webp');
  assert.equal(first.getAttribute('srcset'), '/thumb-s.webp 400w, /thumb-m.webp 800w');
  assert.equal(first.getAttribute('sizes'), '(max-width: 600px) 100vw, 400px');
  assert.equal(first.hasAttribute('data-src'), false);
  assert.equal(first.hasAttribute('data-srcset'), false);
  assert.equal(first.hasAttribute('data-sizes'), false);

  disposeLazyImages(firstRoot);
  assert.equal(observerInstance.observed.has(second), false, '页面停用必须解除旧页面图片');
  assert.equal(observerInstance.observed.has(third), true, '不得解除其他根节点的图片');

  observerInstance.intersect(third);
  assert.equal(third.getAttribute('srcset'), '/third.webp 400w');
  assert.equal(observerInstance.observed.size, 0);
} finally {
  if (previousIntersectionObserver === undefined) {
    delete globalThis.IntersectionObserver;
  } else {
    globalThis.IntersectionObserver = previousIntersectionObserver;
  }
}

const pageApp = read('src/shell/desktop-shell/runtime/shared/page-app.js');
assert.match(pageApp, /import \{ disposeLazyImages, initLazyImages \} from '\.\/lazy-media\.js';/);
assert.match(
  pageApp,
  /finally \{\s*disposeLazyImages\(activeApp\.root \|\| document\);\s*disposeLazyComments\(activeApp\.root \|\| document\);\s*registry\.activeApp = null;/
);

const moments = read('templates/modules/moments-app/list.html');
assert.match(moments, /thumbnail\.gen\(coverImage, 'xl'\)/, '瞬间封面必须提供完整响应式候选');
assert.match(moments, /loading="eager"[\s\S]*?fetchpriority="high"/, '瞬间首屏封面必须作为 LCP 资源加载');
assert.match(moments, /data-moment-photo-url=\$\{media\.url\}/, '瞬间查看器必须保留原图 URL');
assert.match(moments, /th:data-src="\$\{thumbnail\.gen\(media\.url, 's'\)\}"/);
assert.match(moments, /th:data-srcset="\|\$\{thumbnail\.gen\(media\.url, 's'\)\} 400w,/);
assert.doesNotMatch(moments, /data-src=\$\{media\.url\}/, '瞬间列表不得继续懒加载原图');

const photos = read('templates/photos.html');
assert.match(photos, /th:each="groupItem, groupIter : \$\{groups\}"/);
assert.match(photos, /thumbnail\.gen\(groupCoverPrimary, 'l'\)/, '相簿封面必须提供响应式缩略图');
assert.match(photos, /isFirstPhotoPage and photoIter\.first[\s\S]*?fetchpriority="high"/, '图库只应优先首屏首张可见照片');
assert.match(photos, /#theme\.assets\('\/images\/transparent\.svg'\)/, '图库懒加载应复用主题透明占位资源');
assert.doesNotMatch(photos, /<img[\s\S]*?src="data:/, '图库 img 不得重复内联 data URI 占位图');
assert.match(photos, /th:data-src="\$\{!#strings\.isEmpty\(photoListImage\) \? thumbnail\.gen\(photoListImage, 'm'\) : null\}"/);
assert.match(photos, /th:data-srcset="\$\{!#strings\.isEmpty\(photoListImage\)/);
assert.doesNotMatch(photos, /data-src=\$\{!#strings\.isEmpty\(photo\.spec\.cover\)/, '图库列表不得继续懒加载原图');

const photoDetail = read('templates/photo.html');
assert.match(photoDetail, /class="photos-detail-image"[\s\S]*?th:src="\$\{photo\.spec\.url\}"/, '图库详情查看器必须保留原图');

const equipments = read('templates/modules/equipments-app/list.html');
assert.equal(
  (equipments.match(/th:src="\$\{thumbnail\.gen\(equipment\.spec\.cover, 'l'\)\}"/g) || []).length,
  2,
  '装备主图和背景必须复用同一缩略图候选'
);
assert.match(equipments, /isFirstEquipmentPage and iter\.first \? 'eager' : 'lazy'[\s\S]*?isFirstEquipmentPage and iter\.first \? 'high' : 'low'/);
assert.doesNotMatch(equipments, /th:src="\$\{equipment\.spec\.cover\}"/, '装备列表不得继续直出原图');

console.log('media performance contract passed');
