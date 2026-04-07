/**
 * Widget link helpers — unified protocol for widget internal/external links.
 *
 * Rules:
 * - Internal links MUST specify `app` explicitly (reader / explorer / moments-app)
 * - No fuzzy inference — renderer decides the app type
 * - Internal links get `class="pjax-link"` + `data-pjax-app`
 * - External links get `target="_blank" rel="noopener noreferrer"`
 */

const IGNORED_PROTOCOLS = ['mailto:', 'tel:', 'javascript:'];

/**
 * Check if a href is an internal (same-origin) link.
 * @param {string} href
 * @returns {boolean}
 */
export function isWidgetInternalHref(href) {
  if (!href || href === '#') return false;
  for (const proto of IGNORED_PROTOCOLS) {
    if (href.startsWith(proto)) return false;
  }
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin;
  } catch (_e) {
    return false;
  }
}

/**
 * Build an internal PJAX-managed link for a widget.
 * @param {{ href: string, app: string, className?: string, attrs?: string, innerHtml: string }} opts
 * @returns {string} HTML string
 */
export function buildWidgetPjaxLink({ href, app, className = '', attrs = '', innerHtml }) {
  // Reject placeholder / empty href — output inert wrapper instead of PJAX link
  if (!href || href === '#') {
    const cls = className || '';
    return `<span class="${cls}"${attrs ? ' ' + attrs : ''}>${innerHtml}</span>`;
  }
  const cls = className ? `${className} pjax-link` : 'pjax-link';
  return `<a class="${cls}" data-pjax-app="${app}" href="${href}"${attrs ? ' ' + attrs : ''}>${innerHtml}</a>`;
}

/**
 * Build an external link for a widget.
 * @param {{ href: string, className?: string, attrs?: string, innerHtml: string }} opts
 * @returns {string} HTML string
 */
export function buildWidgetExternalLink({ href, className = '', attrs = '', innerHtml }) {
  return `<a class="${className}" href="${href}" target="_blank" rel="noopener noreferrer"${attrs ? ' ' + attrs : ''}>${innerHtml}</a>`;
}
