import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

// Served theme interaction regression. Authorization and config storage are
// intercepted fixtures; every other write is blocked before forwarding.
const site = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090/');
const output = path.resolve(process.env.SETTINGS_BROWSER_OUTPUT || '.superpowers/sdd/2026-09-30-settings-completion/browser');
await fs.mkdir(output, { recursive: true });
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const initial = {
  header: { logo: { title: 'Fixture settings' }, dropdown: { light_bg: 'rgba(88, 92, 100, 0.66)', dark_bg: '#46525EB8' } },
  dock: { appearance: { settings_enabled: true, show_labels: true, magnification: false }, future: 'retained' },
  desktop: { icons: { posts: ['fixture-post'] }, background: { mode: 'preset', preset: 'deep-sea' } },
  moments: { profile: { display_name: '原瞬间名称' }, untouched: 'retained' },
  douban: { profile: { display_name: '原书影音名称' } },
  links: { profile: { display_name: '原友链名称' } },
  widgets: { behavior: { enabled: true } },
  fixtureFuture: { preserved: 42 },
};
let config = structuredClone(initial);
let revision = 1;
let authenticated = true;
let configReads = 0;
let blockQr = false;
const report = { fixture: true, boundary: '真实主题页面；仅文档授权和配置 GET/PUT 使用隔离 fixture。所有其他写请求阻断，未读取账号或凭据，不代表真实 Halo 持久化验收。', checks: [], screenshots: [], errors: [], fixtureWrites: [], blockedWrites: [], realWriteRequestsForwarded: 0 };
const browser = await chromium.launch({ headless: true });
let context;
let page;
try {
  const manifest = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8'));
  const remoteManifest = await (await fetch(new URL('/themes/theme-sky-blog-3/assets/asset-manifest.json', site))).json();
  assert.deepEqual(remoteManifest.__meta, manifest.__meta, 'served build metadata must match the current local build');
  report.build = manifest.__meta;
  report.assets = [];
  const shellEntry = manifest['shell-core'].js[0];
  const entrySource = await (await fetch(new URL(shellEntry, site))).text();
  const qrImport = entrySource.match(/openWeChatShare\(\)[\s\S]*?import\("([^"]+)"\)/)?.[1];
  assert.ok(qrImport, 'QR code must load through a dynamic import');
  const qrPath = new URL(qrImport, new URL(shellEntry, site)).pathname;
  report.qrRequests = [];
  for (const relative of [...manifest['shell-core'].js, ...manifest['shell-core'].css]) {
    const response = await fetch(new URL(relative, site));
    assert.equal(response.status, 200);
    const local = relative.slice(relative.indexOf('/assets/') + 1).split('?')[0];
    const expected = await fs.readFile(path.join('templates', local));
    const actual = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(actual), digest(expected), `served asset bytes differ: ${local}`);
    report.assets.push({ path: local, sha256: digest(actual) });
  }
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const local = url.origin === site.origin;
    if (local && method === 'GET' && url.pathname === '/halo-tracker.js') {
      report.suppressedAnalytics = ['/halo-tracker.js'];
      return route.fulfill({ contentType: 'application/javascript', body: '/* Analytics excluded from isolated settings acceptance. */' });
    }
    if (local && url.pathname === qrPath) {
      report.qrRequests.push({ blocked: blockQr, path: qrPath });
      if (blockQr) return route.abort('failed');
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { etag: `"fixture-${revision}"` }, body: JSON.stringify(body) });
    if (local && /^\/apis\/api\.console\.halo\.run\/v1alpha1\/themes\/[^/]+\/json-config$/.test(url.pathname)) {
      if (method === 'GET') { configReads++; return json(config); }
      if (method === 'PUT') {
        config = request.postDataJSON(); revision++;
        report.fixtureWrites.push({ method, path: url.pathname });
        return json(config);
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      report.blockedWrites.push({ method, origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (local && (url.pathname === '/api/v1alpha1/menus' || /^\/apis\/content\.halo\.run\/v1alpha1\/(categories|tags|posts|singlepages)$/.test(url.pathname))) {
      const kind = url.pathname.split('/').at(-1);
      return json({ page: 1, size: 50, total: 1, items: [{ metadata: { name: `fixture-${kind}` }, spec: { title: `测试 ${kind}`, displayName: `测试 ${kind}`, publish: true }, status: { permalink: '/' } }] });
    }
    if (local && request.isNavigationRequest() && request.resourceType() === 'document') {
      const response = await route.fetch({ headers: { ...request.headers(), 'Cache-Control': 'no-cache' } });
      let html = await response.text();
      let count = 0;
      html = html.replace(/<[^>]*\bdata-theme-settings-protocol\b[^>]*>/g, (tag) => {
        count++;
        return tag.replace(/\bdata-authenticated\s*=\s*(["'])[^"']*\1/, `data-authenticated="${authenticated}"`)
          .replace(/\bdata-app-steam\s*=\s*(["'])[^"']*\1/, 'data-app-steam="false"');
      });
      assert.equal(count, 1);
      return route.fulfill({ response, body: html });
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => report.errors.push({ message: error.message, stack: error.stack, qrFaultActive: blockQr }));
  const settings = page.locator('[data-theme-settings-window]');
  const pane = (id) => settings.locator(`[data-settings-pane="${id}"]`);
  const field = (key) => settings.locator(`[data-setting-path="${key}"]`);
  const choose = async (label) => {
    const search = settings.getByRole('searchbox', { name: '搜索设置' });
    if (await search.inputValue()) await search.fill('');
    await settings.locator('.theme-settings-navigation').getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click();
    const ids = { '外观': 'appearance', '墙纸': 'wallpaper', 'Dock': 'desktop-dock', '菜单栏': 'menu-control', '导航菜单': 'navigation', '小组件': 'widgets', '通知中心': 'notifications', '应用': 'apps', '高级': 'advanced' };
    await pane(ids[label]).waitFor({ state: 'visible' });
  };
  const value = (key) => page.evaluate((key) => window.Alpine.store('themeSettings').value(key), key);
  const capture = async (name) => {
    // The site injects a temporary click animation outside theme sources.
    // Capture the settled UI without changing the site's saved custom script.
    await page.waitForFunction(() => document.querySelectorAll('.sky-heart').length === 0);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    report.screenshots.push(`${name}.png`);
  };
  const test = async (name, run) => { await run(); report.checks.push({ name, status: 'passed' }); };
  const currentPage = new URL(site.href);
  currentPage.searchParams.set('_settings_verify', `${manifest.__meta.revision}-${Date.now()}`);
  await page.goto(currentPage.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.dock-settings-icon').waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('.dock-settings-icon')?.style.width));

  await test('Dock label remains visible with reduced motion and without magnification', async () => {
    const icon = page.locator('.dock-settings-icon');
    await icon.hover();
    await page.waitForFunction(() => document.querySelector('.dock-settings-icon').classList.contains('dock-tooltip-visible'));
    const geometry = await icon.evaluate((icon) => {
      const label = icon.querySelector('.dock-tooltip');
      const tip = label.getBoundingClientRect(), box = icon.getBoundingClientRect();
      return { overflow: getComputedStyle(icon).overflow, labelBottom: tip.bottom, iconTop: box.top, labelOpacity: getComputedStyle(label).opacity };
    });
    assert.equal(geometry.overflow, 'visible');
    assert.ok(geometry.labelBottom < geometry.iconTop);
    await capture('dock-label-desktop');
    await icon.focus();
    assert.equal(await icon.evaluate((icon) => icon.classList.contains('dock-tooltip-visible')), true);
  });
  await page.locator('.dock-settings-icon').click();
  await settings.waitFor({ state: 'visible' });

  await test('Appearance shortcut removed and desktop fields are reachable only in Widgets', async () => {
    await choose('外观');
    assert.equal(await pane('appearance').getByRole('button', { name: '墙纸', exact: true }).count(), 0);
    await choose('Dock');
    assert.equal(await pane('desktop-dock').locator('[data-setting-path^="desktop."]').count(), 0);
    assert.equal(await pane('desktop-dock').locator('[data-setting-path="default_layout.layout_json"]').count(), 0);
    assert.equal(await field('navigation.dock.menu_name').isVisible(), true);
    await capture('dock-settings-desktop');
    await choose('小组件');
    assert.equal(await field('default_layout.layout_json').isVisible(), true);
    assert.equal(await pane('widgets').locator('[data-setting-path^="desktop.icons."]').count(), 5);
    await capture('widgets-desktop');
  });

  await test('Dock entry preview and cancel restore button visibility without a config write', async () => {
    await choose('Dock');
    await field('dock.appearance.settings_enabled').click();
    await page.waitForFunction(() => !document.querySelector('[data-setting-path="dock.appearance.settings_enabled"] input').checked);
    await page.locator('.dock-settings-icon').waitFor({ state: 'hidden' });
    assert.equal(report.fixtureWrites.length, 0);
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.dock-settings-icon').waitFor({ state: 'visible' });
    assert.equal(await value('dock.appearance.settings_enabled'), true);
  });

  await test('Five application rows open one detail each and preserve a draft through back/search', async () => {
    await choose('应用');
    const rows = pane('apps').locator('[data-settings-app-entry]');
    assert.equal(await rows.count(), 5);
    await capture('applications-list-desktop');
    for (const app of ['moments', 'douban', 'links', 'steam', 'equipments']) {
      await pane('apps').locator(`[data-settings-app-entry="${app}"]`).click();
      await pane('apps').locator(`[data-settings-app="${app}"]`).waitFor({ state: 'visible' });
      assert.equal(await pane('apps').locator('[data-settings-app]:visible').count(), 1);
      assert.equal(await pane('apps').locator(`[data-settings-app="${app}"]`).isVisible(), true);
      if (app === 'steam') assert.equal(await field('steam.cover.image_url').isVisible(), true);
      await settings.locator('.theme-settings-back-button').click();
      await pane('apps').locator('[data-settings-app-list]').waitFor({ state: 'visible' });
    }
    await pane('apps').locator('[data-settings-app-entry="moments"]').click();
    await field('moments.profile.display_name').locator('input').fill('保留的瞬间草稿');
    await capture('moments-detail-desktop');
    await settings.locator('.theme-settings-back-button').click();
    await settings.getByRole('searchbox', { name: '搜索设置' }).fill('Steam');
    const result = settings.locator('.theme-settings-search-results').getByRole('button', { name: 'Steam' });
    await result.first().waitFor();
    assert.equal(await result.count(), 1);
    await result.first().click();
    await field('steam.cover.image_url').waitFor({ state: 'visible' });
    assert.equal(await value('moments.profile.display_name'), '保留的瞬间草稿');
    assert.equal(await page.evaluate(() => window.Alpine.store('themeSettings').activeApp), 'steam');
    await choose('应用');
    await pane('apps').locator('[data-settings-app-entry="moments"]').click();
    assert.equal(await field('moments.profile.display_name').locator('input').inputValue(), '保留的瞬间草稿');
  });

  await test('RGBA controls preserve alpha, accept zero opacity and retain invalid text until cancel', async () => {
    await choose('菜单栏');
    const light = field('header.dropdown.light_bg');
    await light.locator('input[type="text"]').fill('#2468AC80');
    await light.locator('input[type="number"]').fill('0');
    await light.locator('input[type="number"]').press('Tab');
    assert.equal(await value('header.dropdown.light_bg'), 'rgba(36, 104, 172, 0)');
    await page.locator('.menubar-menu-group').filter({ has: page.locator('button[aria-haspopup="menu"]') }).first().hover();
    const dropdown = page.locator('.menubar-dropdown:visible').first();
    await dropdown.waitFor();
    await page.waitForFunction(() => {
      const menu = [...document.querySelectorAll('.menubar-dropdown')].find((item) => getComputedStyle(item).display !== 'none');
      return menu && getComputedStyle(menu).backgroundColor === 'rgba(36, 104, 172, 0)';
    });
    const contrast = await dropdown.locator('.menubar-dropdown-item').first().evaluate((item) => ({ color: getComputedStyle(item).color, shadow: getComputedStyle(item).textShadow }));
    assert.equal(contrast.color, 'rgb(255, 255, 255)');
    assert.notEqual(contrast.shadow, 'none');
    await capture('transparent-menu-preview');
    await light.locator('input[type="number"]').fill('35');
    await light.locator('input[type="number"]').press('Tab');
    assert.equal(await value('header.dropdown.light_bg'), 'rgba(36, 104, 172, 0.35)');
    assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--mac-header-dropdown-light-bg')), 'rgba(36, 104, 172, 0.35)');
    await capture('menu-colors-desktop');
    await light.locator('input[type="text"]').fill('rgba(');
    await choose('Dock');
    await choose('菜单栏');
    assert.equal(await light.locator('input[type="text"]').inputValue(), 'rgba(');
    assert.equal(await settings.locator('.theme-settings-actions').getByRole('button', { name: '应用', exact: true }).isDisabled(), true);
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await value('header.dropdown.light_bg'), initial.header.dropdown.light_bg);
    assert.equal(await light.locator('input[type="text"]').inputValue(), initial.header.dropdown.light_bg);
    assert.equal(await value('moments.profile.display_name'), initial.moments.profile.display_name);
    assert.equal(report.fixtureWrites.length, 0);
  });

  await test('Global Apply saves only changed values and retains unknown and unrelated fields', async () => {
    await choose('应用');
    await pane('apps').locator('[data-settings-app-entry="moments"]').click();
    await field('moments.profile.display_name').locator('input').fill('已保存瞬间名称');
    await settings.locator('.theme-settings-back-button').click();
    await pane('apps').locator('[data-settings-app-entry="douban"]').click();
    await field('douban.profile.display_name').locator('input').fill('已保存书影音名称');
    await choose('菜单栏');
    await field('header.dropdown.light_bg').locator('input[type="text"]').fill('rgba(255, 255, 255, 0.5)');
    await settings.locator('.theme-settings-actions').getByRole('button', { name: '应用', exact: true }).click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').hasDirtyChanges() && !window.Alpine.store('themeSettings').saving);
    assert.equal(report.fixtureWrites.length, 1);
    assert.equal(config.moments.profile.display_name, '已保存瞬间名称');
    assert.equal(config.douban.profile.display_name, '已保存书影音名称');
    assert.equal(config.header.dropdown.light_bg, 'rgba(255, 255, 255, 0.5)');
    assert.equal(config.moments.untouched, 'retained');
    assert.equal(config.dock.future, 'retained');
    assert.equal(config.fixtureFuture.preserved, 42);
    assert.deepEqual(config.desktop, initial.desktop);
  });

  await test('Application rows and all settings panes fit mobile without obscuring persistent controls', async () => {
    await choose('外观');
    await field('header.theme.default_mode').getByRole('radio', { name: '深色', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await choose('应用');
    await capture('applications-list-dark-desktop');
    await settings.locator('.theme-settings-actions').getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForFunction(() => !window.Alpine.store('themeSettings').hasDirtyChanges());
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileChoose = async (label) => {
      await settings.getByRole('button', { name: '展开设置分类', exact: true }).click();
      await choose(label);
    };
    for (const label of ['外观', '墙纸', 'Dock', '菜单栏', '导航菜单', '小组件', '通知中心', '应用', '高级']) {
      await mobileChoose(label);
      const overflow = await settings.evaluate((element) => element.scrollWidth - element.clientWidth);
      assert.ok(overflow <= 2, `${label} overflows horizontally: ${overflow}`);
    }
    await mobileChoose('应用');
    await capture('applications-list-mobile');
    await pane('apps').locator('[data-settings-app-entry="moments"]').click();
    await capture('moments-detail-mobile');
    await mobileChoose('菜单栏');
    await capture('menu-colors-mobile');
    const footer = await settings.locator('.theme-settings-actions').boundingBox();
    const dock = await page.locator('.dock-container').boundingBox();
    assert.ok(footer && dock && footer.y + footer.height <= dock.y);
  });

  await test('Anonymous Dock settings click does not probe protected config or open the window', async () => {
    authenticated = false;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(document.querySelector('.dock-settings-icon')?.style.width));
    const before = configReads;
    await page.locator('.dock-settings-icon').click();
    await page.getByText('登录后才能使用主题设置。', { exact: true }).waitFor();
    assert.equal(await settings.isVisible(), false);
    assert.equal(configReads, before);
    await capture('anonymous-settings-feedback');
  });

  await test('QR code loads on demand, reports a chunk failure and generates a downloadable PNG after reload', async () => {
    assert.equal(report.qrRequests.length, 0, 'QR library must not load on the desktop/settings path');
    const article = await page.locator('a[href^="/archives/"]:visible').first().getAttribute('href');
    assert.ok(article);
    const articleUrl = new URL(article, site);
    articleUrl.searchParams.set('_settings_verify', `${manifest.__meta.revision}-${Date.now()}`);
    await page.goto(articleUrl.href, { waitUntil: 'domcontentloaded' });
    const share = page.locator('.window-share:visible');
    const openQr = async () => {
      await share.locator('button[title="分享"]').click();
      await share.getByRole('button', { name: /^微信/ }).click();
    };
    blockQr = true;
    await openQr();
    await share.getByText('二维码生成失败', { exact: true }).waitFor();
    assert.equal(report.qrRequests.at(-1).blocked, true);
    blockQr = false;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openQr();
    const qr = share.getByRole('img', { name: '微信分享二维码' });
    await qr.waitFor();
    assert.match(await qr.getAttribute('src'), /^data:image\/png;base64,/);
    const downloadReady = page.waitForEvent('download');
    await share.getByRole('button', { name: /^保存二维码/ }).click();
    const download = await downloadReady;
    assert.match(download.suggestedFilename(), /-wechat-qrcode\.png$/);
    await download.saveAs(path.join(output, 'wechat-qrcode.png'));
    const png = await fs.readFile(path.join(output, 'wechat-qrcode.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await capture('wechat-share');
  });
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack || String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await context?.close();
  await browser.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, fixtureWrites: report.fixtureWrites.length, realWriteRequestsForwarded: report.realWriteRequestsForwarded, output, failure: report.failure }, null, 2));
}
