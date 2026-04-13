/**
 * Shared PJAX link attachment utilities.
 *
 * Extracted from pjax/index.js so that both the PJAX module and
 * the desktop surface layer can reuse the same logic.
 */

import { createLogger } from '../../shared/debug.js';
const { log: linkLog } = createLogger('desktop-widget-pjax');

const PJAX_MANAGED_ATTR = 'data-pjax-managed';
const PJAX_ATTACHED_ATTR = 'data-pjax-attached';

/**
 * Check if a link element qualifies for PJAX management.
 * @param {HTMLAnchorElement} link
 * @returns {boolean}
 */
export function isPjaxManagedLink(link) {
  if (!link || link.target === '_blank' || !link.classList?.contains('pjax-link')) {
    return false;
  }

  try {
    const url = new URL(link.href, window.location.origin);
    if (url.protocol !== window.location.protocol) return false;
    if (url.host !== window.location.host) return false;
    if (link.href.startsWith('javascript:')) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Mark a single link as PJAX-managed (set/remove data attribute).
 * @param {HTMLAnchorElement} link
 */
function markPjaxLink(link) {
  if (!link?.classList?.contains('pjax-link')) return;

  if (isPjaxManagedLink(link)) {
    if (!link.hasAttribute(PJAX_MANAGED_ATTR)) {
      link.setAttribute(PJAX_MANAGED_ATTR, 'true');
    }
    return;
  }

  link.removeAttribute(PJAX_MANAGED_ATTR);
  link.removeAttribute('data-pjax-state');
}

/**
 * Scan a root element and mark all `.pjax-link` anchors.
 * @param {HTMLElement|Document} root
 */
export function markPjaxLinks(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('a.pjax-link[href]').forEach((link) => {
    markPjaxLink(link);
  });
}

/**
 * Attach unattached PJAX-managed links to the pjax instance.
 * @param {HTMLElement} root - Container to scan
 * @returns {number} Number of newly attached links
 */
export function attachDynamicLinks(root) {
  if (!root || !window.pjax) return 0;
  markPjaxLinks(root);
  const selector = `a.pjax-link[${PJAX_MANAGED_ATTR}="true"]:not([${PJAX_ATTACHED_ATTR}])`;
  const links = root.querySelectorAll(selector);
  if (!links.length) return 0;
  linkLog('attach:', links.length, 'links in', root.className?.split(' ')[0] || root.tagName);
  let count = 0;
  links.forEach((link) => {
    if (!isPjaxManagedLink(link)) return;
    window.pjax.attachLink(link);
    link.setAttribute(PJAX_ATTACHED_ATTR, 'true');
    count++;
  });
  return count;
}

export { PJAX_MANAGED_ATTR, PJAX_ATTACHED_ATTR };
