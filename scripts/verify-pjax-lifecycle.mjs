import { chromium } from 'playwright';

const baseUrl = (process.env.SMOKE_BASE_URL || '').trim();
const requestedCycles = Number.parseInt(process.env.PJAX_LIFECYCLE_CYCLES || '20', 10);
const cycleCount = Number.isFinite(requestedCycles) ? Math.max(20, requestedCycles) : 20;
const navigationTimeoutMs = 30_000;
const shellStyleSelector = '#shell-core-style';
const shellStylePathPattern = /\/assets\/css\/shell-core\/index\.css$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toAbsoluteUrl(target) {
  return new URL(target, baseUrl).toString();
}

function normalizePathname(value) {
  const pathname = new URL(value, baseUrl).pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function isShellCoreStyleRequest(value) {
  try {
    return shellStylePathPattern.test(new URL(value, baseUrl).pathname);
  } catch {
    return false;
  }
}

async function waitForAnimationSettle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function waitForPjaxRuntime(page) {
  await page.waitForFunction(
    () => Boolean(
      window.pjax?.loadUrl
      && window.__THEME_SHELL_CORE_LOADED__
      && document.querySelector('#window-frame-root')
    ),
    undefined,
    { timeout: navigationTimeoutMs }
  );
}

async function waitForPjaxSettle(page, expectedPathname) {
  await page.waitForFunction(
    (expected) => {
      const normalize = (pathname) => (
        pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
      );
      const root = document.querySelector('#window-frame-root');
      return normalize(window.location.pathname) === expected
        && root
        && !root.classList.contains('pjax-loading');
    },
    expectedPathname,
    { timeout: navigationTimeoutMs }
  );
  await waitForAnimationSettle(page);
}

async function readShellStyleState(page) {
  return page.evaluate((selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    return {
      count: nodes.length,
      nodes: nodes.map((node) => ({
        tagName: node.tagName,
        href: node.href || '',
        rel: node.getAttribute('rel') || '',
        connected: node.isConnected,
        disabled: Boolean(node.disabled)
      }))
    };
  }, shellStyleSelector);
}

async function assertUniqueShellStyle(page, stage, expectedHref = '') {
  const state = await readShellStyleState(page);
  assert(
    state.count === 1,
    `${stage}: 期望 ${shellStyleSelector} 唯一，实际数量为 ${state.count}`
  );

  const [style] = state.nodes;
  assert(
    style.tagName === 'LINK' && style.rel.toLowerCase().split(/\s+/).includes('stylesheet'),
    `${stage}: ${shellStyleSelector} 必须是 stylesheet link`
  );
  assert(style.connected, `${stage}: ${shellStyleSelector} 已脱离文档`);
  assert(!style.disabled, `${stage}: ${shellStyleSelector} 被禁用`);
  assert(
    isShellCoreStyleRequest(style.href),
    `${stage}: ${shellStyleSelector} 未指向 shell-core CSS：${style.href || '(空)'}`
  );
  if (expectedHref) {
    assert(
      style.href === expectedHref,
      `${stage}: shell-core CSS href 发生变化：${expectedHref} -> ${style.href}`
    );
  }

  return style.href;
}

async function readFloatingScrollbarState(page) {
  return page.evaluate(() => {
    const snapshot = window.__THEME_FLOATING_SCROLLBAR_DEBUG__?.snapshot?.() || null;
    const hosts = Array.from(document.querySelectorAll('.floating-scrollbar-host'));
    return {
      snapshot,
      hostCount: hosts.length,
      duplicateOverlayHosts: hosts.filter((host) => (
        host.querySelectorAll(':scope > .window-scrollbar-overlay').length > 1
      )).length
    };
  });
}

async function assertFloatingScrollbarState(page, stage, expectedInitialized = null) {
  const state = await readFloatingScrollbarState(page);
  assert(state.snapshot, `${stage}: 缺少浮动滚动条诊断快照`);
  assert(
    state.snapshot.disconnected === 0,
    `${stage}: 浮动滚动条仍持有 ${state.snapshot.disconnected} 个断连容器`
  );
  assert(
    state.snapshot.initialized === state.snapshot.connected,
    `${stage}: 浮动滚动条 registry 不一致：${JSON.stringify(state.snapshot)}`
  );
  assert(
    state.hostCount === state.snapshot.connected,
    `${stage}: DOM host 数量 ${state.hostCount} 与 registry ${state.snapshot.connected} 不一致`
  );
  assert(state.duplicateOverlayHosts === 0, `${stage}: 存在重复滚动条 overlay`);
  if (expectedInitialized !== null) {
    assert(
      state.snapshot.initialized === expectedInitialized,
      `${stage}: 浮动滚动条数量应回到 ${expectedInitialized}，实际 ${state.snapshot.initialized}`
    );
  }
  return state;
}

async function countWindowResizeListeners(cdp, sampleId) {
  const objectGroup = `pjax-lifecycle-${sampleId}`;
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: 'window',
    objectGroup,
    returnByValue: false
  });

  assert(evaluated.result.objectId, 'CDP 无法解析 window 对象');

  try {
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: evaluated.result.objectId,
      depth: 1,
      pierce: true
    });
    const resizeListeners = listeners.filter((listener) => listener.type === 'resize');
    return {
      count: resizeListeners.length,
      sources: resizeListeners.map((listener) => ({
        scriptId: listener.scriptId || '',
        lineNumber: Number(listener.lineNumber || 0) + 1,
        columnNumber: Number(listener.columnNumber || 0) + 1,
        useCapture: Boolean(listener.useCapture),
        passive: Boolean(listener.passive),
        once: Boolean(listener.once)
      }))
    };
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  }
}

