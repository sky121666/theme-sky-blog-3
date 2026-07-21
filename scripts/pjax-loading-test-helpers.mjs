import assert from 'node:assert/strict';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export async function verifyPendingPjaxLoading({
  page,
  targetUrl,
  action,
  preservedSelector,
  expectWindowOverlay,
  label
}) {
  const expectedUrl = new URL(targetUrl);
  const requestSeen = deferred();
  const releaseRequest = deferred();
  const requestContinued = deferred();
  let intercepted = false;
  const marker = `pjax-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const routeHandler = async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const matchesTarget = request.method() === 'GET'
      && ['fetch', 'xhr'].includes(request.resourceType())
      && requestUrl.origin === expectedUrl.origin
      && requestUrl.pathname === expectedUrl.pathname
      && requestUrl.search === expectedUrl.search;

    if (!intercepted && matchesTarget) {
      intercepted = true;
      requestSeen.resolve();
      await releaseRequest.promise;
    }

    await route.continue();
    if (matchesTarget) requestContinued.resolve();
  };

  await page.route('**/*', routeHandler);
  const preserved = await page.evaluate(({ selector, value }) => {
    const node = document.querySelector(selector);
    if (!node) return false;
    node.setAttribute('data-pjax-pending-marker', value);
    return true;
  }, { selector: preservedSelector, value: marker });
  assert.equal(preserved, true, `${label}必须存在待保留的当前内容`);

  let actionPromise;
  try {
    actionPromise = Promise.resolve().then(action);
    await withTimeout(requestSeen.promise, 10_000, `${label}未捕获到 PJAX 请求`);
    await page.waitForTimeout(180);

    const pendingState = await page.evaluate(({ selector, value }) => {
      const isVisible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && node.getAttribute('aria-hidden') !== 'true'
          && rect.width > 0
          && rect.height > 0;
      };
      const overlay = document.querySelector('[data-window-loading-overlay]');
      const contentRoot = document.querySelector('[data-window-content-root]');
      const frameRoot = document.getElementById('window-frame-root');
      return {
        overlayVisible: isVisible(overlay),
        progressVisible: isVisible(document.querySelector('#nprogress .bar')),
        preserved: document.querySelector(selector)?.getAttribute('data-pjax-pending-marker') === value,
        busy: contentRoot?.getAttribute('aria-busy') === 'true'
          || frameRoot?.getAttribute('aria-busy') === 'true'
      };
    }, { selector: preservedSelector, value: marker });

    assert.equal(pendingState.preserved, true, `${label}等待期间必须保留当前内容`);
    assert.equal(pendingState.busy, true, `${label}等待期间必须声明 aria-busy`);
    assert.equal(
      pendingState.overlayVisible,
      expectWindowOverlay,
      expectWindowOverlay ? `${label}跨应用时必须保留窗口骨架` : `${label}同应用时不得显示窗口骨架`
    );
    if (!expectWindowOverlay) {
      assert.equal(pendingState.progressVisible, true, `${label}无骨架时必须显示轻量进度`);
    }
  } finally {
    releaseRequest.resolve();
    if (intercepted) {
      await withTimeout(requestContinued.promise, 10_000, `${label}请求未能继续`);
    }
    if (actionPromise) await actionPromise;
    await page.unroute('**/*', routeHandler);
  }
}

export async function assertPjaxLoadingSettled(page, label) {
  await page.waitForFunction(() => {
    const isVisible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && node.getAttribute('aria-hidden') !== 'true'
        && rect.width > 0
        && rect.height > 0;
    };
    const overlay = document.querySelector('[data-window-loading-overlay]');
    const contentRoot = document.querySelector('[data-window-content-root]');
    const frameRoot = document.getElementById('window-frame-root');
    return !isVisible(overlay)
      && !isVisible(document.querySelector('#nprogress .bar'))
      && contentRoot?.getAttribute('aria-busy') !== 'true'
      && frameRoot?.getAttribute('aria-busy') !== 'true';
  }, null, { timeout: 10_000 });

  const settled = await page.evaluate(() => ({
    overlayHidden: document.querySelector('[data-window-loading-overlay]')?.getAttribute('aria-hidden') !== 'false',
    progressRemoved: !document.querySelector('#nprogress'),
    contentBusy: document.querySelector('[data-window-content-root]')?.getAttribute('aria-busy') === 'true',
    frameBusy: document.getElementById('window-frame-root')?.getAttribute('aria-busy') === 'true'
  }));
  assert.equal(settled.overlayHidden, true, `${label}完成后窗口骨架必须隐藏`);
  assert.equal(settled.progressRemoved, true, `${label}完成后轻量进度必须移除`);
  assert.equal(settled.contentBusy, false, `${label}完成后内容 aria-busy 必须清除`);
  assert.equal(settled.frameBusy, false, `${label}完成后窗口 aria-busy 必须清除`);
}
