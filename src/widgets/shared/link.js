/**
 * Widget link helpers — unified protocol for widget internal/external links.
 */

const IGNORED_PROTOCOLS = ['mailto:', 'tel:', 'javascript:'];

export function isWidgetInternalHref(href) {
  if (!href || href === '#') return false;
  for (const proto of IGNORED_PROTOCOLS) {
    if (href.startsWith(proto)) return false;
  }
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin;
  } catch (_error) {
    return false;
  }
}

export function buildWidgetPjaxLink({ href, app, className = '', attrs = '', innerHtml, disabled = false }) {
  if (!href || href === '#') {
    const cls = className || '';
    return `<span class="${cls}"${attrs ? ' ' + attrs : ''}>${innerHtml}</span>`;
  }
  if (disabled) {
    return `<span class="${className}"${attrs ? ' ' + attrs : ''}>${innerHtml}</span>`;
  }
  const cls = className ? `${className} pjax-link` : 'pjax-link';
  return `<a class="${cls}" data-pjax-app="${app}" href="${href}"${attrs ? ' ' + attrs : ''}>${innerHtml}</a>`;
}

export function buildWidgetExternalLink({ href, className = '', attrs = '', innerHtml }) {
  return `<a class="${className}" href="${href}" target="_blank" rel="noopener noreferrer"${attrs ? ' ' + attrs : ''}>${innerHtml}</a>`;
}
