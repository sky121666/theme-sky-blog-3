import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const layout = fs.readFileSync(path.join(root, 'templates/modules/shell/layout.html'), 'utf8');
const bootstrap = [...layout.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .find((match) => match[1].includes('const manifestUrl ='))?.[1];
assert.ok(bootstrap, '无法提取 Shell bootstrap');
assert.match(layout, /type="application\/json" data-initial-app-script/, '初始应用必须由 bootstrap 按版本顺序加载');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const manifest = { __meta: { version: '1', revision: 'build-2', query: 'v=1&r=build-2' } };

function harness(fetchResult, { withApp = true, appImport = Promise.resolve(), shellImport = Promise.resolve(), currentRevision = 'halo-12', autoStyleLoad = true } = {}) {
  const timers = new Map();
  const imports = [];
  const fetches = [];
  const errors = [];
  const writes = [];
  const nodes = [];
  const events = [];
  const alerts = [];
  let reloads = 0;
  let timerId = 0;
  function style(name, href, attributes = {}) {
    let value = href;
    const attrs = new Map(Object.entries(attributes));
    const listeners = new Map();
    const node = {
      name, disabled: false,
      get href() { return value; },
      set href(next) { writes.push({ name, href: next }); value = next; },
      get id() { return attrs.get('id') || ''; },
      set id(next) { attrs.set('id', next); },
      get media() { return attrs.get('media') || ''; },
      set media(next) { attrs.set('media', next); },
      getAttribute(key) { return attrs.get(key) ?? null; },
      setAttribute(key, next) { attrs.set(key, next); },
      removeAttribute(key) { attrs.delete(key); },
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      dispatch(type) { listeners.get(type)?.(); },
      cloneNode() { return style(`${name}-replacement`, value, Object.fromEntries(attrs)); },
      after(replacement) {
        nodes.splice(nodes.indexOf(node) + 1, 0, replacement);
        events.push(`insert:${replacement.name}`);
        if (autoStyleLoad === 'sync') replacement.dispatch('load');
        else if (autoStyleLoad) queueMicrotask(() => replacement.dispatch('load'));
      },
      replaceWith(replacement) {
        nodes.splice(nodes.indexOf(replacement), 1);
        nodes.splice(nodes.indexOf(node), 1, replacement);
        events.push(`commit:${replacement.name}`);
      },
      remove() { const index = nodes.indexOf(node); if (index >= 0) nodes.splice(index, 1); }
    };
    return node;
  }
  const shellStyle = style('shell', `/assets/css/shell-core/index.css?v=1&r=${currentRevision}`, { id: 'shell-core-style' });
  const appStyle = withApp ? style('app', `/assets/css/apps/reader/index.css?v=1&r=${currentRevision}`, { 'data-app-css': 'reader', media: 'screen' }) : null;
  nodes.push(shellStyle, ...(appStyle ? [appStyle] : []), style('plugin', '/plugins/fixture.css'));
  const appScript = withApp ? { dataset: { src: '/assets/js/apps/reader/index.js?v=1&r=halo-12' } } : null;
  const window = { location: { origin: 'https://example.test', reload() { reloads += 1; } } };
  function element(tagName) {
    const attributes = new Map();
    const listeners = new Map();
    return {
      tagName, children: [], style: {}, textContent: '',
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name) || null; },
      addEventListener(name, listener) { listeners.set(name, listener); },
      dispatch(name) { listeners.get(name)?.(); },
      append(...children) { this.children.push(...children); }
    };
  }
  const document = {
    body: { appendChild(node) { alerts.push(node); } },
    getElementById(id) { return alerts.find((node) => node.id === id) || null; },
    createElement: element,
    querySelector(selector) {
      if (selector.includes('shell-core/index.css')) return shellStyle;
      return selector.includes('script') ? appScript : appStyle;
    }
  };
  const context = {
    URL, URLSearchParams, AbortController, window,
    document,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { fetches.push({ url, options }); return fetchResult; },
    importModule(url) { imports.push(url); events.push(`import:${url}`); return url.includes('/reader/') ? appImport : shellImport; },
    console: { error: (...args) => errors.push(args) }
  };
  const source = bootstrap.replaceAll('import(', 'importModule(')
    .replace("'/assets/js/shell-core/index.js'", "'/assets/js/shell-core/index.js?v=1&r=halo-12'")
    .replace("'/assets/css/shell-core/index.css'", "'/assets/css/shell-core/index.css?v=1&r=halo-12'");
  vm.runInNewContext(source, context);
  return { window, timers, imports, fetches, errors, writes, appScript, shellStyle, appStyle, nodes, events, alerts,
    get reloads() { return reloads; },
    fireDeadline(ms = 4000) { const timer = [...timers.values()].find((entry) => entry.ms === ms); assert.ok(timer, `missing ${ms}ms deadline`); timer.fn(); } };
}

