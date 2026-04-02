import { formatCompactNumber, formatWidgetDate } from './format.js';
import {
  resolveDesktopAuthorProfile,
  selectDailyRandomTags,
  selectTopCategories
} from './data.js';

export function renderLatestPostsWidget({ sources, escapeHtml }, widget, options = {}) {
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
    const cover = post?.spec?.cover || sources.fallbackCover || '';
    const coverMedia = cover
      ? `<img class="wg-news-sm-img" src="${escapeHtml(cover)}" alt="">`
      : '<div class="wg-news-sm-img is-placeholder"></div>';
    inner = `
      <a class="wg-news-sm pjax-link" href="${escapeHtml(post?.status?.permalink || '#')}">
        ${coverMedia}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
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
    const cover = post?.spec?.cover || sources.fallbackCover || '';
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
    const heroCover = heroPost?.spec?.cover || sources.fallbackCover || '';
    const coverImg = heroCover
      ? `<img class="wg-news-lg-cover-img" src="${escapeHtml(heroCover)}" alt="">`
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

  return `<div class="desktop-widget-news-layout is-${size}">${inner}</div>`;
}

export function renderPopularPostsWidget({ sources, escapeHtml }, widget, options = {}) {
  const isCompact = options.compact === true;
  const size = widget?.size || 'medium';

  let limit = 3;
  if (size === 'small') limit = 1;
  else if (size === 'large') limit = isCompact ? 4 : 5;

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
    const cover = post?.spec?.cover || sources.fallbackCover || '';
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
    const heroCover = heroPost?.spec?.cover || sources.fallbackCover || '';
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

  const cls = `wg-hot-wrap wg-hot-wrap--${size}${isCompact ? ' is-compact' : ''}`;
  return `<div class="${cls}">${inner}</div>`;
}


const CATEGORY_FALLBACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Z"/></svg>';

export function renderCategoriesWidget({ sources, escapeHtml }) {
  const categories = selectTopCategories(sources.categories, 4);
  if (!categories.length) {
    return '<div class="desktop-widget-empty">当前没有可展示的分类。</div>';
  }

  const categoriesUrl = '/categories';

  const items = categories.map((cat) => {
    const color = cat.color || 'currentColor';
    const iconSvg = cat.icon || CATEGORY_FALLBACK_ICON;
    const colorStyle = color !== 'currentColor' ? ` style="color:${escapeHtml(color)}"` : '';
    return `
      <a class="wg-cat-item pjax-link" href="${escapeHtml(cat.permalink)}">
        <span class="wg-cat-icon"${colorStyle}>${iconSvg}</span>
        <span class="wg-cat-label">${escapeHtml(cat.name)}</span>
      </a>`;
  }).join('');

  return `
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M224,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h64a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z"/></svg>
          分类
        </span>
        <a class="wg-cat-more pjax-link" href="${escapeHtml(categoriesUrl)}">
          更多分类
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>
        </a>
      </div>
      <div class="wg-cat-grid">${items}</div>
    </div>`;
}

export function renderAuthorCardWidget({ sources, escapeHtml }, widget) {
  const author = resolveDesktopAuthorProfile(sources);
  const authorHref = escapeHtml(author.permalink || '#');
  const avatarMarkup = author.avatar
    ? `<img class="wg-author-avatar-img" src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.displayName)}">`
    : `<span class="wg-author-avatar-fallback">${escapeHtml((author.displayName || 'A').slice(0, 1))}</span>`;

  /* 文章路由 = 作者页, 瞬间路由 = /moments */
  const postsHref = authorHref;
  const momentsHref = '/moments';

  /* 文章 icon */
  const postsSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
  /* 瞬间 icon */
  const momentsSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  return `
    <div class="wg-author-compact">
      <a class="wg-author-head" href="${authorHref}">
        <div class="wg-author-avatar">
          ${avatarMarkup}
          <div class="wg-author-status-dot"></div>
        </div>
        <div class="wg-author-info">
          <strong class="wg-author-name">${escapeHtml(author.displayName)}</strong>
          <span class="wg-author-bio">${escapeHtml(author.summary)}</span>
        </div>
      </a>
      <div class="wg-author-actions">
        <a class="wg-author-action-btn" href="${postsHref}" title="文章">${postsSvg}</a>
        <a class="wg-author-action-btn" href="${momentsHref}" title="瞬间">${momentsSvg}</a>
      </div>
    </div>
  `;
}

