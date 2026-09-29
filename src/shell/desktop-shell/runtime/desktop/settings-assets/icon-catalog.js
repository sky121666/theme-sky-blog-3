import { sanitizeIconSvg } from './icon-svg.js';
import { COMMON_ICONS } from './icon-common.js';

const API_ORIGIN = 'https://api.iconify.design';
const RESULT_LIMIT = 50;
const SEARCH_LIMIT = 999;
const SEARCH_LIMIT_NOTICE = '已达到服务搜索范围，请细化关键词继续查找。';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_URL_LENGTH = 500;
const CACHE_LIMIT = 128;
const CACHE_BYTES = 4_000_000;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QUERY_ALIASES = {
  首页: 'house', 主页: 'house', 搜索: 'search', 菜单: 'menu', 用户: 'user', 头像: 'user',
  设置: 'settings', 图片: 'image', 相册: 'images', 文章: 'file-text', 文档: 'book-open',
  链接: 'link', 友链: 'link', 通知: 'bell', 太阳: 'sun', 月亮: 'moon', 调色板: 'palette',
  关于: 'info', 音乐: 'music', 视频: 'video', 邮件: 'mail', 邮箱: 'mail', 日历: 'calendar',
  标签: 'tag', 分类: 'folder', 下载: 'download', 上传: 'upload', 代码: 'code',
  导航: 'navigation', 方向: 'compass', 定位: 'map-pin', 位置: 'map-pin', 地图: 'map',
  返回: 'arrow-left', 后退: 'arrow-left', 前进: 'arrow-right', 向左: 'arrow-left', 向右: 'arrow-right',
  向上: 'arrow-up', 向下: 'arrow-down', 关闭: 'x', 确认: 'check', 编辑: 'pencil', 删除: 'trash',
  刷新: 'refresh-cw', 收藏: 'star', 喜欢: 'heart', 锁定: 'lock', 分享: 'share', 图标: 'shapes', 下雪: 'snowflake',
};
const cache = new Map();
const inFlight = new Map();
const waitingSlots = [];
let cachedBytes = 0;
let activeRequests = 0;

/** Common UI labels only; unknown words are preserved, not machine translated. */
export function normalizeIconQuery(query) {
  const value = typeof query === 'string' ? query.trim().slice(0, 120).toLowerCase() : '';
  return value.split(/\s+/).map((word) => Object.hasOwn(QUERY_ALIASES, word) ? QUERY_ALIASES[word] : word).join(' ');
}

function iconError(message, code, name = 'Error') {
  return Object.assign(new Error(message), { code, name });
}
const aborted = () => iconError('图标加载已取消。', 'ICON_ABORTED', 'AbortError');
const invalid = () => iconError('图标服务返回的数据格式无效。', 'ICON_INVALID_RESPONSE');
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validName = (value) => typeof value === 'string' && value.length <= 100 && NAME.test(value);
const validIcon = (value) => typeof value === 'string' && value.length <= 180 && ICON_NAME.test(value);