const appReady = deferred();
const normal = harness(Promise.resolve({ ok: true, json: async () => manifest }), { appImport: appReady.promise, autoStyleLoad: false });
await tick();
assert.deepEqual(normal.imports, [], 'CSS 交接完成前不得导入应用或启动 Shell');
assert.equal(normal.timers.size, 2, '两个 CSS 下载必须同时有界等待');
assert.equal(normal.shellStyle.href.endsWith('r=halo-12'), true, '下载期间不得修改已应用的 Shell href');
assert.equal(normal.appStyle.href.endsWith('r=halo-12'), true, '下载期间不得修改已应用的 App href');
assert.equal(normal.shellStyle.disabled, false);
assert.equal(normal.appStyle.disabled, false);
const shellReplacement = normal.nodes.find((node) => node.name === 'shell-replacement');
const appReplacement = normal.nodes.find((node) => node.name === 'app-replacement');
assert.equal(shellReplacement.media, 'not all', '候选 CSS 下载时不得提前参与层叠');
assert.equal(appReplacement.media, 'not all');
assert.equal(normal.nodes.filter((node) => node.id === 'shell-core-style').length, 1, '候选节点不得复制活动 CSS 的 id');
shellReplacement.dispatch('load');
await tick();
assert.ok(normal.nodes.includes(normal.shellStyle) && normal.nodes.includes(normal.appStyle), '只完成一份 CSS 不得提前替换任何 SSR 样式');
assert.deepEqual(normal.imports, []);
appReplacement.dispatch('load');
await tick();
assert.deepEqual(normal.imports, ['/assets/js/apps/reader/index.js?v=1&r=build-2']);
assert.equal(normal.timers.size, 1, 'CSS 完成后只应保留当前 App 模块的 deadline');
assert.equal(normal.writes.length, 2, 'Shell 和初始应用 CSS 候选节点应同步构建版本');
assert.ok(normal.writes.every(({ href }) => href.endsWith('v=1&r=build-2')));
assert.ok(normal.writes.every(({ name }) => name.endsWith('-replacement')), '禁止更改已应用 CSS 的 href');
assert.deepEqual(normal.nodes.map((node) => node.name), ['shell-replacement', 'app-replacement', 'plugin'], '交接必须保留 SSR CSS 与插件的层叠顺序');
assert.equal(shellReplacement.id, 'shell-core-style');
assert.equal(shellReplacement.getAttribute('media'), null, '交接必须恢复原先不存在的 media 属性');
assert.equal(appReplacement.media, 'screen', '交接必须保留原始 media');
assert.equal(appReplacement.getAttribute('data-app-css'), 'reader');
assert.ok(normal.events.indexOf('commit:app-replacement') < normal.events.findIndex((event) => event.startsWith('import:')), '所有 CSS 交接完成后才能开始模块注册');
assert.equal(Object.isFrozen(normal.window.__THEME_ASSET_IDENTITY__), true);
appReady.resolve();
await normal.window.__THEME_BOOTSTRAP_READY__;
assert.deepEqual(normal.imports, ['/assets/js/apps/reader/index.js?v=1&r=build-2', '/assets/js/shell-core/index.js?v=1&r=build-2']);
assert.equal(normal.appScript.dataset.appScriptState, 'ready');
assert.equal(normal.timers.size, 0, 'App/Shell 完成后应清理模块 deadline');
assert.equal(normal.alerts.length, 0, '正常启动不得显示恢复提示');
assert.equal(normal.window.__THEME_BOOTSTRAP_CANCELLED__, false, '正常启动不得设置取消状态');

