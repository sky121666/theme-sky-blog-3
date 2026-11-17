import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const source = await readFile(new URL('../src/apps/docsme/runtime.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(href = 'https://docs.test/docs/project/v1/chapter?preview-theme=theme-sky-blog-3&lang=zh#section') {
  const navigation = deferred(), calls = [], attrs = new Map();
  const select = new EventTarget();
  Object.assign(select, { dataset: { currentLink: '/docs/project/v1' }, disabled: false, isConnected: true,
    options: [{ dataset: { link: '/docs/project/v1' }, value: 'v1' }, { dataset: { link: '/docs/project/v2' }, value: 'v2' }], selectedIndex: 0,
    getAttribute: key => attrs.get(key) ?? null,
    setAttribute: (key, value) => attrs.set(key, String(value)), removeAttribute: key => attrs.delete(key) });
  Object.defineProperty(select, 'selectedOptions', { get: () => [select.options[select.selectedIndex]] });
  const location = new URL(href);
  const window = { location, pjax: { loadUrl(href, options) { calls.push({ href, options }); return navigation.promise; } } };
  const root = { querySelectorAll: () => [select], isConnected: true, _docsmeDisposed: false };
  const context = vm.createContext({ window, location, document: {}, URL, console,
    openSearchWidget: () => true });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.bind = bindSwitchers;', context);
  context.bind(root);
  return { select, root, calls, navigation, change() { select.selectedIndex = 1; select.dispatchEvent(new Event('change')); } };
}

test('Docsme version navigation preserves the document suffix, preview, query and chapter with its actual trigger', async () => {
  const f = fixture(); f.change();
  assert.equal(f.calls[0]?.href, 'https://docs.test/docs/project/v2/chapter?preview-theme=theme-sky-blog-3&lang=zh#section');
  assert.equal(f.calls[0].options?.triggerElement, f.select);
  f.navigation.resolve(false); await flush();
});
test('Docsme veto restores the committed selection and control state', async () => {
  const f = fixture(); f.change();
  assert.equal(f.select.disabled, true); assert.equal(f.select.getAttribute('aria-busy'), 'true');
  f.navigation.resolve(false); await flush();
  assert.equal(f.select.selectedIndex, 0); assert.equal(f.select.disabled, false); assert.equal(f.select.getAttribute('aria-busy'), null);
});
test('Docsme a pending representation switch cannot enqueue another switch', async () => {
  const f = fixture(); f.change(); f.change();
  assert.equal(f.calls.length, 1);
  f.navigation.resolve(false); await flush();
});
test('Docsme a rejected switch retains the old representation and allows another attempt', async () => {
  const f = fixture(); f.change(); f.navigation.reject(new Error('offline')); await flush();
  assert.equal(f.select.selectedIndex, 0); assert.equal(f.select.disabled, false); assert.equal(f.select.getAttribute('aria-busy'), null);
});
test('Docsme keeps every repeated query value while the target owns explicit keys', async () => {
  const f = fixture('https://docs.test/docs/project/v1/chapter?tag=one&tag=two&lang=zh#section');
  f.select.options[1].dataset.link = '/docs/project/v2?lang=en'; f.change();
  const target = new URL(f.calls[0].href);
  assert.deepEqual(target.searchParams.getAll('tag'), ['one', 'two']); assert.equal(target.searchParams.get('lang'), 'en');
  f.navigation.resolve(false); await flush();
});

const shopBundle = await build({ entryPoints: ['src/apps/shop/runtime.js'], bundle: true, write: false, format: 'iife', globalName: 'ShopPolish', logLevel: 'silent' });
test('Shop representation and failed filters keep control, content and focus consistent', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const reducedMotion of ['no-preference', 'reduce']) await t.test(reducedMotion, async () => {
    const context = await browser.newContext({ reducedMotion });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
      await page.goto('https://theme.test/shop/products?view=all');
      await page.setContent(`<div data-app-root="shop" data-shop-scene="products" data-shop-entry-view="catalog"><main class="shop-main">
        <form data-shop-filter><select name="categoryId"><option value="">全部</option><option value="a">分类A</option></select><select name="sort"><option value="">默认</option><option value="title,asc">名称</option></select></form>
        <form data-shop-search><input name="keyword" aria-label="搜索商品"><input name="view" value="all" type="hidden"></form>
        <p data-shop-browse-status role="status" hidden></p>
        <button data-shop-display-layout="cards">卡片</button><button data-shop-display-layout="list">列表</button>
        <select data-shop-display-size-select><option value="medium">中</option><option value="small">小</option></select>
        <span data-shop-display-status role="status"></span><div data-shop-catalog><a href="/shop/products/demo">商品</a></div>
      </main></div>`);
      await page.addScriptTag({ content: shopBundle.outputFiles[0].text });
      await page.evaluate(() => {
        window.__calls = []; window.__resolvers = [];
        window.pjax = { loadUrl(href, options) { window.__calls.push({ href, trigger: options.triggerElement?.tagName }); return new Promise(resolve => { window.__resolve = resolve; window.__resolvers.push(resolve); }); } };
        window.__cleanup = ShopPolish.hydrateShop(document.querySelector('[data-app-root="shop"]'));
      });
      await page.getByText('列表', { exact: true }).click();
      assert.match(await page.locator('[data-shop-display-status]').innerText(), /列表/);
      assert.equal(await page.locator('[data-shop-catalog] a').count(), 1);
      assert.equal(await page.locator('[data-shop-display-layout="list"]').getAttribute('aria-pressed'), 'true');
      await page.locator('select[name="categoryId"]').selectOption('a');
      assert.equal(await page.locator('select[name="categoryId"]').isDisabled(), true);
      assert.equal(await page.locator('[data-shop-filter]').getAttribute('aria-busy'), 'true');
      await page.evaluate(() => window.__resolve(false));
      await page.waitForFunction(() => !document.querySelector('select[name="categoryId"]').disabled);
      assert.equal(await page.locator('select[name="categoryId"]').inputValue(), '');
      assert.equal(await page.locator('[data-shop-filter]').getAttribute('aria-busy'), null);
      assert.match(await page.locator('[data-shop-browse-status]').innerText(), /未完成|重试/);
      await page.locator('select[name="sort"]').selectOption('title,asc');
      assert.equal(await page.evaluate(() => window.__calls.length), 2);
      await page.evaluate(() => window.__resolve(false));
      await page.waitForFunction(() => !document.querySelector('select[name="categoryId"]').disabled);
      await page.locator('select[name="categoryId"]').selectOption('a');
      await page.getByLabel('搜索商品').fill('新的搜索'); await page.getByLabel('搜索商品').press('Enter');
      assert.equal(await page.evaluate(() => window.__calls.length), 4, 'A new search supersedes an in-flight filter');
      await page.evaluate(() => window.__resolvers[2](false));
      assert.equal(await page.locator('select[name="categoryId"]').isDisabled(), true, 'A stale completion cannot release the new request');
      await page.evaluate(() => window.__resolve(false)); await page.waitForFunction(() => !document.querySelector('select[name="categoryId"]').disabled);
      await page.locator('select[name="categoryId"]').selectOption('a');
      await page.evaluate(() => { window.__cleanup(); window.__cleanup = ShopPolish.hydrateShop(document.querySelector('[data-app-root="shop"]')); });
      assert.equal(await page.locator('select[name="categoryId"]').inputValue(), '');
      assert.equal(await page.locator('select[name="categoryId"]').isDisabled(), false);
      assert.equal(await page.locator('[data-shop-filter]').getAttribute('aria-busy'), null);
      await page.evaluate(() => window.__resolvers[4](false));
      await page.locator('select[name="sort"]').selectOption('title,asc'); await page.evaluate(() => window.__resolve(false));
      await page.waitForFunction(() => !document.querySelector('select[name="sort"]').disabled);
      assert.equal(await page.locator('select[name="categoryId"]').inputValue(), '', 'Remount cannot commit an abandoned filter');
      await page.evaluate(() => window.__cleanup());
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
