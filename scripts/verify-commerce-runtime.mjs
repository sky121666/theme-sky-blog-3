import { assertCurrentBuild } from './lib/build-identity.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Only local source files, compiled CSS and in-memory documents are served.
// Every request is intercepted; this fixture cannot contact a Halo instance.
// Official Commerce components are deliberately absent: no orders are created.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertCurrentBuild(root);
const origin = 'https://theme.test';
const image = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/></svg>`)}`;
const firstImage = image('#4a90e2');
const secondImage = image('#e2a54a');
const accountAvatar = await readFile(path.join(root, 'scripts/fixtures/images/avatar-category.png'));
const categoryCss = await readFile(path.join(root, 'src/apps/shop/styles/category-appearance.css'), 'utf8');
const categoryTemplate = await readFile(path.join(root, 'templates/modules/shop-app/category-appearance.html'), 'utf8');
const categoryFallback = categoryTemplate.match(/<svg\b[\s\S]*?<\/svg>/)?.[0].replace(/\s+th:[\w:-]+="[^"]*"/g, '') || '';
const accountEvidence = path.join(root, 'output/appstore-account-direct-order-2026-10-09');
const accountFragments = new Map();
if (process.env.SHOP_ACCOUNT_FIXTURE_DIR) {
  const directory = path.resolve(root, process.env.SHOP_ACCOUNT_FIXTURE_DIR);
  for (const [state, filename] of [['avatar', 'account-authenticated-avatar.html'], ['none', 'account-authenticated-no-avatar.html'], ['anonymous', 'account-anonymous.html']]) {
    accountFragments.set(state, await readFile(path.join(directory, filename), 'utf8'));
  }
}
const manifest = JSON.parse(await readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
assert.ok(manifest.shop?.css?.length, 'Build the Shop assets with pnpm run build before running this fixture');
const assetPrefix = '/themes/theme-sky-blog-3/assets/';
const cssSources = new Map();
for (const asset of manifest.shop.css) {
  assert.ok(asset.startsWith(assetPrefix), `Unexpected Shop CSS path: ${asset}`);
  const localPath = path.resolve(root, 'templates/assets', asset.slice(assetPrefix.length));
  assert.ok(localPath.startsWith(path.join(root, 'templates/assets') + path.sep), 'CSS must stay inside local assets');
  cssSources.set(asset, await readFile(localPath, 'utf8'));
}

function accountFooter(state) {
  const rendered = accountFragments.get(state);
  if (rendered) return rendered.replace(/<a\b/, '<a id="sidebar-last"');
  const anonymous = state === 'anonymous';
  const avatar = state !== 'none' && !anonymous;
  return `<div class="shop-sidebar-footer"><a id="sidebar-last" class="shop-account-trigger" ${anonymous ? 'data-shop-account-login href="/login?redirect_uri=/shop/products"' : 'data-shop-account-orders href="/uc/shop/orders"'}>
    <span class="shop-account-picture">${avatar ? `<img class="shop-account-avatar" data-shop-account-avatar src="${state === 'broken' ? '/fixture-broken-avatar.png' : '/fixture-avatar.png'}" alt="">` : ''}
    <span class="shop-account-icon" data-shop-account-fallback aria-hidden="true"${avatar ? ' hidden' : ''}><span class="icon-[lucide--user-round]"></span></span></span>
    <span class="shop-account-name">${anonymous ? '登录' : '示例用户'}</span></a></div>`;
}

function fixtureHtml(account = 'avatar', category = null) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Shop fixture</title>
    ${[...cssSources.keys()].map((href) => `<link rel="stylesheet" href="${href}">`).join('')}
    <style>
      ${categoryCss}
      html,body{margin:0;height:100%}
      /* Shell geometry from layout.html/window-frame.html; mobile frame sizing
         must come from the real compiled Shop CSS, never this fixture. */
      .window-layer{position:fixed;inset:28px 0 0;display:flex;align-items:flex-start;justify-content:center;pointer-events:none}
      .shop-window{position:relative;display:flex;flex-direction:column;width:100%;height:100%;pointer-events:auto}
      @media(min-width:768px){.window-layer{inset:0;align-items:center}#window-frame-root{width:100%;height:100%}}
    </style>
    </head><body><div class="window-layer"><div id="window-frame-root"><section class="shop-window"><div class="shop-window-content">
    <div id="shop-app" class="shop-app" data-app-root="shop" data-shop-scene="products" data-menu-open="false" data-shop-chrome-title="所有商品" data-shop-site-title="Fixture">
      <script type="application/json" data-app-props="shop">{"version":1,"appId":"shop","data":{"scene":"products"}}</script>
      <div class="shop-app-shell">
        <aside id="shop-sidebar" class="shop-sidebar" aria-label="商店导航">
          <div class="shop-dragbar"></div>
          <form class="shop-search" action="/shop/products" method="get" data-shop-search>
            <label class="shop-ui-input"><input id="sidebar-search" type="search" name="keyword" aria-label="搜索商品" value="原关键字"></label>
            <input type="hidden" name="categoryId" value="cat-a"><input type="hidden" name="sort" value="minPrice,asc"><input type="hidden" name="view" value="all">
          </form>
          <nav class="shop-nav">
            <a id="browse-all" class="shop-nav-link" href="/shop/products?view=all" data-shop-browse data-shop-view="all" data-shop-category="" data-shop-keyword="" data-shop-sort="">所有商品</a>
            <a id="browse-categories" class="shop-nav-link" href="/shop/products?view=categories" data-shop-browse data-shop-view="categories">全部分类</a>
            <a id="browse-category" class="shop-nav-link" href="/shop/products?categoryId=cat-b&amp;view=all" data-shop-browse data-shop-view="all" data-shop-category="cat-b" data-shop-keyword="" data-shop-sort="">分类 B</a>
            <a class="shop-nav-link" href="/shop/cart">购物车</a>
          </nav>
          ${accountFooter(account)}
        </aside>
        <button class="shop-menu-backdrop" type="button" data-shop-menu-close aria-label="关闭商店导航" tabindex="-1"></button>
        <main class="shop-main">
          <div class="shop-main-header"><button id="menu-toggle" class="shop-ui-btn shop-mobile-menu" type="button" data-shop-menu-toggle aria-controls="shop-sidebar" aria-expanded="false">导航</button><h1 class="shop-page-title">所有商品</h1></div>
          <div class="shop-filterbar">
            <form id="main-search" class="shop-search" action="/shop/products" method="get" data-shop-search>
              <input class="shop-ui-input" type="search" name="keyword" aria-label="商品关键字" value="原关键字">
              <input type="hidden" name="categoryId" value="cat-a"><input type="hidden" name="sort" value="minPrice,asc"><input type="hidden" name="view" value="all">
            </form>
            <form id="filter" class="shop-sort" action="/shop/products" method="get" data-shop-filter>
              <input type="hidden" name="keyword" value="原关键字"><input type="hidden" name="view" value="all">
              <label for="category">分类</label><select id="category" class="shop-ui-select" name="categoryId"><option value="">全部</option><option value="cat-a" selected>分类 A</option><option value="cat-b">分类 B</option></select>
              <label for="sort">排序</label><select id="sort" class="shop-ui-select" name="sort"><option value="">默认</option><option value="minPrice,asc" selected>价格升序</option><option value="minPrice,desc">价格降序</option><option value="title,asc">名称</option></select>
              <button class="shop-ui-btn" type="submit">应用</button>
            </form>
          </div>
          <p id="description" class="shop-product-description">保留商品简介，验证配置控制实际可见性。</p>
          ${category ? `<a id="category-image-link" href="/shop/products?categoryId=cat-image"><span class="shop-category-icon" aria-hidden="true"><img class="shop-category-image" data-shop-category-image src="${category === 'broken' ? '/fixture-broken-category.png' : '/fixture-category.png'}" alt="" width="28" height="28"><span class="shop-category-glyph" data-shop-category-glyph="folder">${categoryFallback}</span></span><span>图片分类</span></a>` : ''}
          <div class="shop-gallery-thumbs"><button id="thumbnail-one" type="button" data-shop-thumbnail="${firstImage}" aria-pressed="true"><img src="${firstImage}" alt="第一张"></button><button id="thumbnail-two" type="button" data-shop-thumbnail="${secondImage}" aria-pressed="false"><img src="${secondImage}" alt="第二张"></button></div>
          <img id="gallery-main" data-shop-gallery-main src="${firstImage}" alt="商品主图" width="120" height="80">
          <div id="fixture-carousel" class="shop-gallery-carousel" aria-label="商品图册">
            ${Array.from({ length: 8 }, (_, i) => `<a class="shop-gallery-card" href="/shop/product/${i}"><img class="shop-gallery-image" src="${firstImage}" alt="商品 ${i}"><div class="shop-gallery-caption">商品 ${i}</div></a>`).join('')}
          </div>
          <button id="carousel-next" type="button" data-shop-carousel="fixture-carousel" data-shop-direction="next">下一组</button>
          <button id="carousel-previous" type="button" data-shop-carousel="fixture-carousel" data-shop-direction="previous">上一组</button>
          <a id="next-page" class="shop-ui-btn" href="/shop/products?page=4" data-shop-browse data-shop-page="4">下一页</a>
        </main>
      </div>
    </div></div></section></div></div></body></html>`;
}

const initialQuery = '?keyword=%E5%8E%9F%E5%85%B3%E9%94%AE%E5%AD%97&categoryId=cat-a&sort=minPrice%2Casc&view=all&page=3';
const browser = await chromium.launch({ headless: true });
let passed = 0;
const failures = [];

async function withPage(action, { mobile = false, reducedMotion = 'no-preference', query = initialQuery, account = 'avatar', category = null } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 }, reducedMotion, serviceWorkers: 'block' });
  const pageErrors = [];
  const unsafeRequests = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') {
      unsafeRequests.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    if (cssSources.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: cssSources.get(url.pathname) });
    if (url.pathname === '/fixture-avatar.png') return route.fulfill({ status: 200, contentType: 'image/png', body: accountAvatar });
    if (url.pathname === '/fixture-broken-avatar.png') return route.fulfill({ status: 404, contentType: 'image/png', body: '' });
    if (url.pathname === '/fixture-category.png') return route.fulfill({ status: 200, contentType: 'image/png', body: accountAvatar });
    if (url.pathname === '/fixture-broken-category.png') return route.fulfill({ status: 404, contentType: 'image/png', body: '' });
    if (request.isNavigationRequest() && url.pathname === '/shop/products') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml(account, category) });
    }
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      const sourcePath = path.resolve(root, `.${url.pathname}`);
      if (!sourcePath.startsWith(path.join(root, 'src') + path.sep)) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(sourcePath, 'utf8') });
    }
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    unsafeRequests.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${origin}/shop/products${query}`);
    await page.evaluate(async () => {
      const avatar = document.querySelector('[data-shop-account-avatar]');
      window.__avatarBeforeHydrate = avatar ? { complete: avatar.complete, naturalWidth: avatar.naturalWidth } : null;
      const categoryImage = document.querySelector('[data-shop-category-image]');
      window.__categoryBeforeHydrate = categoryImage ? { complete: categoryImage.complete, naturalWidth: categoryImage.naturalWidth } : null;
      await import('/src/apps/shop/hydrate.js');
      window.__shopLifecycle = window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop;
      window.__shopRoot = document.querySelector('[data-app-root="shop"]');
      window.__shopLifecycle.hydrate(window.__shopRoot);
    });
    await action(page);
    assert.deepEqual(pageErrors, [], 'No browser page errors');
    assert.deepEqual(unsafeRequests, [], 'All browser requests must be served from the local fixture');
  } finally {
    await context.close();
  }
}

