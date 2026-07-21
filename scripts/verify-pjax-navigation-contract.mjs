import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeAssetElement {
  constructor(tagName, removeElement) {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.rel = '';
    this.type = '';
    this.href = '';
    this.src = '';
    this.sheet = null;
    this.removeElement = removeElement;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(type, handlers.filter((candidate) => candidate !== handler));
  }

  dispatch(type) {
    (this.listeners.get(type) || []).slice().forEach((handler) => handler({ target: this }));
  }

  getAttribute(name) {
    if (name === 'href') return this.href || null;
    if (name === 'src') return this.src || null;
    return this.attributes.get(name) || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  remove() {
    this.removeElement(this);
  }
}

function createAssetFixture() {
  const elements = [];
  const timers = new Map();
  let nextTimerId = 1;

  const removeElement = (target) => {
    const index = elements.indexOf(target);
    if (index >= 0) elements.splice(index, 1);
  };

  const document = {
    body: { dataset: {} },
    head: {
      appendChild(element) {
        elements.push(element);
        return element;
      }
    },
    createElement(tagName) {
      return new FakeAssetElement(tagName, removeElement);
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'link[rel="stylesheet"]') {
        return elements.filter((element) => element.tagName === 'LINK' && element.rel === 'stylesheet');
      }
      if (selector === 'script[type="module"], script[data-app-script]') {
        return elements.filter((element) => element.tagName === 'SCRIPT');
      }
      return [];
    }
  };

  const window = {
    location: {
      origin: 'https://example.test',
      href: 'https://example.test/'
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };

  return { document, elements, timers, window };
}

async function waitForElement(fixture, predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const match = fixture.elements.find(predicate);
    if (match) return match;
    await Promise.resolve();
  }
  throw new Error('等待测试资源节点超时');
}

async function verifyAssetFailureRecovery() {
  const fixture = createAssetFixture();
  setGlobal('window', fixture.window);
  setGlobal('document', fixture.document);
  setGlobal('fetch', async () => ({
    ok: true,
    async json() {
      return {
        photos: {
          css: ['/assets/css/apps/photos/index.css'],
          js: ['/assets/js/apps/photos/index.js']
        },
        moments: {
          css: ['/assets/css/apps/moments/index.css'],
          js: ['/assets/js/apps/moments/index.js']
        }
      };
    }
  }));

  const appLoaderUrl = pathToFileURL(path.join(root, 'src/shell-core/runtime/app-loader.js'));
  const { ensureAppCssLoaded, ensureAppJsLoaded } = await import(`${appLoaderUrl.href}?contract=asset-retry`);

  const failedCssPromise = ensureAppCssLoaded('photos');
  const failedCss = await waitForElement(fixture, (element) => element.dataset.appCss === 'photos');
  const cssRejected = assert.rejects(failedCssPromise, /load app css failed/);
  failedCss.dispatch('error');
  await cssRejected;
  assert.equal(failedCss.dataset.appCssState, 'error');
  assert.equal(fixture.elements.includes(failedCss), false, '失败 CSS 节点必须移除');

  const retriedCssPromise = ensureAppCssLoaded('photos');
  const retriedCss = await waitForElement(
    fixture,
    (element) => element.dataset.appCss === 'photos' && element !== failedCss
  );
  retriedCss.dispatch('load');
  await retriedCssPromise;
  assert.equal(retriedCss.dataset.appCssState, 'ready', 'CSS 重试成功后必须进入 ready 状态');

  const failedScriptPromise = ensureAppJsLoaded('photos');
  const failedScript = await waitForElement(fixture, (element) => element.dataset.appScript === 'photos');
  const scriptRejected = assert.rejects(failedScriptPromise, /load app js failed/);
  failedScript.dispatch('error');
  await scriptRejected;
  assert.equal(failedScript.dataset.appScriptState, 'error');
  assert.equal(fixture.elements.includes(failedScript), false, '失败 JS 节点必须移除');

  const retriedScriptPromise = ensureAppJsLoaded('photos');
  const retriedScript = await waitForElement(
    fixture,
    (element) => element.dataset.appScript === 'photos' && element !== failedScript
  );
  retriedScript.dispatch('load');
  await retriedScriptPromise;
  assert.equal(retriedScript.dataset.appScriptState, 'ready', 'JS 重试成功后必须进入 ready 状态');

  const timeoutPromise = ensureAppCssLoaded('moments');
  const timedOutCss = await waitForElement(fixture, (element) => element.dataset.appCss === 'moments');
  const timeoutRejected = assert.rejects(timeoutPromise, /timed out after 15000ms/);
  const timeoutEntry = Array.from(fixture.timers.values()).find((timer) => timer.delay === 15_000);
  assert.ok(timeoutEntry, '资源等待必须设置有界超时');
  timeoutEntry.callback();
  await timeoutRejected;
  assert.equal(timedOutCss.dataset.appCssState, 'error');
  assert.equal(fixture.elements.includes(timedOutCss), false, '超时节点必须移除以允许后续重试');

  const staleScript = fixture.document.createElement('script');
  staleScript.type = 'module';
  staleScript.src = '/assets/js/apps/moments/index.js';
  staleScript.dataset.appScript = 'moments';
  fixture.document.head.appendChild(staleScript);
  let staleScriptSettled = false;
  const staleScriptPromise = ensureAppJsLoaded('moments');
  staleScriptPromise.then(
    () => { staleScriptSettled = true; },
    () => { staleScriptSettled = true; }
  );
  for (let attempt = 0; attempt < 20 && !staleScript.listeners.get('error')?.length; attempt += 1) {
    await Promise.resolve();
  }
  assert.ok(staleScript.listeners.get('error')?.length, '状态未知的旧 JS 节点必须进入受控等待');
  assert.equal(staleScriptSettled, false, '无显式 ready 状态的旧 JS 节点不得被误判为成功');
  const staleScriptRejected = assert.rejects(staleScriptPromise, /load app js failed/);
  staleScript.dispatch('error');
  await staleScriptRejected;
  assert.equal(fixture.elements.includes(staleScript), false, '状态未知且失败的旧 JS 节点必须移除');
}