async function navigateWithPjax(page, target) {
  const expectedPathname = normalizePathname(target);

  await page.evaluate(
    ({ targetUrl, timeoutMs }) => new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;

      const cleanup = () => {
        window.clearTimeout(timer);
        document.removeEventListener('pjax:complete', onComplete);
        document.removeEventListener('pjax:same-variant-complete', onComplete);
        document.removeEventListener('pjax:error', onError);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onComplete = () => finish(resolve);
      const onError = (event) => {
        const status = event?.detail?.request?.status;
        const detail = event?.detail?.error?.message;
        finish(reject, new Error(`PJAX 请求失败${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`));
      };

      document.addEventListener('pjax:complete', onComplete);
      document.addEventListener('pjax:same-variant-complete', onComplete);
      document.addEventListener('pjax:error', onError);
      timer = window.setTimeout(
        () => finish(reject, new Error(`等待 PJAX 完成事件超时：${targetUrl}`)),
        timeoutMs
      );

      try {
        const loadResult = window.pjax?.loadUrl?.(targetUrl);
        if (!window.pjax?.loadUrl) {
          finish(reject, new Error('window.pjax.loadUrl 不可用'));
          return;
        }
        Promise.resolve(loadResult).catch((error) => {
          finish(reject, error instanceof Error ? error : new Error(String(error)));
        });
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error(String(error)));
      }
    }),
    { targetUrl: toAbsoluteUrl(target), timeoutMs: navigationTimeoutMs }
  );

  await waitForPjaxSettle(page, expectedPathname);
  assert(
    normalizePathname(page.url()) === expectedPathname,
    `PJAX 路径不匹配：期望 ${expectedPathname}，实际 ${page.url()}`
  );
}

async function navigateSameVariantByClick(page, target) {
  const expectedPathname = normalizePathname(target);

  await page.evaluate(
    ({ targetUrl, timeoutMs }) => new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;
      const link = document.createElement('a');
      link.href = targetUrl;
      link.className = 'pjax-link';
      link.textContent = 'PJAX lifecycle probe';
      link.hidden = true;
      document.body.appendChild(link);

      const contentContainer = document.querySelector('[data-window-content-variant]')
        || document.querySelector('#pjax-container');
      if (!contentContainer) {
        link.remove();
        reject(new Error('找不到同 variant 内容容器'));
        return;
      }

      const oldScrollContainer = document.createElement('div');
      oldScrollContainer.dataset.windowScroll = '';
      oldScrollContainer.style.cssText = 'height:1px;overflow:auto';
      contentContainer.appendChild(oldScrollContainer);
      oldScrollContainer.dispatchEvent(new Event('scroll'));
      window.__PJAX_LIFECYCLE_OLD_SCROLL_CONTAINER__ = oldScrollContainer;

      const cleanup = () => {
        window.clearTimeout(timer);
        document.removeEventListener('pjax:same-variant-complete', onComplete);
        document.removeEventListener('pjax:error', onError);
        link.remove();
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onComplete = () => finish(resolve);
      const onError = (event) => {
        const status = event?.detail?.request?.status;
        const detail = event?.detail?.error?.message;
        finish(reject, new Error(`同 variant PJAX 失败${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`));
      };

      document.addEventListener('pjax:same-variant-complete', onComplete);
      document.addEventListener('pjax:error', onError);
      timer = window.setTimeout(
        () => finish(reject, new Error(`等待 pjax:same-variant-complete 超时：${targetUrl}`)),
        timeoutMs
      );
      link.click();
    }),
    { targetUrl: toAbsoluteUrl(target), timeoutMs: navigationTimeoutMs }
  );

  await waitForPjaxSettle(page, expectedPathname);
  assert(
    normalizePathname(page.url()) === expectedPathname,
    `同 variant PJAX 路径不匹配：期望 ${expectedPathname}，实际 ${page.url()}`
  );

  const oldContainerState = await page.evaluate(() => {
    const oldScrollContainer = window.__PJAX_LIFECYCLE_OLD_SCROLL_CONTAINER__;
    delete window.__PJAX_LIFECYCLE_OLD_SCROLL_CONTAINER__;
    return oldScrollContainer ? {
      connected: oldScrollContainer.isConnected,
      active: oldScrollContainer.dataset.scrollbarActive || ''
    } : null;
  });
  assert(oldContainerState, '同 variant 测试未保留旧滚动容器引用');
  assert(!oldContainerState.connected, '同 variant 替换后旧滚动容器仍连接在 DOM');
  assert(!oldContainerState.active, '同 variant 替换后旧滚动容器活动状态未清理');
}