const unchangedCss = harness(Promise.resolve({ ok: true, json: async () => manifest }), { currentRevision: 'build-2' });
await unchangedCss.window.__THEME_BOOTSTRAP_READY__;
assert.equal(unchangedCss.writes.length, 0, '相同构建 CSS 不应重复更新 href');

const cachedCss = harness(Promise.resolve({ ok: true, json: async () => manifest }), { autoStyleLoad: 'sync' });
await cachedCss.window.__THEME_BOOTSTRAP_READY__;
assert.equal(cachedCss.imports.length, 2, '缓存命中插入时立即触发 load 也必须正确交接并启动');
assert.equal(cachedCss.timers.size, 0, '同步 load 不能遗留超时回调');
assert.deepEqual(cachedCss.nodes.map((node) => node.name), ['shell-replacement', 'app-replacement', 'plugin']);

for (const failure of ['error', 'error-after-shell', 'timeout']) {
  const failed = harness(Promise.resolve({ ok: true, json: async () => manifest }), { autoStyleLoad: false });
  await tick();
  const candidates = failed.nodes.filter((node) => node.name.endsWith('-replacement'));
  if (failure === 'error-after-shell') candidates[0].dispatch('load');
  if (failure === 'timeout') failed.fireDeadline(15000);
  else candidates[1].dispatch('error');
  await failed.window.__THEME_BOOTSTRAP_READY__;
  assert.deepEqual(failed.nodes.map((node) => node.name), ['shell', 'app', 'plugin'], `${failure}: 清除全部候选并保留原样式`);
  assert.equal(failed.shellStyle.disabled, false);
  assert.equal(failed.appStyle.disabled, false);
  assert.equal(failed.shellStyle.href.endsWith('r=halo-12'), true);
  assert.equal(failed.appStyle.href.endsWith('r=halo-12'), true);
  assert.equal(failed.imports.length, 0, `${failure}: 不得启动无匹配 CSS 的应用`);
  assert.equal(failed.timers.size, 0, `${failure}: 包括同伴下载的所有 timer 必须清理`);
  assert.equal(failed.window.__THEME_ASSET_IDENTITY__.source, 'manifest', '样式失败不得偷偷降级构建身份');
  assert.match(failed.window.__THEME_BOOTSTRAP_ERROR__, /Theme stylesheet (failed|timed out):/);
  assert.equal(failed.alerts.length, 1, `${failure}: 样式故障应显示恢复提示`);
  candidates.forEach((node) => node.dispatch('load'));
  await tick();
  assert.deepEqual(failed.nodes.map((node) => node.name), ['shell', 'app', 'plugin'], '失败后的迟到 load 不得再交接');
}

for (const stage of ['headers', 'body']) {
  const pending = deferred();
  const result = stage === 'headers' ? pending.promise : Promise.resolve({ ok: true, json: () => pending.promise });
  const stalled = harness(result);
  await tick();
  assert.equal(stalled.imports.length, 0);
  stalled.fireDeadline();
  await stalled.window.__THEME_BOOTSTRAP_READY__;
  assert.equal(stalled.fetches[0].options.signal.aborted, true, `${stage} 超时应取消请求`);
  assert.equal(stalled.window.__THEME_ASSET_IDENTITY__.source, 'server-fallback');
  assert.equal(stalled.imports.length, 2, `${stage} 超时仍应按 app→Shell 启动`);
  const fallbackQuery = stalled.window.__THEME_ASSET_IDENTITY__.query;
  const fallbackParams = new URLSearchParams(fallbackQuery);
  assert.equal(fallbackParams.get('v'), '1');
  assert.equal(fallbackParams.get('r'), 'halo-12');
  assert.ok(fallbackParams.get('fallback'), 'manifest 失效时须绕开长期缓存的 Halo 资源 URL');
  assert.ok(stalled.imports.every((url) => new URL(url, 'https://example.test').search === `?${fallbackQuery}`));
  assert.ok(stalled.writes.every(({ href }) => new URL(href, 'https://example.test').search === `?${fallbackQuery}`));
  pending.resolve(stage === 'headers' ? { ok: true, json: async () => manifest } : manifest);
  await tick();
  assert.equal(stalled.imports.length, 2, '迟到 manifest 不得重复启动或切换身份');
  assert.equal(stalled.window.__THEME_ASSET_IDENTITY__.source, 'server-fallback');
  assert.equal(stalled.timers.size, 0);
}