async function boundedRequest(signal, operation) {
  if (signal?.aborted) throw aborted();
  const controller = new AbortController();
  const abort = () => controller.abort(aborted());
  signal?.addEventListener('abort', abort, { once: true });
  let rejectAbort;
  const interrupted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(iconError('图标加载超时，请重试。', 'ICON_TIMEOUT', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    return await Promise.race([operation(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
    controller.abort(aborted());
  }
}

function evict(key) {
  const entry = cache.get(key);
  if (entry) cachedBytes -= entry.bytes;
  cache.delete(key);
}
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return;
  if (entry.expires <= Date.now()) { evict(key); return; }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}
function cacheValue(key, value, ttl, bytes) {
  if (bytes > CACHE_BYTES) return;
  evict(key);
  cache.set(key, { value, expires: Date.now() + ttl, bytes });
  cachedBytes += bytes;
  while (cache.size > CACHE_LIMIT || cachedBytes > CACHE_BYTES) evict(cache.keys().next().value);
}

// A shared transport slot also bounds simultaneous requests from different subscribers.
function drainSlots() {
  while (activeRequests < 3 && waitingSlots.length) {
    const item = waitingSlots.shift();
    item.signal.removeEventListener('abort', item.abort);
    if (item.signal.aborted) { item.reject(item.signal.reason); continue; }
    activeRequests++;
    item.resolve(() => { activeRequests--; drainSlots(); });
  }
}
function acquireSlot(signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const item = { signal, resolve, reject, abort: null };
    item.abort = () => {
      const index = waitingSlots.indexOf(item);
      if (index >= 0) waitingSlots.splice(index, 1);
      reject(signal.reason);
    };
    waitingSlots.push(item);
    signal.addEventListener('abort', item.abort, { once: true });
    drainSlots();
  });
}
async function readJson(url, signal, maxLength) {
  const release = await acquireSlot(signal);
  try {
    if (signal.aborted) throw signal.reason;
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (!response.ok) throw iconError(`图标服务暂时不可用（${response.status}），请重试。`, 'ICON_NETWORK_ERROR');
    const text = await response.text();
    if (signal.aborted) throw signal.reason;
    if (text.length > maxLength) throw invalid();
    try { return { data: JSON.parse(text), bytes: text.length * 2 }; }
    catch (error) { if (error?.code) throw error; throw invalid(); }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error?.code?.startsWith('ICON_')) throw error;
    throw iconError('无法连接图标服务，请检查网络后重试。', 'ICON_NETWORK_ERROR');
  } finally { release(); }
}

