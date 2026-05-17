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
  const remaining = moment.mediaCount > 1 ? `<b>+${moment.mediaCount - 1}</b>` : '';
  if (medium?.type === 'PHOTO' && medium.url) {
    return `
      <span class="wg-moment-social-media">
        <img src="${escapeHtml(medium.url)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        ${remaining}
      </span>
    `;
  }

  const icon = medium?.type === 'VIDEO'
    ? 'icon-[lucide--video]'
    : medium?.type === 'AUDIO'
      ? 'icon-[lucide--music-2]'
      : 'icon-[lucide--image]';

  return `
    <span class="wg-moment-social-media is-placeholder">
      <span class="${icon}" aria-hidden="true"></span>
      ${remaining}
    </span>
  `;
}

function resolveMomentStats(moment) {
  const stats = moment?.stats || {};
  return {
    upvote: Number(stats.upvote ?? 0) || 0
  };
}

function renderMomentLikes(upvote, escapeHtml, className = 'wg-moment-social-stat') {
  return `
    <span class="${className} is-heart" aria-label="${escapeHtml(`${upvote} 个赞`)}">
      <span class="icon-[lucide--heart]" aria-hidden="true"></span>
      <b>${escapeHtml(String(upvote))}</b>
    </span>
  `;
}

function renderMomentEmpty(mode) {
  return buildWidgetPjaxLink({
    href: '/moments',
    app: 'moments',
    className: 'desktop-widget-empty wg-moment-social-empty',
    disabled: mode === 'preview',
    innerHtml: `
      <strong>还没有瞬间</strong>
      <span>打开瞬间记录最近动态</span>
    `
  });
}

function renderMomentAuthor(author, escapeHtml, time) {
  return `
    <span class="wg-moment-social-header">
      <span class="wg-moment-social-avatar">
        <img src="${escapeHtml(author.avatar || '/logo')}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
      <span class="wg-moment-social-info">
        <span class="wg-moment-social-name">${escapeHtml(author.displayName || '作者')}</span>
        <span class="wg-moment-social-time">${escapeHtml(time || '最新瞬间')}</span>
      </span>
    </span>
  `;
}

function renderMomentLink({ moment, app = 'moments', className, mode, escapeHtml, innerHtml }) {
  return buildWidgetPjaxLink({
    href: escapeHtml(moment?.permalink || '/moments'),
    app,
    className,
    disabled: mode === 'preview',
    innerHtml
  });
}

function renderMomentSmall({ moment, original, author, showMedia, escapeHtml, mode }) {
  const { upvote } = resolveMomentStats(original);
  return renderMomentLink({
    moment,
    escapeHtml,
    mode,
    className: 'wg-moment-social wg-moment-social--small',
    innerHtml: `
      ${renderMomentAuthor(author, escapeHtml, moment.listTime)}
      <span class="wg-moment-social-content">${escapeHtml(moment.summary)}</span>
      <span class="wg-moment-social-footer">
        ${renderMomentLikes(upvote, escapeHtml)}
        ${showMedia && moment.mediaCount ? `<span class="wg-moment-social-media-count">${escapeHtml(moment.rowBadge)}</span>` : ''}
      </span>
    `
  });
}

function renderMomentMedium({ moment, original, author, showMedia, escapeHtml, mode }) {
  const { upvote } = resolveMomentStats(original);
  const tag = moment.tags.length > 0 ? moment.tags[0] : '';
  return renderMomentLink({
    moment,
    escapeHtml,
    mode,
    className: 'wg-moment-social wg-moment-social--medium',
    innerHtml: `
      ${renderMomentAuthor(author, escapeHtml, moment.listTime)}
      <span class="wg-moment-social-content">${escapeHtml(moment.summary)}</span>
      ${renderMomentMediaPreview(moment, escapeHtml, showMedia)}
      <span class="wg-moment-social-bar">
        ${tag ? `<span class="wg-moment-social-tag">#${escapeHtml(tag)}</span>` : '<span></span>'}
        ${renderMomentLikes(upvote, escapeHtml)}
      </span>
    `
  });
}

function renderMomentLarge({ moments, originals, author, showMedia, escapeHtml, mode }) {
  const featured = moments[0];
  const { upvote } = resolveMomentStats(originals[0]);
  const secondary = moments.slice(1, 3);

  const secondaryItems = secondary.map((moment, index) => {
    const stats = resolveMomentStats(originals[index + 1]);
    return renderMomentLink({
      moment,
      escapeHtml,
      mode,
      className: 'wg-moment-social-item',
      innerHtml: `
        ${renderMomentMediaPreview(moment, escapeHtml, showMedia)}
        <span class="wg-moment-social-item-copy">
          <span class="wg-moment-social-item-title">${escapeHtml(moment.summary)}</span>
          <span class="wg-moment-social-item-meta">${escapeHtml(moment.listTime)} · ${escapeHtml(String(stats.upvote))} 赞</span>
        </span>
      `
    });
  }).join('');

  return `
    <div class="wg-moment-social wg-moment-social--large">
      ${renderMomentLink({
        moment: featured,
        escapeHtml,
        mode,
        className: 'wg-moment-social-feature',
        innerHtml: `
          ${renderMomentMediaPreview(featured, escapeHtml, showMedia)}
          <span class="wg-moment-social-feature-copy">
            ${renderMomentAuthor(author, escapeHtml, featured.listTime)}
            <span class="wg-moment-social-content">${escapeHtml(featured.summary)}</span>
            <span class="wg-moment-social-footer">${renderMomentLikes(upvote, escapeHtml)}</span>
          </span>
        `
      })}
      ${secondaryItems ? `<span class="wg-moment-social-stack-list">${secondaryItems}</span>` : ''}
    </div>
  `;
}

export function renderRecentMomentsWidget({ sources, escapeHtml, normalizeMomentRecord, mode }, widget) {
  if (!sources.momentsAvailable) {
    return '<div class="desktop-widget-empty">未安装 Moments 插件。</div>';
  }

  const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
  const size = widget?.size || 'medium';
  const limit = size === 'large' ? clampInteger(meta.limit, 3, 1, 3) : 1;
  const showMedia = meta.showMedia !== false;
  const originals = sources.recentMoments.slice(0, limit);
  const moments = originals.map((moment) => normalizeMomentRecord(moment));

  if (!moments.length) {
    return renderMomentEmpty(mode);
  }

  const author = resolveDesktopAuthorProfile(sources);

  if (size === 'small') {
    return renderMomentSmall({
      moment: moments[0],
      original: originals[0],
      author,
      showMedia,
      escapeHtml,
      mode
    });
  }

  if (size === 'large') {
    return renderMomentLarge({
      moments,
      originals,
      author,
      showMedia,
      escapeHtml,
      mode
    });
  }

  return renderMomentMedium({
    moment: moments[0],
    original: originals[0],
    author,
    showMedia,
    escapeHtml,
    mode
  });
}
