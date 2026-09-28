import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { editModeMethods } from '../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js';

const template = readFileSync(new URL('../templates/modules/shell/desktop-widgets.html', import.meta.url), 'utf8');
const alpinePath = new URL('../node_modules/alpinejs/dist/cdn.min.js', import.meta.url).pathname;

function sourceBetween(start, end) {
  const startIndex = template.indexOf(start);
  const endIndex = template.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `模板片段缺失：${start}`);
  return template.slice(startIndex, endIndex);
}

test('小组件设置字段和外观选项有可访问名称、角色与状态', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fields = sourceBetween(
      '<template x-for="field in widgetConfigForm.configSchema"',
      '<template x-if="widgetConfigForm.previewWidget">'
    );
    const appearances = sourceBetween(
      '<div class="desktop-widget-center-appearance-picker"',
      '<button type="button"\n                                  class="desktop-widget-center-item-action"'
    );
    await page.setContent(`
      <main>
        <section x-data="widgetSettingsFixture()">${fields}</section>
        <section x-data="widgetAppearanceFixture()">${appearances}</section>
      </main>
    `);
    await page.evaluate((handlerSource) => {
      const keydownHandler = new Function(`return ({ ${handlerSource} }).handleCatalogAppearanceKeydown`)();
      window.widgetSettingsFixture = () => ({
        widgetConfigForm: {
          meta: { cityName: '北京', count: 2, category: 'all', showCaption: true, groups: '', categories: [] },
          configSchema: [
            { key: 'cityName', label: '城市', type: 'text' },
            { key: 'count', label: '条数', type: 'number', min: 1, max: 10 },
            { key: 'category', label: '分类', type: 'select' },
            { key: 'showCaption', label: '显示标题', type: 'toggle' },
            { key: 'groups', label: '相册分组', type: 'photo-group' },
            { key: 'categories', label: '文章分类', type: 'category-list' }
          ]
        },
        widgetConfigSelectOptions: () => [{ value: 'all', label: '全部' }],
        widgetConfigPhotoGroups: () => [],
        widgetConfigCategoryOptions: () => [],
        updateWidgetConfigMeta(key, value) { this.widgetConfigForm.meta[key] = value; }
      });
      window.widgetAppearanceFixture = () => ({
        entry: { title: '示例日历', catalogKey: 'system.calendar:small' },
        selectedAppearance: 'follow',
        widgetCenterSelections: {},
        isCatalogAppearanceSelected(_entry, appearance) {
          return this.selectedAppearance === appearance;
        },
        selectCatalogAppearance(_key, appearance) { this.selectedAppearance = appearance; },
        handleCatalogAppearanceKeydown: keydownHandler,
        $nextTick(callback) { window.Alpine.nextTick(callback); },
        widgetAppearanceLabel: (appearance) => ({ follow: '跟随', light: '浅色', dark: '深色' })[appearance]
      });
    }, editModeMethods.handleCatalogAppearanceKeydown.toString());
    await page.addScriptTag({ path: alpinePath });
    await page.locator('.desktop-widget-config-input').first().waitFor();

    assert.equal(await page.getByRole('textbox', { name: '城市' }).count(), 1);
    assert.equal(await page.getByRole('spinbutton', { name: '条数' }).count(), 1);
    assert.equal(await page.getByRole('combobox', { name: '分类' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '显示标题' }).count(), 1);
    assert.equal(await page.getByRole('group', { name: '相册分组' }).count(), 1);
    assert.equal(await page.getByRole('group', { name: '文章分类' }).count(), 1);

    const tablist = page.getByRole('tablist', { name: '示例日历 外观' });
    assert.equal(await tablist.count(), 1);
    assert.equal(await tablist.getByRole('tab').count(), 3);
    assert.equal(await tablist.getByRole('tab', { name: '跟随', selected: true }).count(), 1);
    await tablist.getByRole('tab', { name: '浅色' }).click();
    assert.equal(await tablist.getByRole('tab', { name: '浅色', selected: true }).count(), 1);
    await tablist.getByRole('tab', { name: '浅色' }).press('ArrowRight');
    assert.equal(await tablist.getByRole('tab', { name: '深色', selected: true }).count(), 1);
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '深色', null, { timeout: 1500 });
    assert.equal(await tablist.getByRole('tab', { name: '深色' }).evaluate((node) => document.activeElement === node), true);
  } finally {
    await browser.close();
  }
});

test('外观选项支持方向键移动选择和焦点', () => {
  const entry = { catalogKey: 'system.calendar:small' };
  let focused = -1;
  let prevented = false;
  const tabs = [0, 1, 2].map((index) => ({ focus() { focused = index; } }));
  const host = {
    ...editModeMethods,
    widgetCenterSelections: { [entry.catalogKey]: { appearance: 'follow' } },
    $nextTick(callback) { callback(); }
  };
  const event = {
    key: 'ArrowRight',
    preventDefault() { prevented = true; },
    currentTarget: { parentElement: { querySelectorAll() { return tabs; } } }
  };

  host.handleCatalogAppearanceKeydown(entry, 'follow', event);
  assert.equal(host.selectedCatalogAppearance(entry), 'light');
  assert.equal(focused, 1);
  assert.equal(prevented, true);
});