async function main() {
  if (!baseUrl) {
    console.log('跳过 PJAX lifecycle：未设置 SMOKE_BASE_URL');
    return;
  }

  let browser;
  let context;
  let page;
  let cdp;
  let onRequest;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    const initialResponse = await page.goto(toAbsoluteUrl('/categories'), {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs
    });
    assert(initialResponse?.ok(), `初始路由 /categories 加载失败：HTTP ${initialResponse?.status() || 'unknown'}`);

    await waitForPjaxRuntime(page);
    await waitForPjaxSettle(page, '/categories');
    const shellStyleHref = await assertUniqueShellStyle(page, '基线');
    await page.waitForFunction(
      (selector) => Boolean(document.querySelector(selector)?.sheet),
      shellStyleSelector,
      { timeout: navigationTimeoutMs }
    );

    const baseline = await countWindowResizeListeners(cdp, 'baseline');
    const baselineFloatingScrollbars = await assertFloatingScrollbarState(page, '基线');
    const shellCssRequests = [];
    onRequest = (request) => {
      if (!isShellCoreStyleRequest(request.url())) return;
      shellCssRequests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType()
      });
    };
    page.on('request', onRequest);

    const samples = [{
      stage: 'baseline:/categories',
      resizeListeners: baseline.count,
      floatingScrollbars: baselineFloatingScrollbars.snapshot.initialized
    }];

    for (const target of ['/', '/categories']) {
      const stage = `full-pjax:${target}`;
      await navigateWithPjax(page, target);
      await assertUniqueShellStyle(page, stage, shellStyleHref);
      await assertFloatingScrollbarState(
        page,
        stage,
        target === '/categories' ? baselineFloatingScrollbars.snapshot.initialized : null
      );
    }

    for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
      for (const target of ['/tags', '/categories']) {
        const stage = `cycle ${cycle}/${cycleCount}:${target}`;
        await navigateSameVariantByClick(page, target);
        await assertUniqueShellStyle(page, stage, shellStyleHref);
        const floatingScrollbars = await assertFloatingScrollbarState(
          page,
          stage,
          target === '/categories' ? baselineFloatingScrollbars.snapshot.initialized : null
        );

        const sample = await countWindowResizeListeners(cdp, `${cycle}-${target === '/' ? 'home' : 'categories'}`);
        samples.push({
          stage,
          resizeListeners: sample.count,
          floatingScrollbars: floatingScrollbars.snapshot.initialized
        });
        assert(
          sample.count <= baseline.count,
          `${stage}: window resize listener 从基线 ${baseline.count} 增长到 ${sample.count}；来源=${JSON.stringify(sample.sources)}`
        );
        assert(
          shellCssRequests.length === 0,
          `${stage}: PJAX 期间产生 shell-core CSS 请求：${JSON.stringify(shellCssRequests)}`
        );
      }
    }

    const finalSample = await countWindowResizeListeners(cdp, 'final');
    assert(
      finalSample.count === baseline.count,
      `最终 /categories 的 window resize listener 应回到基线 ${baseline.count}，实际 ${finalSample.count}`
    );
    assert(shellCssRequests.length === 0, `PJAX 期间产生 shell-core CSS 请求：${JSON.stringify(shellCssRequests)}`);
    const finalFloatingScrollbars = await assertFloatingScrollbarState(
      page,
      '最终 /categories',
      baselineFloatingScrollbars.snapshot.initialized
    );

    console.log([
      'PJAX lifecycle 门禁通过',
      `baseUrl=${baseUrl}`,
      `cycles=${cycleCount}`,
      `pjaxNavigations=${cycleCount * 2 + 2}`,
      `sameVariantNavigations=${cycleCount * 2}`,
      `resizeListeners=${baseline.count}`,
      `floatingScrollbars=${finalFloatingScrollbars.snapshot.initialized}/${finalFloatingScrollbars.snapshot.connected}`,
      'shellCoreCssRequests=0',
      `samples=${samples.length}`
    ].join(' | '));
  } finally {
    if (page && onRequest) page.off('request', onRequest);
    await Promise.allSettled([
      cdp?.detach().catch(() => {}),
      page?.close().catch(() => {}),
      context?.close().catch(() => {}),
      browser?.close().catch(() => {})
    ]);
  }
}

main().catch((error) => {
  console.error(`PJAX lifecycle 门禁失败：${error?.stack || error}`);
  process.exitCode = 1;
});
