import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const loaderPath = path.join(process.cwd(), 'src/shell/desktop-shell/runtime/shared/lazy-theme-config-client.js');
assert.ok(fs.existsSync(loaderPath), '主题配置客户端需要独立的按需加载边界');
const { createBoundedModuleLoader, showThemeConfigRecovery } = await import(pathToFileURL(loaderPath).href);

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const pending = deferred();
let attempts = 0;
const loadStalledClient = createBoundedModuleLoader(() => {
  attempts += 1;
  return pending.promise;
}, { timeoutMs: 5, label: '主题配置功能' });

await assert.rejects(loadStalledClient(), (error) =>
  error?.code === 'module-load-timeout' && /刷新/.test(error.message),
  '配置模块无限等待时，当前操作应在截止时间失败并给出刷新恢复路径');
await assert.rejects(loadStalledClient(), (error) => error?.code === 'module-load-timeout');
assert.equal(attempts, 1, '超时后不能重复发起同 URL import');
pending.resolve({ readThemeConfig: () => {} });
await Promise.resolve();
await assert.rejects(loadStalledClient(), (error) => error?.code === 'module-load-timeout');
assert.equal(attempts, 1, '迟到模块不能悄悄恢复旧操作');

const failure = new Error('network error');
let failedAttempts = 0;
const loadFailedClient = createBoundedModuleLoader(() => {
  failedAttempts += 1;
  return Promise.reject(failure);
}, { timeoutMs: 1000, label: '主题配置功能' });
await assert.rejects(loadFailedClient(), (error) =>
  error?.code === 'module-load-failed' && error.cause === failure && /刷新/.test(error.message));
await assert.rejects(loadFailedClient(), (error) => error?.code === 'module-load-failed');
assert.equal(failedAttempts, 1, '模块拒绝后也不能自动重复同 URL import');

const loadedClient = { readThemeConfig: () => {}, mutateThemeConfig: () => {} };
let successAttempts = 0;
const loadClient = createBoundedModuleLoader(() => {
  successAttempts += 1;
  return Promise.resolve(loadedClient);
}, { timeoutMs: 1000, label: '主题配置功能' });
assert.equal(await loadClient(), loadedClient);
assert.equal(await loadClient(), loadedClient);
assert.equal(successAttempts, 1, '成功加载的配置客户端应复用单次导入结果');

const notices = [];
let reloads = 0;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
globalThis.document = {
  body: { appendChild(node) { notices.push(node); } },
  getElementById(id) { return notices.find((notice) => notice.id === id) || null; },
  createElement(tagName) {
    const listeners = new Map();
    return {
      tagName, children: [], style: {}, textContent: '',
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, callback) { listeners.set(name, callback); },
      dispatch(name) { listeners.get(name)?.(); },
      append(...children) { this.children.push(...children); }
    };
  }
};
globalThis.window = { location: { reload() { reloads += 1; } } };
try {
  const loadUnavailableClient = createBoundedModuleLoader(
    () => Promise.reject(new Error('chunk unavailable')),
    { timeoutMs: 1000, label: '主题配置功能', onFailure: showThemeConfigRecovery }
  );
  await assert.rejects(loadUnavailableClient(), (error) => error?.code === 'module-load-failed');
  showThemeConfigRecovery();
  assert.equal(notices.length, 1, '多个配置操作故障只需一条可见恢复提示');
  assert.equal(notices[0].role, 'alert');
  assert.match(notices[0].children[0].textContent, /刷新重试/);
  notices[0].children[1].dispatch('click');
  assert.equal(reloads, 1, '恢复按钮必须重新加载页面以结束悬挂的模块导入');
} finally {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
}

console.log('theme config lazy loader contract passed');
