import { formatWidgetDate } from '../../shared/format.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';
import { flattenCategoryTree, resolveWidgetCover } from '../../shared/data.js';

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function defaultLimitForSize(size) {
  if (size === 'small') return 1;
  if (size === 'large') return 4;
  return 3;
}

function readPostExcerpt(post, maxLength = 34) {
  const raw = post?.status?.excerpt || post?.spec?.excerpt?.raw || '';
  const normalized = String(raw || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…` : normalized;
}

function resolveCategoryFilter(sources, categoryName) {
  const requested = String(categoryName || '').trim();
  if (!requested) return null;
  const categories = flattenCategoryTree(sources?.categories || []);
  return categories.find((category) => category.key === requested) || null;
}

function postMatchesCategory(post, categoryName) {
  const specCategories = Array.isArray(post?.spec?.categories) ? post.spec.categories : [];
  if (specCategories.includes(categoryName)) return true;
  const categories = Array.isArray(post?.categories) ? post.categories : [];
  return categories.some((category) => category?.metadata?.name === categoryName);
}

export function renderWidget({ sources, escapeHtml, mode }, widget, options = {}) {
  const size = widget?.size || 'medium';
  const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
  const limit = clampInteger(meta.limit, defaultLimitForSize(size), 1, 8);
  const showSummary = meta.showSummary === true;
  const category = resolveCategoryFilter(sources, meta.categoryName);

  const sourcePosts = Array.isArray(sources.latestPosts) ? sources.latestPosts : [];
  const posts = (category ? sourcePosts.filter((post) => postMatchesCategory(post, category.key)) : sourcePosts)
    .slice(0, limit);

  if (!posts.length) {
    return '<div class="desktop-widget-empty">还没有可展示的文章。</div>';
  }

  let inner = '';

  if (size === 'small') {
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const date = escapeHtml(formatWidgetDate(post?.spec?.publishTime) || '');
    const cover = resolveWidgetCover(post?.spec?.cover, sources.fallbackCover);
    const coverMedia = cover
      ? `<img class="wg-news-sm-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`
      : '<div class="wg-news-sm-img is-placeholder"></div>';
    inner = buildWidgetPjaxLink({
      href: escapeHtml(post?.status?.permalink || '#'),
      app: 'reader',
      className: 'wg-news-sm',
      disabled: mode === 'preview',
      innerHtml: `
        ${coverMedia}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${title}</strong>
          <span>${date}</span>
        </div>
      `
    });
  } else if (size === 'medium') {
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const cover = resolveWidgetCover(post?.spec?.cover, sources.fallbackCover);
    const coverImg = cover
      ? `<img class="wg-news-md-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`
      : '<div class="wg-news-md-img is-placeholder"></div>';

    const listPosts = posts.slice(1);
    const listHTML = listPosts.map((p) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const d = escapeHtml(formatWidgetDate(p?.spec?.publishTime) || '');
      const secondary = showSummary ? escapeHtml(readPostExcerpt(p) || d) : d;
      return buildWidgetPjaxLink({
        href: escapeHtml(p?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-news-md-row',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-news-md-row-title">${t}</span>
          <span class="wg-news-md-row-date">${secondary}</span>
        `
      });
    }).join('');

    inner = `
      ${buildWidgetPjaxLink({
        href: escapeHtml(post?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-news-md-cover',
        disabled: mode === 'preview',
        innerHtml: `
          ${coverImg}
          <div class="wg-news-md-cover-scrim"></div>
        `
      })}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">${escapeHtml(category?.name || '最新发布')}</span>
          ${buildWidgetPjaxLink({
            href: escapeHtml(post?.status?.permalink || '#'),
            app: 'reader',
            className: 'wg-news-md-title',
            disabled: mode === 'preview',
            innerHtml: title
          })}
        </div>
        <div class="wg-news-md-list">${listHTML}</div>
      </div>
    `;
  } else {
    const heroPost = posts[0];
    const heroTitle = escapeHtml(heroPost?.spec?.title || '未命名文章');
    const heroCover = resolveWidgetCover(heroPost?.spec?.cover, sources.fallbackCover);
    const coverImg = heroCover
      ? `<img class="wg-news-lg-cover-img" src="${escapeHtml(heroCover)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`
      : '<div class="wg-news-lg-cover-img is-placeholder"></div>';

    const listPosts = posts.slice(1);
    const listHTML = listPosts.map((p) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const d = escapeHtml(formatWidgetDate(p?.spec?.publishTime) || '');
      const secondary = showSummary ? escapeHtml(readPostExcerpt(p, 40) || d) : d;
      return buildWidgetPjaxLink({
        href: escapeHtml(p?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-news-lg-item',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${t}</span>
          <span class="wg-news-lg-item-date">${secondary}</span>
        `
      });
    }).join('');

    inner = `
      <div class="wg-news-lg-cover">
        ${coverImg}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">${escapeHtml(category?.name || '最新发布')}</span>
          <strong>${heroTitle}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${listHTML}
        ${buildWidgetPjaxLink({
          href: escapeHtml(sources.archivesUrl || '/archives'),
          app: 'explorer-archives',
          className: 'wg-news-lg-viewall',
          disabled: mode === 'preview',
          innerHtml: '查看全部文章 →'
        })}
      </div>
    `;
  }

  return `<div class="desktop-widget-news-layout is-${size}">${inner}</div>`;
}
