const WEB_PROTOCOLS = new Set(['http:', 'https:']);
const CUSTOMER_CENTER_PATH = /^\/uc(?:\/|$)/;

function isUrlInput(value) {
  return value instanceof URL || (typeof value === 'string' && value.trim().length > 0);
}

/** The standalone customer-center SPA requires a document boundary; shop uses theme PJAX. */
export function requiresCommerceDocumentNavigation(currentUrl, targetUrl) {
  if (!isUrlInput(currentUrl) || !isUrlInput(targetUrl)) return false;
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl, current);
    if (!WEB_PROTOCOLS.has(current.protocol) || !WEB_PROTOCOLS.has(target.protocol)
      || current.origin !== target.origin) return false;
    return CUSTOMER_CENTER_PATH.test(current.pathname) || CUSTOMER_CENTER_PATH.test(target.pathname);
  } catch {
    return false;
  }
}
