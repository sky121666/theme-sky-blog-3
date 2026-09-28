import { parseBangumiIntegerField as integerField, parseBangumiPagePayload } from '../../../shared/bangumi-page-payload.js';

export { parseBangumiPagePayload };

export async function fetchBangumiPagePayload(query, options = {}) {
  const expected = {
    typeNum: integerField(query?.typeNum, 'typeNum', [1, 2]),
    status: integerField(query?.status, 'status', [0, 1, 2, 3]),
    size: integerField(query?.size, 'size')
  };
  if (expected.size < 1) throw new Error('Invalid Bangumi request size');
  const url = `/bangumis?typeNum=${expected.typeNum}&status=${expected.status}&size=${expected.size}`;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.max(1, Math.min(30000, Number(options.timeoutMs) || 8000));
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Bangumi widget HTTP ${response.status}`);
        return parseBangumiPagePayload(await response.text(), expected);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Bangumi widget request timed out'));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const STATUS_NUMBERS = { watching: 2, wish: 1, done: 3 };
const STATUS_ORDER = ['watching', 'wish', 'done'];

function widgetSelection(widget) {
  const typeNum = ['1', '2'].includes(String(widget?.meta?.typeNum || ''))
    ? String(widget.meta.typeNum)
    : '';
  const status = Object.hasOwn(STATUS_NUMBERS, widget?.meta?.status)
    ? String(widget.meta.status)
    : 'auto';
  return { typeNum, status, large: widget?.size === 'large' };
}

function selectionKey(widget) {
  const selection = widgetSelection(widget);
  return `${selection.typeNum || 'auto'}:${selection.status}:${selection.large ? 'large' : 'compact'}`;
}

export function createBangumiWidgetDataStore(options = {}) {
  const fetchPage = options.fetchPage || fetchBangumiPagePayload;
  const now = options.now || Date.now;
  const ttlMs = Math.max(1000, Number(options.ttlMs) || 5 * 60 * 1000);
  const combinations = new Map();
  const selections = new Map();

  function getCombination(typeNum, status) {
    const query = { typeNum, status: STATUS_NUMBERS[status], size: 4 };
    const key = `${typeNum}:${query.status}:4`;
    const cached = combinations.get(key);
    if (cached?.status === 'loading') return cached.promise;
    if (cached?.status === 'error') return Promise.reject(cached.error);
    if (cached?.status === 'ready' && cached.expiresAt > now()) return Promise.resolve(cached.payload);

    const promise = Promise.resolve()
      .then(() => fetchPage(query))
      .then((payload) => {
        // Injected fetchers still need the same identity and shape guarantees.
        if (
          Number(payload?.typeNum) !== typeNum
          || Number(payload?.status) !== query.status
          || Number(payload?.size) !== query.size
          || !Number.isSafeInteger(Number(payload?.total))
          || Number(payload.total) < 0
          || !Array.isArray(payload?.items)
        ) throw new Error('Bangumi widget payload identity does not match request');
        const normalized = { ...query, total: Number(payload.total), items: payload.items };
        combinations.set(key, { status: 'ready', payload: normalized, expiresAt: now() + ttlMs });
        return normalized;
      })
      .catch((error) => {
        combinations.set(key, { status: 'error', error });
        throw error;
      });
    combinations.set(key, { status: 'loading', promise });
    return promise;
  }

  function get(widget) {
    const key = selectionKey(widget);
    const entry = selections.get(key) || null;
    if (entry?.status === 'ready' && entry.expiresAt <= now()) {
      selections.delete(key);
      return null;
    }
    return entry;
  }

  function load(widget) {
    const key = selectionKey(widget);
    const existing = get(widget);
    if (existing?.status === 'ready') return Promise.resolve(existing);
    if (existing?.status === 'loading') return existing.promise;
    if (existing?.status === 'error') return Promise.reject(existing.error);

    const selection = widgetSelection(widget);
    const source = {
      bangumisByStatus: {},
      bangumiStatusCounts: {},
      bangumiStatusKnown: {}
    };
    const record = (typeNum, status, payload) => {
      const typeKey = typeNum === 2 ? 'drama' : 'anime';
      (source.bangumisByStatus[typeKey] ||= {})[status] = payload.items;
      (source.bangumiStatusCounts[typeKey] ||= {})[status] = payload.total;
      (source.bangumiStatusKnown[typeKey] ||= {})[status] = true;
    };

    const promise = (async () => {
      const types = selection.typeNum ? [Number(selection.typeNum)] : [1, 2];
      const statuses = selection.status === 'auto' ? STATUS_ORDER : [selection.status];
      for (const typeNum of types) {
        if (selection.large && selection.status === 'auto') {
          const payloads = await Promise.all(statuses.map((status) => getCombination(typeNum, status)));
          payloads.forEach((payload, index) => record(typeNum, statuses[index], payload));
          if (payloads.some((payload) => payload.items.length)) break;
          continue;
        }
        let found = false;
        for (const status of statuses) {
          const payload = await getCombination(typeNum, status);
          record(typeNum, status, payload);
          if (payload.items.length) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      const ready = { status: 'ready', sources: source, expiresAt: now() + ttlMs };
      selections.set(key, ready);
      return ready;
    })().catch((error) => {
      selections.set(key, { status: 'error', error });
      throw error;
    });
    selections.set(key, { status: 'loading', promise });
    return promise;
  }

  function retry(widget) {
    for (const [key, entry] of combinations) {
      if (entry.status === 'error') combinations.delete(key);
    }
    for (const [key, entry] of selections) {
      if (entry.status === 'error') selections.delete(key);
    }
    selections.delete(selectionKey(widget));
    return load(widget);
  }

  return { get, load, retry };
}

export const bangumiWidgetDataStore = createBangumiWidgetDataStore();
