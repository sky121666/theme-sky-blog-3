import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile, compileModule } from 'svelte/compiler';
import { chromium } from 'playwright';
import { build as viteBuild } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Compile current component sources in memory. This fixture neither reads old
// generated assets nor writes new ones; all network traffic is intercepted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root, 'src/apps/shop/commerce-ui');
const origin = 'https://commerce-controls.test';
const api = '/apis/uc.api.ecommerce.halo.run/v1alpha1';
const addressApi = '/apis/api.ecommerce.halo.run/v1alpha1';
const previewImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="skyblue"/></svg>');
const harness = `<script>
  import SpecButton from './components/SpecButton.svelte';
  let selected = $state(false);
  let available = $state(true);
  window.__specSelections = 0;
  window.__disableSpec = () => available = false;
</script>
<SpecButton isSelected={selected} isAvailable={available} imageUrl={${JSON.stringify(previewImage)}} value="标准版" onclick={() => { selected = !selected; window.__specSelections++; }} />`;
const componentWarnings = [];
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'browser',
  conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'],
  loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
  stdin: {
    resolveDir: ui, sourcefile: 'commerce-controls-fixture.js', contents: `
      import { mount } from 'svelte';
      import AddressForm from './pages/components/AddressForm.svelte';
      import Cart from './pages/Cart.svelte';
      import SpecHarness from 'spec-harness';
      const target = document.querySelector('#fixture');
      const view = new URL(location.href).searchParams.get('view');
      mount(view === 'address' ? AddressForm : view === 'cart' ? Cart : SpecHarness, { target, props: { csrfToken: 'fixture' } });
    `,
  },
  plugins: [{ name: 'current-svelte-components', setup(builder) {
    builder.onResolve({ filter: /^spec-harness$/ }, () => ({ path: path.join(ui, 'SpecHarness.svelte'), namespace: 'fixture' }));
    const component = async (filename, source) => {
      const result = compile(source, { filename, generate: 'client', css: 'injected', customElement: filename.includes('/src/apps/shop/commerce-ui/') });
      if (filename.startsWith(ui) && !filename.endsWith('SpecHarness.svelte')) {
        componentWarnings.push(...result.warnings.map(warning => ({ file: path.relative(root, filename), code: warning.code, message: warning.message })));
      }
      return { contents: result.js.code, loader: 'js', resolveDir: path.dirname(filename) };
    };
    builder.onLoad({ filter: /\.svelte$/, namespace: 'fixture' }, ({ path: filename }) => component(filename, harness));
    builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => component(filename, await readFile(filename, 'utf8')));
    builder.onLoad({ filter: /\.svelte\.js$/ }, async ({ path: filename }) => ({
      contents: compileModule(await readFile(filename, 'utf8'), { filename, generate: 'client' }).js.code,
      loader: 'js', resolveDir: path.dirname(filename),
    }));
  } }],
});
assert.deepEqual(componentWarnings, [], 'Project components compile without Svelte warnings');
const script = bundle.outputFiles[0].text;
const cssBuild = await viteBuild({
  root, configFile: false, logLevel: 'error', plugins: [tailwindcss()],
  build: { write: false, rollupOptions: { input: path.join(root, 'src/apps/shop/styles/index.css') } },
});
const currentCss = cssBuild.output.filter(output => output.type === 'asset' && output.fileName.endsWith('.css')).map(output => output.source).join('\n');
assert.ok(currentCss, 'Compile current theme CSS in memory');
const styles = await readFile(path.join(ui, 'styles/official.css'), 'utf8') + '\n' + currentCss;
const output = path.resolve(root, process.env.COMMERCE_CONTROLS_OUTPUT || 'output/motion-polish-20261115/controls');
assert.ok(output.startsWith(path.join(root, 'output') + path.sep), 'Control evidence must stay inside output/');
await mkdir(output, { recursive: true });
const results = [];
const sourceHashes = Object.fromEntries(await Promise.all([
  'src/apps/shop/commerce-ui/pages/Cart.svelte', 'src/apps/shop/commerce-ui/pages/components/CartItem.svelte', 'src/apps/shop/styles/index.css',
].map(async filename => [filename, createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex')])));
const browser = await chromium.launch({ headless: true });
let passed = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

async function scenario(name, view, respond, action, { width = 800, reducedMotion = 'no-preference', hasTouch = false } = {}) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width, height: 900 }, reducedMotion, hasTouch, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [], errors = [], unexpected = [];
  const result = { name, view, width, reducedMotion, hasTouch, requests, errors, unexpected, passed: false };
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
    if (url.pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${styles}</style><style>html,body{margin:0;font-family:-apple-system,system-ui,sans-serif}.controls-window{width:100%;height:100vh;min-width:0;overflow:auto}.controls-window .shop-main{padding:24px}@media(max-width:768px){.controls-window .shop-main{padding:12px}}</style></head><body>${view === 'cart' ? '<section class="shop-window controls-window"><div class="shop-app"><main class="shop-main"><div id="fixture"></div></main></div></section>' : '<form id="fixture" onsubmit="event.preventDefault()"></form>'}<script type="module" src="/fixture.js"></script></body></html>` });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    const entry = { method: request.method(), path: url.pathname, ...(request.method() === 'GET' ? {} : { body: request.postDataJSON() }) };
    requests.push(entry);
    if (await respond(route, entry)) return;
    unexpected.push(`${entry.method} ${entry.path}`);
    await route.abort();
  });
  try {
    await page.goto(`${origin}/fixture?view=${view}`);
    await action(page, requests, result);
    assert.deepEqual(errors, [], 'No unhandled component exceptions');
    assert.deepEqual(unexpected, [], 'No request escapes the fixture');
    passed++;
    result.passed = true;
    if (view === 'cart') {
      await page.waitForFunction(() => document.querySelector('.shop-cart__items')?.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running') ?? true);
      result.screenshot = path.join(output, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
      await page.screenshot({ path: result.screenshot, fullPage: true });
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    result.error = error.message;
    result.screenshot = path.join(output, `failed-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(() => {});
    throw error;
  } finally { results.push(result); await context.close(); }
}
const reply = async (route, data, status = 200) => { await route.fulfill({ status, json: data }); return true; };

try {
  const reads = new Map();
  await scenario('address levels expose pending, retry failures and reset dependent choices', 'address', async (route, request) => {
    if (request.method !== 'GET' || !request.path.startsWith(addressApi)) return false;
    const count = (reads.get(request.path) || 0) + 1;
    reads.set(request.path, count);
    await pause(120);
    if (count === 1 && !request.path.includes('/p2/')) return reply(route, { message: 'fixture load failure' }, 422);
    if (request.path.endsWith('/provinces')) return reply(route, [{ code: 'p1', name: '省一' }, { code: 'p2', name: '省二' }]);
    if (request.path.endsWith('/p1/cities')) return reply(route, [{ code: 'c1', name: '城市一' }]);
    if (request.path.endsWith('/p2/cities')) return reply(route, [{ code: 'c2', name: '城市二' }]);
    if (request.path.endsWith('/c1/areas')) return reply(route, [{ code: 'a1', name: '区县一' }]);
    return false;
  }, async (page, requests) => {
    await page.locator('#province[aria-busy="true"]').waitFor();
    assert.equal(await page.locator('#city').isDisabled(), true);
    assert.equal(await page.locator('#district').isDisabled(), true);
    await page.locator('#province-error').waitFor();
    assert.equal(await page.locator('#province').evaluate(node => node.validity.valueMissing), true, 'Pending/failed province remains a native required control');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('#province option[value="p1"]').waitFor({ state: 'attached' });
    await page.locator('#province').selectOption('p1');
    await page.locator('#city-error').waitFor();
    assert.equal(await page.locator('#city').evaluate(node => node.validity.valueMissing), true, 'City failure cannot bypass form validity');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('#city option[value="c1"]').waitFor({ state: 'attached' });
    await page.locator('#city').selectOption('c1');
    await page.locator('#district-error').waitFor();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('#district option[value="a1"]').waitFor({ state: 'attached' });
    await page.locator('#district').selectOption('a1');
    await page.locator('#province').selectOption('p2');
    assert.equal(await page.locator('#city').inputValue(), '', 'Changing province resets city');
    assert.equal(await page.locator('#district').inputValue(), '', 'Changing province resets district');
    assert.equal(await page.locator('#district').isDisabled(), true);
    assert.ok(requests.every(request => !/undefined|\/\/cities/.test(request.path)), 'No missing-parent address requests');
  });

  const oldProvinceGate = gate();
  await scenario('late province response preserves current region and entered contact fields', 'address', async (route, request) => {
    if (request.method !== 'GET') return false;
    if (request.path === `${addressApi}/provinces`) return reply(route, [{ code: 'p1', name: '省一' }, { code: 'p2', name: '省二' }]);
    if (request.path === `${addressApi}/provinces/p1/cities`) {
      await oldProvinceGate.promise;
      return reply(route, [{ code: 'c1', name: '迟到的城市一' }]);
    }
    if (request.path === `${addressApi}/provinces/p2/cities`) return reply(route, [{ code: 'c2', name: '城市二' }]);
    if (request.path === `${addressApi}/cities/c2/areas`) return reply(route, [{ code: 'a2', name: '区县二' }]);
    return false;
  }, async page => {
    await page.locator('#lastName').fill('陈');
    await page.locator('#firstName').fill('测试');
    await page.locator('#contactPhone').fill('00000000000');
    await page.locator('#province option[value="p1"]').waitFor({ state: 'attached' });
    const oldRequest = page.waitForRequest(request => request.url().endsWith('/provinces/p1/cities'));
    await page.locator('#province').selectOption('p1');
    await oldRequest;
    await page.locator('#province').selectOption('p2');
    await page.locator('#city option[value="c2"]').waitFor({ state: 'attached' });
    await page.locator('#city').selectOption('c2');
    await page.locator('#district option[value="a2"]').waitFor({ state: 'attached' });
    await page.locator('#district').selectOption('a2');
    oldProvinceGate.release();
    await pause(100);
    assert.equal(await page.locator('#city option[value="c1"]').count(), 0, 'Late previous-province data must not replace current choices');
    for (const [selector, expected] of [['#province', 'p2'], ['#city', 'c2'], ['#district', 'a2'], ['#lastName', '陈'], ['#firstName', '测试'], ['#contactPhone', '00000000000']]) {
      assert.equal(await page.locator(selector).inputValue(), expected, `${selector} survives the obsolete response`);
    }
  });

  const item = { id: 1, quantity: 2, product: { id: 901, title: '模拟商品', productType: 'VIRTUAL', permalink: '/shop/product/901' }, productVariant: { id: 1901, price: 9, trackInventory: true, stock: 5 } };
  const cartGeometry = page => page.evaluate(() => {
    const rect = selector => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { top: value.top, right: value.right, width: value.width, height: value.height };
    };
    return {
      itemAmount: rect('.shop-cart-item__total'),
      summaryAmount: rect('.shop-cart-summary__row--total .shop-cart-summary__amount'),
      item: rect('.shop-cart-item'),
      overflow: document.documentElement.scrollWidth > innerWidth,
      touchHeights: [...document.querySelectorAll('.shop-cart-item button')].map(node => node.getBoundingClientRect().height),
    };
  });
  const amountsStayInPlace = (before, after) => {
    for (const key of ['itemAmount', 'summaryAmount']) {
      assert.ok(Math.abs(before[key].right - after[key].right) <= 1, `${key} right edge stays fixed: ${JSON.stringify({ before, after })}`);
      assert.ok(Math.abs(before[key].top - after[key].top) <= 1, `${key} baseline stays fixed: ${JSON.stringify({ before, after })}`);
    }
    assert.equal(after.overflow, false, 'Current cart has no horizontal page overflow');
  };

  for (const width of [1280, 390]) {
    let quantity = 2, puts = 0, reads = 0;
    const putGate = gate(), readGate = gate();
    await scenario(`${width}px quantity feedback waits for server confirmation and keeps amount positions`, 'cart', async (route, request) => {
      if (request.path === `${api}/cart-items` && request.method === 'GET') {
        if (++reads > 1) await readGate.promise;
        return reply(route, [{ ...item, quantity }]);
      }
      if (request.path === `${api}/cart-items/1` && request.method === 'PUT') {
        puts++;
        await putGate.promise;
        quantity = request.body.quantity;
        return reply(route, { ...item, quantity });
      }
      return false;
    }, async (page, requests, result) => {
      const increase = page.getByRole('button', { name: '增加数量', exact: true });
      const input = page.getByRole('spinbutton', { name: '数量', exact: true });
      const checkout = page.getByRole('button', { name: '前往结算' });
      await increase.waitFor();
      await page.waitForFunction(() => document.querySelector('.shop-cart__items').getAnimations().every(animation => animation.playState !== 'running'));
      const before = await cartGeometry(page);
      assert.equal(await page.locator('.shop-cart-item').getAttribute('data-operation-state'), 'idle');
      await increase.focus();
      assert.equal(await increase.evaluate(node => getComputedStyle(node).outlineStyle), 'solid', 'Native keyboard focus is visible');
      await page.keyboard.press('Space');
      await page.locator('.shop-cart-item[data-operation-state="pending"]').waitFor();
      assert.equal(await input.isDisabled(), true);
      assert.equal(await checkout.isDisabled(), true);
      assert.equal(await page.locator('.shop-cart-summary').getAttribute('aria-busy'), 'true');
      assert.match(await page.locator('.shop-cart-item__feedback').innerText(), /加载中/);
      assert.equal(await input.inputValue(), '2', 'Unconfirmed number is not written into the cart');
      await increase.evaluate(node => { node.click(); node.click(); });
      const pending = await cartGeometry(page);
      amountsStayInPlace(before, pending);
      result.pendingScreenshot = path.join(output, `${width}px-quantity-pending.png`);
      await page.screenshot({ path: result.pendingScreenshot, fullPage: true });
      const refresh = page.waitForRequest(request => request.method() === 'GET' && request.url().endsWith('/cart-items'));
      putGate.release();
      await refresh;
      assert.equal(await page.locator('.shop-cart-item').getAttribute('data-operation-state'), 'pending', 'PUT response does not confirm before the cart read');
      assert.equal(await checkout.isDisabled(), true, 'Checkout waits for the reconciled amount');
      readGate.release();
      await page.locator('.shop-cart-item[data-operation-state="confirmed"]').waitFor();
      assert.equal(await input.inputValue(), '3');
      assert.match(await page.locator('.shop-cart-item__feedback').innerText(), /✓\s*数量\s*·\s*3/);
      assert.match(await page.locator('.shop-cart-item__total').innerText(), /27\.00/);
      await page.waitForFunction(() => !document.querySelector('.shop-cart-summary button')?.disabled);
      const confirmed = await cartGeometry(page);
      amountsStayInPlace(before, confirmed);
      if (width === 390) assert.ok(confirmed.touchHeights.every(height => height >= 44), 'Phone cart actions retain 44px touch height');
      assert.equal(puts, 1, 'Repeated activation does not replay PUT');
      assert.equal(reads, 2, 'One success triggers one reconciliation');
      result.geometry = { before, pending, confirmed };
      result.writes = requests.filter(request => request.method !== 'GET');
    }, { width, hasTouch: width === 390 });
  }

  let quantityAttempts = 0, quantityAfterFailure = 2;
  await scenario('quantity error stays inline and a new explicit change recovers', 'cart', async (route, request) => {
    if (request.path === `${api}/cart-items` && request.method === 'GET') return reply(route, [{ ...item, quantity: quantityAfterFailure }]);
    if (request.path === `${api}/cart-items/1` && request.method === 'PUT') {
      if (++quantityAttempts === 1) return reply(route, { message: 'fixture quantity failure' }, 422);
      quantityAfterFailure = request.body.quantity;
      return reply(route, { ...item, quantity: quantityAfterFailure });
    }
    return false;
  }, async page => {
    const increase = page.getByRole('button', { name: '增加数量', exact: true });
    await increase.click();
    await page.locator('.shop-cart-item[data-operation-state="error"] .shop-cart-item__feedback[role="alert"]').waitFor();
    assert.match(await page.locator('.shop-cart-item__feedback').innerText(), /更新数量失败/);
    assert.equal(await page.getByRole('spinbutton', { name: '数量', exact: true }).inputValue(), '2');
    assert.match(await page.locator('.shop-cart-item__total').innerText(), /18\.00/);
    assert.equal(await page.locator('.shop-cart-item[data-operation-state="confirmed"]').count(), 0);
    await page.waitForFunction(() => !document.querySelector('.shop-cart-summary button')?.disabled);
    assert.equal(quantityAttempts, 1, 'An error does not claim success or replay a quantity request');
    await increase.click();
    await page.locator('.shop-cart-item[data-operation-state="confirmed"]').waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '数量', exact: true }).inputValue(), '3');
    assert.equal(await page.locator('.shop-cart-item__feedback[role="alert"]').count(), 0);
    assert.equal(quantityAttempts, 2, 'Explicit input recovers with exactly one new request');
  });

  let reducedQuantity = 2, reducedRemoved = false;
  const reducedDeleteGate = gate();
  await scenario('reduced motion keeps real feedback and touch controls without animated confirmation or exit', 'cart', async (route, request) => {
    if (request.path === `${api}/cart-items` && request.method === 'GET') return reply(route, reducedRemoved ? [] : [{ ...item, quantity: reducedQuantity }]);
    if (request.path === `${api}/cart-items/1` && request.method === 'PUT') {
      reducedQuantity = request.body.quantity;
      return reply(route, { ...item, quantity: reducedQuantity });
    }
    if (request.path === `${api}/cart-items/1` && request.method === 'DELETE') {
      await reducedDeleteGate.promise;
      reducedRemoved = true;
      await route.fulfill({ status: 204 });
      return true;
    }
    return false;
  }, async page => {
    const increase = page.getByRole('button', { name: '增加数量', exact: true });
    await increase.waitFor();
    const before = await cartGeometry(page);
    await increase.tap();
    await page.locator('.shop-cart-item[data-operation-state="confirmed"]').waitFor();
    assert.match(await page.locator('.shop-cart-item__feedback').innerText(), /数量\s*·\s*3/);
    assert.equal(await page.locator('.shop-cart-item__feedback-mark').evaluate(node => getComputedStyle(node).animationName), 'none');
    const runningDurations = await page.locator('.shop-cart-item').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => animation.effect.getTiming().duration));
    assert.ok(runningDurations.every(duration => duration <= 0.01), `Reduced motion permits only the project's 0.01ms CSS sentinel, with no entry or confirmation motion: ${runningDurations}`);
    amountsStayInPlace(before, await cartGeometry(page));
    const remove = page.locator('.shop-cart-item__remove');
    const box = await remove.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await remove.evaluate(node => getComputedStyle(node).transform), 'none', 'Reduced motion does not scale the pressed button');
    await page.mouse.up();
    await page.locator('.shop-cart-item[data-operation-state="pending"]').waitFor();
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true);
    reducedDeleteGate.release();
    await page.locator('.shop-cart-item').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.shop-cart__items').count(), 0);
  }, { width: 390, reducedMotion: 'reduce', hasTouch: true });

  let cartReads = 0;
  await scenario('cart read failure has a working retry and checkout stays disabled', 'cart', async (route, request) => {
    if (request.path !== `${api}/cart-items` || request.method !== 'GET') return false;
    return ++cartReads === 1 ? reply(route, { message: 'fixture load failure' }, 422) : reply(route, [item]);
  }, async page => {
    await page.getByRole('button', { name: '重试', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.shop-cart-item').waitFor();
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isEnabled(), true);
    assert.equal(cartReads, 2, 'One explicit retry issues one new cart read');
  });

  await scenario('phone deletion review offers both 44px actions without an active checkout', 'cart', async (route, request) => {
    if (request.method === 'GET' && request.path === `${api}/cart-items`) return reply(route, [item]);
    if (request.method === 'DELETE' && request.path === `${api}/cart-items/1`) {
      await route.fulfill({ status: 204 });
      return true;
    }
    return false;
  }, async page => {
    await page.getByRole('button', { name: '删除', exact: true }).click();
    for (const name of ['重新核对', '保留商品']) {
      const button = page.getByRole('button', { name, exact: true });
      await button.waitFor();
      assert.ok((await button.boundingBox()).height >= 44, `${name} remains reachable on touch`);
    }
    assert.ok(await page.getByRole('button', { name: '前往结算' }).isDisabled());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }, { width: 390, hasTouch: true });

  let deletes = 0, removed = false;
  const deleteGate = gate();
  await scenario('cart deletion guards repeated input, shows failure and retries explicitly', 'cart', async (route, request) => {
    if (request.path === `${api}/cart-items` && request.method === 'GET') return reply(route, removed ? [] : [item]);
    if (request.path === `${api}/cart-items/1` && request.method === 'DELETE') {
      deletes++;
      if (deletes === 1) { await deleteGate.promise; return reply(route, { message: 'fixture delete failure' }, 503); }
      removed = true;
      await route.fulfill({ status: 204 });
      return true;
    }
    return false;
  }, async page => {
    await page.getByRole('button', { name: '删除', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '增加数量' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '减少数量' }).count(), 1);
    assert.equal(await page.getByRole('spinbutton', { name: '数量', exact: true }).inputValue(), '2');
    await page.locator('.shop-cart-item__remove').evaluate(button => { button.click(); button.click(); });
    await page.locator('.shop-cart-item__remove[aria-busy="true"]').waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '数量', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true, 'Do not submit stale cart items while a deletion is pending');
    await page.waitForFunction(() => document.querySelector('.shop-cart-item__remove')?.disabled);
    await pause(80);
    assert.equal(deletes, 1, 'Repeated click must not issue a second DELETE');
    deleteGate.release();
    await page.getByRole('alert').filter({ hasText: '删除失败' }).waitFor();
    await pause(450);
    assert.equal(deletes, 1, 'A failed DELETE is not automatically retried');
    assert.equal(await page.getByRole('button', { name: '重试', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.shop-cart-item').waitFor({ state: 'detached' });
    assert.equal(deletes, 2, 'Only explicit retry issues the second DELETE');
  });

  const remainingItem = { ...item, id: 2, product: { ...item.product, id: 902, title: '保留商品' } };
  let uncertainDeletes = 0, uncertainReads = 0;
  const reconciliationGate = gate();
  await scenario('lost deletion response reconciles the server before enabling checkout', 'cart', async (route, request) => {
    if (request.path === `${api}/cart-items` && request.method === 'GET') {
      if (++uncertainReads === 1) return reply(route, [item, remainingItem]);
      await reconciliationGate.promise;
      return reply(route, [remainingItem]);
    }
    if (request.path === `${api}/cart-items/1` && request.method === 'DELETE') {
      uncertainDeletes++;
      // The server has removed the item; the client receives no response.
      await route.abort('failed');
      return true;
    }
    return false;
  }, async page => {
    const refresh = page.waitForRequest(request => request.method() === 'GET' && request.url().endsWith('/cart-items'));
    await page.locator('.shop-cart-item__remove').first().click();
    await refresh;
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true, 'Unknown deletion result keeps checkout blocked while re-reading');
    reconciliationGate.release();
    await page.waitForFunction(() => document.querySelectorAll('.shop-cart-item').length === 1);
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isEnabled(), true);
    assert.deepEqual(await page.locator('input[name$=".cartItemId"]').evaluateAll(nodes => nodes.map(node => node.value)), ['2'], 'Checkout contains only confirmed server items');
    assert.equal(uncertainDeletes, 1, 'Reconciliation never replays DELETE');
    assert.equal(uncertainReads, 2);
  });

  let failedRefreshReads = 0, failedRefreshDeletes = 0;
  const failedRefreshGate = gate(), recoveryGate = gate();
  await scenario('failed deletion reconciliation stays blocked and manual recovery only reads', 'cart', async (route, request) => {
    if (request.path === `${api}/cart-items` && request.method === 'GET') {
      failedRefreshReads++;
      if (failedRefreshReads === 1) return reply(route, [item, remainingItem]);
      if (failedRefreshReads === 2) {
        await failedRefreshGate.promise;
        return reply(route, { message: 'fixture reconciliation failure' }, 422);
      }
      await recoveryGate.promise;
      return reply(route, [remainingItem]);
    }
    if (request.path === `${api}/cart-items/1` && request.method === 'DELETE') {
      failedRefreshDeletes++;
      await route.abort('failed');
      return true;
    }
    return false;
  }, async page => {
    const refresh = page.waitForRequest(request => request.method() === 'GET' && request.url().endsWith('/cart-items'));
    await page.locator('.shop-cart-item__remove').first().click();
    await refresh;
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true);
    failedRefreshGate.release();
    await page.locator('.shop-cart__error').waitFor();
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true, 'A failed read must not reactivate stale cached items');
    const recovery = page.waitForRequest(request => request.method() === 'GET' && request.url().endsWith('/cart-items'));
    await page.locator('.shop-cart__error').getByRole('button', { name: '重试', exact: true }).click();
    await recovery;
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isDisabled(), true);
    recoveryGate.release();
    await page.waitForFunction(() => document.querySelectorAll('.shop-cart-item').length === 1 && !document.querySelector('.shop-cart__error'));
    assert.equal(await page.getByRole('button', { name: '前往结算' }).isEnabled(), true);
    assert.deepEqual(await page.locator('input[name$=".cartItemId"]').evaluateAll(nodes => nodes.map(node => node.value)), ['2']);
    assert.equal(failedRefreshDeletes, 1, 'Recovery retry only performs a GET');
    assert.equal(failedRefreshReads, 3);
  });

  await scenario('spec selection and image preview are independent native keyboard buttons', 'spec', async (route, request) => {
    if (request.method !== 'GET' || request.path !== '/apis/api.storage.halo.run/v1alpha1/thumbnails/-/via-uri') return false;
    await route.fulfill({ contentType: 'image/svg+xml', body: decodeURIComponent(previewImage.split(',')[1]) });
    return true;
  }, async page => {
    const option = page.getByRole('button', { name: '标准版', exact: true });
    const preview = page.getByRole('button', { name: '查看大图：标准版', exact: true });
    await option.waitFor();
    assert.equal(await page.locator('button button, button [role="button"]').count(), 0);
    assert.equal(await option.getAttribute('aria-pressed'), 'false');
    await option.focus(); await page.keyboard.press('Space');
    assert.equal(await option.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Enter');
    assert.equal(await option.getAttribute('aria-pressed'), 'false');
    await preview.focus(); await page.keyboard.press('Space');
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(() => window.__specSelections), 2, 'Preview does not select the SKU');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await preview.evaluate(node => node === document.activeElement), true, 'Closing the preview restores trigger focus');
    await page.evaluate(() => window.__disableSpec());
    assert.equal(await option.isDisabled(), true);
    assert.equal(await preview.isEnabled(), true, 'Unavailable SKU images remain inspectable');
  });
  console.log(`PASS commerce controls: ${passed} isolated source-compiled scenarios`);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({
    kind: 'isolated-source-compiled-controls', node: process.version, origin,
    sources: sourceHashes, cssSha256: createHash('sha256').update(currentCss).digest('hex'),
    generatedAssets: 'not read or written', liveBusinessTraffic: 'none; every request intercepted',
    passed, failed: results.filter(result => !result.passed).length, results,
  }, null, 2));
  await browser.close();
}
