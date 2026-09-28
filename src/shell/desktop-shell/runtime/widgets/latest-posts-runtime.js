const WIDGET_TYPE = 'halo.latest_posts';
const REQUEST_TIMEOUT_MS = 8_000;
const hostCategoryStates = new WeakMap();
const pendingRequests = new Map();

export function disposeLatestPostsSources(host) {
  hostCategoryStates.delete(host.widgetRenderVersions);
}

// Halo 2.26.1 CategoryQueryEndpoint: GET categories/{name}/posts accepts
// PostPublicQuery (page/size/sort) and filters spec.categories by metadata.name.
// https://github.com/halo-dev/halo/blob/v2.26.1/application/src/main/java/run/halo/app/core/endpoint/theme/CategoryQueryEndpoint.java
export function fetchLatestPostsByCategory(categoryName, options = {}) {
  const name = String(categoryName || '').trim();
  if (!name) return Promise.resolve([]);
  if (pendingRequests.has(name)) return pendingRequests.get(name);

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const query = new URLSearchParams({ page: '1', size: '8', sort: 'spec.publishTime,desc' });
  const request = Promise.resolve().then(async () => {
    const response = await fetch(
      `/apis/api.content.halo.run/v1alpha1/categories/${encodeURIComponent(name)}/posts?${query}`,
      { credentials: 'omit', headers: { Accept: 'application/json' }, signal: controller.signal }
    );
    if (!response.ok) throw new Error(`Category posts request failed: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.items)) throw new Error('Category posts response is invalid');
    return payload.items;
  }).finally(() => {
    clearTimeout(timeout);
    pendingRequests.delete(name);
  });
  pendingRequests.set(name, request);
  return request;
}

export function resolveLatestPostsSources(host, widget) {
  const name = String(widget?.meta?.categoryName || '').trim();
  if (widget?.widget !== WIDGET_TYPE || !name) return host.sources;

  // Both desktop and notification hosts retain this object between renders.
  // Each category owns its state; a late A response cannot replace category B.
  const owner = host.widgetRenderVersions;
  let states = hostCategoryStates.get(owner);
  if (!states) {
    states = new Map();
    hostCategoryStates.set(owner, states);
  }
  let entry = states.get(name);
  if (!entry) {
    entry = { status: 'loading', items: [] };
    states.set(name, entry);
    entry.promise = fetchLatestPostsByCategory(name)
      .then((items) => {
        entry.items = items;
        entry.status = 'ready';
      })
      .catch(() => {
        entry.status = 'error';
      })
      .finally(() => {
        if (hostCategoryStates.get(owner) !== states) return;
        host.widgetRenderVersions[WIDGET_TYPE] = (host.widgetRenderVersions[WIDGET_TYPE] || 0) + 1;
        host._widgetHtmlCache?.clear();
        host.onWidgetRendererReady?.(WIDGET_TYPE);
      });
  }
  return {
    ...host.sources,
    latestPosts: entry.items,
    latestPostsCategory: { name, status: entry.status }
  };
}