async function test(name, action, options) {
  try {
    await withPage(action, options);
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function assertNavigation(page, action, expected) {
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/shop/products' && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value)),
    action()
  ]);
  const url = new URL(page.url());
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/shop/products');
  assert.deepEqual(Object.fromEntries(url.searchParams), expected);
  assert.equal(url.hash, '', 'Navigation must not retain a stale hash');
}

async function openPhoneMenu(page) {
  await page.evaluate(() => {
    const input = document.getElementById('sidebar-search');
    const original = input.focus;
    window.__menuFocusTrace = [];
    input.focus = function (...args) {
      const result = original.apply(this, args);
      window.__menuFocusTrace.push({ active: document.activeElement.id, visibility: getComputedStyle(this).visibility, sidebarVisibility: getComputedStyle(document.getElementById('shop-sidebar')).visibility, inert: document.getElementById('shop-sidebar').inert });
      return result;
    };
  });
  await page.click('#menu-toggle');
  try {
    await page.waitForFunction(() => document.activeElement.id === 'sidebar-search');
  } catch (error) {
    const state = await page.evaluate(() => ({ active: document.activeElement.id, open: window.__shopRoot.dataset.menuOpen, focusTrace: window.__menuFocusTrace, visibility: getComputedStyle(document.getElementById('shop-sidebar')).visibility }));
    throw new Error(`${error.message}; menu focus state: ${JSON.stringify(state)}`);
  }
}

