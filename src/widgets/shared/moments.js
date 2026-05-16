import { resolveDesktopAuthorProfile } from './data.js';
import { buildWidgetPjaxLink } from './link.js';

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function renderMomentMediaPreview(moment, escapeHtml, showMedia) {
  if (!showMedia || !moment.mediaCount) return '';
  const medium = moment.media[0];
  if (medium?.type === 'PHOTO' && medium.url) {
    return `
      <span class="wg-moment-social-media">
        <img src="${escapeHtml(medium.url)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        ${moment.mediaCount > 1 ? `<b>+${moment.mediaCount - 1}</b>` : ''}
      </span>
    `;
  }

  return `
    <span class="wg-moment-social-media is-placeholder">
      <span class="icon-[lucide--image]" aria-hidden="true"></span>
      ${moment.mediaCount > 1 ? `<b>+${moment.mediaCount - 1}</b>` : ''}
    </span>
  `;
}

export function renderRecentMomentsWidget({ sources, escapeHtml, normalizeMomentRecord, mode }, widget) {
  if (!sources.momentsAvailable) {
    return '<div class="desktop-widget-empty">未安装 Moments 插件。</div>';
  }

  const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
  const limit = clampInteger(meta.limit, 1, 1, 3);
  const showMedia = meta.showMedia !== false;
  const moments = sources.recentMoments
    .slice(0, limit)
    .map((moment) => normalizeMomentRecord(moment));

  if (!moments.length) {
    return '<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';
  }

  const author = resolveDesktopAuthorProfile(sources);

  if (moments.length > 1) {
    const items = moments.map((moment, index) => {
      const original = sources.recentMoments[index] || {};
      const stats = original.stats || {};
      const upvote = stats.upvote ?? 0;
      return buildWidgetPjaxLink({
        href: escapeHtml(moment.permalink),
        app: 'moments',
        className: 'wg-moment-social-item',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-moment-social-item-copy">
            <span class="wg-moment-social-item-title">${escapeHtml(moment.summary)}</span>
            <span class="wg-moment-social-item-meta">${escapeHtml(moment.listTime)} · ${escapeHtml(String(upvote))} 赞</span>
          </span>
          ${renderMomentMediaPreview(moment, escapeHtml, showMedia)}
        `
      });
    }).join('');

    return `
      <div class="wg-moment-social wg-moment-social--stack">
        <span class="wg-moment-social-header">
          <span class="wg-moment-social-avatar">
            <img src="${escapeHtml(author.avatar || '/logo')}" alt="" loading="lazy" decoding="async" fetchpriority="low">
          </span>
          <span class="wg-moment-social-info">
            <span class="wg-moment-social-name">${escapeHtml(author.displayName || '作者')}</span>
            <span class="wg-moment-social-time">最新 ${moments.length} 条瞬间</span>
          </span>
        </span>
        <span class="wg-moment-social-stack-list">${items}</span>
      </div>
    `;
  }

  const featured = moments[0];
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
      ${renderMomentMediaPreview(featured, escapeHtml, showMedia)}
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart">${svgHeart}<b>${upvote}</b></span>
        <span class="wg-moment-social-stat is-chat">${svgChat}<b>${commentCount}</b></span>
      </span>
    `
  });
}
