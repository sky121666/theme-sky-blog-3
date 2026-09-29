/** Public Halo tag reads shared by catalog previews, drafts and saved widgets. */
export function createRandomTagsWidgetDataStore({ fetchImpl, timeoutMs = 8000, now = Date.now } = {}) {
  let entry = null;
  const ttlMs = 5 * 60 * 1000;

  function get(sources = {}) {
    // A non-empty Finder payload is already usable. An empty array can also
    // mean that the saved layout caused the server to skip the tag query.
    if (Array.isArray(sources.randomTags) && sources.randomTags.length) {
      return { status: 'ready', sources: { randomTags: sources.randomTags } };
    }
    if (entry?.status === 'ready' && entry.expiresAt <= now()) entry = null;
    return entry;
  }

  function load() {
    const cached = get();
    if (cached?.status === 'ready') return Promise.resolve(cached);
    if (cached?.status === 'loading') return cached.promise;
    if (cached?.status === 'error') return Promise.reject(cached.error);

    const controller = new AbortController();
    let timer;
    const promise = Promise.race([
      (async () => {
        const items = [];
        for (let page = 1; page <= 100; page += 1) {
          const response = await (fetchImpl || globalThis.fetch)(`/apis/api.content.halo.run/v1alpha1/tags?page=${page}&size=100`, {
            credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal
          });
          if (!response.ok) throw new Error(`标签读取失败（HTTP ${response.status}）`);
          const payload = await response.json();
          if (Number(payload?.page) !== page || !Array.isArray(payload?.items)
            || !Number.isSafeInteger(payload?.total) || payload.total < 0
            || typeof payload.hasNext !== 'boolean') throw new Error('标签响应格式无效');
          items.push(...payload.items);
          if (!payload.hasNext) return items;
          if (!payload.items.length) throw new Error('标签分页响应不完整');
        }
        throw new Error('标签分页数量超出读取范围');
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('标签读取超时'));
        }, timeoutMs);
      })
    ]).then((randomTags) => {
      entry = { status: 'ready', sources: { randomTags }, expiresAt: now() + ttlMs };
      return entry;
    }).catch((error) => {
      entry = { status: 'error', error };
      throw error;
    }).finally(() => clearTimeout(timer));
    entry = { status: 'loading', promise };
    return promise;
  }

  function retry() {
    if (entry?.status === 'error') entry = null;
    return load();
  }
  return { get, load, retry };
}

export const randomTagsWidgetDataStore = createRandomTagsWidgetDataStore();