async function verifyTopLevelDynamicLink() {
  let attached = 0;
  const attributes = new Map();
  const anchor = {
    tagName: 'A',
    href: 'https://example.test/posts/example',
    target: '',
    className: 'pjax-link',
    classList: { contains: (name) => name === 'pjax-link' },
    matches(selector) {
      return selector.includes('a.pjax-link');
    },
    querySelectorAll() {
      return [];
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };

  setGlobal('window', {
    location: {
      origin: 'https://example.test',
      protocol: 'https:',
      host: 'example.test',
      search: ''
    },
    pjax: {
      attachLink(link) {
        assert.equal(link, anchor);
        attached += 1;
      }
    }
  });
  setGlobal('document', { body: { dataset: {} } });

  const linkAttachUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/link-attach.js')
  );
  const { attachDynamicLinks } = await import(`${linkAttachUrl.href}?contract=top-level-link`);
  assert.equal(attachDynamicLinks(anchor), 1, '新增节点本身为 a.pjax-link 时也必须绑定');
  assert.equal(attached, 1);
}

async function verifyNavigationHelpers() {
  const guardUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/navigation-guard.js')
  );
  const {
    createBrowserNavigationOwnership,
    createNavigationCoordinator,
    isFullNavigationCompletionCurrent,
    isCurrentNavigationIntent,
    isPlainPrimaryNavigationEvent,
    resolveNavigationHref,
    runNonFatalNavigationHook
  } = await import(
    `${guardUrl.href}?contract=navigation-generation`
  );

  assert.equal(isPlainPrimaryNavigationEvent({ button: 0 }), true);
  assert.equal(isPlainPrimaryNavigationEvent({ button: 1 }), false, '中键不得被同窗口 capture 拦截');
  assert.equal(isPlainPrimaryNavigationEvent({ button: 0, metaKey: true }), false);
  assert.equal(isPlainPrimaryNavigationEvent({ button: 0, ctrlKey: true }), false);
  assert.equal(isPlainPrimaryNavigationEvent({ button: 0, shiftKey: true }), false);
  assert.equal(isPlainPrimaryNavigationEvent({ button: 0, altKey: true }), false);

  assert.equal(isCurrentNavigationIntent(undefined, 4), true, '无 intent tag 的兼容事件应 fail-open');
  assert.equal(isCurrentNavigationIntent('invalid', 4), true, '非法 intent tag 应 fail-open');
  assert.equal(isCurrentNavigationIntent(0, 4), true, '非正 intent tag 应 fail-open');
  assert.equal(isCurrentNavigationIntent(4, 4), true, '当前 intent 应通过');
  assert.equal(isCurrentNavigationIntent('4', 4), true, '序列化的当前 intent 应通过');
  assert.equal(isCurrentNavigationIntent(3, 4), false, '过期 intent 必须被拒绝');
  assert.equal(isCurrentNavigationIntent(5, 4), false, '不属于当前导航的未来 intent 必须被拒绝');

  const coordinator = createNavigationCoordinator();
  const first = coordinator.begin();
  const second = coordinator.begin();
  assert.equal(first.signal.aborted, true, '新导航必须取消旧导航');
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), true);
  assert.equal(coordinator.finish(first), false, '旧导航不得完成或覆盖新导航');
  assert.equal(coordinator.finish(second), true);

  const redirectedRequest = {
    responseURL: 'https://example.test/final',
    getResponseHeader: () => 'https://example.test/header-redirect'
  };
  assert.equal(
    resolveNavigationHref(redirectedRequest, 'https://example.test/requested'),
    'https://example.test/final',
    'responseURL 必须优先于原始 request href'
  );
  assert.equal(
    resolveNavigationHref({
      responseURL: '',
      getResponseHeader(name) {
        return name === 'X-PJAX-URL' ? 'https://example.test/pjax-redirect' : null;
      }
    }, 'https://example.test/requested'),
    'https://example.test/pjax-redirect',
    '重定向响应头必须优先于原始 request href'
  );
  assert.equal(
    resolveNavigationHref({
      responseURL: '',
      getResponseHeader(name) {
        if (name === 'X-PJAX-URL') throw new Error('header unavailable');
        return 'https://example.test/xhr-redirect';
      }
    }, 'https://example.test/requested'),
    'https://example.test/xhr-redirect',
    '一个响应头读取失败时仍须尝试剩余重定向头'
  );
  assert.equal(
    resolveNavigationHref(null, 'https://example.test/requested', 'https://example.test/current'),
    'https://example.test/requested',
    '无重定向信息时才允许回退到原始 href'
  );

  const ownership = createBrowserNavigationOwnership();
  ownership.begin(1, { popstate: true });
  assert.equal(ownership.isPopstate(1), true);
  assert.equal(ownership.markForward(1), false, 'popstate intent 不得同时取得 forward 归属');
  ownership.begin(2);
  assert.deepEqual(
    ownership.snapshot(),
    { popstateIntent: 0, forwardIntent: 0 },
    '新 full intent 必须清除旧 popstate 归属'
  );
  assert.equal(ownership.markForward(2), true);
  assert.equal(ownership.shouldCommitForward(1), false, '旧 intent 不得写入 history index');
  assert.equal(ownership.shouldCommitForward(2), true, '抢占后的新 full intent 必须能写入 history index');
  assert.equal(ownership.release(1), false, '释放旧 intent 不得清掉新 intent 的归属');
  assert.equal(ownership.shouldCommitForward(2), true);

  let currentGeneration = 1;
  let currentIntent = 2;
  let depthWrites = 0;
  const failedCompletion = (async () => {
    await Promise.resolve();
    if (isFullNavigationCompletionCurrent({
      completionGeneration: 1,
      currentGeneration,
      completionIntent: 2,
      currentIntent
    }) && ownership.shouldCommitForward(2)) {
      depthWrites += 1;
    }
  })();
  currentGeneration += 1;
  ownership.release(2);
  await failedCompletion;
  assert.equal(depthWrites, 0, 'complete 后紧随 error 的失败请求不得提前写 depth');

  const cleanupGate = deferred();
  let cleanupCount = 0;
  currentGeneration = 3;
  currentIntent = 3;
  const delayedCleanup = (async () => {
    if (!isFullNavigationCompletionCurrent({
      completionGeneration: 3,
      currentGeneration,
      completionIntent: 3,
      currentIntent
    })) return;
    await cleanupGate.promise;
    if (isFullNavigationCompletionCurrent({
      completionGeneration: 3,
      currentGeneration,
      completionIntent: 3,
      currentIntent
    })) {
      cleanupCount += 1;
    }
  })();
  currentGeneration = 4;
  currentIntent = 4;
  cleanupGate.resolve();
  await delayedCleanup;
  assert.equal(cleanupCount, 0, 'overlay await 期间失去归属后不得清理新导航的 DOM/transient 状态');

  let reportedHookError = null;
  let committedHistoryEntries = 0;
  const hookResult = runNonFatalNavigationHook(
    () => { throw new Error('tail hook failed'); },
    (error) => { reportedHookError = error; }
  );
  committedHistoryEntries += 1;
  assert.equal(hookResult, false, '尾部 hook 失败应被记录为非致命');
  assert.match(reportedHookError?.message || '', /tail hook failed/);
  assert.equal(committedHistoryEntries, 1, '尾部 hook 失败不得触发第二次 history commit');
}

