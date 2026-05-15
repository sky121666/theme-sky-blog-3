import { resolveDesktopAuthorProfile } from './data.js';
import { buildWidgetPjaxLink } from './link.js';

export function renderRecentMomentsWidget({ sources, escapeHtml, normalizeMomentRecord, mode }) {
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
  const stats = sources.recentMoments[0]?.stats || {};
  const upvote = stats.upvote ?? 0;
  const commentCount = stats.approvedComment ?? stats.totalComment ?? 0;

  const svgHeart = '<span class="icon-[lucide--heart]" aria-hidden="true"></span>';
  const svgChat = '<span class="icon-[lucide--message-circle]" aria-hidden="true"></span>';

  return buildWidgetPjaxLink({
    href: escapeHtml(featured.permalink),
    app: 'moments',
    className: 'wg-moment-social',
    disabled: mode === 'preview',
    innerHtml: `
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${escapeHtml(author.avatar || '/logo')}" alt="" loading="lazy" decoding="async" fetchpriority="low">
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
        <span class="wg-moment-social-stat is-chat">${svgChat}<b>${commentCount}</b></span>
      </span>
    `
  });
}
