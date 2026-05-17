import { resolveDesktopAuthorProfile } from './data.js';
import { buildWidgetPjaxLink } from './link.js';

function renderMomentMediaPreview(moment, escapeHtml) {
  if (!moment.mediaCount) return '';
  const medium = moment.media[0];
  const mediumType = typeof medium?.type === 'string' ? medium.type : (medium?.type?.name || '');
  const remaining = moment.mediaCount > 1 ? `<b>+${moment.mediaCount - 1}</b>` : '';
  if (mediumType === 'PHOTO' && medium.url) {
    return `
      <span class="wg-moment-social-media">
        <img src="${escapeHtml(medium.url)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        ${remaining}
      </span>
    `;
  }

  const label = mediumType === 'VIDEO'
    ? '视频'
    : mediumType === 'AUDIO'
      ? '音频'
      : '内容';
  const icon = mediumType === 'VIDEO'
    ? 'icon-[lucide--video]'
    : mediumType === 'AUDIO'
      ? 'icon-[lucide--music-2]'
      : 'icon-[lucide--image]';

  return `
    <span class="wg-moment-social-media is-placeholder">
      <span class="${icon}" aria-hidden="true"></span>
      <em>${escapeHtml(label)}</em>
      ${remaining}
    </span>
  `;
}

function resolveMomentStats(moment) {
  const stats = moment?.stats || {};
  const totalComment = Number(stats.totalComment ?? 0) || 0;
  const approvedComment = Number(stats.approvedComment ?? totalComment) || 0;
  return {
    upvote: Number(stats.upvote ?? 0) || 0,
    comment: approvedComment
  };
}

function renderMomentStat({ value, icon, label, className }, escapeHtml) {
  return `
    <span class="${className}" aria-label="${escapeHtml(`${value} ${label}`)}">
      <span class="${icon}" aria-hidden="true"></span>
      <b>${escapeHtml(String(value))}</b>
    </span>
  `;
}

function renderMomentStats(stats, escapeHtml) {
  return `
    <span class="wg-moment-social-stats">
      ${renderMomentStat({
        value: stats.upvote,
        icon: 'icon-[lucide--heart]',
        label: '个赞',
        className: 'wg-moment-social-stat is-heart'
      }, escapeHtml)}
      ${renderMomentStat({
        value: stats.comment,
        icon: 'icon-[lucide--message-circle]',
        label: '条评论',
        className: 'wg-moment-social-stat is-comment'
      }, escapeHtml)}
    </span>
  `;
}

function resolveMomentAuthor(original, fallback) {
  const owner = original?.owner || {};
  return {
    displayName: owner.displayName || fallback.displayName || '作者',
    avatar: owner.avatar || fallback.avatar || '/logo'
  };
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

function renderMomentTimePill(time, escapeHtml) {
  return `<span class="wg-moment-social-time-pill">${escapeHtml(time || '最新')}</span>`;
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

function renderMomentSmall({ moment, original, author, escapeHtml, mode }) {
  const stats = resolveMomentStats(original);
  const hasCover = moment.mediaCount > 0;
  return renderMomentLink({
    moment,
    escapeHtml,
    mode,
    className: `wg-moment-social wg-moment-social--small${hasCover ? ' has-cover' : ''}`,
    innerHtml: `
      ${hasCover ? renderMomentMediaPreview(moment, escapeHtml) : ''}
      <span class="wg-moment-social-overlay">
        <span class="wg-moment-social-topline">
          <span class="wg-moment-social-avatar">
            <img src="${escapeHtml(author.avatar)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
          </span>
          ${renderMomentTimePill(moment.listTime, escapeHtml)}
        </span>
        <span class="wg-moment-social-content">${escapeHtml(moment.summary)}</span>
        <span class="wg-moment-social-footer">
          ${renderMomentStats(stats, escapeHtml)}
          ${!hasCover && moment.mediaCount ? `<span class="wg-moment-social-media-count">${escapeHtml(moment.rowBadge)}</span>` : ''}
        </span>
      </span>
    `
  });
}

function renderMomentMedium({ moment, original, author, escapeHtml, mode }) {
  const stats = resolveMomentStats(original);
  const tag = moment.tags.length > 0 ? moment.tags[0] : '';
  const mediaHtml = renderMomentMediaPreview(moment, escapeHtml);
  return renderMomentLink({
    moment,
    escapeHtml,
    mode,
    className: `wg-moment-social wg-moment-social--medium${mediaHtml ? ' has-media' : ''}`,
    innerHtml: `
      <span class="wg-moment-social-copy">
        ${renderMomentAuthor(author, escapeHtml, moment.listTime)}
        <span class="wg-moment-social-content">${escapeHtml(moment.summary)}</span>
        <span class="wg-moment-social-bar">
          ${tag ? `<span class="wg-moment-social-tag">#${escapeHtml(tag)}</span>` : '<span></span>'}
          ${renderMomentStats(stats, escapeHtml)}
        </span>
      </span>
      ${mediaHtml}
    `
  });
}

function renderMomentLarge({ moments, originals, author, escapeHtml, mode }) {
  const featured = moments[0];
  const stats = resolveMomentStats(originals[0]);

  return `
    <div class="wg-moment-social wg-moment-social--large">
      ${renderMomentLink({
        moment: featured,
        escapeHtml,
        mode,
        className: `wg-moment-social-feature${featured.mediaCount ? ' has-media' : ''}`,
        innerHtml: `
          <span class="wg-moment-social-feature-head">
            ${renderMomentAuthor(author, escapeHtml, featured.fullTime)}
            <span class="wg-moment-social-more" aria-hidden="true">
              <span class="icon-[lucide--more-horizontal]" aria-hidden="true"></span>
            </span>
          </span>
          <span class="wg-moment-social-content">${escapeHtml(featured.summary)}</span>
          ${renderMomentMediaPreview(featured, escapeHtml)}
          <span class="wg-moment-social-feature-copy">
            ${featured.tags.length > 0 ? `<span class="wg-moment-social-tag">#${escapeHtml(featured.tags[0])}</span>` : '<span></span>'}
            <span class="wg-moment-social-footer">${renderMomentStats(stats, escapeHtml)}</span>
          </span>
        `
      })}
    </div>
  `;
}

export function renderRecentMomentsWidget({ sources, escapeHtml, normalizeMomentRecord, mode }, widget) {
  if (!sources.momentsAvailable) {
    return '<div class="desktop-widget-empty">未安装 Moments 插件。</div>';
  }

  const size = widget?.size || 'medium';
  const originals = sources.recentMoments.slice(0, 1);
  const moments = originals.map((moment) => normalizeMomentRecord(moment));

  if (!moments.length) {
    return renderMomentEmpty(mode);
  }

  const author = resolveDesktopAuthorProfile(sources);
  const featuredAuthor = resolveMomentAuthor(originals[0], author);

  if (size === 'small') {
    return renderMomentSmall({
      moment: moments[0],
      original: originals[0],
      author: featuredAuthor,
      escapeHtml,
      mode
    });
  }

  if (size === 'large') {
    return renderMomentLarge({
      moments,
      originals,
      author: featuredAuthor,
      escapeHtml,
      mode
    });
  }

  return renderMomentMedium({
    moment: moments[0],
    original: originals[0],
    author: featuredAuthor,
    escapeHtml,
    mode
  });
}