try {
  await test('SSR browse heading replaces stale App title metadata', async (page) => {
    assert.deepEqual(await page.evaluate(() => {
      window.__shopRoot.dataset.shopChromeTitle = '所有商品';
      document.querySelector('.shop-page-title').textContent = ' DEMO图像 ';
      return window.__shopLifecycle.getDocumentState(window.__shopRoot, { documentTitle: 'Old page title' });
    }), { title: 'DEMO图像 - Fixture', windowTitle: 'DEMO图像', windowSubtitle: '', windowVariant: 'shop' });
  });

  await test('protocol accepts the app root itself and reads props/title', async (page) => {
    assert.deepEqual(await page.evaluate(() => {
      const protocol = window.__shopLifecycle.resolveProtocol(window.__shopRoot);
      const title = window.__shopLifecycle.getDocumentState(window.__shopRoot, { documentTitle: 'Previous' });
      return { sameRoot: protocol.root === window.__shopRoot, appId: protocol.appId, props: protocol.props, state: protocol.state, title };
    }), {
      sameRoot: true, appId: 'shop', props: { version: 1, appId: 'shop', data: { scene: 'products' } }, state: { scene: 'products' },
      title: { title: '所有商品 - Fixture', windowTitle: '所有商品', windowSubtitle: '', windowVariant: 'shop' }
    });
  });

  await test('protocol/hydrate support a document wrapper and an absent app', async (page) => {
    assert.deepEqual(await page.evaluate(() => {
      const lifecycle = window.__shopLifecycle;
      const wrapped = lifecycle.resolveProtocol(document);
      lifecycle.hydrate(document);
      lifecycle.dispose(document);
      const absent = document.createElement('div');
      const missing = lifecycle.resolveProtocol(absent);
      lifecycle.hydrate(absent);
      lifecycle.dispose(absent);
      return { wrappedRoot: wrapped.root === window.__shopRoot, absentRoot: missing.root, scene: missing.state.scene };
    }), { wrappedRoot: true, absentRoot: null, scene: 'products' });
  });

  await test('repeat hydrate binds one gallery listener; dispose removes it; remount works', async (page) => {
    await page.evaluate(() => {
      const img = document.getElementById('gallery-main');
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      window.__galleryWrites = 0;
      Object.defineProperty(img, 'src', {
        get() { return descriptor.get.call(this); },
        set(value) { window.__galleryWrites++; descriptor.set.call(this, value); }
      });
      window.__shopLifecycle.hydrate(window.__shopRoot);
      window.__shopLifecycle.hydrate(window.__shopRoot);
    });
    await page.click('#thumbnail-two img');
    assert.deepEqual(await page.evaluate(() => ({ src: document.getElementById('gallery-main').src, writes: window.__galleryWrites, pressed: [...document.querySelectorAll('[data-shop-thumbnail]')].map((node) => node.getAttribute('aria-pressed')) })), { src: secondImage, writes: 1, pressed: ['false', 'true'] });
    await page.evaluate(() => window.__shopLifecycle.dispose(window.__shopRoot));
    await page.click('#thumbnail-one');
    assert.equal(await page.evaluate(() => window.__galleryWrites), 1, 'Disposed gallery must not handle clicks');
    await page.evaluate(() => window.__shopLifecycle.hydrate(window.__shopRoot));
    await page.click('#thumbnail-one');
    assert.deepEqual(await page.evaluate(() => ({ src: document.getElementById('gallery-main').src, writes: window.__galleryWrites, pressed: [...document.querySelectorAll('[data-shop-thumbnail]')].map((node) => node.getAttribute('aria-pressed')) })), { src: firstImage, writes: 2, pressed: ['true', 'false'] });
  });

  await test('description defaults visible and false/empty flags affect actual layout', async (page) => {
    for (const [flag, expectedVisible] of [[null, true], ['', true], ['true', true], ['false', false], ['0', false], ['off', false], [' false ', false]]) {
      const actual = await page.evaluate((value) => {
        if (value === null) delete window.__shopRoot.dataset.shopDescriptions;
        else window.__shopRoot.dataset.shopDescriptions = value;
        window.__shopLifecycle.hydrate(window.__shopRoot);
        const node = document.getElementById('description');
        return { hidden: node.hidden, visible: node.getClientRects().length > 0, display: getComputedStyle(node).display };
      }, flag);
      assert.equal(actual.hidden, !expectedVisible, `Description flag ${JSON.stringify(flag)} hidden property`);
      assert.equal(actual.visible, expectedVisible, `Description flag ${JSON.stringify(flag)} actual display (${actual.display})`);
    }
  });

  await test('desktop sidebar stays interactive and mobile controls stay hidden', async (page) => {
    assert.deepEqual(await page.evaluate(() => ({ inert: document.getElementById('shop-sidebar').inert, menu: getComputedStyle(document.getElementById('menu-toggle')).display, backdrop: getComputedStyle(document.querySelector('[data-shop-menu-close]')).display })), { inert: false, menu: 'none', backdrop: 'none' });
    await page.focus('#sidebar-search');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-search');
  });

  await test('phone Shop window fills the real shell frame width and height', async (page) => {
    const sizes = await page.evaluate(() => {
      const read = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      };
      return { layer: read('.window-layer'), frame: read('#window-frame-root'), window: read('.shop-window'), app: read('.shop-app'), viewportWidth: innerWidth };
    });
    assert.equal(sizes.layer.width, sizes.viewportWidth);
    for (const key of ['frame', 'window', 'app']) {
      assert.ok(Math.abs(sizes[key].width - sizes.layer.width) < 2, `${key} must fill the shell width: ${JSON.stringify(sizes)}`);
      assert.ok(Math.abs(sizes[key].height - sizes.layer.height) < 2, `${key} must fill the shell height: ${JSON.stringify(sizes)}`);
    }
  }, { mobile: true });

  await test('phone sidebar is inert while closed and opens with one listener', async (page) => {
    assert.equal(await page.evaluate(() => document.getElementById('shop-sidebar').inert), true);
    await page.evaluate(() => { window.__shopLifecycle.hydrate(window.__shopRoot); window.__shopLifecycle.hydrate(window.__shopRoot); document.getElementById('sidebar-search').focus(); });
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'sidebar-search', 'Closed sidebar must not accept keyboard focus');
    await openPhoneMenu(page);
    assert.deepEqual(await page.evaluate(() => ({ open: window.__shopRoot.dataset.menuOpen, expanded: document.getElementById('menu-toggle').getAttribute('aria-expanded'), inert: document.getElementById('shop-sidebar').inert, active: document.activeElement.id })), { open: 'true', expanded: 'true', inert: false, active: 'sidebar-search' });
  }, { mobile: true });

  await test('phone menu traps Tab both ways, closes on Escape and restores focus', async (page) => {
    await openPhoneMenu(page);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-last');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-search');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => ({ open: window.__shopRoot.dataset.menuOpen, expanded: document.getElementById('menu-toggle').getAttribute('aria-expanded'), inert: document.getElementById('shop-sidebar').inert, active: document.activeElement.id })), { open: 'false', expanded: 'false', inert: true, active: 'menu-toggle' });
  }, { mobile: true });

  for (const mobile of [false, true]) {
    await test(`${mobile ? 'phone' : 'desktop'} account row shows a round 36px avatar and a name without a popup`, async (page) => {
      if (mobile) await openPhoneMenu(page);
      assert.equal(await page.locator('.shop-sidebar-footer a').count(), 1);
      assert.equal(await page.locator('#sidebar-last').getAttribute('href'), '/uc/shop/orders');
      assert.equal(await page.locator('#sidebar-last').getAttribute('data-shop-account-orders'), '');
      assert.equal(await page.locator('.shop-account-name').textContent(), '示例用户');
      assert.equal(await page.locator('.shop-sidebar-footer details, .shop-sidebar-footer summary, [data-shop-account-menu], .shop-account-popup').count(), 0);
      const geometry = await page.evaluate(() => {
        const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const avatar = document.querySelector('[data-shop-account-avatar]');
        return { row: rect('.shop-account-trigger'), picture: rect('.shop-account-picture'), avatar: rect('.shop-account-avatar'), name: rect('.shop-account-name'), radius: getComputedStyle(avatar).borderRadius, alt: avatar.getAttribute('alt'), loaded: avatar.complete && avatar.naturalWidth > 0, fallbackHidden: document.querySelector('[data-shop-account-fallback]').hidden };
      });
      for (const key of ['picture', 'avatar']) {
        assert.equal(geometry[key].width, 36, `${key} keeps 36px width`);
        assert.equal(geometry[key].height, 36, `${key} keeps 36px height`);
      }
      assert.ok(geometry.radius === '50%' || parseFloat(geometry.radius) >= 18, `Avatar must be circular: ${geometry.radius}`);
      assert.equal(geometry.alt, '');
      assert.equal(geometry.loaded, true, 'The local example avatar must actually load');
      assert.equal(geometry.fallbackHidden, true);
      assert.ok(geometry.name.left > geometry.avatar.right, 'Name sits next to the avatar');
      assert.ok(geometry.name.right <= geometry.row.right + 1, 'Name stays inside the account row');
      assert.ok(Math.abs((geometry.name.top + geometry.name.bottom - geometry.avatar.top - geometry.avatar.bottom) / 2) < 2, 'Name and avatar share a vertical center');
      await mkdir(accountEvidence, { recursive: true });
      await page.locator('.shop-sidebar-footer').screenshot({ path: path.join(accountEvidence, `account-avatar-${mobile ? 'phone' : 'desktop'}.png`) });
    }, { mobile });

    await test(`${mobile ? 'phone' : 'desktop'} long display name truncates without squeezing the 36px avatar`, async (page) => {
      if (mobile) await openPhoneMenu(page);
      await page.locator('.shop-account-name').evaluate((node) => { node.textContent = '示例用户的很长显示名称用于验证侧栏账户文字不会挤压头像'.repeat(3); });
      const geometry = await page.evaluate(() => {
        const name = document.querySelector('.shop-account-name');
        const style = getComputedStyle(name);
        const picture = document.querySelector('.shop-account-picture').getBoundingClientRect();
        const avatar = document.querySelector('.shop-account-avatar').getBoundingClientRect();
        const row = document.querySelector('.shop-account-trigger').getBoundingClientRect();
        const text = name.getBoundingClientRect();
        return { nameWidth: name.clientWidth, nameScrollWidth: name.scrollWidth, overflow: style.overflow, ellipsis: style.textOverflow, whiteSpace: style.whiteSpace, pictureWidth: picture.width, avatarWidth: avatar.width, avatarHeight: avatar.height, rowRight: row.right, nameRight: text.right };
      });
      assert.ok(geometry.nameWidth > 0 && geometry.nameScrollWidth > geometry.nameWidth, `Long name is constrained: ${JSON.stringify(geometry)}`);
      assert.deepEqual([geometry.overflow, geometry.ellipsis, geometry.whiteSpace], ['hidden', 'ellipsis', 'nowrap']);
      assert.deepEqual([geometry.pictureWidth, geometry.avatarWidth, geometry.avatarHeight], [36, 36, 36]);
      assert.ok(geometry.nameRight <= geometry.rowRight + 1, 'Long name does not overflow the account row');
    }, { mobile });
  }

  await test('account row reaches the document navigation owner as one direct orders link', async (page) => {
    assert.deepEqual(await page.evaluate(() => {
      const link = document.getElementById('sidebar-last');
      const clicks = [];
      const sink = (event) => { clicks.push({ prevented: event.defaultPrevented, href: event.target.closest('a')?.getAttribute('href') }); event.preventDefault(); };
      document.addEventListener('click', sink);
      link.click();
      document.removeEventListener('click', sink);
      return { clicks, managed: link.classList.contains('pjax-link'), popup: !!document.querySelector('.shop-account-popup, [data-shop-account-menu]') };
    }), { clicks: [{ prevented: false, href: '/uc/shop/orders' }], managed: true, popup: false });
  });

  await test('empty avatar uses the existing icon in the same 36px picture slot', async (page) => {
    const shellCss = await readFile(path.join(root, 'templates/assets/css/shell-core/index.css'), 'utf8');
    const start = shellCss.indexOf('.icon-\\[lucide--user-round\\]{');
    assert.ok(start >= 0, 'Account fallback reuses the existing Lucide icon rule');
    await page.addStyleTag({ content: shellCss.slice(start, shellCss.indexOf('}', start) + 1) });
    assert.equal(await page.locator('.shop-account-avatar').count(), 0);
    assert.equal(await page.locator('[data-shop-account-fallback]').isVisible(), true);
    const geometry = await page.evaluate(() => {
      const picture = document.querySelector('.shop-account-picture').getBoundingClientRect();
      const icon = document.querySelector('[data-shop-account-fallback]');
      const rect = icon.getBoundingClientRect();
      return { picture: [picture.width, picture.height], icon: [rect.width, rect.height], radius: getComputedStyle(icon).borderRadius };
    });
    assert.deepEqual(geometry.picture, [36, 36]);
    assert.deepEqual(geometry.icon, [36, 36]);
    assert.ok(geometry.radius === '50%' || parseFloat(geometry.radius) >= 18, 'Fallback icon is circular');
    await mkdir(accountEvidence, { recursive: true });
    await page.locator('.shop-sidebar-footer').screenshot({ path: path.join(accountEvidence, 'account-icon-fallback.png') });
  }, { account: 'none' });

  await test('avatar load error reveals the user icon without changing name or direct orders link', async (page) => {
    await page.locator('[data-shop-account-avatar]').evaluate((node) => { node.src = '/fixture-broken-avatar.png'; });
    await page.waitForFunction(() => document.querySelector('[data-shop-account-avatar]').hidden && !document.querySelector('[data-shop-account-fallback]').hidden);
    assert.equal(await page.locator('.shop-account-name').textContent(), '示例用户');
    assert.equal(await page.locator('#sidebar-last').getAttribute('href'), '/uc/shop/orders');
    assert.equal(await page.locator('[data-shop-account-avatar]').isVisible(), false);
    assert.equal(await page.locator('[data-shop-account-fallback]').isVisible(), true);
    const geometry = await page.locator('.shop-account-picture').boundingBox();
    assert.deepEqual([geometry.width, geometry.height], [36, 36]);
  });

  await test('hydration handles an avatar that had already failed before its listener existed', async (page) => {
    assert.deepEqual(await page.evaluate(() => window.__avatarBeforeHydrate), { complete: true, naturalWidth: 0 });
    assert.deepEqual(await page.evaluate(() => ({ avatarHidden: document.querySelector('[data-shop-account-avatar]').hidden, fallbackHidden: document.querySelector('[data-shop-account-fallback]').hidden })), { avatarHidden: true, fallbackHidden: false });
    assert.equal(await page.locator('[data-shop-account-avatar]').isVisible(), false);
    await page.evaluate(() => { window.__shopLifecycle.dispose(window.__shopRoot); window.__shopLifecycle.hydrate(window.__shopRoot); window.__shopLifecycle.hydrate(window.__shopRoot); });
    assert.equal(await page.locator('[data-shop-account-fallback]').isVisible(), true);
    assert.equal(await page.locator('.shop-account-name').textContent(), '示例用户');
  }, { account: 'broken' });

  await test('late category image error reveals the glyph without changing its navigation or size', async (page) => {
    const picture = page.locator('[data-shop-category-image]');
    const glyph = page.locator('[data-shop-category-glyph]');
    assert.equal(await picture.evaluate((node) => node.complete && node.naturalWidth > 0), true);
    assert.equal(await glyph.isVisible(), false, 'The successful image owns the identity slot');
    const before = await page.locator('.shop-category-icon').boundingBox();
    await picture.evaluate((node) => { node.src = '/fixture-broken-category.png'; });
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-shop-category-image]');
      return image.complete && image.naturalWidth === 0;
    });
    assert.equal(await picture.isVisible(), false, 'The failed image must leave the identity slot');
    assert.equal(await glyph.isVisible(), true, 'A late real image error reveals the configured fallback glyph');
    const after = await page.locator('.shop-category-icon').boundingBox();
    assert.deepEqual([after.width, after.height], [before.width, before.height], 'Fallback preserves the category identity geometry');
    assert.equal(await page.locator('#category-image-link').getAttribute('href'), '/shop/products?categoryId=cat-image');
    assert.equal(await page.locator('.shop-account-avatar').isVisible(), true, 'Category failure does not hide a successful account avatar');
  }, { category: 'image' });

  await test('hydration reveals the category glyph when its image failed before the listener existed', async (page) => {
    assert.deepEqual(await page.evaluate(() => window.__categoryBeforeHydrate), { complete: true, naturalWidth: 0 }, 'Failure happened before hydration');
    assert.equal(await page.locator('[data-shop-category-image]').isVisible(), false);
    assert.equal(await page.locator('[data-shop-category-glyph]').isVisible(), true);
    await page.evaluate(() => { window.__shopLifecycle.dispose(window.__shopRoot); window.__shopLifecycle.hydrate(window.__shopRoot); window.__shopLifecycle.hydrate(window.__shopRoot); });
    assert.equal(await page.locator('[data-shop-category-glyph]').isVisible(), true, 'Rehydration keeps the fallback visible');
    assert.equal(await page.locator('#category-image-link').getAttribute('href'), '/shop/products?categoryId=cat-image');
  }, { category: 'broken' });

  await test('hydration preserves successfully loaded category images across remounts', async (page) => {
    assert.equal(await page.locator('[data-shop-category-image]').evaluate((node) => node.complete && node.naturalWidth > 0), true);
    await page.evaluate(() => { window.__shopLifecycle.dispose(window.__shopRoot); window.__shopLifecycle.hydrate(window.__shopRoot); });
    assert.equal(await page.locator('[data-shop-category-image]').isVisible(), true);
    assert.equal(await page.locator('[data-shop-category-glyph]').isVisible(), false, 'A successful image does not show a duplicate glyph');
  }, { category: 'image' });

  await test('anonymous footer keeps the official login return without reading account UI', async (page) => {
    assert.equal(await page.locator('#sidebar-last').getAttribute('href'), '/login?redirect_uri=/shop/products');
    assert.equal(await page.locator('#sidebar-last').textContent().then(value => value.trim()), '登录');
    assert.equal(await page.locator('[data-shop-account-orders], [data-shop-account-avatar], [data-shop-account-menu]').count(), 0);
  }, { account: 'anonymous' });

  for (const hiddenMode of ['display', 'visibility']) {
    await test(`phone menu skips ${hiddenMode}-hidden chrome and desktop search when choosing focus`, async (page) => {
      await page.evaluate((hiddenMode) => {
        const chrome = document.querySelector('.shop-dragbar');
        chrome.innerHTML = '<button id="sidebar-chrome" type="button">关闭窗口</button>';
        chrome.style[hiddenMode] = hiddenMode === 'display' ? 'none' : 'hidden';
        const search = document.getElementById('sidebar-search').closest('form');
        search.classList.add('shop-desktop-search'); search.style.display = 'none';
        document.querySelector('.shop-nav').insertAdjacentHTML('afterbegin', '<button id="sidebar-disabled" type="button" disabled>不可用</button>');
        window.__shopLifecycle.hydrate(window.__shopRoot);
      }, hiddenMode);
      await page.click('#menu-toggle');
      await page.waitForFunction(() => document.activeElement.id === 'browse-all');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-last');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'browse-all');
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => ({ active: document.activeElement.id, open: window.__shopRoot.dataset.menuOpen })), { active: 'menu-toggle', open: 'false' });
      await page.click('#menu-toggle');
      await page.waitForFunction(() => document.activeElement.id === 'browse-all');
      await page.locator('[data-shop-menu-close]').click({ position: { x: 350, y: 20 } });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-toggle');
    }, { mobile: true });
  }

  await test('phone backdrop closes the menu and restores the trigger', async (page) => {
    await page.click('#menu-toggle');
    await page.locator('[data-shop-menu-close]').click({ position: { x: 350, y: 20 } });
    assert.deepEqual(await page.evaluate(() => ({ open: window.__shopRoot.dataset.menuOpen, active: document.activeElement.id })), { open: 'false', active: 'menu-toggle' });
  }, { mobile: true });

  await test('viewport change resets mobile menu and disposal removes media listener', async (page) => {
    await page.click('#menu-toggle');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.waitForFunction(() => window.__shopRoot.dataset.menuOpen === 'false');
    assert.equal(await page.evaluate(() => document.getElementById('shop-sidebar').inert), false);
    await page.evaluate(() => { window.__shopLifecycle.dispose(window.__shopRoot); window.__shopRoot.dataset.menuOpen = 'fixture-disposed'; });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__shopRoot.dataset.menuOpen), 'fixture-disposed');
    assert.equal(await page.evaluate(() => document.getElementById('shop-sidebar').inert), false);
    await page.click('#menu-toggle');
    assert.equal(await page.evaluate(() => window.__shopRoot.dataset.menuOpen), 'fixture-disposed', 'Disposed click listener must stay inactive');
  }, { mobile: true });

  await test('disposing an opening menu cancels its deferred focus', async (page) => {
    await page.evaluate(() => {
      const toggle = document.getElementById('menu-toggle');
      toggle.focus();
      toggle.click();
      window.__shopLifecycle.dispose(window.__shopRoot);
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-toggle', 'A disposed menu must not steal focus from its pending frame');
  }, { mobile: true });

  await test('phone purchase actions stay at the app bottom while content scrolls', async (page) => {
    await page.evaluate((firstImage) => {
      window.__shopRoot.dataset.shopScene = 'product';
      const main = document.querySelector('.shop-main');
      main.innerHTML = `<div class="shop-main-header"><h1 class="shop-product-title">商品详情</h1></div>
        <div class="shop-product-layout"><div class="shop-product-gallery"><img src="${firstImage}" alt="商品" width="120" height="80"></div>
          <div class="shop-product-purchase"><div class="buy-box"><div class="buy-box__price">¥12</div><div id="purchase-actions" class="buy-box__actions"><button type="button" class="shop-btn shop-btn--primary">立即购买</button></div></div></div></div>
        <div class="shop-product-content" style="height:1800px">商品长详情</div>`;
    }, firstImage);
    const geometry = () => page.evaluate(() => {
      const app = window.__shopRoot.getBoundingClientRect();
      const actions = document.getElementById('purchase-actions').getBoundingClientRect();
      const main = document.querySelector('.shop-main');
      return { app: { top: app.top, bottom: app.bottom, left: app.left, right: app.right }, actions: { top: actions.top, bottom: actions.bottom, left: actions.left, right: actions.right }, scrollTop: main.scrollTop, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight };
    });
    const before = await geometry();
    assert.ok(before.scrollHeight > before.clientHeight, 'The fixture must contain actually scrollable product content');
    assert.ok(Math.abs(before.actions.bottom - before.app.bottom) < 2, `Purchase actions must start at the app bottom: ${JSON.stringify(before)}`);
    await page.evaluate(() => { document.querySelector('.shop-main').scrollTop = 550; });
    const after = await geometry();
    assert.ok(after.scrollTop >= 500, 'The detail viewport must actually scroll');
    assert.ok(Math.abs(after.actions.bottom - after.app.bottom) < 2, `Purchase actions must remain at the app bottom after scroll: ${JSON.stringify(after)}`);
    assert.ok(Math.abs(after.actions.top - before.actions.top) < 2, 'Purchase actions must not move with detail content');
  }, { mobile: true });

  await test('search submit retains category/sort/view and resets pagination', async (page) => {
    await page.fill('#main-search input[name="keyword"]', ' 新商品 ');
    await assertNavigation(page, () => page.locator('#main-search input[name="keyword"]').press('Enter'), { keyword: '新商品', categoryId: 'cat-a', sort: 'minPrice,asc', view: 'all' });
  });

  await test('filter form submits all selected fields and resets pagination', async (page) => {
    await page.evaluate(() => { document.getElementById('category').value = 'cat-b'; document.getElementById('sort').value = 'title,asc'; });
    await assertNavigation(page, () => page.click('#filter button[type="submit"]'), { keyword: '原关键字', categoryId: 'cat-b', sort: 'title,asc', view: 'all' });
  });

  await test('category select change retains keyword/sort/view and resets pagination', async (page) => {
    await assertNavigation(page, () => page.selectOption('#category', 'cat-b'), { keyword: '原关键字', categoryId: 'cat-b', sort: 'minPrice,asc', view: 'all' });
  });

  await test('sort select change retains keyword/category/view and resets pagination', async (page) => {
    await assertNavigation(page, () => page.selectOption('#sort', 'minPrice,desc'), { keyword: '原关键字', categoryId: 'cat-a', sort: 'minPrice,desc', view: 'all' });
  }, { query: `${initialQuery}#old-page-anchor` });

  await test('sidebar category link clears search/sort and resets pagination', async (page) => {
    await assertNavigation(page, () => page.click('#browse-category'), { categoryId: 'cat-b', view: 'all' });
  });

  await test('all-products link clears search/category/sort and resets pagination', async (page) => {
    await assertNavigation(page, () => page.click('#browse-all'), { view: 'all' });
  });

  await test('pagination changes page while retaining every filter', async (page) => {
    await assertNavigation(page, () => page.click('#next-page'), { keyword: '原关键字', categoryId: 'cat-a', sort: 'minPrice,asc', view: 'all', page: '4' });
  });

  await test('clearing search removes the keyword and stale page', async (page) => {
    await page.fill('#main-search input[name="keyword"]', '');
    await assertNavigation(page, () => page.locator('#main-search input[name="keyword"]').press('Enter'), { categoryId: 'cat-a', sort: 'minPrice,asc', view: 'all' });
  });

  await test('modified browse clicks retain native handling', async (page) => {
    assert.deepEqual(await page.evaluate(() => {
      const results = [];
      const link = document.getElementById('browse-category');
      const sink = (event) => { results.push(event.defaultPrevented); event.preventDefault(); };
      window.addEventListener('click', sink);
      for (const options of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
      }
      window.removeEventListener('click', sink);
      return results;
    }), [false, false, false, false, false]);
  });

  await test('new-window, download and external browse links retain native handling', async (page) => {
    assert.deepEqual(await page.evaluate(() => {
      const link = document.getElementById('browse-category');
      const intercepted = [], votes = [];
      window.pjax = { loadUrl: (href) => votes.push(href) };
      document.addEventListener('click', (event) => { intercepted.push(event.defaultPrevented); event.preventDefault(); });
      link.target = '_blank'; link.click();
      link.target = ''; link.setAttribute('download', ''); link.click();
      link.removeAttribute('download'); link.href = 'https://outside.test/shop/products'; link.click();
      return { intercepted, votes };
    }), { intercepted: [false, false, false], votes: [] });
  });

  await test('browse controls use the guarded navigation gateway and honor cancellation', async (page) => {
    const beforeUrl = page.url();
    const navigations = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    await page.evaluate(() => {
      window.__guardCalls = [];
      window.pjax = { loadUrl(href) { window.__guardCalls.push(href); return { kind: 'cancelled', reason: 'fixture unsaved-data guard' }; } };
      window.__shopLifecycle.hydrate(window.__shopRoot);
    });
    await page.click('#browse-category');
    await page.click('#next-page');
    await page.selectOption('#sort', 'minPrice,desc');
    await page.fill('#main-search input[name="keyword"]', ' 被拦截搜索 ');
    await page.locator('#main-search input[name="keyword"]').press('Enter');
    await page.click('#filter button[type="submit"]');
    const hrefs = await page.evaluate(() => window.__guardCalls);
    assert.equal(hrefs.length, 5, 'Each control must call the gateway exactly once');
    assert.deepEqual(hrefs.map((href) => {
      const url = new URL(href);
      assert.equal(url.origin, origin);
      assert.equal(url.pathname, '/shop/products');
      return Object.fromEntries(url.searchParams);
    }), [
      { categoryId: 'cat-b', view: 'all' },
      { keyword: '原关键字', categoryId: 'cat-a', sort: 'minPrice,asc', view: 'all', page: '4' },
      { keyword: '原关键字', categoryId: 'cat-a', sort: 'minPrice,desc', view: 'all' },
      { keyword: '被拦截搜索', categoryId: 'cat-a', sort: 'minPrice,asc', view: 'all' },
      { keyword: '原关键字', categoryId: 'cat-a', sort: 'minPrice,desc', view: 'all' }
    ]);
    assert.equal(page.url(), beforeUrl, 'A canceled gateway must not fall through to native navigation');
    assert.deepEqual(navigations, [], 'Canceled controls must not navigate the main frame');
  });

  await test('category overview clears product filters through the PJAX gateway', async (page) => {
    const beforeUrl = page.url();
    await page.evaluate(() => {
      window.__guardCalls = [];
      window.pjax = { loadUrl(href) { window.__guardCalls.push(href); return { kind: 'cancelled' }; } };
    });
    await page.click('#browse-categories');
    assert.deepEqual(await page.evaluate(() => window.__guardCalls), [`${origin}/shop/products?view=categories`]);
    assert.equal(page.url(), beforeUrl, 'Canceled category navigation cannot fall through to a document refresh');
  });

  await test('anonymous login opts in to the global navigation coordinator', async (page) => {
    assert.equal(await page.locator('[data-shop-account-login]').evaluate((link) => link.classList.contains('pjax-link')), true);
  }, { account: 'anonymous' });

  await test('official POST routes retain urlencoded fields, repeated names and submitter values', async (page) => {
    const result = await page.evaluate(async () => {
      const calls = [], intercepted = [];
      window.pjax = { loadUrl(href, options) {
        calls.push({ href, method: options.requestOptions.requestMethod, params: options.requestOptions.requestParams, hasFormData: Boolean(options.requestOptions.formData) });
        return Promise.resolve(false);
      } };
      document.addEventListener('submit', (event) => { intercepted.push(event.defaultPrevented); event.preventDefault(); });
      for (const action of ['/shop/cart?redirect_uri=%2Fshop%2Fproduct%2F901', '/shop/checkout/prepare?redirect_uri=%2Fshop%2Fproduct%2F901', '/shop/checkout/prepare', '/shop/checkout/fixture-context/submit']) {
        const form = document.createElement('form');
        form.method = 'post'; form.action = action;
        form.innerHTML = '<input name="_csrf" value="fixture-csrf"><input name="items[0].quantity" value="2"><input name="discountCode" value="A & 中"><input name="discountCode" value="B+"><input disabled name="ignored" value="disabled"><button name="commit" value="buy & now">提交</button>';
        window.__shopRoot.querySelector('.shop-main').append(form);
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector('button') }));
        await Promise.resolve(); await Promise.resolve();
        form.remove();
      }
      return { calls, intercepted };
    });
    assert.deepEqual(result.intercepted, [true, true, true, true], 'Every official POST must be stopped before native submission');
    assert.deepEqual(result.calls.map(({ href }) => new URL(href).pathname + new URL(href).search), ['/shop/cart?redirect_uri=%2Fshop%2Fproduct%2F901', '/shop/checkout/prepare?redirect_uri=%2Fshop%2Fproduct%2F901', '/shop/checkout/prepare', '/shop/checkout/fixture-context/submit']);
    for (const call of result.calls) {
      assert.equal(call.method, 'POST');
      assert.equal(call.hasFormData, false, 'Default urlencoded forms must not turn into multipart');
      assert.deepEqual(call.params, [
        { name: '_csrf', value: 'fixture-csrf' }, { name: 'items%5B0%5D.quantity', value: '2' },
        { name: 'discountCode', value: 'A%20%26%20%E4%B8%AD' }, { name: 'discountCode', value: 'B%2B' },
        { name: 'commit', value: 'buy%20%26%20now' }
      ]);
    }
  });

  await test('order cancellation and access recovery use PJAX while preserving a declined confirmation', async (page) => {
    const result = await page.evaluate(async () => {
      const calls = [], prevented = [];
      window.pjax = { loadUrl(href, options) {
        calls.push({ path: new URL(href).pathname, params: options.requestOptions.requestParams });
        return Promise.resolve(false);
      } };
      document.addEventListener('submit', (event) => { prevented.push(event.defaultPrevented); event.preventDefault(); });
      for (const [action, allow] of [
        ['/shop/order/fixture-order/cancel', false],
        ['/shop/order/fixture-order/cancel', true],
        ['/shop/order/fixture-order/access-link', true]
      ]) {
        const form = document.createElement('form');
        form.method = 'post'; form.action = action;
        form.innerHTML = '<input name="_csrf" value="fixture-csrf"><input name="email" value="buyer@example.test"><button>提交</button>';
        form.onsubmit = () => allow;
        window.__shopRoot.querySelector('.shop-main').append(form);
        form.requestSubmit(form.querySelector('button'));
        await Promise.resolve(); await Promise.resolve();
        form.remove();
      }
      return { calls, prevented };
    });
    assert.deepEqual(result.prevented, [true, true, true], 'none of the order forms may reload the document');
    assert.deepEqual(result.calls.map(call => call.path), ['/shop/order/fixture-order/cancel', '/shop/order/fixture-order/access-link']);
    for (const call of result.calls) assert.deepEqual(call.params, [
      { name: '_csrf', value: 'fixture-csrf' }, { name: 'email', value: 'buyer%40example.test' }
    ]);
  });

  await test('POST admission cancellation, pending duplication and disposal release buttons without native fallback', async (page) => {
    const result = await page.evaluate(async () => {
      const calls = [], intercepted = [];
      const form = document.createElement('form'); form.method = 'post'; form.action = '/shop/checkout/prepare';
      form.innerHTML = '<input name="_csrf" value="fixture-csrf"><button id="fixture-submit">提交</button><button id="fixture-disabled" disabled>禁用</button>';
      const other = form.cloneNode(true); other.action = '/shop/cart';
      window.__shopRoot.querySelector('.shop-main').append(form, other);
      const button = form.querySelector('button');
      const submit = (target = form) => target.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: target.querySelector('button') }));
      document.addEventListener('submit', (event) => { intercepted.push(event.defaultPrevented); event.preventDefault(); });
      window.pjax = { loadUrl(href) { calls.push(href); return Promise.resolve(false); } };
      submit(); await Promise.resolve(); await Promise.resolve();
      const cancelledDisabled = button.disabled;
      window.pjax = { loadUrl(href) {
        calls.push(href);
        document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 401, url: href } }));
        return Promise.resolve();
      } };
      submit(); submit(); submit(other); await Promise.resolve(); await Promise.resolve();
      const pending = { count: calls.length, disabled: button.disabled };
      document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 402, url: other.action, outcome: 'failed' } }));
      const unrelatedDisabled = button.disabled;
      document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 401, url: form.action, outcome: 'failed' } }));
      const failedDisabled = button.disabled;
      submit(); await Promise.resolve();
      window.__shopLifecycle.dispose(window.__shopRoot);
      const disposedDisabled = button.disabled;
      submit();
      return { calls, intercepted, cancelledDisabled, pending, unrelatedDisabled, failedDisabled, disposedDisabled, originalDisabled: form.querySelector('#fixture-disabled').disabled };
    });
    assert.equal(result.cancelledDisabled, false, 'Rejected admission must release the button');
    assert.deepEqual(result.pending, { count: 2, disabled: true }, 'Pending submission must admit exactly one POST across the app');
    assert.equal(result.unrelatedDisabled, true, 'Another navigation cannot release the pending form');
    assert.equal(result.failedDisabled, false, 'Matching failure must release the source form');
    assert.equal(result.disposedDisabled, false, 'Leaving the app must release modified button state');
    assert.equal(result.originalDisabled, true, 'Originally disabled buttons stay disabled');
    assert.equal(result.calls.length, 3, 'Disposed listener must not submit again');
    assert.deepEqual(result.intercepted, [true, true, true, true, true, false]);
  });

  await test('POST delegation retains multipart bodies and respects effective submitter action', async (page) => {
    const result = await page.evaluate(() => {
      const calls = [];
      window.pjax = { loadUrl(href, options) { calls.push({ href, method: options.requestOptions.requestMethod, entries: [...options.requestOptions.formData], hasParams: Boolean(options.requestOptions.requestParams) }); return false; } };
      const form = document.createElement('form'); form.method = 'get'; form.action = '/unhandled';
      form.innerHTML = '<input name="_csrf" value="fixture-csrf"><input name="couponIds" value="1"><input name="couponIds" value="2"><button formmethod="post" formenctype="multipart/form-data" formaction="/shop/checkout/fixture-context/submit" name="commit" value="now">提交</button>';
      window.__shopRoot.append(form);
      document.addEventListener('submit', (event) => event.preventDefault());
      const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector('button') });
      form.dispatchEvent(event);
      return { calls, intercepted: event.defaultPrevented };
    });
    assert.deepEqual(result.calls, [{ href: `${origin}/shop/checkout/fixture-context/submit`, method: 'POST', entries: [['_csrf', 'fixture-csrf'], ['couponIds', '1'], ['couponIds', '2'], ['commit', 'now']], hasParams: false }]);
  });

  await test('POST delegation preserves native external, target, callback and unsupported form handling', async (page) => {
    const result = await page.evaluate(() => {
      const calls = [], intercepted = [];
      window.pjax = { loadUrl(href) { calls.push(href); return false; } };
      document.addEventListener('submit', (event) => { intercepted.push(event.defaultPrevented); event.preventDefault(); });
      for (const setup of [
        (form) => { form.action = 'https://outside.test/shop/cart'; },
        (form) => { form.action = '/shop/payments/callback'; },
        (form) => { form.target = '_blank'; },
        (form, button) => { button.setAttribute('formtarget', '_blank'); },
        (form, button) => { button.setAttribute('formaction', 'https://outside.test/shop/cart'); },
        (form) => { form.method = 'get'; },
        (form) => { form.enctype = 'text/plain'; },
        (form) => { form.addEventListener('submit', (event) => event.preventDefault()); },
        () => { window.pjax = null; }
      ]) {
        const form = document.createElement('form'); form.method = 'post'; form.action = '/shop/cart';
        form.innerHTML = '<input name="_csrf" value="fixture-csrf"><button>提交</button>';
        const button = form.querySelector('button'); setup(form, button); window.__shopRoot.append(form);
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button })); form.remove();
      }
      return { calls, intercepted };
    });
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.intercepted, [false, false, false, false, false, false, false, true, false]);
  });

  for (const reducedMotion of ['no-preference', 'reduce']) {
    await test(`carousel scrolls real DOM and respects motion ${reducedMotion}`, async (page) => {
      await page.evaluate(() => {
        const carousel = document.getElementById('fixture-carousel');
        const original = carousel.scrollBy.bind(carousel);
        window.__scrollCalls = [];
        carousel.scrollBy = (options) => { window.__scrollCalls.push(options); original(options); };
        window.__shopLifecycle.hydrate(window.__shopRoot);
      });
      const width = await page.evaluate(() => document.getElementById('fixture-carousel').clientWidth);
      await page.click('#carousel-next');
      await page.waitForFunction(() => document.getElementById('fixture-carousel').scrollLeft > 0);
      assert.deepEqual(await page.evaluate(() => window.__scrollCalls), [{ left: width, behavior: reducedMotion === 'reduce' ? 'instant' : 'smooth' }]);
      // CSS scroll snapping may settle at a card boundary instead of exactly
      // clientWidth. Observe real scrolling, then wait for it to settle before
      // asking to scroll back; the method call separately verifies its target.
      await page.waitForFunction(() => {
        const left = document.getElementById('fixture-carousel').scrollLeft;
        const state = window.__carouselStability ?? { left: null, frames: 0 };
        state.frames = left === state.left ? state.frames + 1 : 0;
        state.left = left;
        window.__carouselStability = state;
        return state.frames >= 5;
      });
      await page.click('#carousel-previous');
      await page.waitForFunction(() => document.getElementById('fixture-carousel').scrollLeft < 2);
      assert.equal(await page.evaluate(() => window.__scrollCalls.length), 2);
      assert.equal(await page.evaluate(() => window.__scrollCalls[1].left), -width);
      await page.evaluate(() => window.__shopLifecycle.dispose(window.__shopRoot));
      await page.click('#carousel-next');
      assert.equal(await page.evaluate(() => window.__scrollCalls.length), 2, 'Disposed carousel must not receive another scroll call');
    }, { reducedMotion });
  }
} finally {
  await browser.close();
}

console.log(`Shop isolated DOM fixture: ${passed} passed, ${failures.length} failed; real Halo requests: 0`);
if (failures.length) process.exitCode = 1;
