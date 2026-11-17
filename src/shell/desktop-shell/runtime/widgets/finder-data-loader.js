import { parseDesktopWidgetProtocolFromResponse } from './protocol.js';
import { FINDER_WIDGET_SOURCES } from './source-types.js';
import { desktopWidgetRepresentation } from './data-loader.js';

const sourceFields = {
  'halo.latest_posts': ['latestPosts'],
  'halo.popular_posts': ['popularPosts'],
  'halo.categories': ['categories'],
  'halo.site_stats': ['siteStats'],
  'plugin-moments.recent': ['momentsAvailable', 'recentMoments'],
  'plugin-links.feed': ['friendsAvailable', 'recentFriends', 'friendsUrl'],
  'plugin-docsme.quick': ['docsmeAvailable', 'docsmeProjects', 'docsmeUrl'],
  'plugin-photos.gallery': ['photosAvailable', 'photos', 'photoGroupName', 'photosUrl'],
  'plugin-steam.summary': ['steamAvailable', 'steamProfile', 'steamStats', 'steamRecentGames', 'steamOwnedGames', 'steamUrl']
};
const stores = new WeakMap();
const hostRequests = new WeakMap();

function requestIdentity(widget, representation = null) {
  const type = String(widget?.widget || '');
  if (!Object.hasOwn(FINDER_WIDGET_SOURCES, type)) throw new Error('不支持的小组件数据类型');
  const group = type === 'plugin-photos.gallery' ? String(widget?.meta?.groupName || '').trim() : '';
  if (group.length > 256) throw new Error('相册标识过长');
  return { type, group, representation, key: JSON.stringify([representation?.key || '', type, group]) };
}

function requestPath(targetWindow, selections) {
  const representation = selections[0].representation;
  const path = new URL(representation.path, targetWindow.location?.origin || 'http://localhost').pathname;
  const query = new URLSearchParams();
  selections.forEach(({ type }) => query.append('widgetSource', type));
  const group = selections.find((selection) => selection.group)?.group;
  if (group) query.set('widgetPhotoGroup', group);
  if (representation.previewTheme) query.set('preview-theme', representation.previewTheme);
  return `${path}?${query}`;
}

