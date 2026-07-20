import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

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

const fixture = createFixture();
setGlobal('window', fixture.window);
setGlobal('document', fixture.document);

try {
  const moduleUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/shared/plugin-compat.js')
  );
  const {
    disposeLightGallery,
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
  assert.equal(fixture.documentListeners.get('pjax:send')?.length, 1, '兼容层只能注册一次');
  assert.equal(fixture.documentListeners.get('pjax:same-variant-send')?.length, 1);
  assert.equal(fixture.documentListeners.get('pjax:complete')?.length, 1);
  assert.equal(fixture.documentListeners.get('pjax:same-variant-complete')?.length, 1);
  assert.equal(fixture.documentListeners.get('pjax:error')?.length, 1);
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

  fixture.documentListeners.get('pjax:send')[0]();
  await fixture.animationFrames.shift()?.();
  assert.equal(fixture.gallery.hasAttribute('lg-uid'), false, '导航开始后已取消的刷新不得重新挂载旧灯箱');

  fixture.documentListeners.get('theme:content-swapped')[0]({ detail: { root: fixture.document } });
  fixture.documentListeners.get('pjax:complete')[0]({ detail: { root: fixture.document } });
  assert.equal(fixture.animationFrames.length, 1, '同一帧的多个完成事件必须合并');
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

  console.log('plugin runtime compatibility contract passed');
} finally {
  restoreGlobal('window', previousWindow);
  restoreGlobal('document', previousDocument);
}
