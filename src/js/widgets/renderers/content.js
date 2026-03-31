import { formatCompactNumber, formatWidgetDate } from './format.js';
import {
  resolveDesktopAuthorProfile,
  selectDailyRandomTags,
  selectTopCategories
} from './data.js';

export function renderLatestPostsWidget({ sources, escapeHtml }, widget, options = {}) {
  const isPreview = options.preview === true;
  const size = widget?.size || 'medium';

  let limit = 3;
  if (size === 'small') limit = 1;
  else if (size === 'large') limit = 4;

  const posts = sources.latestPosts.slice(0, limit);

  if (!posts.length) {
    return '<div class="desktop-widget-empty">还没有可展示的文章。</div>';
  }

  let inner = '';

  if (size === 'small') {
    /* ── Small (2x2): 单篇卡片 ── */
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const date = escapeHtml(formatWidgetDate(post?.spec?.publishTime) || '');
    const cover = post?.spec?.cover || '';
    const coverStyle = cover ? `style="background-image:url('${escapeHtml(cover)}')"` : '';
    const fallbackCls = cover ? '' : ' is-fallback';
    inner = `
      <a class="wg-news-sm${fallbackCls} pjax-link" ${coverStyle} href="${escapeHtml(post?.status?.permalink || '#')}">
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
          <svg class="wg-news-sm-bookmark" viewBox="0 0 20 20" fill="currentColor"><path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z"/></svg>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${title}</strong>
          <span>${date}</span>
        </div>
      </a>
    `;
  } else if (size === 'medium') {
    /* ── Medium (4x2): 图文平衡 ── */
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const cover = post?.spec?.cover || '';
    const coverImg = cover
      ? `<img class="wg-news-md-img" src="${escapeHtml(cover)}" alt="" />`
      : '<div class="wg-news-md-img is-placeholder"></div>';

    const listPosts = posts.slice(1);
    const listHTML = listPosts.map((p) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const d = escapeHtml(formatWidgetDate(p?.spec?.publishTime) || '');
      return `
        <a class="wg-news-md-row pjax-link" href="${escapeHtml(p?.status?.permalink || '#')}">
          <span class="wg-news-md-row-title">${t}</span>
          <span class="wg-news-md-row-date">${d}</span>
        </a>
      `;
    }).join('');

    inner = `
      <a class="wg-news-md-cover pjax-link" href="${escapeHtml(post?.status?.permalink || '#')}">
        ${coverImg}
        <div class="wg-news-md-cover-scrim"></div>
      </a>
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">最新发布</span>
          <a class="wg-news-md-title pjax-link" href="${escapeHtml(post?.status?.permalink || '#')}">${title}</a>
        </div>
        <div class="wg-news-md-list">${listHTML}</div>
      </div>
    `;
  } else {
    /* ── Large (4x4): 深度列表 ── */
    const heroPost = posts[0];
    const heroTitle = escapeHtml(heroPost?.spec?.title || '未命名文章');
    const heroCover = heroPost?.spec?.cover || '';
    const coverImg = heroCover
      ? `<img class="wg-news-lg-cover-img" src="${escapeHtml(heroCover)}" alt="" />`
      : '<div class="wg-news-lg-cover-img is-placeholder"></div>';

    const listPosts = posts.slice(1);
    const listHTML = listPosts.map((p) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const d = escapeHtml(formatWidgetDate(p?.spec?.publishTime) || '');
      return `
        <a class="wg-news-lg-item pjax-link" href="${escapeHtml(p?.status?.permalink || '#')}">
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${t}</span>
          <span class="wg-news-lg-item-date">${d}</span>
        </a>
      `;
    }).join('');

    inner = `
      <div class="wg-news-lg-cover">
        ${coverImg}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">最新发布</span>
          <strong>${heroTitle}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${listHTML}
        <a class="wg-news-lg-viewall pjax-link" href="${escapeHtml(sources.archivesUrl || '/archives')}">查看全部文章 →</a>
      </div>
    `;
  }

  if (isPreview) {
    return `<div class="desktop-widget-preview-skin desktop-widget-preview-skin--latest is-${size}">${inner}</div>`;
  }
  return `<div class="desktop-widget-news-layout is-${size}">${inner}</div>`;
}

