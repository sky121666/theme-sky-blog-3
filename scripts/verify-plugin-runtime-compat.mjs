import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousDOMParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
const tick = () => new Promise((resolve) => setImmediate(resolve));

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

function createFixture() {
  const attributes = new Map();
  const image = {
    currentSrc: 'https://example.test/image.webp',
    src: 'https://example.test/image.jpg',
    dataset: {},
    getAttribute(name) {
      return name === 'src' ? this.src : null;
    }
  };
  const gallery = {
    isConnected: true,
    matches(selector) {
      return selector === '#article-content'
        || (selector === '#article-content[lg-uid]' && attributes.has('lg-uid'));
    },
    querySelectorAll(selector) {
      return selector === 'img' ? [image] : [];
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };
  const unrelatedAttributes = new Map([['lg-uid', 'lg-unrelated']]);
  const unrelatedGallery = {
    matches(selector) {
      return selector === '[lg-uid]';
    },
    querySelectorAll() {
      return [];
    },
    hasAttribute(name) {
      return unrelatedAttributes.has(name);
    },
    getAttribute(name) {
      return unrelatedAttributes.get(name) || null;
    },
    removeAttribute(name) {
      unrelatedAttributes.delete(name);
    }
  };
  const documentListeners = new Map();
  const windowListeners = new Map();
  const windowListenerOptions = new Map();
  const animationFrames = [];
  const document = {
    isConnected: true,
    readyState: 'complete',
    matches() {
      return false;
    },
    querySelectorAll(selector) {
      if (selector === '#article-content') return [gallery];
      if (selector === '#article-content[lg-uid]') return gallery.hasAttribute('lg-uid') ? [gallery] : [];
      return [];
    },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    }
  };
  const window = {
    location: { href: 'https://example.test/archives' },
    __ONLINE_MONITOR_META__: { privatePage: false },
    history: {
      state: null,
      pushState(state) {
        this.state = state;
      },
      replaceState(state) {
        this.state = state;
      }
    },
    lgData: {
      uid: 0,
      'lg-unrelated': {
        destroy() {
          throw new Error('非文章 LightGallery 实例不应由主题销毁');
        }
      }
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    cancelAnimationFrame(id) {
      animationFrames[id - 1] = null;
    },
    setTimeout(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    addEventListener(type, handler, options) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
      if (!windowListenerOptions.has(type)) windowListenerOptions.set(type, []);
      windowListenerOptions.get(type).push(options);
    },
    lightGallery(element, options) {
      assert.equal(element, gallery);
      assert.deepEqual(options, { selector: 'img' });
      const uid = `lg${this.lgData.uid}`;
      this.lgData.uid += 1;
      element.setAttribute('lg-uid', uid);
      this.lgData[uid] = {
        destroy(immediate) {
          assert.equal(immediate, true);
          element.removeAttribute('lg-uid');
          delete window.lgData[uid];
        }
      };
    }
  };

  return {
    animationFrames,
    attributes,
    document,
    documentListeners,
    gallery,
    image,
    unrelatedAttributes,
    unrelatedGallery,
    window,
    windowListenerOptions,
    windowListeners
  };
}

function createScriptLoadingFixture() {
  const scripts = [];
  const timers = new Map();
  const animationFrames = [];
  const documentListeners = new Map();
  const image = { currentSrc: 'https://example.test/image.webp', dataset: {} };
  const gallery = {
    hasAttribute() { return false; },
    querySelectorAll(selector) { return selector === 'img' ? [image] : []; }
  };
  let nextTimerId = 0;
  let mounts = 0;
  function scriptElement() {
    const listeners = new Map();
    let src = '';
    const script = {
      dataset: {}, isConnected: false, async: true,
      get src() { return src; },
      set src(value) { src = value; },
      getAttribute(name) { return name === 'src' ? src : null; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type) { listeners.delete(type); },
      dispatch(type) { listeners.get(type)?.(); },
      remove() { this.isConnected = false; }
    };
    return script;
  }
  const document = {
    isConnected: true,
    readyState: 'loading',
    head: {
      appendChild(script) {
        scripts.push(script);
        script.isConnected = true;
      }
    },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    createElement(tag) {
      assert.equal(tag, 'script');
      return scriptElement();
    },
    querySelectorAll(selector) {
      if (selector === 'script[src]') return scripts.filter((script) => script.isConnected);
      if (selector === '#article-content') return [gallery];
      return [];
    }
  };
  const window = {
    location: { href: 'https://example.test/reader' },
    addEventListener() {},
    lightGallery() { mounts += 1; },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    cancelAnimationFrame(id) { animationFrames[id - 1] = null; },
    setTimeout(callback, ms) {
      const id = ++nextTimerId;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  class FixtureDOMParser {
    parseFromString(html) {
      const sources = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)]
        .map((match) => ({ getAttribute: () => match[1] }));
      return {
        querySelectorAll(selector) {
          return selector === 'script[src]' ? sources : [];
        }
      };
    }
  }
  return {
    document, window, FixtureDOMParser, scripts, timers, animationFrames, documentListeners,
    get mounts() { return mounts; },
    addExistingScript(src) {
      const script = scriptElement();
      script.src = src;
      document.head.appendChild(script);
      return script;
    },
    fireDeadline() {
      const timer = [...timers.values()].find((entry) => entry.ms === 15000);
      assert.ok(timer, 'LightGallery script deadline missing');
      timer.callback();
    }
  };
}

const fixture = createFixture();
setGlobal('window', fixture.window);
setGlobal('document', fixture.document);

try {
  const moduleUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/shared/plugin-compat.js')
  );
  const {
    disposeLightGallery,
    disposePluginUiBeforeNavigationCommit,
    discardStagedOnlineMonitorHistoryState,
    initPluginCompatibility,
    mountLightGallery,
    preparePluginCompatibilityFromResponse,
    syncOnlineMonitorMetaFromHistoryState,
    syncOnlineMonitorMetaFromResponse
  } = await import(`${moduleUrl.href}?contract=plugin-runtime-compat`);

  assert.equal(mountLightGallery(fixture.document), 1, '首次挂载应初始化文章灯箱');
  assert.equal(fixture.image.dataset.src, fixture.image.currentSrc, '灯箱应使用浏览器已选择的图片源');
  assert.equal(mountLightGallery(fixture.document), 0, '已有 lg-uid 时不得重复初始化');
  assert.equal(disposeLightGallery(fixture.document), 1, '导航前应销毁已有实例');
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), false, '销毁后必须移除实例标记');
  assert.equal(fixture.unrelatedGallery.hasAttribute('lg-uid'), true, '不得销毁非文章灯箱实例');

  assert.equal(syncOnlineMonitorMetaFromResponse(`
    <article><pre><code>privatePage: false</code></pre></article>
    <script>window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
      privatePage: true,
      readingProgressEnabled: true
    });</script>
  `), true, '应读取 Online 私密页标记');
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, true);
  assert.equal(syncOnlineMonitorMetaFromResponse('<main>no online plugin</main>'), false);
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, true, '无插件元数据时不得覆盖现有状态');
  syncOnlineMonitorMetaFromResponse(`
    <article><code>privatePage: true</code></article>
    <script>window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
      privatePage: false
    });</script>
  `);
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, false, '应恢复公开页标记');

  initPluginCompatibility();
  initPluginCompatibility();
  assert.equal(fixture.documentListeners.get('theme:pjax-ready')?.length, 1);
  assert.equal(fixture.documentListeners.get('theme:navigation-settled')?.length, 1);
  for (const type of ['pjax:complete', 'pjax:same-variant-complete', 'pjax:error', 'theme:content-swapped']) {
    assert.equal(fixture.documentListeners.get(type)?.length || 0, 0, `${type} must not duplicate theme lifecycle work`);
  }
  assert.equal(fixture.windowListeners.get('pageshow')?.length, 1);
  assert.equal(fixture.windowListeners.get('popstate')?.length, 1, '应注册 Online history 恢复监听');
  assert.equal(fixture.windowListenerOptions.get('popstate')?.[0]?.capture, true, 'history 恢复必须在捕获阶段执行');
  assert.equal(fixture.window.history.state.__themeOnlinePrivatePage, false, '初始 history state 应记录公开页');

  await preparePluginCompatibilityFromResponse(`
    <script>window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
      privatePage: true
    });</script>
  `, {
    stageOnlineHistory: true,
    targetUrl: '/private'
  });
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, false, '响应到达时不得提前污染旧 history entry 的页面语义');
  fixture.window.history.replaceState({ marker: 'old-public' }, '', '/archives');
  assert.deepEqual(fixture.window.history.state, {
    marker: 'old-public',
    __themeOnlinePrivatePage: false
  }, 'PJAX 保存旧 entry 时必须继续使用旧页面语义');
  fixture.window.history.pushState({ marker: 'new-private' }, '', '/private#reading');
  assert.deepEqual(fixture.window.history.state, {
    marker: 'new-private',
    __themeOnlinePrivatePage: true
  }, 'PJAX 新 entry 必须写入目标页面语义');
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, true, '目标 entry 写入后才切换 Online 运行态');
  discardStagedOnlineMonitorHistoryState();
  syncOnlineMonitorMetaFromResponse(`
    <script>window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
      privatePage: false
    });</script>
  `);

  await fixture.animationFrames.shift()?.();
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), true, '源页灯箱应能在等待响应期间使用');
  fixture.documentListeners.get('pjax:send')?.forEach((listener) => listener());
  fixture.documentListeners.get('pjax:same-variant-send')?.forEach((listener) => listener());
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), true, '请求开始不得提前销毁源页灯箱');
  disposePluginUiBeforeNavigationCommit();
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), false, '许可提交后才销毁源页灯箱');
  fixture.documentListeners.get('theme:navigation-settled')?.[0]({ detail: {
    intentId: 1, outcome: 'failed'
  } });
  await fixture.animationFrames.shift()?.();
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), true, '未离页的失败必须恢复源页灯箱');

  disposePluginUiBeforeNavigationCommit();
  for (const type of ['theme:content-swapped', 'pjax:complete', 'pjax:error']) {
    fixture.documentListeners.get(type)?.forEach((handler) => handler({ detail: { root: fixture.document } }));
  }
  assert.equal(fixture.animationFrames.length, 0, '库传输事件不得提前重新初始化插件 UI');
  fixture.documentListeners.get('theme:pjax-ready')[0]({ detail: { root: fixture.document } });
  assert.equal(fixture.animationFrames.length, 1, '主题就绪只调度一次插件 UI 增强');
  await fixture.animationFrames.shift()?.();
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), true, '内容替换后必须重新挂载灯箱');

  syncOnlineMonitorMetaFromResponse(`
    <script>window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
      privatePage: true
    });</script>
  `);
  fixture.window.history.pushState({ marker: 'private' }, '', '/private');
  const privateState = fixture.window.history.state;
  assert.equal(privateState.__themeOnlinePrivatePage, true, '新 history state 应记录私密页');
  syncOnlineMonitorMetaFromResponse(`
    <script>window.__ONLINE_MONITOR_META__ = Object.assign({}, window.__ONLINE_MONITOR_META__, {
      privatePage: false
    });</script>
  `);
  fixture.window.history.pushState({ marker: 'public' }, '', '/public');
  assert.equal(fixture.window.history.state.__themeOnlinePrivatePage, false, '新 history state 应记录公开页');
  assert.equal(syncOnlineMonitorMetaFromHistoryState(privateState), true);
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, true, 'history 回退前应恢复私密页语义');
  fixture.windowListeners.get('popstate')[0]({ state: fixture.window.history.state });
  assert.equal(fixture.window.__ONLINE_MONITOR_META__.privatePage, false, 'popstate 应在插件重连前恢复目标页语义');

  const loadingFixture = createScriptLoadingFixture();
  setGlobal('window', loadingFixture.window);
  setGlobal('document', loadingFixture.document);
  setGlobal('DOMParser', loadingFixture.FixtureDOMParser);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const { initPluginCompatibility: initScripts, preparePluginCompatibilityFromResponse: prepareScripts } =
      await import(`${moduleUrl.href}?contract=plugin-script-loading`);
    initScripts();
    const response = (version) => `<script src="/plugins/PluginLightGallery/assets/static/lightgallery.js?v=${version}"></script>`;
    const first = prepareScripts(response('one'));
    const firstRejection = assert.rejects(first, /LightGallery asset timed out:/);
    await tick();
    assert.equal(loadingFixture.scripts.length, 1, '首次响应应只注入一份脚本');
    assert.equal(loadingFixture.timers.size, 1, '脚本下载必须设置截止时间');
    const queued = prepareScripts(response('one'));
    await tick();
    assert.equal(loadingFixture.scripts.length, 1, '并发响应不能重复注入未完成的同版本脚本');
    const expired = loadingFixture.scripts[0];
    loadingFixture.fireDeadline();
    await firstRejection;
    await tick();
    assert.equal(expired.isConnected, false, '超时脚本必须移除，允许下一次响应重试');
    assert.equal(loadingFixture.scripts.length, 2, '后续响应应重新注入超时版本');
    assert.equal(loadingFixture.scripts.filter((script) => script.isConnected).length, 1, '重试时不能留下重复活动脚本');
    expired.dispatch('load');
    assert.equal(loadingFixture.timers.size, 1, '迟到 load 不能完成新一轮下载');
    loadingFixture.scripts[1].dispatch('load');
    await queued;
    assert.equal(loadingFixture.timers.size, 0, '成功后应清理截止时间');
    await prepareScripts(response('one'));
    assert.equal(loadingFixture.scripts.length, 2, '已加载的同版本脚本应复用');

    const slow = prepareScripts(response('two'));
    await tick();
    assert.equal(loadingFixture.scripts.length, 3, '不同版本必须加载自己的脚本');
    assert.match(loadingFixture.scripts[2].src, /v=two$/);
    assert.equal(loadingFixture.timers.size, 1, '慢加载期间保留截止时间');
    loadingFixture.scripts[2].dispatch('load');
    await slow;
    assert.equal(loadingFixture.timers.size, 0, '截止前完成不得遗留 timer');

    const failed = prepareScripts(response('three'));
    const failedRejection = assert.rejects(failed, /LightGallery asset failed:/);
    await tick();
    loadingFixture.scripts[3].dispatch('error');
    await failedRejection;
    assert.equal(loadingFixture.scripts[3].isConnected, false, '加载错误应清除旧节点');
    loadingFixture.documentListeners.get('theme:pjax-ready')[0]({ detail: { root: loadingFixture.document } });
    await loadingFixture.animationFrames.shift()?.();
    assert.equal(loadingFixture.mounts, 0, '当前版本脚本失败后不能用旧全局运行时挂载');
    const retry = prepareScripts(response('three'));
    await tick();
    assert.equal(loadingFixture.scripts.length, 5, '加载错误后的同版本应可重试');
    loadingFixture.scripts[4].dispatch('load');
    await retry;
    assert.equal(loadingFixture.timers.size, 0);
    loadingFixture.documentListeners.get('theme:pjax-ready')[0]({ detail: { root: loadingFixture.document } });
    await loadingFixture.animationFrames.shift()?.();
    assert.equal(loadingFixture.mounts, 1, '重试完成后应恢复挂载');
    assert.equal(warnings.length, 2, '超时和加载错误应留下可见诊断');
  } finally {
    console.warn = originalWarn;
  }

  const externalFixture = createScriptLoadingFixture();
  setGlobal('window', externalFixture.window);
  setGlobal('document', externalFixture.document);
  setGlobal('DOMParser', externalFixture.FixtureDOMParser);
  const externalWarnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => externalWarnings.push(args);
  try {
    const { initPluginCompatibility: initExternal, preparePluginCompatibilityFromResponse: prepareExternal } =
      await import(`${moduleUrl.href}?contract=plugin-external-script-loading`);
    const src = (version) => `/plugins/PluginLightGallery/assets/static/lightgallery.js?v=${version}`;
    const response = (version) => `<script src="${src(version)}"></script>`;
    const existing = externalFixture.addExistingScript(src('existing'));
    initExternal();

    let loaded = false;
    const pending = prepareExternal(response('existing')).then(() => { loaded = true; });
    await tick();
    assert.equal(externalFixture.scripts.length, 1, '已有同 URL 脚本加载中时不得再次注入');
    assert.equal(externalFixture.timers.size, 1, '等待外部脚本也必须保留 15 秒截止');
    externalFixture.documentListeners.get('theme:pjax-ready')[0]({ detail: { root: externalFixture.document } });
    const pendingRefresh = externalFixture.animationFrames.shift()?.();
    await tick();
    assert.equal(loaded, false, '外部脚本 load 前准备流程不得完成');
    assert.equal(externalFixture.mounts, 0, '外部脚本 load 前不得挂载旧全局运行时');
    existing.dispatch('load');
    await pending;
    await pendingRefresh;
    assert.equal(loaded, true, '外部脚本 load 后准备流程应完成');
    assert.equal(externalFixture.mounts, 1, '外部脚本 load 后应允许挂载');
    assert.equal(externalFixture.timers.size, 0);

    const failedExternal = externalFixture.addExistingScript(src('failed'));
    const failed = prepareExternal(response('failed'));
    const failedRejection = assert.rejects(failed, /LightGallery asset failed:/);
    await tick();
    externalFixture.documentListeners.get('theme:pjax-ready')[0]({ detail: { root: externalFixture.document } });
    const failedRefresh = externalFixture.animationFrames.shift()?.();
    failedExternal.dispatch('error');
    await failedRejection;
    await failedRefresh;
    assert.equal(externalFixture.mounts, 1, '外部脚本失败后不得挂载');
    assert.equal(failedExternal.isConnected, true, '主题不得删除外部脚本');
    const failedRetry = prepareExternal(response('failed'));
    await tick();
    assert.equal(externalFixture.scripts.length, 3, '外部脚本明确失败后应注入可重试脚本');
    externalFixture.scripts[2].dispatch('load');
    await failedRetry;

    const slowExternal = externalFixture.addExistingScript(src('slow'));
    const timedOut = prepareExternal(response('slow'));
    const timeoutRejection = assert.rejects(timedOut, /LightGallery asset timed out:/);
    await tick();
    externalFixture.documentListeners.get('theme:pjax-ready')[0]({ detail: { root: externalFixture.document } });
    const timeoutRefresh = externalFixture.animationFrames.shift()?.();
    externalFixture.fireDeadline();
    await timeoutRejection;
    await timeoutRefresh;
    assert.equal(externalFixture.mounts, 1, '外部脚本超时后不得挂载');
    assert.equal(slowExternal.isConnected, true, '超时不得删除可能仍在加载的外部脚本');

    let retried = false;
    const slowRetry = prepareExternal(response('slow')).then(() => { retried = true; });
    await tick();
    assert.equal(externalFixture.scripts.length, 4, '超时重试应继续等待外部节点，避免重复执行脚本');
    assert.equal(retried, false, '超时重试在外部脚本 load 前不得完成');
    slowExternal.dispatch('load');
    await slowRetry;
    assert.equal(retried, true, '超时后迟到的 load 应允许后续导航恢复');
    assert.equal(externalFixture.timers.size, 0);
    assert.equal(externalWarnings.length, 2, '外部脚本错误和超时应留下可见诊断');
  } finally {
    console.warn = previousWarn;
  }

  const completedFixture = createScriptLoadingFixture();
  completedFixture.document.readyState = 'complete';
  setGlobal('window', completedFixture.window);
  setGlobal('document', completedFixture.document);
  setGlobal('DOMParser', completedFixture.FixtureDOMParser);
  const { preparePluginCompatibilityFromResponse: prepareCompleted } =
    await import(`${moduleUrl.href}?contract=plugin-completed-script-order`);
  const completedScript = completedFixture.addExistingScript(
    '/plugins/PluginLightGallery/assets/static/lightgallery.min.js'
  );
  completedScript.async = false;
  const stillLoadingScript = completedFixture.addExistingScript(
    '/plugins/PluginLightGallery/assets/static/lg-zoom.min.js'
  );
  let allReady = false;
  const ordered = prepareCompleted(`
    <script src="/plugins/PluginLightGallery/assets/static/lightgallery.min.js"></script>
    <script src="/plugins/PluginLightGallery/assets/static/lg-zoom.min.js"></script>
  `).then(() => { allReady = true; });
  await tick();
  assert.equal(completedFixture.scripts.length, 2, '已完成的普通脚本应直接复用');
  assert.equal(completedFixture.timers.size, 1, '后续仍在加载的脚本必须继续等待');
  assert.equal(allReady, false, '第一条脚本已就绪不得跳过后续脚本');
  stillLoadingScript.dispatch('load');
  await ordered;
  assert.equal(allReady, true, '后续脚本 load 后整个加载序列应完成');

  console.log('plugin runtime compatibility contract passed');
} finally {
  restoreGlobal('window', previousWindow);
  restoreGlobal('document', previousDocument);
  restoreGlobal('DOMParser', previousDOMParser);
}
