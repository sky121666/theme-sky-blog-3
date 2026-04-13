import { resolveDesktopAuthorProfile } from './data.js';
import { buildWidgetPjaxLink } from './link.js';

export function renderRecentMomentsWidget({ sources, escapeHtml, normalizeMomentRecord }, widget) {
  if (!sources.momentsAvailable) {
    return '<div class="desktop-widget-empty">未安装 Moments 插件。</div>';
  }

  const moments = sources.recentMoments
    .slice(0, 1)
    .map((moment) => normalizeMomentRecord(moment));

  if (!moments.length) {
    return '<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';
  }

  const featured = moments[0];
  const author = resolveDesktopAuthorProfile(sources);
  const tag = featured.tags.length > 0 ? featured.tags[0] : '';
  const upvote = sources.recentMoments[0]?.stats?.upvote ?? 0;
  const totalComment = sources.recentMoments[0]?.stats?.totalComment ?? 0;

  const svgHeart = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  const svgChat = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

  return buildWidgetPjaxLink({
    href: escapeHtml(featured.permalink),
    app: 'moments-app',
    className: 'wg-moment-social',
    innerHtml: `
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${escapeHtml(author.avatar || '/logo')}" alt="">
        </span>
        <span class="wg-moment-social-info">
          <span class="wg-moment-social-name">${escapeHtml(author.displayName || '作者')}</span>
          <span class="wg-moment-social-time">${escapeHtml(featured.listTime)}</span>
        </span>
        ${tag ? `<span class="wg-moment-social-tag">#${escapeHtml(tag)}</span>` : ''}
      </span>
      <span class="wg-moment-social-content">${escapeHtml(featured.summary)}</span>
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart">${svgHeart}<b>${upvote}</b></span>
        <span class="wg-moment-social-stat is-chat">${svgChat}<b>${totalComment}</b></span>
      </span>
    `
  });
}
