import { escapeHtml, extractTextPreview, truncateText } from './utils.js';

export function formatMomentTime(value, variant = 'full') {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return variant === 'list' ? '--.-- --:--' : '未知时间';
  }

  const pad = (segment) => String(segment).padStart(2, '0');

  if (variant === 'list') {
    return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeMomentRecord(moment) {
  const key = moment?.metadata?.name || '';
  const content = moment?.spec?.content || {};
  const media = Array.isArray(content.medium) ? content.medium : [];
  const tags = Array.isArray(moment?.spec?.tags) ? moment.spec.tags : [];
  let rawText = extractTextPreview(content.html || '') || extractTextPreview(content.raw || '');

  if (rawText && tags.length > 0) {
    for (const tag of tags) {
      rawText = rawText.replace(new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '');
    }
    rawText = rawText.replace(/\s+/g, ' ').trim();
  }

  const mediaCount = media.length;
  const title = rawText ? truncateText(rawText, 36) : (mediaCount > 0 ? '图片瞬间' : '瞬间记录');
  const summary = rawText
    ? truncateText(rawText, 88)
    : (mediaCount > 0 ? '打开预览查看媒体内容' : '打开预览查看完整内容');

  return {
    key,
    title: title || '瞬间记录',
    summary: summary || '打开预览查看完整内容',
    listTime: formatMomentTime(moment?.spec?.releaseTime, 'list'),
    fullTime: formatMomentTime(moment?.spec?.releaseTime, 'full'),
    media,
    mediaCount,
    rowBadge: mediaCount > 0 ? `${mediaCount} 项媒体` : '文本',
    mediaLabel: mediaCount > 0 ? `${mediaCount} 项媒体` : '纯文本',
    interactions: `${moment?.stats?.upvote ?? 0} 赞 · ${moment?.stats?.totalComment ?? 0} 评论`,
    tags,
    html: content.html || (rawText ? `<p>${escapeHtml(rawText)}</p>` : ''),
    permalink: key ? `/moments/${encodeURIComponent(key)}` : '/moments'
  };
}

export function renderMomentMediaTile(medium) {
  const mediumType = medium?.type || '';
  const mediumUrl = escapeHtml(medium?.url || '');

  if (mediumType === 'PHOTO') {
    return `<div class="author-moment-preview-tile is-photo"><img src="${mediumUrl}" alt=""></div>`;
  }

  if (mediumType === 'VIDEO') {
    return `<div class="author-moment-preview-tile is-video"><video src="${mediumUrl}" preload="metadata" controls playsinline></video></div>`;
  }

  if (mediumType === 'AUDIO') {
    return '<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>音频</span></div></div>';
  }

  return '<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>文章卡片</span></div></div>';
}

export function renderMomentRow(moment) {
  return `
    <a class="author-moment-row pjax-link"
       data-pjax-app="moments"
       data-author-moment-option
       data-moment-key="${escapeHtml(moment.key)}"
       data-moment-title="${escapeHtml(moment.title)}"
       href="${escapeHtml(moment.permalink)}">
      <div class="author-moment-row-main">
        <span class="author-moment-row-icon" aria-hidden="true">
          <span class="icon-[lucide--image]" aria-hidden="true"></span>
        </span>
        <span class="author-moment-row-copy">
          <span class="author-moment-row-title">${escapeHtml(moment.title)}</span>
          <span class="author-moment-row-summary">${escapeHtml(moment.summary)}</span>
        </span>
      </div>
      <span class="author-moment-row-meta">
        <span class="author-moment-row-date">${escapeHtml(moment.listTime)}</span>
        <span class="author-moment-row-badge">${escapeHtml(moment.rowBadge)}</span>
      </span>
    </a>
  `;
}

export function renderMomentPreview(moment, authorDisplayName) {
  const mediaHtml = moment.mediaCount > 0
    ? `<div class="author-moment-preview-media">${moment.media.map((medium) => renderMomentMediaTile(medium)).join('')}</div>`
    : '';
  const tagsHtml = moment.tags.length > 0
    ? `
      <div>
        <dt>标签</dt>
        <dd>
          <span class="author-inline-chip-list">
            ${moment.tags.map((tag) => `<span class="author-inline-chip">${escapeHtml(tag)}</span>`).join('')}
          </span>
        </dd>
      </div>
    `
    : '';

  return `
    <article class="author-preview-panel tag-preview-panel author-preview-panel--moment"
             data-author-moment-panel
             data-moment-key="${escapeHtml(moment.key)}">
      <header class="author-preview-header tag-preview-header">
        <div class="author-preview-icon tag-preview-icon author-preview-icon--moment">
          <span class="icon-[lucide--image]" aria-hidden="true"></span>
        </div>
        <div class="author-preview-heading tag-preview-heading">
          <h2 class="author-preview-title tag-preview-title">${escapeHtml(moment.title)}</h2>
          <p class="author-preview-path tag-preview-path">${escapeHtml(`${authorDisplayName || '作者'} / ${moment.fullTime}`)}</p>
        </div>
      </header>

      ${mediaHtml}

      <dl class="author-preview-meta tag-preview-meta">
        <div>
          <dt>发布时间</dt>
          <dd>${escapeHtml(moment.fullTime)}</dd>
        </div>
        <div>
          <dt>互动</dt>
          <dd>${escapeHtml(moment.interactions)}</dd>
        </div>
        <div>
          <dt>内容类型</dt>
          <dd>${escapeHtml(moment.mediaLabel)}</dd>
        </div>
        ${tagsHtml}
      </dl>

      ${moment.html ? `<div class="author-moment-preview-body">${moment.html}</div>` : ''}

      <a class="author-preview-action tag-preview-action pjax-link" data-pjax-app="moments" href="${escapeHtml(moment.permalink)}">打开瞬间</a>
    </article>
  `;
}
