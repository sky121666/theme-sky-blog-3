import { parseBangumiPagePayload } from '../../shared/bangumi-page-payload.js';

const CACHE_TTL_MS = 60_000;
const totals = new Map();
const cacheKey = (typeNum, status) => `${typeNum}:${status}`;
const validStatus = (value) => /^[0-3]$/.test(String(value));

function showTotal(badge, total) {
  badge.textContent = String(total);
  badge.dataset.countState = 'ready';
  badge.title = '';
}

function showUnavailable(badge) {
  badge.textContent = '—';
  badge.dataset.countState = 'failed';
  badge.title = '数量暂不可用';
}

export function startBangumisStatusCounts(root, { typeNum, fetchPage = fetch, clock = Date.now, timeoutMs = 10_000 } = {}) {
  const badges = Array.from(root.querySelectorAll('[data-bangumis-status-count]'));
  const pending = badges.filter((badge) => badge.dataset.countState === 'pending'
    && validStatus(badge.dataset.bangumisStatusCount));
  const activeRequests = new Set();
  let cancelled = false;
  const cancelledValue = Symbol('cancelled');
  let finishCancellation;
  const cancelledRequest = new Promise((resolve) => { finishCancellation = resolve; });
  const isActive = (badge) => !cancelled
    && root.isConnected !== false && badge.isConnected !== false
    && badge.dataset.countState === 'pending';
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const request of activeRequests) request.abort();
    finishCancellation(cancelledValue);
  };
  const normalizedType = Number(typeNum);
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;

  if (![1, 2].includes(normalizedType)) {
    pending.filter(isActive).forEach(showUnavailable);
    return { done: Promise.resolve(), cancel };
  }

  for (const badge of badges) {
    const status = badge.dataset.bangumisStatusCount;
    if (badge.dataset.countState !== 'ready' || !validStatus(status)) continue;
    const value = String(badge.textContent || '').trim();
    if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
      totals.set(cacheKey(normalizedType, status), { total: Number(value), savedAt: clock() });
    }
  }

  const queued = [];
  for (const badge of pending) {
    const status = Number(badge.dataset.bangumisStatusCount);
    const cached = totals.get(cacheKey(normalizedType, status));
    const age = cached ? clock() - cached.savedAt : Infinity;
    if (age >= 0 && age < CACHE_TTL_MS) {
      if (isActive(badge)) showTotal(badge, cached.total);
    } else {
      queued.push({ badge, status });
    }
  }

  let next = 0;
  async function worker() {
    while (!cancelled && root.isConnected !== false && next < queued.length) {
      const { badge, status } = queued[next++];
      const query = new URLSearchParams({
        typeNum: String(normalizedType), status: String(status), page: '1', size: '1'
      });
      const requestController = new AbortController();
      activeRequests.add(requestController);
      let timer;
      try {
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => {
            requestController.abort();
            reject(new Error('Bangumi count request timed out'));
          }, deadlineMs);
        });
        const request = (async () => {
          const response = await fetchPage(`/bangumis?${query}`, {
            credentials: 'same-origin', redirect: 'error', signal: requestController.signal
          });
          if (!response?.ok) throw new Error(`Bangumi count HTTP ${response?.status ?? 'unknown'}`);
          return parseBangumiPagePayload(await response.text(), {
            typeNum: normalizedType, status, size: 1
          });
        })();
        const payload = await Promise.race([request, deadline, cancelledRequest]);
        if (payload === cancelledValue) return;
        if (isActive(badge)) {
          totals.set(cacheKey(normalizedType, status), { total: payload.total, savedAt: clock() });
          showTotal(badge, payload.total);
        }
      } catch (_error) {
        if (isActive(badge)) showUnavailable(badge);
      } finally {
        clearTimeout(timer);
        activeRequests.delete(requestController);
      }
    }
  }

  const done = Promise.all(Array.from({ length: Math.min(2, queued.length) }, () => worker())).then(() => undefined);
  return { done, cancel };
}
