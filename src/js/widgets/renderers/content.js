import { formatCompactNumber, formatWidgetDate } from './format.js';
import {
  resolveDesktopAuthorProfile,
  selectDailyRandomTags,
  selectTopCategories
} from './data.js';

export function renderLatestPostsWidget({ sources, escapeHtml }, widget, options = {}) {
  const isPreview = options.preview === true;
  const size = widget?.size || 'medium';
  const limit = size === 'large' ? 4 : 2;
  const posts = sources.latestPosts.slice(0, limit);
  
  if (!posts.length) {
    return '<div class="desktop-widget-empty">还没有可展示的文章。</div>';
  }

  const rowsHTML = posts.map((post) => {
    const title = post?.spec?.title || '未命名文章';
    const date = formatWidgetDate(post?.spec?.publishTime) || '最近发布';
    return `
      <a class="desktop-widget-mac-list-row pjax-link" href="${escapeHtml(post?.status?.permalink || '#')}">
        <div class="desktop-widget-mac-list-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(date)}</span>
        </div>
      </a>
    `;
  }).join('');

  const inner = `
    <div class="desktop-widget-mac-header">
      <span class="desktop-widget-mac-icon is-latest"></span>
      <span class="desktop-widget-mac-title">最新文章</span>
    </div>
    <div class="desktop-widget-mac-list-box">
      ${rowsHTML}
    </div>
  `;

  if (isPreview) {
    return `<div class="desktop-widget-preview-skin desktop-widget-preview-skin--latest">${inner}</div>`;
  }
  return `<div class="desktop-widget-news-layout">${inner}</div>`;
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
