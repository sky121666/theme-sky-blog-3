const PAGE_SIZE = 100;
const CONCURRENCY = 3;
const CACHE_TTL_MS = 5 * 60 * 1000;
const YEAR_LABEL = 'content.halo.run/archive-year';
const MONTH_LABEL = 'content.halo.run/archive-month';

function archiveMonth(post) {
  const labels = post?.metadata?.labels || {};
  const year = String(labels[YEAR_LABEL] || '');
  const month = String(labels[MONTH_LABEL] || '').padStart(2, '0');
  if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('文章缺少有效归档年月标签');
  }
  return { year, month, index: Number(year) * 12 + Number(month) - 1 };
}

function catalogFromCounts(counts) {
  const years = new Map();
  for (const [key, count] of [...counts].sort(([a], [b]) => b.localeCompare(a))) {
    if (!count) continue;
    const [year, month] = key.split('-');
    if (!years.has(year)) years.set(year, []);
    years.get(year).push({ month, count });
  }
  return [...years].map(([year, months]) => ({ year, months }));
}

function createAccumulator() {
  const names = new Set();
  const counts = new Map();
  return {
    add(posts) {
      for (const post of posts) {
        const name = post?.metadata?.name;
        if (typeof name !== 'string' || !name) throw new Error('文章缺少唯一标识');
        if (names.has(name)) continue;
        const { year, month } = archiveMonth(post);
        names.add(name);
        const key = `${year}-${month}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    },
    get size() { return names.size; },
    catalog: () => catalogFromCounts(counts)
  };
}

export function buildArchiveCatalog(posts = []) {
  const accumulator = createAccumulator();
  accumulator.add(posts);
  return accumulator.catalog();
}

function abortError() {
  return new DOMException('归档目录请求已取消', 'AbortError');
}

function abortable(promise, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal?.removeEventListener('abort', onAbort);
    });
  });
}

function validatePage(data, { page, size, total }) {
  // PostPublicQueryService's documented emptyResult fallback uses page/size=0.
  if (data?.total === 0 && data.page === 0 && data.size === 0 && Array.isArray(data.items)
    && data.items.length === 0 && data.totalPages === 1 && data.hasNext === false && (total == null || total === 0)) {
    return { ...data, page, size, totalPages: 0 };
  }
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0
    || data.page !== page || data.size !== size || (total != null && data.total !== total)) {
    throw new Error('归档目录分页或总数不一致，请重试');
  }
  const totalPages = Math.ceil(data.total / size);
  if (data.totalPages !== totalPages || data.items.length !== Math.max(0, Math.min(size, data.total - (page - 1) * size))
    || (typeof data.hasNext === 'boolean' && data.hasNext !== (page < totalPages))) {
    throw new Error('归档目录分页不完整，请重试');
  }
  return data;
}

async function runWorkers(length, signal, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, length) }, async () => {
    while (next < length) {
      signal.throwIfAborted();
      const index = next++;
      await task(index);
    }
  }));
}

// Halo 2.26.1 PostQueryEndpoint -> PostPublicQuery/SortableRequest supports
// labelSelector/fieldSelector and ListResult.total. There is no grouped archive
// endpoint or field projection. Count dense archives with size=1 per month;
// otherwise stream bounded pages without retaining ListedPostVo objects.
// https://github.com/halo-dev/halo/blob/v2.26.1/application/src/main/java/run/halo/app/core/endpoint/theme/PostQueryEndpoint.java
async function collectCatalog(baseUrl, fetchImpl, signal) {
  async function request({ page = 1, size = 1, order = 'desc', year, month, total } = {}) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));
    url.searchParams.delete('sort');
    url.searchParams.append('sort', `spec.publishTime,${order}`);
    url.searchParams.append('sort', `metadata.name,${order}`);
    // Match PostFinder.archives(), which explicitly excludes hidden categories.
    url.searchParams.append('fieldSelector', 'status.hideFromList!=true');
    if (year && month) {
      url.searchParams.append('labelSelector', `${YEAR_LABEL}=${year}`);
      url.searchParams.append('labelSelector', `${MONTH_LABEL}=${month}`);
    }
    signal.throwIfAborted();
    const response = await abortable(fetchImpl(url.href, {
      headers: { Accept: 'application/json' }, credentials: 'same-origin', signal
    }), signal);
    if (!response.ok || response.redirected) throw new Error(`HTTP ${response.status}`);
    const type = response.headers?.get?.('content-type') || '';
    if (type && !type.toLowerCase().includes('application/json')) throw new Error('归档目录接口未返回 JSON');
    const data = await abortable(response.json(), signal);
    return validatePage(data, { page, size, total });
  }

  const newest = await request({ size: PAGE_SIZE });
  const total = newest.total;
  if (!total) return [];
  if (total <= PAGE_SIZE) {
    const accumulator = createAccumulator();
    accumulator.add(newest.items);
    if (accumulator.size !== total) throw new Error('归档分页有重复或缺失文章，请重试');
    return accumulator.catalog();
  }
  const latest = archiveMonth(newest.items[0]);
  // Small sites need one bounded page; avoid an unnecessary oldest probe.
  const pageCount = Math.ceil(total / PAGE_SIZE);
  if (pageCount > 2) {
    const oldest = await request({ order: 'asc', total });
    const earliest = archiveMonth(oldest.items[0]);
    const monthCount = latest.index - earliest.index + 1;
    if (monthCount < 1) throw new Error('归档年月范围不一致');
    if (monthCount + 2 <= pageCount) {
      const counts = new Map();
      await runWorkers(monthCount, signal, async (offset) => {
        const index = latest.index - offset;
        const year = String(Math.floor(index / 12)).padStart(4, '0');
        const month = String(index % 12 + 1).padStart(2, '0');
        const result = await request({ year, month });
        if (result.items.length) {
          const actual = archiveMonth(result.items[0]);
          if (actual.year !== year || actual.month !== month) throw new Error('归档接口未应用年月筛选');
        }
        counts.set(`${year}-${month}`, result.total);
      });
      if ([...counts.values()].reduce((sum, count) => sum + count, 0) !== total) {
        throw new Error('归档计数在加载期间发生变化，请重试');
      }
      return catalogFromCounts(counts);
    }
  }

  const accumulator = createAccumulator();
  accumulator.add(newest.items);
  newest.items = [];
  await runWorkers(pageCount - 1, signal, async (index) => {
    const result = await request({ page: index + 2, size: PAGE_SIZE, total });
    accumulator.add(result.items);
    // Only names and month counters survive this callback, not post payloads.
  });
  if (accumulator.size !== total) throw new Error('归档分页有重复或缺失文章，请重试');
  return accumulator.catalog();
}

function validCatalog(catalog) {
  return Array.isArray(catalog) && catalog.every((entry) => /^\d{4}$/.test(entry?.year)
    && Array.isArray(entry.months) && entry.months.every(({ month, count }) => /^(0[1-9]|1[0-2])$/.test(month)
      && Number.isSafeInteger(count) && count > 0));
}

export function createArchiveCatalogLoader({
  fetchImpl = (...args) => fetch(...args),
  storage = () => window.sessionStorage,
  now = () => Date.now(),
  timeoutMs = 30000
} = {}) {
  const pending = new Map();
  const completed = new Map();
  return function load(url, { signal, force = false, scope = 'anonymous' } = {}) {
    const baseUrl = new URL(url, window.location.href).href;
    // Halo public queries include the authenticated owner's nonpublic posts.
    // Never share successful counts across server-rendered principal scopes.
    const cacheable = typeof scope === 'string' && scope.length > 0;
    const key = `theme-archive-catalog-v2:${JSON.stringify([baseUrl, scope])}`;
    if (signal?.aborted) return Promise.reject(signal.reason || abortError());
    if (!force && cacheable) {
      try {
        const cached = completed.get(key) || JSON.parse(storage()?.getItem(key) || 'null');
        const age = now() - cached?.timestamp;
        if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS && validCatalog(cached?.catalog)) {
          return Promise.resolve(cached.catalog);
        }
      } catch (_error) { /* Storage may be disabled. */ }
    }
    let job = pending.get(key);
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController();
      job = { controller, clients: 0, settled: false, promise: null };
      const timer = setTimeout(() => controller.abort(new DOMException('归档目录加载超时，请重试', 'TimeoutError')), timeoutMs);
      job.promise = collectCatalog(baseUrl, fetchImpl, controller.signal).then((catalog) => {
        controller.signal.throwIfAborted();
        const value = { timestamp: now(), catalog };
        if (cacheable) {
          completed.set(key, value);
          try { storage()?.setItem(key, JSON.stringify(value)); } catch (_error) { /* Memory cache remains usable. */ }
        }
        return catalog;
      }).catch((error) => {
        // Stop sibling workers as soon as one page fails; never cache partial counts.
        controller.abort(error);
        throw error;
      }).finally(() => {
        clearTimeout(timer);
        job.settled = true;
        if (pending.get(key) === job) pending.delete(key);
      });
      pending.set(key, job);
    }
    job.clients += 1;
    return abortable(job.promise, signal).finally(() => {
      job.clients -= 1;
      if (!job.clients && !job.settled) job.controller.abort(abortError());
    });
  };
}

export const loadArchiveCatalog = createArchiveCatalogLoader();
