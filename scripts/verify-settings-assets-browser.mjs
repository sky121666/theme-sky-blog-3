import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

// Fixture regression on the served theme. Never loads credentials or writes to Halo.
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090/';
const site = new URL(base);
assert.ok(['http:', 'https:'].includes(site.protocol) && !site.username && !site.password);
const liveIconify = process.env.SETTINGS_LIVE_ICONIFY === 'true';
const output = path.resolve(process.env.SETTINGS_BROWSER_OUTPUT || 'output/icon-interaction-polish-2026-09-29/browser');
await fs.mkdir(output, { recursive: true });
const clone = (value) => structuredClone(value);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const imagePath = (name) => `/__settings_fixture__/${name}.png`;
const attachment = (name, displayName) => ({
  apiVersion: 'storage.halo.run/v1alpha1', kind: 'Attachment',
  metadata: { name, creationTimestamp: '2026-09-29T00:00:00Z' },
  spec: { displayName, mediaType: 'image/png', policyName: 'fixture-local' },
  status: { permalink: imagePath(name), thumbnails: { S: imagePath(name) } },
});
const firstImage = attachment('fixture-mountain', '测试山景');
const secondImage = attachment('fixture-sea', '测试海景');
const uploadedImage = attachment('fixture-uploaded', 'fixture-upload.png');
const originalConfig = {
  header: { logo: { title: 'Fixture settings' }, icons: {}, actions: { search_enabled: true }, untouched: { fixture: 'header-preserved' } },
  desktop: { background: { mode: 'preset', preset: 'deep-sea', image_url: '' }, icons: { posts: ['fixture-preserved-post'] } },
  widgets: { behavior: { enabled: true, hide_on_mobile: false, edit_enabled: true, fallback_cover: imagePath('initial-cover') }, modules: { weather: { city_name: '北京', refresh_minutes: 30 }, fixture_module: { retained: true } } },
  developer: { fixtureKeep: 'unrelated-setting-preserved' },
};
let serverConfig = clone(originalConfig);
let revision = 1;
let denyAttachments = false;
let delayUpload = false;
let releaseUpload;
let denyIconSearch = false;
let releaseIconSearch;
let useLiveIconify = false;
const liveIconifyRequests = new Set();
const iconBody = '<path fill="currentColor" d="M2 12L12 2l10 10v10H2z"/>';
const pagedIconNames = Array.from({ length: 101 }, (_, index) => `fixture-page-${String(index + 1).padStart(3, '0')}`);
const fixtureIconCollections = {
  lucide: { name: 'Lucide', total: 105, author: { name: 'Lucide' }, license: { title: 'ISC' } },
  mdi: { name: 'Material Design Icons', total: 105, author: { name: 'Pictogrammers' }, license: { title: 'Apache 2.0' } },
  ph: { name: 'Phosphor', total: 3, author: { name: 'Phosphor' }, license: { title: 'MIT' } },
};
const fixtureCollectionNames = {
  lucide: ['house', 'home', 'navigation', 'search', ...pagedIconNames],
  mdi: ['home', 'navigation', 'navigation-outline', 'compass', ...pagedIconNames],
  ph: ['house', 'navigation-arrow', 'books'],
};
const report = {
  fixture: true, recordedAt: new Date().toISOString(), site: site.origin,
  boundary: '真实主题页面与交互；仅在文档中模拟设置授权。配置 GET/PUT、附件读取/上传与默认在线图标使用 fixture；liveIconify 记录单独列出的官方只读 GET（如启用）；不代表真实 Halo 上传或保存验收。未登录、未读取凭据。',
  checks: [], screenshots: [], pageErrors: [], blockedWrites: [], fixtureWrites: [], attachmentQueries: [], resourceQueries: [],
  realWriteRequestsForwarded: 0, liveIconify: [], iconQueries: [],
};
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function verifyBuild() {
  const local = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8'));
  const shell = local['shell-core'].js[0];
  const assets = shell.slice(0, shell.indexOf('/assets/') + '/assets/'.length);
  const get = async (href) => {
    const response = await fetch(new URL(href, site), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.ok(response.ok, `构建身份读取失败：${href} HTTP ${response.status}`);
    return response;
  };
  const served = await (await get(`${assets}asset-manifest.json`)).json();
  assert.deepEqual(served.__meta, local.__meta, '远端与本地构建 manifest 必须一致');
  const verifiedAssets = [];
  for (const asset of [...new Set([...local['shell-core'].js, ...local['shell-core'].css])]) {
    const relative = `templates/assets/${asset.slice(asset.indexOf('/assets/') + 8)}`;
    const actual = Buffer.from(await (await get(`${asset}?${local.__meta.query}`)).arrayBuffer());
    const expected = await fs.readFile(relative);
    assert.equal(digest(actual), digest(expected), `远端入口资源与本地不一致：${relative}`);
    verifiedAssets.push({ path: relative, sha256: digest(actual) });
  }
  return { build: local.__meta, verifiedAssets, boundary: '仅验证本地/远端 manifest 和入口资源字节；Halo/插件身份由主验收独立核对。' };
}

const browser = await chromium.launch({ headless: true });
let context;
let page;
try {
  report.buildContext = await verifyBuild();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const local = url.origin === site.origin;
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (local && /^\/apis\/api\.console\.halo\.run\/v1alpha1\/themes\/[^/]+\/json-config$/.test(url.pathname)) {
      if (method === 'GET') return json(serverConfig, 200, { etag: `"fixture-${revision}"` });
      if (method === 'PUT') {
        serverConfig = request.postDataJSON();
        revision++;
        report.fixtureWrites.push({ method, path: url.pathname, kind: 'theme-config', revision });
        return json(serverConfig, 200, { etag: `"fixture-${revision}"` });
      }
    }
    if (local && method === 'GET' && (url.pathname === '/api/v1alpha1/menus' || /^\/apis\/content\.halo\.run\/v1alpha1\/(categories|tags|posts|singlepages)$/.test(url.pathname))) {
      const kind = url.pathname.split('/').at(-1);
      const pageNumber = Number(url.searchParams.get('page') || 1);
      report.resourceQueries.push({ kind, page: pageNumber });
      const name = `fixture-${kind}${pageNumber > 1 ? '-more' : ''}`;
      const items = [{ metadata: { name }, spec: { displayName: `测试 ${kind}`, title: `测试 ${kind}`, publish: true }, status: { permalink: `/__settings_fixture__/${kind}` } }];
      return json({ page: pageNumber, size: 50, total: kind === 'menus' ? 51 : 1, items });
    }
    if (local && url.pathname === '/apis/api.console.halo.run/v1alpha1/attachments' && method === 'GET') {
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const size = Number(url.searchParams.get('size') || 24);
      const keyword = url.searchParams.get('keyword') || '';
      report.attachmentQueries.push({ page: pageNumber, keyword });
      if (denyAttachments) return json({ title: 'Fixture forbidden' }, 403);
      const items = keyword ? (keyword.includes('海') ? [secondImage] : []) : (pageNumber > 1 ? [secondImage] : [firstImage]);
      return json({ page: pageNumber, size, total: keyword ? items.length : 25, items });
    }
    if (local && url.pathname === '/apis/storage.halo.run/v1alpha1/policies' && method === 'GET') {
      return json({ page: 1, size: 100, total: 1, items: [{ metadata: { name: 'fixture-local' }, spec: { displayName: '隔离测试存储' } }] });
    }
    if (local && url.pathname === '/apis/api.console.halo.run/v1alpha1/attachments/upload' && method === 'POST') {
      const body = request.postDataBuffer()?.toString('latin1') || '';
      assert.ok(body.includes('fixture-local') && body.includes('fixture-upload.png'), '上传必须携带选定策略和测试图片');
      report.fixtureWrites.push({ method, path: url.pathname, kind: 'attachment-upload' });
      if (delayUpload) await new Promise((resolve) => { releaseUpload = resolve; });
      return json(uploadedImage).catch(() => {}); // Closing the picker aborts this intercepted request.
    }
    // Every non-read operation reaching the real site is stopped before forwarding.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      report.blockedWrites.push({ method, origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (local && url.pathname.startsWith('/__settings_fixture__/')) return route.fulfill({ contentType: 'image/png', body: png });
    if (url.origin === 'https://api.iconify.design') {
      const query = url.searchParams.get('query') || '';
      const prefix = url.searchParams.get('prefix') || '';
      const start = Number(url.searchParams.get('start') || 0);
      const limit = Number(url.searchParams.get('limit') || 51);
      const requestedIcons = (url.searchParams.get('icons') || '').split(',').filter(Boolean);
      report.iconQueries.push({ path: url.pathname, query, prefix, start, limit, icons: requestedIcons, live: useLiveIconify });
      if (liveIconify && useLiveIconify && (url.pathname === '/search' || url.pathname === '/mdi.json')) {
        liveIconifyRequests.add(url.href);
        return route.continue();
      }
      if (url.pathname === '/collections') return json(fixtureIconCollections);
      if (url.pathname === '/collection') {
        const names = fixtureCollectionNames[prefix];
        if (!names) return json({ error: 'Unknown fixture collection' }, 404);
        return json({ prefix, total: names.length, categories: { Common: names.slice(0, 4) }, uncategorized: names.slice(4) });
      }
      if (url.pathname === '/search') {
        assert.equal(limit, Math.min(start + 51, 999), 'limit必须是累计检索上限，额外一项只用于判断下一页');
        if (start >= limit) return json({ error: 'Bad request' }, 400);
        if (query === 'fixture-error' && denyIconSearch) return json({ error: 'Fixture icon service unavailable' }, 503);
        if (query === 'fixture-pending') await new Promise((resolve) => { releaseIconSearch = resolve; });
        let names;
        if (query === 'fixture-pages') names = pagedIconNames.map((name) => `mdi:${name}`);
        else if (query === 'fixture-empty') names = [];
        else if (query === 'fixture-pending') names = ['mdi:pending-old'];
        else if (query === 'fixture-error') names = ['mdi:home'];
        else if (query.includes(':')) names = [query];
        else names = Object.entries(fixtureCollectionNames).flatMap(([set, entries]) => entries.filter((name) => name.includes(query)).map((name) => `${set}:${name}`));
        if (prefix) names = names.filter((name) => name.startsWith(`${prefix}:`));
        const icons = names.slice(start, limit);
        return json({ icons, total: Math.min(names.length, limit), limit, start }).catch(() => {});
      }
      const jsonCollection = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
      if (jsonCollection) {
        assert.ok(requestedIcons.length > 0 && requestedIcons.length <= 50, '每批只应加载当前页图标');
        return json({ prefix: jsonCollection, width: 24, height: 24, icons: Object.fromEntries(requestedIcons.map((name) => [name, { body: iconBody }])) });
      }
      throw new Error(`未声明的 Iconify 请求：${url.pathname}；图标应使用批量 JSON，不能逐个请求 SVG`);
    }
    if (local && request.isNavigationRequest() && request.resourceType() === 'document') {
      const response = await route.fetch({ headers: { ...request.headers(), 'cache-control': 'no-cache', pragma: 'no-cache' } });
      const html = await response.text();
      report.documentState = {
        hasPicker: html.includes('id="theme-asset-picker"'),
        hasImageButton: html.includes('添加图片…'),
        hasOldImageHelp: html.includes('已上传的背景图片由 Halo 后台附件组件管理'),
      };
      assert.ok(report.documentState.hasPicker && report.documentState.hasImageButton, '服务端仍返回旧设置模板；请重新加载当前主题后重试');
      let protocolCount = 0;
      const patched = html.replace(/<[^>]*\bdata-theme-settings-protocol\b[^>]*>/g, (tag) => {
        protocolCount++;
        return /\bdata-authenticated\s*=/.test(tag)
          ? tag.replace(/\bdata-authenticated\s*=\s*(["'])[^"']*\1/, 'data-authenticated="true"')
          : tag.replace(/>$/, ' data-authenticated="true">');
      });
      assert.equal(protocolCount, 1, '真实页面必须有唯一设置协议，不得用旧页面替代本次模板');
      return route.fulfill({ response, body: patched });
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => report.pageErrors.push(String(error.message || error)));
  page.on('dialog', (dialog) => dialog.dismiss());
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (liveIconifyRequests.has(url.href)) report.liveIconify.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(() => {
    window.__settingsFixtureWidgetEvents = [];
    window.__settingsFixturePjaxSends = 0;
    document.addEventListener('pjax:send', () => window.__settingsFixturePjaxSends++);
    window.addEventListener('theme:widget-settings-change', (event) => {
      window.__settingsFixtureWidgetEvents.push({ changedPath: event.detail.changedPath, fallbackCover: event.detail.fallbackCover });
    });
  });
  const settings = page.locator('[data-theme-settings-window]');
  const picker = page.locator('#theme-asset-picker');
  const waitPicker = async () => {
    await picker.waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.Alpine?.store('themeAssets')?.busy === false);
  };
  const waitClosed = () => picker.waitFor({ state: 'hidden' });
  const iconNames = () => picker.locator('.theme-asset-icon').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  const waitIconInput = async () => {
    // Let the input's 300 ms debounce start before checking the completion state.
    await page.waitForTimeout(360);
    await waitPicker();
  };
  const searchIcons = async (query) => {
    await picker.getByRole('searchbox', { name: '搜索素材', exact: true }).fill(query);
    await waitIconInput();
  };
  const chooseIconCollection = async (prefix) => {
    const select = picker.getByLabel('图标集', { exact: true });
    await select.locator(`option[value="${prefix}"]`).waitFor({ state: 'attached' });
    await select.selectOption(prefix);
    await waitPicker();
  };
  const storeValue = (valuePath) => page.evaluate((key) => window.Alpine.store('themeSettings').value(key), valuePath);
  const choosePane = async (name) => {
    await page.waitForFunction(() => {
      const store = window.Alpine.store('themeSettings');
      const mobile = window.matchMedia('(max-width: 680px)').matches;
      return store.isMobileViewport === mobile && document.querySelector('#theme-settings-sidebar').getAttribute('aria-hidden') === String(mobile && !store.mobileSidebarOpen);
    });
    if (await page.locator('[data-theme-settings-sidebar-toggle]').isVisible()) {
      if (await page.locator('#theme-settings-sidebar').getAttribute('aria-hidden') === 'true') await page.getByRole('button', { name: '展开设置分类', exact: true }).click();
    }
    await settings.locator('.theme-settings-navigation button').filter({ has: page.locator('strong').getByText(name, { exact: true }) }).click();
    await page.waitForFunction((label) => document.querySelector('#theme-settings-title')?.textContent?.trim() === label, name);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const openBackground = async () => {
    await choosePane('墙纸');
    await settings.getByRole('button', { name: '添加图片…', exact: true }).click();
    await waitPicker();
  };
  const putCount = () => report.fixtureWrites.filter((entry) => entry.kind === 'theme-config').length;
  const uploadCount = () => report.fixtureWrites.filter((entry) => entry.kind === 'attachment-upload').length;
  const waitUploadRequest = async (count) => {
    const deadline = Date.now() + 12_000;
    while (uploadCount() < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(uploadCount(), count, '等待 fixture 上传请求');
  };
  async function scenario(name, action) {
    await action();
    report.checks.push({ name, passed: true });
    console.log(`通过：${name}`);
  }
  async function screenshot(name) {
    await page.waitForTimeout(550);
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    report.screenshots.push(path.basename(file));
  }
  async function verifyBrandGeometry(name, customSvg) {
    const geometry = await page.locator('.menubar').evaluate((bar) => {
      const rect = (selector) => bar.querySelector(selector)?.getBoundingClientRect().toJSON();
      return {
        bar: bar.getBoundingClientRect().toJSON(),
        button: rect('.menubar-brand-icon'), title: rect('.menubar-app-name'),
        svg: rect('.menubar-brand-icon svg'),
        text: bar.querySelector('.menubar-brand-icon')?.textContent.trim(),
      };
    });
    const mobile = page.viewportSize().width <= 640;
    assert.equal(geometry.bar.height, mobile ? 44 : 24, `${name}：顶栏高度保持不变`);
    assert.equal(geometry.button.width, mobile ? 36 : 22, `${name}：品牌点击区域宽度`);
    assert.equal(geometry.button.height, mobile ? 36 : 22, `${name}：品牌点击区域高度`);
    const centerY = (box) => box.y + box.height / 2;
    assert.ok(Math.abs(centerY(geometry.button) - centerY(geometry.title)) < 0.5, `${name}：品牌按钮与文字容器中心一致`);
    if (customSvg) {
      const { svg, button } = geometry;
      assert.ok(svg && Math.abs(svg.width - svg.height) < 0.5, `${name}：SVG 视口必须为正方形，不能被通用 flex-basis 压窄`);
      assert.ok(svg.width >= 14 && svg.width <= 18, `${name}：品牌图标尺寸适合紧凑顶栏`);
      assert.ok(svg.x >= button.x && svg.y >= button.y && svg.right <= button.right && svg.bottom <= button.bottom, `${name}：图标不得溢出点击区域`);
      assert.ok(Math.abs(centerY(svg) - centerY(geometry.title)) <= 1.5, `${name}：光学校准不得移动按钮或偏离文字中心过远`);
    } else {
      assert.equal(geometry.svg, undefined, `${name}：默认苹果保留字体字形`);
      assert.equal(geometry.text, '\uF8FF');
    }
    (report.brandGeometry ||= []).push({ name, ...geometry });
    const file = path.join(output, `${name}.png`);
    await page.locator('.menubar').screenshot({ path: file });
    report.screenshots.push(path.basename(file));
  }
  await page.goto(site.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Alpine?.store('themeAssets') && window.Alpine?.store('themeSettings'));

  await scenario('真实入口在模拟授权与 fixture GET 后打开设置', async () => {
    await page.getByRole('button', { name: '打开系统设置', exact: true }).click();
    await settings.waitFor({ state: 'visible' });
    assert.equal(await storeValue('widgets.behavior.fallback_cover'), imagePath('initial-cover'));
    assert.equal(putCount(), 0);
  });
  await scenario('九个设置分类独立显示，添加图片只打开选择器', async () => {
    for (const label of ['外观', '墙纸', '桌面与 Dock', '菜单栏', '导航菜单', '小组件', '通知中心', '应用', '高级']) {
      await choosePane(label);
      assert.equal(await settings.locator('[data-settings-pane]:visible').count(), 1);
    }
    await choosePane('墙纸');
    await screenshot('desktop-wallpaper-fixture');
    const before = { mode: await storeValue('desktop.background.mode'), url: await storeValue('desktop.background.image_url') };
    await settings.getByRole('button', { name: '添加图片…', exact: true }).click();
    await waitPicker();
    await picker.getByRole('button', { name: '测试山景', exact: true }).waitFor();
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
    assert.equal(await storeValue('desktop.background.mode'), before.mode);
    assert.equal(await storeValue('desktop.background.image_url'), before.url);
    assert.equal(putCount(), 0);
    assert.equal(uploadCount(), 0);
    assert.equal(await page.evaluate(() => window.Alpine.store('themeSettings').hasDirtyChanges()), false);
  });
  await scenario('墙纸图库展开收起、来源选择与颜色预览不写入配置', async () => {
    await choosePane('墙纸');
    const gallery = settings.getByRole('radiogroup', { name: '内置墙纸', exact: true });
    assert.equal(await gallery.getByRole('radio').count(), 4);
    await gallery.getByRole('radio').first().press('End');
    assert.equal(await storeValue('desktop.background.preset'), 'graphite-night', '键盘仅选择收起后可见的最后一项');
    await settings.getByRole('button', { name: '全部显示（12）', exact: true }).click();
    assert.equal(await gallery.getByRole('radio').count(), 12);
    await gallery.getByRole('radio', { name: '深海', exact: true }).click();
    await settings.getByRole('button', { name: '收起', exact: true }).click();
    assert.equal(await gallery.getByRole('radio').count(), 4);
    assert.equal(await storeValue('desktop.background.preset'), 'deep-sea');
    assert.equal(await settings.getByLabel('背景来源', { exact: true }).locator('option[value="image"]').evaluate((option) => option.disabled), true);
    await settings.getByLabel('背景来源', { exact: true }).selectOption('solid');
    assert.equal(await storeValue('desktop.background.mode'), 'solid');
    await settings.getByRole('button', { name: '石墨黑', exact: true }).click();
    assert.equal((await storeValue('desktop.background.solid_color')).toLowerCase(), '#1c1c1e');
    assert.equal(await settings.getByRole('button', { name: '石墨黑', exact: true }).getAttribute('aria-pressed'), 'true');
    await settings.getByLabel('自定义墙纸颜色', { exact: true }).fill('#2468ac');
    await page.waitForFunction(() => document.body.style.backgroundColor === 'rgb(36, 104, 172)');
    await settings.getByLabel('背景来源', { exact: true }).selectOption('preset');
    assert.equal(await storeValue('desktop.background.preset'), 'deep-sea');
    const dirtyPaths = await page.evaluate(() => window.Alpine.store('themeSettings').dirtyPaths);
    for (let attempt = 0; attempt < 2; attempt++) {
      await settings.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('desktop.background.preset');
      await settings.locator('.theme-settings-search-results button').click();
      await gallery.getByRole('radio', { name: '深海', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await gallery.getByRole('radio').count(), 12);
      await settings.getByRole('button', { name: '收起', exact: true }).click();
      assert.equal(await gallery.getByRole('radio').count(), 4);
    }
    assert.equal(await storeValue('desktop.background.preset'), 'deep-sea');
    assert.deepEqual(await page.evaluate(() => window.Alpine.store('themeSettings').dirtyPaths), dirtyPaths);
    assert.equal(putCount(), 0);
    await settings.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('正在编辑的文字立即进入草稿，Escape 保留未应用修改', async () => {
    await choosePane('应用');
    const input = settings.locator('[data-setting-path="equipments.profile.display_name"] input');
    await input.fill('测试装备标题');
    assert.equal(await storeValue('equipments.profile.display_name'), '测试装备标题');
    await page.keyboard.press('Escape');
    assert.ok(await settings.isVisible(), '第一次 Escape 必须显示放弃提醒并保留草稿');
    assert.equal(await input.inputValue(), '测试装备标题');
    await settings.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('菜单加载更多后重新聚焦仍保留第二页，只修改菜单来源', async () => {
    await choosePane('导航菜单');
    await settings.getByRole('button', { name: '加载更多', exact: true }).click();
    const select = settings.locator('[data-setting-path="navigation.header.menu_name"] select');
    await select.locator('option[value="fixture-menus-more"]').waitFor({ state: 'attached' });
    const requests = report.resourceQueries.length;
    await select.focus();
    await page.waitForTimeout(80);
    assert.equal(report.resourceQueries.length, requests, '聚焦不应重新请求第一页');
    await select.selectOption('fixture-menus-more');
    assert.equal(await storeValue('navigation.header.menu_name'), 'fixture-menus-more');
    assert.equal(putCount(), 0);
    await settings.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('附件分页与名称搜索返回可选择结果', async () => {
    await openBackground();
    await picker.getByRole('button', { name: '测试山景', exact: true }).waitFor();
    await picker.getByRole('button', { name: '下一页', exact: true }).click();
    await picker.getByRole('button', { name: '测试海景', exact: true }).waitFor();
    assert.ok(report.attachmentQueries.some((query) => query.page === 2));
    await picker.getByRole('searchbox', { name: '搜索素材' }).fill('海');
    await page.waitForFunction(() => window.Alpine.store('themeAssets').page === 1 && !window.Alpine.store('themeAssets').busy);
    await picker.getByRole('button', { name: '测试海景', exact: true }).click();
    assert.ok(report.attachmentQueries.some((query) => query.keyword === '海'));
    await screenshot('desktop-image-picker-fixture');
  });
  await scenario('使用图片只改草稿并预览背景', async () => {
    await picker.getByRole('button', { name: '使用图片', exact: true }).click();
    await waitClosed();
    assert.equal(await storeValue('desktop.background.image_url'), imagePath('fixture-sea'));
    await page.waitForFunction((url) => document.body.style.backgroundImage.includes(url), imagePath('fixture-sea'));
    assert.equal(putCount(), 0);
  });
  await scenario('应用发出 fixture PUT 且保留无关配置', async () => {
    await settings.locator('.theme-settings-primary-button').click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').saving && window.Alpine.store('themeSettings').statusTone === 'success');
    assert.equal(putCount(), 1);
    assert.equal(serverConfig.desktop.background.image_url, imagePath('fixture-sea'));
    assert.equal(serverConfig.desktop.background.mode, 'image');
    assert.deepEqual(serverConfig.developer, originalConfig.developer);
    assert.deepEqual(serverConfig.desktop.icons, originalConfig.desktop.icons);
    assert.deepEqual(serverConfig.header.untouched, originalConfig.header.untouched);
  });
  await scenario('已有图片从内置背景切回图片时复用原图且不发起上传或保存', async () => {
    const before = {
      url: await storeValue('desktop.background.image_url'),
      puts: putCount(), uploads: uploadCount(), queries: report.attachmentQueries.length,
    };
    assert.equal(before.url, imagePath('fixture-sea'));
    await settings.getByRole('button', { name: '全部显示（12）', exact: true }).click();
    await settings.getByRole('radiogroup', { name: '内置墙纸', exact: true }).getByRole('radio', { name: '深海', exact: true }).click();
    await settings.getByRole('button', { name: '收起', exact: true }).click();
    assert.equal(await storeValue('desktop.background.mode'), 'preset');
    assert.equal(await storeValue('desktop.background.image_url'), before.url);
    await settings.locator('.theme-settings-photo-choice').click();
    assert.equal(await storeValue('desktop.background.mode'), 'image');
    assert.equal(await storeValue('desktop.background.image_url'), before.url);
    await page.waitForFunction((url) => document.body.style.backgroundImage.includes(url), before.url);
    assert.equal(await picker.isVisible(), false, '已有图片只切换来源，不应打开上传或选择流程');
    assert.equal(putCount(), before.puts);
    assert.equal(uploadCount(), before.uploads);
    assert.equal(report.attachmentQueries.length, before.queries);
    assert.equal(await page.evaluate(() => window.Alpine.store('themeSettings').hasDirtyChanges()), false);
  });
  await scenario('清除图片只解除草稿引用且可撤销', async () => {
    await settings.getByRole('button', { name: '移除图片', exact: true }).click();
    assert.equal(await storeValue('desktop.background.image_url'), '');
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await storeValue('desktop.background.image_url'), imagePath('fixture-sea'));
    assert.equal(putCount(), 1);
  });
  await scenario('Escape 只关闭素材弹窗并恢复发起按钮焦点', async () => {
    await openBackground();
    await page.keyboard.press('Escape');
    await waitClosed();
    assert.ok(await settings.isVisible());
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '添加图片…');
  });
  await scenario('上传使用 fixture 文件与策略，取消不会保存或删除附件', async () => {
    await openBackground();
    await picker.getByRole('button', { name: '上传图片', exact: true }).click();
    await picker.getByLabel('上传存储位置').selectOption('fixture-local');
    await picker.getByLabel('选择要上传的图片').setInputFiles({ name: 'fixture-upload.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction((url) => !window.Alpine.store('themeAssets').busy && window.Alpine.store('themeAssets').selectedUrl === url, imagePath('fixture-uploaded'));
    assert.equal(uploadCount(), 1);
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
    assert.equal(await storeValue('desktop.background.image_url'), imagePath('fixture-sea'));
    assert.equal(putCount(), 1);
  });
  await scenario('上传等待中关闭后，迟到响应不会改写下一次选择', async () => {
    delayUpload = true;
    await openBackground();
    await picker.getByRole('button', { name: '上传图片', exact: true }).click();
    await page.waitForFunction(() => !window.Alpine.store('themeAssets').busy && window.Alpine.store('themeAssets').policyName);
    await picker.getByLabel('选择要上传的图片').setInputFiles({ name: 'fixture-upload.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => window.Alpine.store('themeAssets').uploading);
    await waitUploadRequest(2);
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
    await openBackground();
    await picker.getByRole('button', { name: '测试山景', exact: true }).click();
    releaseUpload?.();
    delayUpload = false;
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.Alpine.store('themeAssets').selectedUrl), imagePath('fixture-mountain'));
    await picker.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('回退封面预览同步到组件运行数据并可撤销', async () => {
    await choosePane('小组件');
    const widgetPane = settings.locator('[data-settings-pane="widgets"]');
    await widgetPane.getByRole('button', { name: '选择图片…', exact: true }).click();
    await waitPicker();
    await picker.getByRole('button', { name: '测试山景', exact: true }).click();
    await picker.getByRole('button', { name: '使用图片', exact: true }).click();
    await waitClosed();
    assert.equal(await storeValue('widgets.behavior.fallback_cover'), imagePath('fixture-mountain'));
    await page.waitForFunction((url) => {
      const element = document.querySelector('[x-data="desktopWidgets"]');
      return element && window.Alpine.$data(element).sources.fallbackCover === url;
    }, imagePath('fixture-mountain'));
    assert.equal(await settings.getByAltText('回退封面').getAttribute('src'), imagePath('fixture-mountain'));
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await storeValue('widgets.behavior.fallback_cover'), imagePath('initial-cover'));
    await page.waitForFunction((url) => window.Alpine.$data(document.querySelector('[x-data="desktopWidgets"]')).sources.fallbackCover === url, imagePath('initial-cover'));
  });
  await scenario('设置行显示真实默认图标，图标按钮支持键盘打开和焦点返回', async () => {
    await choosePane('菜单栏');
    const triggers = settings.locator('.theme-settings-icon-trigger:visible');
    assert.equal(await triggers.count(), 6);
    assert.equal(await settings.getByRole('button', { name: '选择图标…', exact: true }).count(), 0);
    assert.ok(await triggers.evaluateAll((nodes) => nodes.every((node) => node.querySelector('.theme-settings-icon-sample')?.innerHTML.trim())), '未自定义时必须回显主题正在使用的默认图标');
    await screenshot('settings-current-icon-buttons');
    await triggers.first().focus();
    await page.keyboard.press('Enter');
    await waitPicker();
    assert.equal(await picker.getByRole('searchbox', { name: '搜索素材' }).getAttribute('placeholder'), 'Search icons…');
    assert.ok(!/\d+\s*个图标/.test(await picker.innerText()), '结果区不能用当前页数量冒充总量');
    await page.keyboard.press('Escape');
    await waitClosed();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '选择图标：应用图标');
  });
  await scenario('统一图标库先显示16个常用图标，英文别名和中文导航可搜索', async () => {
    await choosePane('菜单栏');
    const beforeRequests = report.iconQueries.length;
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    assert.equal(await picker.getByRole('button', { name: '内置图标', exact: true }).count(), 0);
    assert.equal(await picker.getByRole('button', { name: '在线图标', exact: true }).count(), 0);
    assert.equal(await picker.getByLabel('图标集', { exact: true }).inputValue(), '');
    assert.equal(await picker.locator('.theme-asset-icon').count(), 16);
    assert.equal(await picker.locator('.theme-asset-icon').first().getAttribute('aria-label'), 'lucide:house');
    assert.ok(report.iconQueries.slice(beforeRequests).every((request) => request.path === '/collections'), '常用图标不应请求图标详情或整集名称');
    await screenshot('desktop-icon-library-fixture');
    await searchIcons('home');
    await picker.getByRole('button', { name: 'lucide:home', exact: true }).click();
    const colorRequests = report.iconQueries.length;
    await picker.getByLabel('自定义颜色', { exact: true }).focus();
    await page.keyboard.press('Space');
    assert.ok(await picker.getByLabel('自定义颜色', { exact: true }).isChecked());
    await picker.getByLabel('图标颜色', { exact: true }).waitFor({ state: 'visible' });
    await page.keyboard.press('Space');
    await picker.getByLabel('图标颜色', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(report.iconQueries.length, colorRequests, '切换图标颜色只更新已选SVG，不应请求网络');
    await searchIcons('首页');
    await picker.getByRole('button', { name: 'lucide:house', exact: true }).click();
    await searchIcons('导航');
    await picker.getByRole('button', { name: 'mdi:navigation', exact: true }).waitFor();
    assert.ok(report.iconQueries.some((request) => request.path === '/search' && request.query === 'navigation'), '中文导航必须映射为navigation');
    assert.match(await picker.locator('.theme-asset-selected-icon').textContent(), /lucide:house/, '更换关键词保留已选图标');
    await screenshot('desktop-icon-navigation-fixture');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('图标集按需读取并按50项分页，返回页使用缓存且搜索重置页码', async () => {
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    const beforeCollection = report.iconQueries.length;
    await chooseIconCollection('mdi');
    const firstPage = await iconNames();
    assert.equal(firstPage.length, 50);
    const geometry = await picker.locator('.theme-asset-icon').evaluateAll((nodes) => nodes.map((node) => ({ x: Math.round(node.getBoundingClientRect().x), y: Math.round(node.getBoundingClientRect().y) })));
    assert.equal(new Set(geometry.map((point) => point.x)).size, 10);
    assert.equal(new Set(geometry.map((point) => point.y)).size, 5);
    assert.ok(await picker.locator('.theme-asset-icon-grid').evaluate((node) => node.scrollHeight - node.clientHeight <= 2), '桌面50项应完整显示五排');
    await screenshot('desktop-icon-fifty-results');
    assert.ok(firstPage.every((name) => name.startsWith('mdi:')));
    assert.equal(report.iconQueries.slice(beforeCollection).filter((request) => request.path === '/collection' && request.prefix === 'mdi').length, 1);
    assert.ok(await picker.getByRole('button', { name: '上一页图标', exact: true }).isDisabled());
    await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
    await waitPicker();
    const secondPage = await iconNames();
    assert.equal(secondPage.length, 50);
    assert.ok(secondPage.every((name) => !firstPage.includes(name)), '翻页替换结果，不能累加到100项');
    await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
    await waitPicker();
    assert.equal((await iconNames()).length, 5);
    assert.ok(await picker.getByRole('button', { name: '下一页图标', exact: true }).isDisabled(), '集合最后一页必须停止');
    await picker.getByRole('button', { name: '上一页图标', exact: true }).click();
    await waitPicker();
    const beforeReturn = report.iconQueries.length;
    await picker.getByRole('button', { name: '上一页图标', exact: true }).click();
    await waitPicker();
    assert.deepEqual(await iconNames(), firstPage);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '上一页图标', '返回首屏结果后保留分页按钮焦点');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.Alpine.store('themeAssets').page), 1, '不可用的上一页不能响应键盘重复翻页');
    assert.equal(report.iconQueries.length, beforeReturn, '回到已经加载的集合页不可重复请求');
    await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
    await waitPicker();
    await searchIcons('导航');
    assert.deepEqual(await iconNames(), ['mdi:navigation', 'mdi:navigation-outline']);
    assert.ok(report.iconQueries.some((request) => request.path === '/search' && request.query === 'navigation' && request.prefix === 'mdi' && request.start === 0));
    await searchIcons('');
    await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
    await waitPicker();
    await chooseIconCollection('ph');
    assert.equal((await iconNames()).length, 3, '切换集合应回到第一页');
    assert.ok((await iconNames()).every((name) => name.startsWith('ph:')));
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('统一搜索按50项分页，相同查询与返回页不重复请求', async () => {
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await searchIcons('fixture-pages');
    const firstPage = await iconNames();
    assert.equal(firstPage.length, 50);
    const geometry = await picker.locator('.theme-asset-icon').evaluateAll((nodes) => nodes.map((node) => ({ x: Math.round(node.getBoundingClientRect().x), y: Math.round(node.getBoundingClientRect().y) })));
    assert.equal(new Set(geometry.map((point) => point.x)).size, 10);
    assert.equal(new Set(geometry.map((point) => point.y)).size, 5);
    assert.ok(await picker.locator('.theme-asset-icon-grid').evaluate((node) => node.scrollHeight - node.clientHeight <= 2), '桌面50项应完整显示五排');
    await screenshot('desktop-icon-fifty-results');
    await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
    await waitPicker();
    const secondPage = await iconNames();
    assert.equal(secondPage.length, 50);
    assert.ok(secondPage.every((name) => !firstPage.includes(name)));
    assert.ok(report.iconQueries.some((request) => request.path === '/search' && request.query === 'fixture-pages' && request.start === 50 && request.limit === 101));
    const beforeReturn = report.iconQueries.length;
    await picker.getByRole('button', { name: '上一页图标', exact: true }).click();
    await waitPicker();
    assert.deepEqual(await iconNames(), firstPage);
    assert.equal(report.iconQueries.length, beforeReturn, '搜索返回页应同时复用名称和SVG缓存');
    await searchIcons('');
    assert.equal((await iconNames()).length, 16);
    const beforeRepeat = report.iconQueries.length;
    await searchIcons('fixture-pages');
    assert.deepEqual(await iconNames(), firstPage);
    assert.equal(report.iconQueries.length, beforeRepeat, '重复相同关键词不应重新获取结果');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('图标空结果和网络错误区分显示，刷新能重试失败查询', async () => {
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await searchIcons('fixture-empty');
    await picker.getByText('未找到匹配图标', { exact: true }).waitFor();
    assert.equal(await picker.getByRole('alert').filter({ visible: true }).count(), 0);
    denyIconSearch = true;
    await searchIcons('fixture-error');
    assert.match(await picker.getByRole('alert').filter({ visible: true }).textContent(), /503|不可用|连接|失败/);
    assert.equal(await picker.getByText('未找到匹配图标', { exact: true }).isVisible(), false);
    denyIconSearch = false;
    await picker.getByRole('button', { name: '刷新素材', exact: true }).click();
    await waitPicker();
    await picker.getByRole('button', { name: 'mdi:home', exact: true }).waitFor();
    assert.equal(await picker.getByRole('alert').filter({ visible: true }).count(), 0);
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('关闭等待中的图标查询后，迟到响应不会污染下一次选择', async () => {
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const beforePendingBox = await picker.boundingBox();
    const beforePendingNames = await iconNames();
    const pendingRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.origin === 'https://api.iconify.design' && url.pathname === '/search' && url.searchParams.get('query') === 'fixture-pending';
    });
    await picker.getByRole('searchbox', { name: '搜索素材', exact: true }).fill('fixture-pending');
    await pendingRequest;
    const pendingDeadline = Date.now() + 12_000;
    while (!releaseIconSearch && Date.now() < pendingDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(typeof releaseIconSearch, 'function', '延迟图标fixture必须已进入等待');
    await page.waitForFunction(() => window.Alpine.store('themeAssets').busy);
    assert.deepEqual(await iconNames(), beforePendingNames, '慢查询保留已显示结果');
    const pendingBox = await picker.boundingBox();
    assert.ok(Math.abs(pendingBox.y - beforePendingBox.y) < 1 && Math.abs(pendingBox.height - beforePendingBox.height) < 1, '局部加载不得引起弹窗高度和位置跳动');
    assert.equal(await page.evaluate(() => window.__settingsFixturePjaxSends), 0);
    await screenshot('desktop-icon-local-loading');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await picker.getByRole('button', { name: 'lucide:house', exact: true }).click();
    const freshNames = await iconNames();
    releaseIconSearch?.();
    releaseIconSearch = undefined;
    await page.waitForTimeout(100);
    assert.deepEqual(await iconNames(), freshNames);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.match(await picker.locator('.theme-asset-selected-icon').textContent(), /lucide:house/);
    assert.equal(await picker.getByRole('alert').filter({ visible: true }).count(), 0);
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('图标搜索与颜色写入兼容对象且不撑高顶栏', async () => {
    await choosePane('菜单栏');
    const beforeMenubarHeight = await page.locator('.menubar').evaluate((node) => node.getBoundingClientRect().height);
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await searchIcons('house');
    await picker.getByRole('button', { name: 'lucide:house', exact: true }).click();
    const beforeColorRequests = report.iconQueries.length;
    await picker.locator('.theme-asset-color-toggle').click();
    await picker.getByLabel('图标颜色', { exact: true }).fill('#123456');
    await page.waitForFunction(() => document.querySelector('.theme-asset-icon-preview svg')?.getAttribute('color') === '#123456');
    assert.equal(report.iconQueries.length, beforeColorRequests, '自定义颜色不能重新获取图标');
    await screenshot('desktop-icon-picker-fixture');
    await picker.getByRole('button', { name: '使用图标', exact: true }).click();
    await waitClosed();
    const icon = await storeValue('header.logo.icon');
    assert.equal(icon.name, 'lucide:house');
    assert.equal(typeof icon.width, 'string');
    assert.equal(icon.color, '#123456');
    assert.ok(icon.value.startsWith('<svg'));
    assert.equal(await page.locator('.menubar').evaluate((node) => node.getBoundingClientRect().height), beforeMenubarHeight);
    await verifyBrandGeometry('desktop-brand-svg-preview', true);
    await settings.locator('.theme-settings-primary-button').click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').saving && window.Alpine.store('themeSettings').statusTone === 'success');
    assert.equal(serverConfig.header.logo.icon.name, 'lucide:house');
    assert.deepEqual(serverConfig.widgets.modules.fixture_module, originalConfig.widgets.modules.fixture_module);
  });
  await scenario('已保存图标可回显并恢复主题默认', async () => {
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    assert.equal(await picker.getByLabel('图标颜色', { exact: true }).inputValue(), '#123456');
    assert.ok(await picker.locator('.theme-asset-icon-preview svg').isVisible(), '已有图标必须回填预览');
    await picker.getByRole('button', { name: '使用默认图标', exact: true }).click();
    await waitClosed();
    assert.equal(await storeValue('header.logo.icon'), '');
    await verifyBrandGeometry('desktop-brand-default', false);
    await page.setViewportSize({ width: 390, height: 844 });
    await verifyBrandGeometry('mobile-brand-default', false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await storeValue('header.logo.icon')).name, 'lucide:house');
  });
  await scenario('完整图标名跨集合选择并保存，重新打开自动定位已有mdi图标集', async () => {
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await chooseIconCollection('');
    await searchIcons('mdi:home');
    await picker.getByRole('button', { name: 'mdi:home', exact: true }).click();
    await picker.getByRole('button', { name: '使用图标', exact: true }).click();
    await waitClosed();
    assert.equal((await storeValue('header.logo.icon')).name, 'mdi:home');
    const writesBefore = putCount();
    await settings.locator('.theme-settings-primary-button').click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').saving && window.Alpine.store('themeSettings').statusTone === 'success');
    assert.equal(putCount(), writesBefore + 1);
    assert.equal(serverConfig.header.logo.icon.name, 'mdi:home');
    assert.ok(serverConfig.header.logo.icon.value.startsWith('<svg'));
    const requestsBeforeOpen = report.iconQueries.length;
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    assert.equal(await picker.getByLabel('图标集', { exact: true }).inputValue(), 'mdi');
    assert.match(await picker.locator('.theme-asset-selected-icon').textContent(), /mdi:home/);
    assert.ok(await picker.locator('.theme-asset-icon-preview svg').isVisible());
    assert.equal(report.iconQueries.length, requestsBeforeOpen, '已加载集合与已保存SVG回显不应重复请求');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('附件权限错误独立显示且刷新后可恢复', async () => {
    denyAttachments = true;
    await openBackground();
    assert.match(await picker.getByRole('alert').filter({ visible: true }).textContent(), /权限/);
    assert.ok(await settings.isVisible());
    denyAttachments = false;
    await picker.getByRole('button', { name: '刷新素材', exact: true }).click();
    await picker.getByRole('button', { name: '测试山景', exact: true }).waitFor();
    await picker.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('390px 手机弹窗没有横向溢出且保持键盘焦点', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBackground();
    const box = await picker.boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.width <= 392 && box.height <= 846, '手机弹窗必须位于可见视口');
    const overflows = await picker.evaluate((dialog) => [...dialog.querySelectorAll('.theme-asset-panel, .theme-asset-footer, .theme-asset-content')].map((node) => ({ overflow: node.scrollWidth - node.clientWidth })));
    assert.ok(overflows.every((item) => item.overflow <= 2), '手机内容不可横向溢出');
    await picker.getByRole('button', { name: '关闭素材选择', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    // Chromium's native dialog may move to browser chrome at the boundary,
    // represented by BODY; it must never focus an inert background control.
    assert.ok(await picker.evaluate((dialog) => dialog.contains(document.activeElement) || document.activeElement === document.body), '反向 Tab 不能进入弹窗后方的页面控件');
    await page.keyboard.press('Tab');
    assert.ok(await picker.evaluate((dialog) => dialog.contains(document.activeElement)), 'Tab 必须保留在模态弹窗内');
    await screenshot('mobile-image-picker-fixture');
    await page.keyboard.press('Escape');
    await waitClosed();
    assert.ok(await settings.isVisible());
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '添加图片…');
  });
  await scenario('手机九个分类内容和操作栏均在可见宽度内', async () => {
    for (const name of ['外观', '墙纸', '桌面与 Dock', '菜单栏', '导航菜单', '小组件', '通知中心', '应用', '高级']) {
      await choosePane(name);
      const bounds = await settings.boundingBox();
      const menubar = await page.locator('.menubar').boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.width <= 390 && bounds.y >= menubar.y + menubar.height && bounds.y + bounds.height <= 752, `${name} 不得遮挡菜单栏或 Dock`);
      const overflow = await settings.locator('[data-settings-pane]:visible').evaluate((node) => node.scrollWidth - node.clientWidth);
      assert.ok(overflow <= 2, `${name} 不能横向溢出: ${overflow}`);
      const footer = await settings.locator('.theme-settings-actions').boundingBox();
      assert.ok(footer && footer.y + footer.height <= bounds.y + bounds.height + 1);
    }
    await choosePane('墙纸');
    await settings.locator('[data-theme-settings-content]').evaluate((node) => node.scrollTo(0, 0));
    await screenshot('mobile-settings-wallpaper-fixture');
  });
  await scenario('375px 图标选择器保留搜索、颜色和确认入口且无横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await verifyBrandGeometry('mobile-brand-svg', true);
    await choosePane('菜单栏');
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await chooseIconCollection('mdi');
    await picker.locator('.theme-asset-icon-grid').evaluate((node) => { node.scrollTop = 100; });
    await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
    await waitPicker();
    assert.equal(await picker.locator('.theme-asset-icon-grid').evaluate((node) => node.scrollTop), 0, '手机翻页从新页顶部开始');
    await chooseIconCollection('');
    await picker.getByRole('button', { name: 'lucide:house', exact: true }).click();
    if (!await picker.getByLabel('自定义颜色', { exact: true }).isChecked()) await picker.locator('.theme-asset-color-toggle').click();
    await picker.getByLabel('图标颜色', { exact: true }).waitFor({ state: 'visible' });
    const bounds = await picker.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.width <= 375 && bounds.y >= 0 && bounds.y + bounds.height <= 812);
    assert.ok(await picker.evaluate((node) => [...node.querySelectorAll('.theme-asset-panel, .theme-asset-footer, .theme-asset-content')].every((element) => element.scrollWidth - element.clientWidth <= 2)));
    await screenshot('mobile-icon-picker-fixture');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('800×480矮窗口可以滚动到分页与确认按钮', async () => {
    await page.setViewportSize({ width: 800, height: 480 });
    await choosePane('菜单栏');
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    const pagination = picker.getByRole('navigation', { name: '图标分页' });
    await pagination.scrollIntoViewIfNeeded();
    const dialogBounds = await picker.boundingBox();
    const navBounds = await pagination.boundingBox();
    const actionsBounds = await picker.locator('.theme-asset-actions').boundingBox();
    assert.ok(dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= 480);
    assert.ok(navBounds.y >= dialogBounds.y && navBounds.y + navBounds.height <= actionsBounds.y, '分页不能被底部操作栏裁切');
    assert.ok(actionsBounds.y + actionsBounds.height <= dialogBounds.y + dialogBounds.height);
    await screenshot('short-window-icon-picker');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await waitClosed();
  });
  await scenario('设置搜索定位具体 Steam 字段；应用封面互不串写', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settings.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('Steam');
    const result = settings.locator('.theme-settings-search-results button').filter({ hasText: 'Steam 背景图片' });
    await result.click();
    const steam = settings.locator('[data-setting-path="steam.cover.image_url"]');
    await steam.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.Alpine.store('themeSettings').focusedSettingPath), 'steam.cover.image_url');
    const wallpaper = await storeValue('desktop.background.image_url');
    for (const field of ['steam.cover.image_url', 'moments.cover.image_url']) {
      const row = settings.locator(`[data-setting-path="${field}"]`);
      await row.getByRole('button', { name: '选择图片…', exact: true }).click();
      await waitPicker();
      assert.equal(await picker.getByLabel('选择要上传的图片').getAttribute('accept'), 'image/png,image/jpeg,image/webp');
      await picker.getByRole('button', { name: '测试山景', exact: true }).click();
      await picker.getByRole('button', { name: '使用图片', exact: true }).click();
      await waitClosed();
      assert.equal(await storeValue(field), imagePath('fixture-mountain'));
      assert.equal(await storeValue('desktop.background.image_url'), wallpaper);
    }
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    await screenshot('desktop-app-settings-fixture');
  });
  await scenario('分类记住滚动位置；浅色和深色窗口均可读', async () => {
    await choosePane('菜单栏');
    const content = settings.locator('[data-theme-settings-content]');
    await content.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }));
    const before = await content.evaluate((node) => node.scrollTop);
    assert.ok(before > 100);
    await choosePane('外观');
    await choosePane('菜单栏');
    report.scrollRestore = await page.evaluate((before) => ({ before, actual: document.querySelector('[data-theme-settings-content]').scrollTop, saved: window.Alpine.store('themeSettings').paneScroll['menu-control'], height: document.querySelector('[data-theme-settings-content]').scrollHeight }), before);
    console.log('滚动恢复：', JSON.stringify(report.scrollRestore));
    await page.waitForFunction((top) => Math.abs(document.querySelector('[data-theme-settings-content]').scrollTop - top) < 2, before);
    await choosePane('外观');
    await settings.getByRole('radio', { name: '深色', exact: true }).click();
    await choosePane('墙纸');
    await content.evaluate((node) => node.scrollTo(0, 0));
    await screenshot('desktop-wallpaper-dark-fixture');
    await page.setViewportSize({ width: 784, height: 706 });
    const compactFooter = await settings.locator('.theme-settings-actions').boundingBox();
    const compactDock = await page.locator('.dock-container').boundingBox();
    assert.ok(compactFooter && compactDock && compactFooter.y + compactFooter.height <= compactDock.y, `桌面矮窗口操作栏不得被 Dock 遮挡: ${JSON.stringify({ footer: compactFooter, dock: compactDock })}`);
    await page.setViewportSize({ width: 772, height: 792 });
    await settings.getByLabel('背景来源', { exact: true }).selectOption('solid');
    await settings.getByRole('button', { name: '石墨黑', exact: true }).click();
    await settings.getByRole('button', { name: '移除图片', exact: true }).click();
    await content.evaluate((node) => node.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await page.waitForTimeout(3500);
    report.wallpaperVisualTarget = { viewport: page.viewportSize(), window: await settings.boundingBox(), deviceScaleFactor: 1 };
    await settings.screenshot({ path: path.join(output, 'wallpaper-reference-size-dark.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choosePane('外观');
    await screenshot('desktop-appearance-dark-fixture');
    await choosePane('菜单栏');
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await screenshot('desktop-icon-library-dark-fixture');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await settings.getByRole('button', { name: '取消', exact: true }).click();
  });
  await scenario('其他位置同时改同一字段时拒绝覆盖并保留当前草稿', async () => {
    await choosePane('通知中心');
    await settings.locator('[data-setting-path="sidebar.notification_center.title"] input').fill('我的通知');
    serverConfig.sidebar = { notification_center: { title: '后台新名称' } };
    const count = putCount();
    await settings.locator('.theme-settings-primary-button').click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').saving && window.Alpine.store('themeSettings').statusTone === 'error');
    assert.equal(putCount(), count);
    assert.equal(await storeValue('sidebar.notification_center.title'), '我的通知');
    assert.match(await settings.locator('.theme-settings-save-status').textContent(), /其他位置修改/);
    await settings.getByRole('button', { name: '取消', exact: true }).click();
  });
  if (liveIconify) await scenario('官方 Iconify 实际GET搜索与按需JSON可在浏览器显示', async () => {
    await choosePane('菜单栏');
    await settings.locator('.theme-settings-icon-trigger').first().click();
    await waitPicker();
    await chooseIconCollection('mdi');
    useLiveIconify = true;
    await picker.getByRole('searchbox', { name: '搜索素材' }).fill('compass-outline');
    await picker.getByRole('button', { name: 'mdi:compass-outline', exact: true }).click({ timeout: 18_000 });
    await picker.locator('.theme-asset-icon-preview svg').waitFor();
    assert.ok(report.liveIconify.some((response) => response.url.includes('/search?') && response.status === 200));
    assert.ok(report.liveIconify.some((response) => new URL(response.url).pathname === '/mdi.json' && response.status === 200));
    await screenshot('live-iconify-search');
    await searchIcons('arrow');
    const livePages = [await iconNames()];
    assert.equal(livePages[0].length, 50);
    for (let index = 0; index < 2; index++) {
      await picker.getByRole('button', { name: '下一页图标', exact: true }).click();
      await waitPicker();
      livePages.push(await iconNames());
      assert.equal(livePages.at(-1).length, 50);
    }
    assert.equal(new Set(livePages.flat()).size, 150, '官方搜索连续三页应无重复');
    await screenshot('live-iconify-third-page');
    report.liveIconPages = livePages;
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    useLiveIconify = false;
  });
  await scenario('全程无真实写入、无 DELETE、无页面异常且构建未漂移', async () => {
    assert.equal(report.blockedWrites.length, 0, '出现了未被 fixture 接管的写入尝试，已被安全拦截');
    assert.ok(report.fixtureWrites.every((write) => ['PUT', 'POST'].includes(write.method)));
    assert.deepEqual(report.pageErrors, []);
    assert.equal(await page.evaluate(() => window.__settingsFixturePjaxSends), 0, '图标与设置操作不能触发全局PJAX');
    assert.deepEqual(serverConfig.developer, originalConfig.developer);
    const after = await verifyBuild();
    assert.deepEqual(after, report.buildContext);
  });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { name: error.name, message: error.message };
  if (page) await page.screenshot({ path: path.join(output, 'failure-fixture.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
  console.error(error.stack || error.message);
} finally {
  releaseUpload?.();
  releaseIconSearch?.();
  await context?.close();
  await browser.close();
  await fs.writeFile(path.join(output, 'browser-fixture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.passed ? '通过' : '失败'}：${report.checks.length} 个隔离浏览器场景；报告 ${path.join(output, 'browser-fixture-report.json')}`);
}
