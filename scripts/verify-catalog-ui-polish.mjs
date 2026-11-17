import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercise the production owners against real browser DOM. Network is replaced
// only for recovery cases; this check does not require Halo or generated assets.
const bundle = await build({ stdin: { contents: `
  import { DoubanApp } from './src/apps/douban/runtime.js';
  import { registerSteamExplorer } from './src/apps/steam/runtime.js';
  import { registerBangumisExplorer } from './src/apps/bangumis/runtime.js';
  import { registerEquipmentsExplorer } from './src/apps/equipments/runtime.js';
  window.catalogOwners = { DoubanApp };
  for (const register of [registerSteamExplorer, registerBangumisExplorer, registerEquipmentsExplorer]) {
    register({ data(name, factory) { window.catalogOwners[name] = factory; } });
  }
`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, format: 'iife', write: false, logLevel: 'silent' });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ reducedMotion: 'reduce' });
const results = [];
async function check(name, run) {
  try { await page.setContent('<html><body></body></html>'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await run(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', message: error.message }); }
}
async function doubanFixture() {
  await page.evaluate(() => {
    document.body.dataset.pageApp = 'douban';
    document.body.innerHTML = `<div data-app-root="douban"><section><button data-before>开始</button><button data-douban-view="grid">网格</button><button data-douban-view="list">列表</button><div data-douban-grid style="display:grid;grid-template-columns:repeat(2,1fr)"></div><table data-douban-list hidden><tbody data-douban-list-body></tbody></table><button data-douban-retry>重试</button></section><div data-douban-quicklook aria-hidden="true" inert><button class="douban-quicklook-backdrop" data-douban-close-preview tabindex="-1">关闭背景</button><article class="douban-quicklook-card" role="dialog" aria-modal="true"><button class="douban-quicklook-close" data-douban-close-preview>关闭</button><h2 data-douban-preview-title></h2><a data-douban-preview-link>详情</a></article></div></div>`;
    const app = new catalogOwners.DoubanApp(document.querySelector('[data-app-root]'));
    app.state.items = [{ spec: { id: 'one', name: '第一部', link: 'https://example.org/film/one' } }, { spec: { id: 'two', name: '第二部' } }, { spec: { id: 'three', name: '第三部' } }];
    app.renderItems();
    app.root.addEventListener('click', app.onClick);
    document.addEventListener('keydown', app.onKeydown);
    window.app = app;
  });
}
try {
  await check('豆瓣网格和表格均可用 Tab、Enter 打开预览并回焦', async () => {
    await doubanFixture();
    const card = page.locator('[data-douban-grid] [data-douban-item-id]').first();
    assert.equal(await card.getAttribute('role'), 'button');
    assert.equal(await card.getAttribute('tabindex'), '0');
    await card.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-douban-quicklook]').classList.contains('is-open'));
    await page.keyboard.press('Escape');
    assert.equal(await card.evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => app.setViewMode('list'));
    const rowButton = page.locator('[data-douban-list-body] button').first();
    await rowButton.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-douban-quicklook]').getAttribute('aria-hidden'), 'false');
    await page.evaluate(() => app.destroy());
  });
  await check('豆瓣真实 backdrop 结构的初始焦点进入 dialog 内关闭按钮', async () => {
    await doubanFixture();
    await page.locator('[data-douban-grid] [data-douban-item-id]').first().focus();
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.douban-quicklook-close').evaluate(el => el === document.activeElement), true, 'Initial modal focus must not land on the earlier backdrop button');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('[data-douban-preview-link]').evaluate(el => el === document.activeElement), true, 'Shift+Tab wraps to the last control inside the dialog');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.douban-quicklook-close').evaluate(el => el === document.activeElement), true, 'Tab wraps to the first control inside the dialog');
    await page.evaluate(() => app.destroy());
  });
  await check('豆瓣预览在焦点落到 dialog 外时回收正反向 Tab', async () => {
    await doubanFixture();
    const result = await page.evaluate(() => {
      app.openPreview('one', document.querySelector('[data-douban-grid] [data-douban-item-id]'));
      const backdrop = document.querySelector('.douban-quicklook-backdrop');
      const dialog = document.querySelector('[role="dialog"]');
      return [false, true].map(shiftKey => {
        backdrop.focus();
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        backdrop.dispatchEvent(event);
        return { shiftKey, prevented: event.defaultPrevented, inside: dialog.contains(document.activeElement), first: document.activeElement.classList.contains('douban-quicklook-close') };
      });
    });
    assert.deepEqual(result, [{ shiftKey: false, prevented: true, inside: true, first: true }, { shiftKey: true, prevented: true, inside: true, first: false }]);
    await page.evaluate(() => app.destroy());
  });
  await check('豆瓣方向键遵循实际网格列数并保留控件的原生按键', async () => {
    await doubanFixture();
    await page.locator('[data-douban-grid] [data-douban-item-id]').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => app.state.focusedId), 'three');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.doubanItemId), 'three');
    await page.locator('[data-douban-view="grid"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => app.state.focusedId), 'three');
    await page.evaluate(() => app.destroy());
  });
  await check('豆瓣下一页失败后重试保留旧条目且继续请求同一页', async () => {
    await doubanFixture();
    await page.evaluate(async () => {
      app.state.hasMore = true; app.state.pageSize = 3;
      app.fetchList = async () => { throw new Error('offline fixture'); };
      await app.loadMore();
      window.retryPages = [];
      app.fetchList = async page => { retryPages.push(page); return { items: [{ spec: { id: 'four', name: '第四部' } }], total: 4 }; };
      app.onClick({ target: document.querySelector('[data-douban-retry]') });
    });
    await page.waitForFunction(() => retryPages.length > 0);
    assert.deepEqual(await page.evaluate(() => retryPages), [2]);
    assert.equal(await page.locator('[data-douban-grid] [data-douban-item-id="one"]').count(), 1);
    await page.evaluate(() => app.destroy());
  });
  await check('Steam 名称排序同步 DOM 与键盘顺序并保留节点', async () => {
    const result = await page.evaluate(() => {
      document.body.innerHTML = '<div data-app-root="steam"><div class="steam-library-grid"><a data-steam-game-card data-steam-game-name="Zulu" data-steam-app-id="1" href="#one"></a><a data-steam-game-card data-steam-game-name="Alpha" data-steam-app-id="2" href="#two"></a></div></div>';
      const app = catalogOwners.steamExplorer(); app.$root = document.querySelector('[data-app-root]'); app.readGames();
      const original = app.games[0].el; app.sortMode = 'name'; app.applyGameOrdering();
      return { order: [...app.$root.querySelectorAll('[data-steam-game-card]')].map(el => el.dataset.steamGameName), identity: app.$root.querySelector('[data-steam-app-id="1"]') === original };
    });
    assert.deepEqual(result.order, ['Alpha', 'Zulu']); assert.equal(result.identity, true);
  });
  await check('Steam 热力图失败可重试、日期可通过方向键读取', async () => {
    const result = await page.evaluate(async () => {
      document.body.innerHTML = '<div><section class="steam-heatmap-panel" data-steam-heatmap-days="28"><span data-steam-heatmap-summary></span><span data-steam-heatmap-detail></span><div data-steam-heatmap-grid></div></section></div>';
      const app = catalogOwners.steamExplorer(); app.$root = document.body.firstElementChild;
      window.fetch = async () => ({ ok: false, status: 503 }); await app.renderHeatmap();
      const failed = app.heatmapError;
      window.fetch = async () => ({ ok: true, json: async () => ({ page: 1, size: 28, total: 0, items: [] }) });
      await app.renderHeatmap();
      const grid = document.querySelector('[data-steam-heatmap-grid]');
      grid.addEventListener('keydown', event => app.focusHeatmapDay(event));
      grid.addEventListener('focusin', event => app.describeHeatmapDay(event));
      grid.querySelector('[tabindex="0"]').focus();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      return { failed, recovered: !app.heatmapError, focus: [...grid.children].indexOf(document.activeElement), stops: grid.querySelectorAll('[tabindex="0"]').length, detail: document.querySelector('[data-steam-heatmap-detail]').textContent };
    });
    assert.equal(result.failed, true); assert.equal(result.recovered, true); assert.equal(result.focus, 20); assert.equal(result.stops, 1); assert.match(result.detail, /无记录/);
  });
  await check('追番清除搜索后恢复列表并回焦搜索框', async () => {
    const result = await page.evaluate(() => {
      document.body.innerHTML = '<div><input class="bangumis-search"><div data-bangumi-card data-bangumi-title="海绵宝宝"></div><div data-bangumi-card data-bangumi-title="间谍过家家"></div></div>';
      const app = catalogOwners.bangumisExplorer(); app.$root = document.body.firstElementChild; app.searchQuery = '不存在'; app.$nextTick = fn => fn();
      const before = app.visibleCount(); app.clearSearch();
      return { before, after: app.visibleCount(), focused: document.activeElement.matches('.bangumis-search') };
    });
    assert.equal(result.before, 0); assert.equal(result.after, 2); assert.equal(result.focused, true);
  });
  await check('装备逐件导航保持边界且尊重减少动态效果', async () => {
    const result = await page.evaluate(async () => {
      document.body.innerHTML = '<div><div class="equipments-stage-scroller" style="height:100px;overflow:auto"><article data-equipment-card style="height:100px"></article><article data-equipment-card style="height:100px"></article></div></div>';
      const app = catalogOwners.equipmentsExplorer(); app.$root = document.body.firstElementChild; app.$nextTick = fn => fn();
      const calls = []; app.$root.querySelector('.equipments-stage-scroller').scrollTo = options => calls.push(options);
      app.readCards(); await app.stepEquipment(1); await app.stepEquipment(1); await app.stepEquipment(-1);
      return { calls, current: app.currentIndex, count: app.itemCount };
    });
    assert.equal(result.count, 2); assert.equal(result.current, 0); assert.equal(result.calls.length, 2); assert.ok(result.calls.every(call => call.behavior === 'auto'));
  });
  await check('装备平滑滚动中连续点下一件不会丢失目标，滚轮可重新接管', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      document.body.innerHTML = '<main><button>下一件</button><div class="equipments-stage-scroller" style="position:relative;height:500px;overflow:auto">' + '<article data-equipment-card style="height:500px"></article>'.repeat(3) + '</div></main>';
      const app = catalogOwners.equipmentsExplorer(); app.$root = document.querySelector('main'); app.readCards(); app.installStageNavigation();
      document.querySelector('button').onclick = () => app.stepEquipment(1);
      window.equipmentApp = app;
    });
    const next = page.getByRole('button', { name: '下一件' }), scroller = page.locator('.equipments-stage-scroller');
    await next.click();
    await page.waitForFunction(() => document.querySelector('.equipments-stage-scroller').scrollTop > 0 && document.querySelector('.equipments-stage-scroller').scrollTop < 250);
    await next.click();
    await page.waitForFunction(() => window.equipmentApp.currentIndex === 2 && document.querySelector('.equipments-stage-scroller').scrollTop >= 999, null, { timeout: 2500 });
    await scroller.hover(); await page.mouse.wheel(0, -500);
    await page.waitForFunction(() => window.equipmentApp.currentIndex === 1, null, { timeout: 2500 });
  });
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.status === 'PASS'), `${results.filter(result => result.status === 'FAIL').length} catalog polish checks failed`);