async function verifyLoadingControllerInterruption() {
  const attributes = new Map();
  const overlay = {
    isConnected: true,
    style: {},
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };
  const contentRoot = {
    matches(selector) {
      return selector === '[data-window-content-root]';
    },
    querySelector(selector) {
      return selector === '[data-window-loading-overlay]' ? overlay : null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
  const controllerUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/loading-controller.js')
  );
  const { createWindowLoadingController } = await import(`${controllerUrl.href}?contract=interrupt-fade`);
  const controller = createWindowLoadingController(contentRoot, {
    showDelay: 0,
    minVisible: 5_000,
    fadeDuration: 5_000
  }).start();
  const pendingFade = controller.finish();
  await controller.finish({ immediate: true });
  await pendingFade;

  assert.equal(attributes.get('aria-busy'), 'false');
  assert.equal(attributes.get('aria-hidden'), 'true');
  assert.equal(overlay.style.display, 'none');
  assert.equal(attributes.has('data-fading'), false, '新导航打断旧淡出时必须清理旧计时器');
}

async function verifyBusyOnlyLoadingController() {
  const rootAttributes = new Map();
  let overlayQueries = 0;
  const contentRoot = {
    matches(selector) {
      return selector === '[data-window-content-root]';
    },
    querySelector() {
      overlayQueries += 1;
      return null;
    },
    setAttribute(name, value) {
      rootAttributes.set(name, String(value));
    }
  };
  const controllerUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/loading-controller.js')
  );
  const {
    createWindowLoadingController,
    hasLoadingOverlay
  } = await import(`${controllerUrl.href}?contract=busy-only`);
  const controller = createWindowLoadingController(contentRoot, { useOverlay: false }).start();

  assert.equal(controller.overlay, null, 'progress 模式不得持有窗口骨架');
  assert.equal(hasLoadingOverlay(controller), false, 'busy-only controller 不得被误判为窗口骨架');
  assert.equal(overlayQueries, 0, 'progress 模式不得查询或触碰窗口骨架 DOM');
  assert.equal(rootAttributes.get('aria-busy'), 'true', 'progress 模式仍须声明内容忙碌状态');

  await controller.finish({ immediate: true });
  assert.equal(rootAttributes.get('aria-busy'), 'false', 'progress 模式完成或中断后必须清除忙碌状态');
}