export function renderSiteStatsWidget({ modules, sources, escapeHtml }, widget) {
  const stats = sources.siteStats;
  if (!stats) {
    return '<div class="desktop-widget-empty">站点统计当前不可用。</div>';
  }

  const svgTrend = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
  const svgUsers = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  const svgPosts = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
  const svgComments = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
  const svgChartBar = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>`;

  if (widget.size === 'medium') {
    return `
      <div class="wg-stat-micro">
        <div class="wg-stat-micro-label">
          <div class="wg-stat-pulse-dot"></div> 总访问量
        </div>
        <div class="wg-stat-micro-value glow-text-emerald">${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</div>
      </div>
    `;
  }

  if (widget.size === 'large') {
    const postCount = stats.post ?? 0;
    const commentCount = stats.comment ?? 0;
    const total = postCount + commentCount || 1;
    const postPercent = postCount / total;
    const commentPercent = commentCount / total;
    const circumference = 251.3;
    const postOffset = circumference * (1 - postPercent);
    const commentOffset = circumference * (1 - commentPercent);
    const commentRotation = 360 * postPercent;

    return `
      <div class="wg-stat-ring">
        <div class="wg-stat-ring-title">内容分布</div>
        <div class="wg-stat-ring-chart-wrap">
          <svg viewBox="0 0 100 100" class="wg-stat-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" class="wg-stat-ring-bg-circle" stroke-width="14"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="14" stroke-dasharray="${circumference}" stroke-dashoffset="${postOffset}" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#f43f5e" stroke-width="14" stroke-dasharray="${circumference}" stroke-dashoffset="${commentOffset}" stroke-linecap="round" style="transform-origin: center; transform: rotate(${commentRotation}deg);"/>
          </svg>
          <div class="wg-stat-ring-center">
            <span class="wg-stat-ring-total">${escapeHtml(formatCompactNumber(total))}</span>
          </div>
        </div>
        <div class="wg-stat-ring-legend">
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-blue"></span><span>文章</span></div>
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-rose"></span><span>评论</span></div>
        </div>
      </div>
    `;
  }

  if (widget.size === 'extra-large') {
    return `
      <div class="wg-stat-hero-solo">
        <div class="wg-stat-hero-solo-bg-icon">${svgChartBar}</div>
        <div class="wg-stat-hero-solo-top">
          <div class="wg-stat-hero-solo-icon">${svgUsers}</div>
          <span class="wg-stat-hero-solo-badge">All Time</span>
        </div>
        <div class="wg-stat-hero-solo-bottom">
          <h3>总访问量</h3>
          <div class="wg-stat-hero-solo-value glow-text-emerald">${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</div>
        </div>
      </div>
    `;
  }

  // Default layout: Hero & List (widget.id === 'halo.site_stats')
  return `
    <div class="wg-stat-hero-list">
      <div class="wg-stat-hero">
        <div class="wg-stat-hero-bg-icon">${svgTrend}</div>
        <div class="wg-stat-hero-head">
          <div class="wg-stat-hero-icon">${svgUsers}</div>
          <span>总访问量</span>
        </div>
        <div class="wg-stat-hero-value glow-text-emerald">${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</div>
      </div>
      <div class="wg-stat-list">
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-blue">${svgPosts}</span><span>文章总数</span></div>
          <span class="wg-stat-list-value">${escapeHtml(formatCompactNumber(stats.post ?? 0))}</span>
        </div>
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-rose">${svgComments}</span><span>评论互动</span></div>
          <span class="wg-stat-list-value">${escapeHtml(formatCompactNumber(stats.comment ?? 0))}</span>
        </div>
      </div>
    </div>
  `;
}

/** 基于字符串的简单 hash → 0~1 伪随机 */
function seededRand(str, salt = 0) {
  let h = salt;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return ((h & 0x7fffffff) % 1000) / 1000;
}

/** 背景标签的散落位置（统一 left+top，避免 right 与居中冲突） */
const BG_POSITIONS = [
  { top: '12%', left: '8%' },
  { top: '72%', left: '80%' },
  { top: '38%', left: '12%' },
  { top: '18%', left: '75%' },
  { top: '65%', left: '18%' },
  { top: '45%', left: '82%' },
  { top: '82%', left: '40%' },
];

export function renderRandomTagsWidget({ sources, escapeHtml }, widget, options = {}) {
  const isCompact = options.compact === true;
  const size = widget?.size || 'medium';

  if (size === 'small') {
    // ── 小组件: Focus & Blur 深度对焦 ──
    const tags = selectDailyRandomTags(sources.randomTags, 8);
    if (!tags.length) {
      return '<div class="desktop-widget-empty">无标签</div>';
    }

    const itemsHTML = tags.map((tag, i) => {
      const pos = BG_POSITIONS[i % BG_POSITIONS.length];
      const style = Object.entries(pos).map(([k, v]) => `${k}:${v}`).join(';');
      const tagColor = tag.color || '#A1A1AA';
      const cls = i === 0 ? 'wg-tag-focus-item is-focus' : 'wg-tag-focus-item';
      return `<a class="${cls} pjax-link" href="${escapeHtml(tag.permalink)}" style="${style};--tag-color:${escapeHtml(tagColor)}">${escapeHtml(tag.name)}</a>`;
    }).join('');

    const content = `<div class="wg-tag-focus-stage" data-tag-focus>${itemsHTML}</div>`;
    return content;
  }

  // ── 中 / 大组件: 结构化磁吸墙 ──
  const limit = size === 'large' ? (isCompact ? 10 : 12) : (isCompact ? 10 : 12);
  const tags = selectDailyRandomTags(sources.randomTags, limit);
  if (!tags.length) {
    return '<div class="desktop-widget-empty">当前没有可展示的标签。</div>';
  }

  const buildChip = (tag, index, extraClass = '') => {
    const tagColor = tag.color || '#A1A1AA';
    const rot = ((seededRand(tag.name, 1) - 0.5) * 5).toFixed(1);
    const tx  = ((seededRand(tag.name, 2) - 0.5) * 3.2).toFixed(1);
    const ty  = ((seededRand(tag.name, 3) - 0.5) * 3.2).toFixed(1);
    const tone = index % 4;
    return `
      <a class="wg-tag-chip ${extraClass} tone-${tone} pjax-link"
         href="${escapeHtml(tag.permalink)}"
         title="${escapeHtml(tag.name)}"
         style="--tag-color:${escapeHtml(tagColor)};--j-rot:${rot}deg;--j-tx:${tx}px;--j-ty:${ty}px;">
        ${escapeHtml(tag.name)}
      </a>
    `;
  };

  let content = '';
  if (size === 'large') {
    const featured = tags[0];
    const rest = tags.slice(1);
    const featuredMarkup = featured ? `
      <a class="wg-tag-feature pjax-link"
         href="${escapeHtml(featured.permalink)}"
         style="--tag-color:${escapeHtml(featured.color || '#A1A1AA')}">
        <span class="wg-tag-feature-kicker">探索</span>
        <strong>${escapeHtml(featured.name)}</strong>
      </a>
    ` : '';

    const chipsMarkup = rest.map((tag, index) => buildChip(tag, index)).join('');
    content = `
      <div class="wg-tag-wall-shell is-large${isCompact ? ' is-compact' : ''}">
        ${featuredMarkup}
        <div class="wg-tag-wall is-large${isCompact ? ' is-compact' : ''}">${chipsMarkup}</div>
      </div>
    `;
  } else {
    const chipsMarkup = tags.map((tag, index) => buildChip(tag, index)).join('');
    content = `<div class="wg-tag-wall is-medium${isCompact ? ' is-compact' : ''}">${chipsMarkup}</div>`;
  }

  return content;
}

/* ── Focus & Blur 自动轮转 (全局定时器) ── */
if (typeof document !== 'undefined') {
  setInterval(() => {
    document.querySelectorAll('[data-tag-focus]').forEach(stage => {
      const items = stage.querySelectorAll('.wg-tag-focus-item');
      if (items.length < 2) return;

      let focusIdx = -1;
      items.forEach((el, i) => { if (el.classList.contains('is-focus')) focusIdx = i; });

      const nextIdx = (focusIdx + 1) % items.length;
      items.forEach((el, i) => {
        el.classList.toggle('is-focus', i === nextIdx);
      });
    });
  }, 4000);
}
