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

  let limit = 3;
  if (size === 'small') limit = 1;
  else if (size === 'large') limit = 5;

  const posts = sources.popularPosts.slice(0, limit);

  if (!posts.length) {
    return '<div class="desktop-widget-empty">热门文章暂时为空。</div>';
  }

  const maxVisit = Math.max(...posts.map((p) => p?.stats?.visit ?? 0), 1);
  let inner = '';

  if (size === 'small') {
    /* ── Small (2x2): 热度磁贴 ── */
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const visit = post?.stats?.visit ?? 0;
    const cover = post?.spec?.cover || '';
    const coverStyle = cover
      ? `style="background-image:url('${escapeHtml(cover)}')"` : '';
    const fallbackCls = cover ? '' : ' is-no-cover';

    inner = `
      <a class="wg-hot-sm${fallbackCls} pjax-link" ${coverStyle} href="${escapeHtml(post?.status?.permalink || '#')}">
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${title}</h3>
          <span class="wg-hot-sm-visits">${escapeHtml(formatCompactNumber(visit))} 阅读</span>
        </div>
      </a>
    `;
  } else if (size === 'medium') {
    /* ── Medium (4x2): 热榜列表 ── */
    const rowsHTML = posts.map((post, i) => {
      const t = escapeHtml(post?.spec?.title || '未命名文章');
      const visit = post?.stats?.visit ?? 0;
      const heatPct = Math.round((visit / maxVisit) * 100);
      return `
        <a class="wg-hot-md-row pjax-link" href="${escapeHtml(post?.status?.permalink || '#')}">
          <span class="wg-hot-md-rank${i < 3 ? ' is-top' : ''}">${String(i + 1).padStart(2, '0')}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${t}</span>
            <div class="wg-hot-md-bar"><span style="width:${heatPct}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${escapeHtml(formatCompactNumber(visit))}</span>
        </a>
      `;
    }).join('');

    inner = `
      <div class="wg-hot-md-head">
        <svg class="wg-hot-md-icon" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${rowsHTML}</div>
    `;
  } else {
    /* ── Large (4x4): 焦点图 + 排行榜 ── */
    const heroPost = posts[0];
    const heroTitle = escapeHtml(heroPost?.spec?.title || '未命名文章');
    const heroCover = heroPost?.spec?.cover || '';
    const heroVisit = heroPost?.stats?.visit ?? 0;
    const coverImg = heroCover
      ? `<img class="wg-hot-lg-cover-img" src="${escapeHtml(heroCover)}" alt="" />`
      : '<div class="wg-hot-lg-cover-img is-placeholder"></div>';

    const listHTML = posts.slice(1).map((p, i) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const visit = p?.stats?.visit ?? 0;
      const heatPct = Math.round((visit / maxVisit) * 100);
      return `
        <a class="wg-hot-lg-row pjax-link" href="${escapeHtml(p?.status?.permalink || '#')}">
          <span class="wg-hot-lg-rank${i < 2 ? ' is-top' : ''}">${String(i + 2).padStart(2, '0')}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${t}</span>
            <div class="wg-hot-lg-bar"><span style="width:${heatPct}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${escapeHtml(formatCompactNumber(visit))}</span>
        </a>
      `;
    }).join('');

    inner = `
      <div class="wg-hot-lg-hero">
        <a class="wg-hot-lg-cover pjax-link" href="${escapeHtml(heroPost?.status?.permalink || '#')}">
          ${coverImg}
          <div class="wg-hot-lg-cover-scrim"></div>
          <div class="wg-hot-lg-cover-text">
            <span class="wg-hot-lg-badge">
              <svg viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
              TOP 1
            </span>
            <strong>${heroTitle}</strong>
            <span class="wg-hot-lg-hero-visits">${escapeHtml(formatCompactNumber(heroVisit))} 阅读</span>
          </div>
        </a>
      </div>
      <div class="wg-hot-lg-list">${listHTML}</div>
    `;
  }

  const cls = `wg-hot-wrap wg-hot-wrap--${size}`;
  if (isPreview) {
    return `<div class="desktop-widget-preview-skin desktop-widget-preview-skin--charts">${inner}</div>`;
  }
  return `<div class="${cls}">${inner}</div>`;
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