for (const response of [
  Promise.reject(new Error('network failed')),
  Promise.resolve({ ok: false, status: 503 }),
  Promise.resolve({ ok: true, json: async () => ({ __meta: { version: '1', revision: 'new', query: 'v=1&r=old' } }) }),
  Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('not json'); } })
]) {
  const fallback = harness(response, { withApp: false });
  await fallback.window.__THEME_BOOTSTRAP_READY__;
  assert.equal(fallback.imports.length, 1);
  assert.equal(fallback.window.__THEME_ASSET_IDENTITY__.source, 'server-fallback');
  assert.equal(fallback.timers.size, 0);
}

const importFailure = harness(Promise.resolve({ ok: true, json: async () => manifest }), { appImport: Promise.reject(new Error('app failed')) });
await importFailure.window.__THEME_BOOTSTRAP_READY__;
assert.equal(importFailure.imports.length, 1, '应用注册失败后不能抢先启动 Alpine');
assert.equal(importFailure.window.__THEME_BOOTSTRAP_ERROR__, 'app failed');
assert.equal(importFailure.errors.length, 1);
assert.equal(importFailure.alerts.length, 1, '模块拒绝时必须显示恢复提示');

for (const stage of ['App', 'Shell']) {
  const pending = deferred();
  const stalled = harness(Promise.resolve({ ok: true, json: async () => manifest }), {
    withApp: stage === 'App',
    currentRevision: 'build-2',
    appImport: pending.promise,
    shellImport: pending.promise
  });
  await tick();
  assert.equal(stalled.imports.length, 1, `${stage}: 应只启动当前模块`);
  stalled.fireDeadline(15000);
  await stalled.window.__THEME_BOOTSTRAP_READY__;
  assert.match(stalled.window.__THEME_BOOTSTRAP_ERROR__, new RegExp(`Theme ${stage} module timed out:`));
  assert.equal(stalled.window.__THEME_BOOTSTRAP_CANCELLED__, true, `${stage}: 截止时须阻止迟到模块启动`);
  assert.equal(stalled.errors.length, 1, `${stage}: 应保留控制台错误`);
  assert.equal(stalled.alerts.length, 1, `${stage}: 超时应显示可见恢复提示`);
  assert.equal(stalled.alerts[0].getAttribute('role'), 'alert');
  assert.match(stalled.alerts[0].children[0].textContent, /刷新重试/);
  stalled.alerts[0].children[1].dispatch('click');
  assert.equal(stalled.reloads, 1, `${stage}: 重试按钮应执行整页刷新`);
  assert.equal(stalled.timers.size, 0, `${stage}: 超时后应清理 deadline`);
  pending.resolve();
  await tick();
  assert.equal(stalled.imports.length, 1, `${stage}: 迟到模块不得启动下一模块或重复导入`);
  if (stage === 'App') assert.equal(stalled.appScript.dataset.appScriptState, undefined, '迟到 App 不得标记为 ready');
}

// Dynamic import cannot be cancelled. Evaluate the actual Shell entry after a
// simulated timeout and confirm its initialization block stays inert.
const shellEntry = fs.readFileSync(path.join(root, 'src/shell/desktop-shell/entry-main.js'), 'utf8')
  .replace(/^import[^\n]*;\s*$/gm, '');
const lateWindow = { __THEME_BOOTSTRAP_CANCELLED__: true };
vm.runInNewContext(shellEntry, {
  window: lateWindow,
  getCurrentThemeAssetIdentity: () => ({ version: '1', revision: 'build-2' })
});
assert.equal(lateWindow.__THEME_MAIN_LOADED__, undefined, '超时后迟到的 Shell 不得初始化 Alpine 或插件');

