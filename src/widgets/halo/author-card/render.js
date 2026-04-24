import { resolveDesktopAuthorProfile } from '../../shared/data.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';

export function renderWidget({ sources, escapeHtml, mode }) {
  const author = resolveDesktopAuthorProfile(sources);
  const authorHref = escapeHtml(author.permalink || '#');
  const avatarMarkup = author.avatar
    ? `<img class="wg-author-avatar-img" src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.displayName)}" loading="lazy" decoding="async" fetchpriority="low">`
    : `<span class="wg-author-avatar-fallback">${escapeHtml((author.displayName || 'A').slice(0, 1))}</span>`;

  const postsHref = authorHref;
  const momentsHref = '/moments';
  const postsSvg = `<span class="icon-[lucide--file-text]" aria-hidden="true"></span>`;
  const momentsSvg = `<span class="icon-[lucide--clock]" aria-hidden="true"></span>`;

  return `
    <div class="wg-author-compact">
      ${buildWidgetPjaxLink({
        href: authorHref,
        app: 'explorer-author',
        className: 'wg-author-head',
        disabled: mode === 'preview',
        innerHtml: `
          <div class="wg-author-avatar">
            ${avatarMarkup}
            <div class="wg-author-status-dot"></div>
          </div>
          <div class="wg-author-info">
            <strong class="wg-author-name">${escapeHtml(author.displayName)}</strong>
            <span class="wg-author-bio">${escapeHtml(author.summary)}</span>
          </div>
        `
      })}
      <div class="wg-author-actions">
        ${buildWidgetPjaxLink({ href: postsHref, app: 'explorer-author', className: 'wg-author-action-btn', attrs: 'title="文章"', disabled: mode === 'preview', innerHtml: postsSvg })}
        ${buildWidgetPjaxLink({ href: momentsHref, app: 'moments', className: 'wg-author-action-btn', attrs: 'title="瞬间"', disabled: mode === 'preview', innerHtml: momentsSvg })}
      </div>
    </div>
  `;
}