// Each caller owns one subscription. Cancel the network only when its last subscriber leaves.
function sharedJson(url, signal, validate, { ttl = 300_000, maxLength = 1_000_000, cacheable = () => true } = {}) {
  if (signal.aborted) return Promise.reject(signal.reason);
  const cached = getCached(url);
  if (cached !== undefined) return Promise.resolve(cached);
  let job = inFlight.get(url);
  if (!job || job.controller.signal.aborted) {
    job = { controller: new AbortController(), subscribers: new Set(), settled: false, promise: null };
    inFlight.set(url, job);
    job.promise = Promise.resolve().then(async () => {
      const { data, bytes } = await readJson(url, job.controller.signal, maxLength);
      const value = validate(data);
      if (job.controller.signal.aborted) throw job.controller.signal.reason;
      if (job.subscribers.size && cacheable(value)) cacheValue(url, value, ttl, bytes);
      return value;
    }).finally(() => {
      job.settled = true;
      if (inFlight.get(url) === job) inFlight.delete(url);
    });
  }
  return new Promise((resolve, reject) => {
    const subscriber = {};
    job.subscribers.add(subscriber);
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      job.subscribers.delete(subscriber);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
      if (!job.settled && !job.subscribers.size) {
        job.controller.abort(signal.reason);
        if (inFlight.get(url) === job) inFlight.delete(url);
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    job.promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

function parseCollections(data) {
  if (!record(data)) throw invalid();
  const collections = [];
  for (const [prefix, info] of Object.entries(data)) {
    if (!validName(prefix) || !record(info) || info.hidden === true || typeof info.name !== 'string' || !info.name.trim()
      || !Number.isSafeInteger(info.total) || info.total < 0) continue;
    const item = { prefix, name: info.name.slice(0, 120), total: info.total, palette: info.palette === true };
    if (record(info.license) && typeof info.license.title === 'string') {
      item.license = { title: info.license.title.slice(0, 150) };
      if (typeof info.license.spdx === 'string') item.license.spdx = info.license.spdx.slice(0, 80);
      if (typeof info.license.url === 'string' && /^https:\/\//.test(info.license.url)) item.license.url = info.license.url.slice(0, 500);
    }
    collections.push(item);
  }
  if (!collections.length) throw invalid();
  return { collections: collections.sort((a, b) => a.name.localeCompare(b.name)) };
}
export function listIconCollections({ signal } = {}) {
  return boundedRequest(signal, (requestSignal) => sharedJson(`${API_ORIGIN}/collections`, requestSignal, parseCollections,
    { ttl: 1_800_000, maxLength: 2_000_000 }));
}

function parseCollection(data, prefix) {
  if (!record(data) || data.prefix !== prefix || (!record(data.categories) && !Array.isArray(data.uncategorized))) throw invalid();
  const groups = [...Object.values(data.categories || {}), data.uncategorized || []];
  if (!groups.every(Array.isArray)) throw invalid();
  const names = [...new Set(groups.flat().filter(validName))];
  return { names: names.map((name) => `${prefix}:${name}`), total: names.length };
}
function parseSearch(data, collection, start, limit) {
  if (!record(data) || !Array.isArray(data.icons) || data.start !== start || data.limit !== limit
    || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > limit
    || data.icons.length > limit - start) throw invalid();
  const matches = [...new Set(data.icons.filter((name) => validIcon(name) && (!collection || name.startsWith(`${collection}:`))))];
  // Official API caps cumulative search results at `limit`, then returns names.slice(start).
  // Request one extra name to establish another page without downloading its SVG.
  return {
    names: matches.slice(0, RESULT_LIMIT), total: null, hasMore: matches.length > RESULT_LIMIT,
    notice: limit === SEARCH_LIMIT && data.total === SEARCH_LIMIT ? SEARCH_LIMIT_NOTICE : '',
  };
}

// Merge alias geometry as described by the IconifyJSON format: flips XOR, rotations add.
function resolveData(data, name, seen = new Set()) {
  if (seen.size >= 32 || seen.has(name)) return null;
  seen.add(name);
  const icon = Object.hasOwn(data.icons, name) ? data.icons[name] : null;
  const alias = record(data.aliases) && Object.hasOwn(data.aliases, name) ? data.aliases[name] : null;
  let result;
  if (record(icon) && typeof icon.body === 'string') result = { ...data, ...icon };
  else if (record(alias) && validName(alias.parent)) {
    const parent = resolveData(data, alias.parent, seen);
    if (!parent) return null;
    result = { ...parent, ...alias, body: parent.body, hFlip: !!parent.hFlip !== !!alias.hFlip,
      vFlip: !!parent.vFlip !== !!alias.vFlip, rotate: (parent.rotate || 0) + (alias.rotate || 0) };
  } else return null;
  return result;
}
function renderData(data, name) {
  const icon = resolveData(data, name);
  if (!icon) return '';
  const left = icon.left ?? 0; const top = icon.top ?? 0;
  const width = icon.width ?? 16; const height = icon.height ?? 16;
  if (![left, top, width, height].every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000)
    || width <= 0 || height <= 0 || !Number.isInteger(icon.rotate || 0)) return '';
  const turns = ((icon.rotate || 0) % 4 + 4) % 4;
  let viewBox = `${left} ${top} ${width} ${height}`;
  let body = icon.body;
  if (turns || icon.hFlip || icon.vFlip) {
    const sx = icon.hFlip ? -1 : 1; const sy = icon.vFlip ? -1 : 1;
    const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][turns];
    const a = cos * sx; const b = sin * sx; const c = -sin * sy; const d = cos * sy;
    const points = [[left, top], [left + width, top], [left, top + height], [left + width, top + height]];
    const e = -Math.min(...points.map(([x, y]) => a * x + c * y));
    const f = -Math.min(...points.map(([x, y]) => b * x + d * y));
    body = `<g transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})">${body}</g>`;
    viewBox = `0 0 ${turns % 2 ? height : width} ${turns % 2 ? width : height}`;
  }
  return sanitizeIconSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`);
}
function batchURL(prefix, names) {
  return `${API_ORIGIN}/${prefix}.json?${new URLSearchParams({ icons: names.join(',') })}`;
}
function batchesFor(names) {
  const groups = new Map();
  for (const fullName of names) {
    const [prefix, name] = fullName.split(':');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(name);
  }
  const batches = [];
  for (const [prefix, group] of groups) {
    let names = [];
    for (const name of group.sort()) {
      if (names.length && batchURL(prefix, [...names, name]).length > MAX_URL_LENGTH) {
        batches.push({ prefix, names, url: batchURL(prefix, names) }); names = [];
      }
      names.push(name);
    }
    if (names.length) batches.push({ prefix, names, url: batchURL(prefix, names) });
  }
  return batches;
}
function parseBatch(data, batch) {
  if (!record(data) || data.prefix !== batch.prefix || !record(data.icons)) throw invalid();
  const icons = []; const failures = [];
  for (const name of batch.names) {
    const svg = renderData(data, name);
    if (svg) icons.push({ name: `${batch.prefix}:${name}`, svg });
    else failures.push(iconError('图标服务返回了缺失或无法安全显示的 SVG。', 'ICON_INVALID_SVG'));
  }
  return { icons, failures };
}

function resultState(icons, total, page, normalizedQuery, hasMore = false, skippedCount = 0, extraNotice = '') {
  return { icons, total, totalKnown: Number.isSafeInteger(total) && total >= 0, hasMore, page, normalizedQuery, skippedCount,
    notice: [skippedCount ? '部分图标暂时无法加载，可重试。' : '', extraNotice].filter(Boolean).join(' ') };
}
function reportProgress(callback, value, signal) {
  if (!signal.aborted && typeof callback === 'function') {
    // Rendering callbacks do not own or cancel the shared transport.
    try { callback(value); } catch { /* The consumer handles its own rendering errors. */ }
  }
}
async function loadIcons(found, page, keyword, signal, onProgress) {
  const available = new Map(); const failures = [];
  const batches = batchesFor(found.names);
  const palette = new Map(getCached(`${API_ORIGIN}/collections`)?.collections.map((item) => [item.prefix, item.palette]) || []);
  const snapshot = () => resultState(found.names.map((name) => available.get(name)).filter(Boolean), found.total, page, keyword,
    found.hasMore, failures.length, found.notice);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (next < batches.length) {
      if (signal.aborted) throw signal.reason;
      const batch = batches[next++];
      try {
        const data = await sharedJson(batch.url, signal, (data) => parseBatch(data, batch),
          { ttl: 600_000, cacheable: (value) => !value.failures.length });
        if (signal.aborted) throw signal.reason;
        for (const icon of data.icons) available.set(icon.name, { ...icon, palette: palette.get(batch.prefix) });
        failures.push(...data.failures);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        failures.push(...batch.names.map(() => error));
      }
      reportProgress(onProgress, snapshot(), signal);
    }
  }));
  if (!available.size && failures.length) throw failures[0];
  return snapshot();
}

export async function searchIcons({ query = '', collection = '', page = 1, signal, onProgress } = {}) {
  const keyword = normalizeIconQuery(query);
  if (collection && !validName(collection)) throw iconError('图标集合名称无效。', 'ICON_INVALID_COLLECTION');
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  return boundedRequest(signal, async (requestSignal) => {
    if (!collection && !keyword) {
      const icons = currentPage === 1 ? COMMON_ICONS.map((icon) => ({ name: icon.name,
        svg: sanitizeIconSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${icon.body}</svg>`), palette: false })).filter((icon) => icon.svg) : [];
      const result = resultState(icons, COMMON_ICONS.length, currentPage, keyword);
      reportProgress(onProgress, result, requestSignal);
      return result;
    }
    const start = (currentPage - 1) * RESULT_LIMIT;
    let found;
    if (validIcon(keyword)) {
      const matches = (!collection || keyword.startsWith(`${collection}:`));
      found = { names: matches && currentPage === 1 ? [keyword] : [], total: matches ? 1 : 0, hasMore: false };
    } else if (!keyword) {
      const params = new URLSearchParams({ prefix: collection });
      const index = await sharedJson(`${API_ORIGIN}/collection?${params}`, requestSignal, (data) => parseCollection(data, collection),
        { ttl: 600_000, maxLength: 2_000_000 });
      found = { names: index.names.slice(start, start + RESULT_LIMIT), total: index.total, hasMore: index.total > start + RESULT_LIMIT };
    } else if (start >= SEARCH_LIMIT) {
      found = { names: [], total: null, hasMore: false, notice: SEARCH_LIMIT_NOTICE };
    } else {
      const limit = Math.min(start + RESULT_LIMIT + 1, SEARCH_LIMIT);
      const params = new URLSearchParams({ query: keyword, limit: String(limit), start: String(start) });
      if (collection) params.set('prefix', collection);
      found = await sharedJson(`${API_ORIGIN}/search?${params}`, requestSignal, (data) => parseSearch(data, collection, start, limit));
    }
    if (requestSignal.aborted) throw requestSignal.reason;
    return loadIcons(found, currentPage, keyword, requestSignal, onProgress);
  });
}