for (const stage of ['App', 'Shell']) {
  const slow = deferred();
  const loading = harness(Promise.resolve({ ok: true, json: async () => manifest }), {
    withApp: stage === 'App',
    currentRevision: 'build-2',
    appImport: slow.promise,
    shellImport: stage === 'Shell' ? slow.promise : Promise.resolve()
  });
  await tick();
  assert.equal(loading.timers.size, 1, `${stage}: 慢加载期间必须保留 deadline`);
  slow.resolve();
  await loading.window.__THEME_BOOTSTRAP_READY__;
  assert.equal(loading.alerts.length, 0, `${stage}: 截止前完成不得误报`);
  assert.equal(loading.timers.size, 0, `${stage}: 完成后不得遗留 deadline`);
}

const shellFailure = harness(Promise.resolve({ ok: true, json: async () => manifest }), {
  withApp: false,
  shellImport: Promise.reject(new Error('shell failed'))
});
await shellFailure.window.__THEME_BOOTSTRAP_READY__;
assert.equal(shellFailure.window.__THEME_BOOTSTRAP_ERROR__, 'shell failed');
assert.equal(shellFailure.alerts.length, 1);

assert.equal(layout.includes('photoFinder.listAll()'), false, '桌面 bootstrap 禁止重新读取全部照片');
const photoSize = Number(layout.match(/photoFinder\.list\(1,\s*(\d+)(?:,\s*widgetsPhotoGroupName)?\)/)?.[1]);
const steamSize = Number(layout.match(/steamFinder\.getOwnedGames\(1,\s*(\d+)\)/)?.[1]);
assert.ok(Number.isInteger(photoSize) && photoSize > 0 && photoSize <= 12, '照片 Finder 首批大小必须在预算内');
assert.ok(Number.isInteger(steamSize) && steamSize > 0 && steamSize <= 12, 'Steam Finder 首批大小必须在预算内');
assert.match(layout, /photos=\$\{widgetsPhotos != null \? widgetsPhotos\.items : \{\}\}/, 'Photo Page 必须消费 items');
assert.match(layout, /steamOwnedGames=\$\{widgetsSteamWidgetGames != null \? widgetsSteamWidgetGames\.items : \{\}\}/, 'Steam Page 必须消费 items');
assert.match(layout, /widgetsPhotosAvailable \? photoFinder\.list\(1,\s*\d+(?:,\s*widgetsPhotoGroupName)?\) : null/, 'Photos 插件不可用时必须短路 Finder');
assert.match(layout, /widgetsSteamAvailable \? steamFinder\.getOwnedGames\(1,\s*\d+\) : null/, 'Steam 插件不可用时必须短路 Finder');
assert.match(layout, /dockImageAllowed\s*=\s*\$\{[^}]*https:\/\//, 'Dock 必须使用图片 URL 协议白名单');
assert.match(layout, /iconType == 'image' and dockImageAllowed/, 'Dock img 只能输出允许的 URL');
assert.match(layout, /dock-icon-svg dock-icon-svg--fallback/, 'Dock data URI 必须有轻量回退图标');
assert.match(layout, /dock-icon-initial[\s\S]*?#strings\.substring\(menuItem\.status\.displayName, 0, 1\)/, 'Dock 图片 URL 被拒绝时，回退图标须显示菜单名首字');

const header = fs.readFileSync(path.join(root, 'templates/modules/shell/header.html'), 'utf8');
assert.equal((header.match(/childImageAllowed\s*=\s*\$\{/g) || []).length, 2, '桌面和移动 Header 必须分别校验图片 URL');
assert.equal((header.match(/childIconType == 'image' and childImageAllowed/g) || []).length, 2, 'Header img 只能输出允许的 URL');
assert.equal((header.match(/childIconType == 'image' and !childImageAllowed/g) || []).length, 2, 'Header 无效图片必须有回退图标');

console.log('shell bootstrap contract passed');
