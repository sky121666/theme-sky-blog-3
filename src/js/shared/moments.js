/**
 * 瞬间（Moments）数据处理与 HTML 渲染
 */

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
  const rawText = extractTextPreview(content.raw || '') || extractTextPreview(content.html || '');
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
    tags: Array.isArray(moment?.spec?.tags) ? moment.spec.tags : [],
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
    <button type="button"
            class="author-moment-row"
            data-author-moment-option
            data-moment-key="${escapeHtml(moment.key)}"
            data-moment-title="${escapeHtml(moment.title)}">
      <div class="author-moment-row-main">
        <span class="author-moment-row-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M5 5.5H15C16.1046 5.5 17 6.39543 17 7.5V12.5C17 13.6046 16.1046 14.5 15 14.5H5C3.89543 14.5 3 13.6046 3 12.5V7.5C3 6.39543 3.89543 5.5 5 5.5Z" stroke="currentColor" stroke-width="1.15"></path>
            <path d="M6.25 11.75L8.25 9.75L10 11.5L12.75 8.75" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="6.75" cy="7.9" r="0.9" fill="currentColor"></circle>
          </svg>
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
    </button>
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
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7.25 5.75H16.75C18.1307 5.75 19.25 6.86929 19.25 8.25V15.75C19.25 17.1307 18.1307 18.25 16.75 18.25H7.25C5.86929 18.25 4.75 17.1307 4.75 15.75V8.25C4.75 6.86929 5.86929 5.75 7.25 5.75Z" stroke="currentColor" stroke-width="1.25"></path>
            <path d="M8 14.25L10.5 11.75L12.75 14L15.75 11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="9" cy="9.25" r="1" fill="currentColor"></circle>
          </svg>
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

      <a class="author-preview-action tag-preview-action pjax-link" href="${escapeHtml(moment.permalink)}">打开瞬间</a>
    </article>
  `;
}