export function renderPopularPostsWidget({ sources, escapeHtml }, widget, options = {}) {
  const isPreview = options.preview === true;
  const size = widget?.size || 'medium';
  const limit = size === 'large' ? 4 : 2;
  const posts = sources.popularPosts.slice(0, limit);

  if (!posts.length) {
    return '<div class="desktop-widget-empty">热门文章暂时为空。</div>';
  }

  const maxVisit = Math.max(...posts.map((post) => post?.stats?.visit ?? 0), 1);
  const rowsHTML = posts.map((post, index) => {
    const visit = post?.stats?.visit ?? 0;
    const heatPct = Math.round((visit / maxVisit) * 100);
    return `
      <a class="desktop-widget-mac-list-row pjax-link" href="${escapeHtml(post?.status?.permalink || '#')}">
        <span class="desktop-widget-charts-rank${index < 3 ? ' is-top' : ''}">${index + 1}</span>
        <div class="desktop-widget-charts-copy">
          <strong>${escapeHtml(post?.spec?.title || '未命名文章')}</strong>
          <div class="desktop-widget-charts-bar">
            <span style="width:${heatPct}%"></span>
          </div>
        </div>
        <span class="desktop-widget-charts-visits">${escapeHtml(formatCompactNumber(visit))}</span>
      </a>
    `;
  }).join('');

  const inner = `
    <div class="desktop-widget-mac-header">
      <span class="desktop-widget-mac-icon is-popular"></span>
      <span class="desktop-widget-mac-title">热门文章</span>
    </div>
    <div class="desktop-widget-mac-list-box">
      ${rowsHTML}
    </div>
  `;

  if (isPreview) {
    return `<div class="desktop-widget-preview-skin desktop-widget-preview-skin--charts">${inner}</div>`;
  }
  return `<div class="desktop-widget-charts-layout">${inner}</div>`;
}


export function renderCategoriesWidget({ sources, escapeHtml }) {
  const categories = selectTopCategories(sources.categories, 6);
  if (!categories.length) {
    return '<div class="desktop-widget-empty">当前没有可展示的分类。</div>';
  }

  return `
    <div class="desktop-widget-mac-bento is-3x2">
      ${categories.map((category) => `
        <a class="desktop-widget-mac-btn pjax-link" href="${escapeHtml(category.permalink)}">
          <span>${escapeHtml(category.name)}</span>
          <strong>${escapeHtml(formatCompactNumber(category.count))}</strong>
        </a>
      `).join('')}
    </div>
  `;
}

export function renderAuthorCardWidget({ sources, escapeHtml }, widget) {
  const author = resolveDesktopAuthorProfile(sources);
  const avatarMarkup = author.avatar
    ? `<img class="desktop-widget-mac-avatar-img" src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.displayName)}">`
    : `<span class="desktop-widget-mac-avatar-fallback">${escapeHtml((author.displayName || 'A').slice(0, 1))}</span>`;

  if (widget?.size === 'small') {
    return `
      <div class="desktop-widget-mac-author is-small">
        <div class="desktop-widget-mac-avatar">${avatarMarkup}</div>
        <strong class="desktop-widget-mac-author-name">${escapeHtml(author.displayName)}</strong>
        <span class="desktop-widget-mac-author-bio">${escapeHtml(author.summary)}</span>
      </div>
    `;
  }

  return `
    <div class="desktop-widget-mac-author is-medium">
      <div class="desktop-widget-mac-author-profile">
        <div class="desktop-widget-mac-avatar">${avatarMarkup}</div>
        <div class="desktop-widget-mac-author-copy">
          <strong>${escapeHtml(author.displayName)}</strong>
          <span>${escapeHtml(author.summary)}</span>
        </div>
      </div>
      <div class="desktop-widget-mac-author-stats">
        <div class="desktop-widget-mac-author-stat">
          <strong>${escapeHtml(formatCompactNumber(author.posts))}</strong>
          <em>文章</em>
        </div>
        <div class="desktop-widget-mac-author-stat">
          <strong>${escapeHtml(formatCompactNumber(author.comments))}</strong>
          <em>评论</em>
        </div>
        <div class="desktop-widget-mac-author-stat">
          <strong>${escapeHtml(formatCompactNumber(author.visits))}</strong>
          <em>访问</em>
        </div>
      </div>
    </div>
  `;
}

export function renderSiteStatsWidget({ modules, sources, escapeHtml }) {
  const stats = sources.siteStats;
  if (!stats) {
    return '<div class="desktop-widget-empty">站点统计当前不可用。</div>';
  }

  return `
    <div class="desktop-widget-mac-bento is-2x2">
      <div class="desktop-widget-mac-cell">
        <strong>${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</strong>
        <em>总访问</em>
      </div>
      <div class="desktop-widget-mac-cell">
        <strong>${escapeHtml(formatCompactNumber(stats.post ?? 0))}</strong>
        <em>文章数</em>
      </div>
      <div class="desktop-widget-mac-cell">
        <strong>${escapeHtml(formatCompactNumber(stats.comment ?? 0))}</strong>
        <em>评论数</em>
      </div>
      <div class="desktop-widget-mac-cell">
        <strong>${escapeHtml(formatCompactNumber(stats.category ?? 0))}</strong>
        <em>分类数</em>
      </div>
    </div>
  `;
}

export function renderRandomTagsWidget({ sources, escapeHtml }) {
  const tags = selectDailyRandomTags(sources.randomTags, 6);
  if (!tags.length) {
    return '<div class="desktop-widget-empty">当前没有可展示的标签。</div>';
  }

  return `
    <div class="desktop-widget-mac-bento is-3x2">
      ${tags.map((tag) => `
        <a class="desktop-widget-mac-btn pjax-link" href="${escapeHtml(tag.permalink)}">
          <span>${escapeHtml(tag.name)}</span>
        </a>
      `).join('')}
    </div>
  `;
}
