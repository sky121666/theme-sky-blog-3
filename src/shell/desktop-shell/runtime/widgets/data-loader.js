import {
  parseDesktopWidgetProtocolFromResponse,
  syncHomeDesktopWidgetProtocolFromResponse
} from './protocol.js';

const windowLoaders = new WeakMap();

function currentProtocol(targetWindow) {
  return targetWindow.__THEME_DESKTOP_PROTOCOL__?.widgets || targetWindow.__THEME_WIDGETS__ || {};
}

function hydratedProtocol(targetWindow) {
  const protocol = currentProtocol(targetWindow);
  return protocol.sources?.hydrated === true ? protocol : null;
}

function homePath(targetWindow) {
  const siteUrl = String(currentProtocol(targetWindow).siteUrl || '').trim();
  if (!siteUrl) return '/';
  try {
    const url = new URL(siteUrl, targetWindow.location.origin);
    // A leading double slash would turn a path-only fetch into an external URL.
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname.startsWith('//')) return '/';
    return `${url.pathname || '/'}${url.search}`;
  } catch (_error) {
    return '/';
  }
}

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

const abortError = () => namedError('AbortError', '小组件数据请求已取消');

/**
 * One home request can serve the persistent desktop and notification center.
 * Consumers own their cancellation; the request ends when none remain.
 */
export function createDesktopWidgetDataLoader(targetWindow, {
  fetchImpl = targetWindow.fetch?.bind(targetWindow) || globalThis.fetch,
  timeoutMs = 12_000
} = {}) {
  let pendingRequest = null;

  function finish(request, error, protocol = null) {
    if (request.settled) return;
    request.settled = true;
    clearTimeout(request.timeout);
    if (pendingRequest === request) pendingRequest = null;
    for (const consumer of request.consumers) {
      consumer.signal?.removeEventListener('abort', consumer.cancel);
      if (error) consumer.reject(error);
      else consumer.resolve(protocol);
    }
    request.consumers.clear();
  }

  function startRequest() {
    const request = {
      controller: new AbortController(),
      consumers: new Set(),
      settled: false,
      timeout: null
    };
    pendingRequest = request;
    request.timeout = setTimeout(() => {
      const newer = hydratedProtocol(targetWindow);
      finish(request, newer ? null : namedError('TimeoutError', '首页小组件数据请求超时'), newer);
      request.controller.abort();
    }, timeoutMs);

    const checkActive = () => {
      if (request.settled || request.controller.signal.aborted) throw abortError();
    };
    // Subscribe before fetching, including when the caller cancels immediately.
    void Promise.resolve().then(async () => {
      checkActive();
      const response = await fetchImpl(homePath(targetWindow), {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal: request.controller.signal
      });
      checkActive();
      const current = hydratedProtocol(targetWindow);
      if (current) return current;
      if (!response.ok) throw new Error(`首页小组件数据请求失败（HTTP ${response.status}）`);
      const text = await response.text();
      checkActive();
      // A PJAX home response may have installed newer data while this body read
      // was pending. Never replace it with this older background response.
      const newer = hydratedProtocol(targetWindow);
      if (newer) return newer;
      const protocol = parseDesktopWidgetProtocolFromResponse(text);
      if (!protocol?.isHome || protocol.sources.hydrated !== true) {
        throw new Error('首页响应缺少有效的桌面小组件数据协议');
      }
      return syncHomeDesktopWidgetProtocolFromResponse(text, targetWindow);
    }).then(
      (protocol) => finish(request, null, protocol),
      (error) => {
        const newer = hydratedProtocol(targetWindow);
        finish(request, newer ? null : error, newer);
      }
    );
    return request;
  }

  return function ensureData({ signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    const cached = hydratedProtocol(targetWindow);
    if (cached) return Promise.resolve(cached);
    const request = pendingRequest || startRequest();
    return new Promise((resolve, reject) => {
      const consumer = { signal, resolve, reject, cancel: null };
      consumer.cancel = () => {
        request.consumers.delete(consumer);
        signal?.removeEventListener('abort', consumer.cancel);
        reject(abortError());
        if (!request.settled && request.consumers.size === 0) {
          finish(request, abortError());
          request.controller.abort();
        }
      };
      request.consumers.add(consumer);
      signal?.addEventListener('abort', consumer.cancel, { once: true });
    });
  };
}

export function ensureDesktopWidgetData(options = {}) {
  const targetWindow = globalThis.window;
  if (!targetWindow) return Promise.resolve(null);
  let loader = windowLoaders.get(targetWindow);
  if (!loader) {
    loader = createDesktopWidgetDataLoader(targetWindow);
    windowLoaders.set(targetWindow, loader);
  }
  return loader(options);
}