export function createFinderWidgetDataStore(targetWindow, { fetchImpl, timeoutMs = 8000, now = Date.now, ttlMs = 300000, maxEntries = 128 } = {}) {
  const entries = new Map();
  const queued = new Map();
  let scheduled = false;

  async function fetchBatch(selections) {
    const controller = new AbortController();
    let timer;
    try {
      const protocol = await Promise.race([
        (async () => {
          const response = await (fetchImpl || globalThis.fetch)(requestPath(targetWindow, selections), {
            credentials: 'same-origin', headers: { Accept: 'text/html' }, signal: controller.signal
          });
          if (!response.ok) throw new Error(`小组件数据读取失败（HTTP ${response.status}）`);
          const text = await response.text();
          if (controller.signal.aborted) throw new Error('小组件数据请求已取消');
          const parsed = parseDesktopWidgetProtocolFromResponse(text);
          if (!/<\/html\s*>/i.test(text) || !parsed?.isHome || !parsed.sources.hydrated) throw new Error('小组件数据协议不完整');
          const representation = selections[0].representation;
          if (desktopWidgetRepresentation(targetWindow).key !== representation.key
            || (representation.themeName && parsed.themeName !== representation.themeName)) {
            throw new Error('小组件响应与当前主题表示不一致');
          }
          return parsed;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('小组件数据读取超时')); }, timeoutMs);
        })
      ]);
      for (const selection of selections) {
        const entry = entries.get(selection.key);
        if (protocol.sources.loaded?.[selection.type] !== true
          || (selection.type === 'plugin-photos.gallery' && protocol.sources.photoGroupName !== selection.group)) {
          entry.status = 'error';
          entry.error = new Error('响应缺少所请求的小组件数据');
          entry.reject(entry.error);
          continue;
        }
        entry.sources = Object.fromEntries(sourceFields[selection.type].map((field) => [field, protocol.sources[field]]));
        entry.status = 'ready';
        entry.expiresAt = now() + ttlMs;
        entry.resolve(entry);
      }
    } catch (error) {
      for (const selection of selections) {
        const entry = entries.get(selection.key);
        entry.status = 'error';
        entry.error = error;
        entry.reject(error);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function flush() {
    scheduled = false;
    const batches = new Map();
    for (const selection of queued.values()) {
      // An explicit album uses its own bounded response; other visible types
      // share one home read. Multiple sizes of the same album share its key.
      const batchKey = JSON.stringify([selection.representation.key, selection.group]);
      if (!batches.has(batchKey)) batches.set(batchKey, []);
      batches.get(batchKey).push(selection);
    }
    queued.clear();
    for (const batch of batches.values()) void fetchBatch(batch);
  }

  function get(widget) {
    const key = requestIdentity(widget, desktopWidgetRepresentation(targetWindow)).key;
    const entry = entries.get(key);
    if (entry?.status === 'ready' && entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    if (!entry && entries.size >= maxEntries && Array.from(entries.values()).every((item) => item.status === 'loading')) {
      return { status: 'error', error: new Error('小组件数据请求繁忙，请稍后重试') };
    }
    return entry || null;
  }

  function load(widget) {
    const selection = requestIdentity(widget, desktopWidgetRepresentation(targetWindow));
    const cached = get(widget);
    if (cached?.status === 'ready') return Promise.resolve(cached);
    if (cached?.status === 'loading') return cached.promise;
    if (cached?.status === 'error') return Promise.reject(cached.error);
    for (const [key, entry] of entries) {
      if (entries.size < maxEntries) break;
      if (entry.status !== 'loading') entries.delete(key);
    }
    if (entries.size >= maxEntries) return Promise.reject(new Error('小组件数据请求繁忙，请稍后重试'));
    const entry = { status: 'loading', sources: null, promise: null };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entries.set(selection.key, entry);
    queued.set(selection.key, selection);
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    return entry.promise;
  }

  function retry(widget) {
    const key = requestIdentity(widget, desktopWidgetRepresentation(targetWindow)).key;
    if (entries.get(key)?.status === 'error') entries.delete(key);
    return load(widget);
  }
  return { get, load, retry };
}

function storeFor(host) {
  if (host.finderWidgetDataStore) return host.finderWidgetDataStore;
  const owner = globalThis.window || globalThis;
  if (!stores.has(owner)) stores.set(owner, createFinderWidgetDataStore(owner));
  return stores.get(owner);
}

function watch(host, widget, promise) {
  const owner = host.widgetRenderVersions;
  if (!hostRequests.has(owner)) hostRequests.set(owner, new Map());
  const pending = hostRequests.get(owner);
  const key = requestIdentity(widget, desktopWidgetRepresentation(globalThis.window || globalThis)).key;
  if (pending.has(key)) return;
  pending.set(key, promise);
  void promise.catch(() => {}).finally(() => {
    pending.delete(key);
    if (host.widgetsDisposed === true) return;
    host.widgetRenderVersions[widget.widget] = (host.widgetRenderVersions[widget.widget] || 0) + 1;
    host._widgetHtmlCache?.clear();
    host.onWidgetDataChanged?.(widget.widget);
  });
}

export function resolveFinderWidgetSources(host, widget) {
  const store = storeFor(host);
  const entry = store.get(widget);
  if (!entry || entry.status === 'loading') watch(host, widget, entry?.promise || store.load(widget));
  return entry || { status: 'loading' };
}

export function retryFinderWidgetSources(host, widget) {
  const promise = storeFor(host).retry(widget);
  watch(host, widget, promise);
  host.widgetRenderVersions[widget.widget] = (host.widgetRenderVersions[widget.widget] || 0) + 1;
  host._widgetHtmlCache?.clear();
  host.onWidgetDataChanged?.(widget.widget);
  return promise;
}