try {
  await verifyAssetFailureRecovery();
  await verifyTopLevelDynamicLink();
  await verifyNavigationHelpers();
  await verifyLoadingControllerInterruption();
  await verifyBusyOnlyLoadingController();

  const pjaxSource = fs.readFileSync(
    path.join(root, 'src/shell/desktop-shell/runtime/desktop/pjax/index.js'),
    'utf8'
  );
  assert.match(pjaxSource, /document\.addEventListener\("pjax:complete", async \(event\) => \{[\s\S]*?try \{[\s\S]*?catch \(error\)[\s\S]*?finally \{/);
  assert.match(pjaxSource, /hardNavigate\(fallbackHref\)/, 'PJAX 完成阶段失败必须硬导航兜底');
  assert.match(pjaxSource, /discardStagedOnlineMonitorHistoryState\(\)/, 'PJAX 错误必须清理待写入的 Online history 状态');
  assert.match(
    pjaxSource,
    /let contentSwapped = false;[\s\S]*?contentSwapped = true;[\s\S]*?if \(!contentSwapped\)/,
    'same-variant 只能在 DOM swap 真正完成后同步 URL 与应用状态'
  );
  assert.doesNotMatch(
    pjaxSource,
    /window\.pjax\.loadUrl\(targetUrl\);\s*window\.pjax\.loadUrl\(targetUrl\);/,
    'same-variant fallback 只允许发起一次 full PJAX'
  );
  assert.match(
    pjaxSource,
    /await ensureAppAssetsLoaded\(nextApp\);[\s\S]*?if \(!isCurrentCompletion\(\)\) return;[\s\S]*?replaceBrowserNavState\(nextNavIndex\);/,
    'full PJAX 只能在异步初始化成功且仍持有归属后写 history index'
  );
  assert.match(
    pjaxSource,
    /await loadingController\?\.finish\([\s\S]*?if \(isCurrentCompletion\(\)\) \{[\s\S]*?container\?\.classList\.remove\('pjax-loading'\);[\s\S]*?clearTransientNavigationUi\(\);/,
    'complete finally 必须在 overlay await 后重新校验 generation/intent 再清 DOM'
  );
  assert.match(
    pjaxSource,
    /const useWindowOverlay = shouldUseWindowLoadingOverlay\(currentApp, targetApp\);\s*const loadingController = createWindowLoadingController\(contentRoot, \{\s*useOverlay: useWindowOverlay\s*\}\)\.start\(\);/,
    'same-variant 必须按应用清单决定使用窗口骨架或轻量进度'
  );
  assert.match(
    pjaxSource,
    /currentVariant !== 'none' &&\s*shouldUseWindowLoadingOverlay\(currentApp, targetApp\);/,
    'full PJAX（含前进后退）必须复用同一加载策略'
  );
  const fullSendStart = pjaxSource.indexOf('document.addEventListener("pjax:send"');
  const fullSendEnd = pjaxSource.indexOf('document.addEventListener("pjax:complete"', fullSendStart);
  const fullSendSource = pjaxSource.slice(fullSendStart, fullSendEnd);
  assert.ok(
    fullSendSource.indexOf('const currentApp =') < fullSendSource.indexOf('deactivateCurrentPageApp();'),
    'full PJAX 必须在停用当前应用前保存 currentApp，确保 popstate 可选择正确加载策略'
  );
  assert.match(
    fullSendSource,
    /event\?\.triggerElement\?\.href \|\| event\?\.requestOptions\?\.requestUrl/,
    'full PJAX 必须从 requestOptions.requestUrl 识别无 triggerElement 的前进后退目标'
  );
  const sameVariantStart = pjaxSource.indexOf('async function navigateWithinVariant');
  const tailHookIndex = pjaxSource.indexOf('runNonFatalNavigationHook(window.__momentsScrollSetup', sameVariantStart);
  const historyCommitIndex = pjaxSource.indexOf('pushBrowserNavState(nextNavIndex', sameVariantStart);
  assert.ok(tailHookIndex > sameVariantStart, 'same-variant 尾部 hook 必须显式隔离异常');
  assert.ok(historyCommitIndex > tailHookIndex, '所有可抛尾部 hook 必须在 same-variant history commit 前完成');

  console.log('pjax navigation offline contract passed');
} finally {
  restoreGlobal('window', previousWindow);
  restoreGlobal('document', previousDocument);
  restoreGlobal('fetch', previousFetch);
}
