const TYPE_LABELS = {
  movie: '电影',
  book: '图书',
  music: '音乐',
  game: '游戏',
  drama: '舞台剧'
};

const STATUS_ORDER = ['doing', 'mark', 'done'];
const CACHE_TTL = 5 * 60 * 1000;
const DATA_CACHE = new Map();

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
  return `<img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function renderRail(items, activeIndex) {
  return items.map((item, index) => `
    <button type="button"
            class="wg-douban-thumb${index === activeIndex ? ' is-active' : ''}"
            data-douban-index="${index}"
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
    return cached.data;
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
    return data;
  } catch (error) {
    DATA_CACHE.delete(cacheKey);
    throw error;
  }
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value;
}

function updateRailState(root, activeIndex) {
  root.querySelectorAll('[data-douban-index]').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.doubanIndex) === activeIndex);
  });
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
    poster.innerHTML = renderPoster(item);
  }
  if (bg) {
    bg.style.backgroundImage = item.poster ? `url("${item.poster.replace(/"/g, '\\"')}")` : '';
  }
  if (rail && options.renderRail !== false) {
    rail.innerHTML = renderRail(items, activeIndex);
  } else {
    updateRailState(root, activeIndex);
  }
}

function mountDoubanShowcase(root) {
  if (!root || root.dataset.doubanShowcaseMounted === 'true') return;
  root.dataset.doubanShowcaseMounted = 'true';

  if (root.dataset.doubanPreview === 'true') return;

  const apiBase = normalizeText(root.dataset.doubanApi || '/apis/api.douban.moony.la/v1alpha1/doubanmovies');
  const configuredType = normalizeText(root.dataset.doubanType || 'auto');
  const configuredStatus = normalizeText(root.dataset.doubanStatus || 'auto');
  const abortController = new AbortController();
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

  root.addEventListener('pointerenter', stop);
  root.addEventListener('pointerleave', pauseThenResume);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', pauseThenResume);
  root.addEventListener('pointerover', (event) => {
    if (isEditingOrDragging()) return;
    const button = event.target.closest('[data-douban-index]');
    if (!button) return;
    const next = Number(button.dataset.doubanIndex);
    if (!Number.isInteger(next) || next < 0 || next >= items.length) return;
    activeIndex = next;
    updateActive(root, items, activeIndex, total, resolvedType, resolvedStatus, { renderRail: false });
  });

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
    }
  })();
}

export function enhanceDoubanShowcaseWidgets(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-douban-showcase]').forEach((node) => mountDoubanShowcase(node));
}
