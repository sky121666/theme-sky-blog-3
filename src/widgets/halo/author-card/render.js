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
  const postsSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
  const momentsSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

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
