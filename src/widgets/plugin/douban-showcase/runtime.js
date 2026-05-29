import { createLogger } from '../../../shell/desktop-shell/runtime/shared/debug.js';

const TYPE_LABELS = {
  movie: '电影',
  book: '图书',
  music: '音乐',
  game: '游戏',
  drama: '舞台剧'
};

const STATUS_ORDER = ['doing', 'mark', 'done'];
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_PREFIX = 'theme:douban-showcase:v1:';
const DATA_CACHE = new Map();
const { warn: debugWarn } = createLogger('douban-widget');

function storedCacheKey(cacheKey) {
  return `${CACHE_PREFIX}${cacheKey}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function numberValue(value) {
  const number = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function withParams(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return `${url.pathname}${url.search}`;
}

function readStoredCache(cacheKey) {
  try {
    const raw = window.sessionStorage?.getItem(storedCacheKey(cacheKey));
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw);
    if (!payload?.data || !payload.time) {
      debugWarn('豆瓣小组件会话缓存格式无效，忽略缓存', {
        cacheKey,
        action: 'ignore-session-cache',
        hint: '检查 sessionStorage 中的豆瓣组件缓存是否被旧版本或手动脚本污染。'
      });
      return null;
    }
    const age = Date.now() - payload.time;
    if (age >= CACHE_TTL) {
      return null;
    }
    return payload.data;
  } catch (_error) {
    debugWarn('豆瓣小组件会话缓存读取失败，忽略缓存', {
      cacheKey,
      message: _error?.message || String(_error || ''),
      action: 'ignore-session-cache',
      hint: '检查浏览器隐私模式、存储权限或缓存 JSON 是否损坏。'
    });
    return null;
  }
}

function writeStoredCache(cacheKey, data) {
  try {
    window.sessionStorage?.setItem(storedCacheKey(cacheKey), JSON.stringify({
      time: Date.now(),
      data
    }));
  } catch (_error) {
    debugWarn('豆瓣小组件会话缓存写入失败，不影响页面渲染', {
      cacheKey,
      message: _error?.message || String(_error || ''),
      action: 'continue-with-memory-cache',
      hint: '检查浏览器存储权限、隐私模式或 sessionStorage 配额。'
    });
    // sessionStorage can be unavailable in private or restricted contexts.
  }
}

async function fetchJson(path, params = {}, signal) {
  const response = await fetch(withParams(path, params), {
    headers: { Accept: 'application/json' },
    signal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function pageItems(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

function pageTotal(page) {
  return Number(page?.total || pageItems(page).length || 0) || 0;
}

function itemSpec(item) {
  return item?.spec || {};
}

function itemFaves(item) {
  return item?.faves || {};
}

function itemTitle(item) {
  return normalizeText(itemSpec(item).name || item?.metadata?.name || '未命名条目');
}

function itemPoster(item) {
  return normalizeText(itemSpec(item).poster || '');
}

function itemGenres(item) {
  const genres = itemSpec(item).genres;
  if (Array.isArray(genres)) return genres.map(normalizeText).filter(Boolean);
  return normalizeText(genres).split(',').map(normalizeText).filter(Boolean);
}

function itemStatus(item) {
  return normalizeText(itemFaves(item).status || 'done');
}

function starText(score) {
  const value = numberValue(score);
  if (!value) return '未评';
  const count = Math.max(0, Math.min(5, Math.round(value)));
  return `${'★'.repeat(count)}${'☆'.repeat(5 - count)}`;
}

function itemSummary(item) {
  const spec = itemSpec(item);
  const faves = itemFaves(item);
  const genres = itemGenres(item);
  const year = normalizeText(spec.year);
  return {
    title: itemTitle(item),
    poster: itemPoster(item),
    year,
    subtitle: [year, genres.slice(0, 2).join(' / ')].filter(Boolean).join(' · ') || normalizeText(spec.cardSubtitle || ''),
    status: itemStatus(item),
    doubanScore: numberValue(spec.score),
    myScore: numberValue(faves.score),
    remark: normalizeText(faves.remark || spec.cardSubtitle || genres.join(' / ') || '还没有写下短评。'),
    link: normalizeText(spec.link || '')
  };
}

function renderPoster(item) {
  if (!item.poster) {
    return '<span class="icon-[lucide--image]" aria-hidden="true"></span>';
  }
  return `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function renderRail(items, activeIndex) {
  return items.map((item, index) => `
    <button type="button"
            class="wg-douban-thumb${index === activeIndex ? ' is-active' : ''}"
            data-douban-index="${index}"
            aria-current="${index === activeIndex ? 'true' : 'false'}"
            aria-label="${escapeHtml(item.title)}">
      ${item.poster ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="icon-[lucide--image]" aria-hidden="true"></span>'}
    </button>
  `).join('');
}

async function resolveType(root, apiBase, configuredType, signal) {
  if (configuredType && configuredType !== 'auto') return configuredType;
  const types = await fetchJson(`${apiBase}/-/types`, {}, signal).catch(() => []);
  const first = Array.isArray(types)
    ? types.find((type) => Number(type?.doubanCount || 0) > 0)
    : null;
  return normalizeText(first?.key || 'movie');
}

async function fetchCollection(apiBase, type, configuredStatus, signal) {
  const params = { page: 1, size: 6, type };
  if (configuredStatus && configuredStatus !== 'auto' && configuredStatus !== 'all') {
    params.status = configuredStatus;
  }
  let page = await fetchJson(apiBase, params, signal);
  if (configuredStatus === 'auto' && pageItems(page).length) {
    return { page, status: 'all' };
  }
  if (configuredStatus === 'auto') {
    for (const status of STATUS_ORDER) {
      page = await fetchJson(apiBase, { ...params, status }, signal);
      if (pageItems(page).length) return { page, status };
    }
  }
  return { page, status: configuredStatus === 'auto' ? 'all' : configuredStatus };
}

async function loadShowcaseData(apiBase, configuredType, configuredStatus, signal) {
  const cacheKey = [apiBase, configuredType || 'auto', configuredStatus || 'auto'].join('|');
  const cached = DATA_CACHE.get(cacheKey);
  const now = Date.now();
  if (cached?.data && now - cached.time < CACHE_TTL) {
    if (!readStoredCache(cacheKey)) {
      writeStoredCache(cacheKey, cached.data);
    }
    return cached.data;
  }
  const stored = readStoredCache(cacheKey);
  if (stored) {
    DATA_CACHE.set(cacheKey, { data: stored, time: now });
    return stored;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = (async () => {
    const type = await resolveType(null, apiBase, configuredType, signal);
    const result = await fetchCollection(apiBase, type, configuredStatus, signal);
    return {
      type,
      status: result.status,
      total: pageTotal(result.page),
      items: pageItems(result.page).map(itemSummary).filter((item) => item.title)
    };
  })();

  DATA_CACHE.set(cacheKey, { promise, time: now });
  try {
    const data = await promise;
    DATA_CACHE.set(cacheKey, { data, time: Date.now() });
    writeStoredCache(cacheKey, data);
    return data;
  } catch (error) {
    DATA_CACHE.delete(cacheKey);
    debugWarn('豆瓣小组件数据加载失败', {
      cacheKey,
      message: error?.message || String(error || ''),
      action: 'render-error-state',
      hint: '检查 plugin-douban 是否安装、公开 API 是否可访问，以及组件配置的类型/状态。'
    });
    throw error;
  }
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value;
}

function updateRailState(root, activeIndex) {
  root.querySelectorAll('[data-douban-index]').forEach((button) => {
    const active = Number(button.dataset.doubanIndex) === activeIndex;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

function showcaseDomState(root) {
  const poster = root.querySelector('[data-douban-poster]');
  const rail = root.querySelector('[data-douban-rail]');
  const title = normalizeText(root.querySelector('[data-douban-title]')?.textContent);
  return {
    hydrated: root.dataset.doubanHydrated === 'true',
    title,
    railCount: rail?.querySelectorAll('[data-douban-index]').length || 0,
    posterLoading: !!poster?.classList.contains('is-loading'),
    hasPosterContent: !!poster?.querySelector('img, span'),
    empty: root.classList.contains('is-empty'),
    error: root.classList.contains('is-error')
  };
}

function isShowcaseDomComplete(root) {
  const state = showcaseDomState(root);
  if (!state.hydrated) return false;
  if (state.empty || state.error) return !!state.title && !state.posterLoading;
  return !!state.title
    && state.title !== '书影音收藏'
    && !state.posterLoading
    && state.hasPosterContent
    && state.railCount > 0;
}

function updateActive(root, items, activeIndex, total, type, _status, options = {}) {
  const item = items[activeIndex] || items[0];
  if (!item) return;

  const typeLabel = TYPE_LABELS[type] || '书影音';
  const poster = root.querySelector('[data-douban-poster]');
  const bg = root.querySelector('[data-douban-bg]');
  const rail = root.querySelector('[data-douban-rail]');

  root.dataset.doubanActiveStatus = item.status || _status || 'done';
  setText(root, '[data-douban-heading]', `${typeLabel}收藏`);
  setText(root, '[data-douban-status-label]', '收藏精选');
  setText(root, '[data-douban-count]', `${total} 条`);
  setText(root, '[data-douban-title]', item.title);
  setText(root, '[data-douban-subtitle]', item.subtitle || typeLabel);
  setText(root, '[data-douban-score]', item.doubanScore ? `豆瓣 ${item.doubanScore.toFixed(1)}` : '豆瓣暂无评分');
  setText(root, '[data-douban-stars]', `我的评分 ${starText(item.myScore)}`);
  setText(root, '[data-douban-remark]', item.remark);

  if (poster) {
    poster.classList.toggle('is-loading', false);
    poster.classList.toggle('is-empty', !item.poster);
    if (poster.dataset.posterSrc !== item.poster) {
      poster.dataset.posterSrc = item.poster;
      poster.innerHTML = renderPoster(item);
    }
  }
  if (bg) {
    bg.style.backgroundImage = item.poster ? `url("${item.poster.replace(/"/g, '\\"')}")` : '';
  }
  if (rail && options.renderRail !== false) {
    rail.innerHTML = renderRail(items, activeIndex);
  } else {
    updateRailState(root, activeIndex);
  }
  root.dataset.doubanHydrated = 'true';
}

function handleImageError(event) {
  const image = event.target?.closest?.('img');
  if (!image) return;
  const poster = image.closest('[data-douban-poster]');
  if (poster) {
    poster.classList.add('is-empty');
    poster.innerHTML = '<span class="icon-[lucide--image]" aria-hidden="true"></span>';
    return;
  }

  const thumb = image.closest('[data-douban-index]');
  if (thumb) {
    thumb.innerHTML = '<span class="icon-[lucide--image]" aria-hidden="true"></span>';
  }
}

function mountDoubanShowcase(root) {
  if (!root) return;
  if (root.dataset.doubanShowcaseMounted === 'true') {
    if (root.dataset.doubanLoading === 'true') return;
    if (isShowcaseDomComplete(root)) return;
    debugWarn('豆瓣小组件 DOM 未完整水合，尝试重新挂载', {
      ...showcaseDomState(root),
      action: 'remount-widget',
      hint: '检查 PJAX 往返、组件 HTML 结构和 data-douban-* 标记是否完整。'
    });
    root.__doubanShowcaseCleanup?.();
    root.dataset.doubanHydrated = 'false';
  }
  root.dataset.doubanShowcaseMounted = 'true';

  if (root.dataset.doubanPreview === 'true') return;
  root.dataset.doubanLoading = 'true';

  const apiBase = normalizeText(root.dataset.doubanApi || '/apis/api.douban.moony.la/v1alpha1/doubanmovies');
  const configuredType = normalizeText(root.dataset.doubanType || 'auto');
  const configuredStatus = normalizeText(root.dataset.doubanStatus || 'auto');
  const abortController = new AbortController();
  const eventController = new AbortController();
  let items = [];
  let activeIndex = 0;
  let timer = 0;
  let resumeTimer = 0;
  let resolvedType = 'movie';
  let resolvedStatus = 'all';
  let total = 0;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const isEditingOrDragging = () => {
    const card = root.closest('.desktop-widget-card');
    return !!card?.classList.contains('is-editing') || !!card?.classList.contains('is-drag-ghost');
  };

  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
  };
  const start = () => {
    if (reduceMotion || timer || items.length <= 1 || isEditingOrDragging()) return;
    timer = window.setInterval(() => {
      if (!root.isConnected || isEditingOrDragging()) {
        stop();
        return;
      }
      activeIndex = (activeIndex + 1) % items.length;
      updateActive(root, items, activeIndex, total, resolvedType, resolvedStatus, { renderRail: false });
    }, 6000);
  };
  const pauseThenResume = () => {
    stop();
    if (resumeTimer) window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(start, 3000);
  };

  root.__doubanShowcaseCleanup = () => {
    stop();
    if (resumeTimer) window.clearTimeout(resumeTimer);
    resumeTimer = 0;
    abortController.abort();
    eventController.abort();
  };

  root.addEventListener('pointerenter', stop, { signal: eventController.signal });
  root.addEventListener('pointerleave', pauseThenResume, { signal: eventController.signal });
  root.addEventListener('focusin', stop, { signal: eventController.signal });
  root.addEventListener('focusout', pauseThenResume, { signal: eventController.signal });
  root.addEventListener('error', handleImageError, { signal: eventController.signal, capture: true });
  root.addEventListener('pointerover', (event) => {
    if (isEditingOrDragging()) return;
    const button = event.target.closest('[data-douban-index]');
    if (!button) return;
    const next = Number(button.dataset.doubanIndex);
    if (!Number.isInteger(next) || next < 0 || next >= items.length) return;
    if (next === activeIndex) return;
    activeIndex = next;
    updateActive(root, items, activeIndex, total, resolvedType, resolvedStatus, { renderRail: false });
  }, { signal: eventController.signal });

  (async () => {
    try {
      const data = await loadShowcaseData(apiBase, configuredType, configuredStatus, abortController.signal);
      resolvedType = data.type;
      resolvedStatus = data.status;
      total = data.total;
      items = data.items;

      if (!root.isConnected) return;
      if (!items.length) {
        root.classList.add('is-empty');
        setText(root, '[data-douban-heading]', `${TYPE_LABELS[resolvedType] || '书影音'} · 暂无记录`);
        setText(root, '[data-douban-title]', '还没有收藏记录');
        setText(root, '[data-douban-subtitle]', '同步豆瓣插件后会在这里展示。');
        setText(root, '[data-douban-remark]', '可以在组件配置里切换类型或状态。');
        root.dataset.doubanHydrated = 'true';
        return;
      }

      updateActive(root, items, activeIndex, total, resolvedType, resolvedStatus);
      start();
    } catch (_error) {
      if (!root.isConnected || abortController.signal.aborted) return;
      root.classList.add('is-error');
      setText(root, '[data-douban-heading]', '读取失败');
      setText(root, '[data-douban-title]', '豆瓣数据暂时不可用');
      setText(root, '[data-douban-subtitle]', '请确认 plugin-douban API 可访问。');
      setText(root, '[data-douban-remark]', '组件使用插件公开 API，不读取页面 DOM。');
      root.dataset.doubanHydrated = 'true';
    } finally {
      root.dataset.doubanLoading = 'false';
    }
  })();
}

export function enhanceDoubanShowcaseWidgets(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-douban-showcase]').forEach((node) => mountDoubanShowcase(node));
}
