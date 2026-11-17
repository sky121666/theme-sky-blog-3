// Authentication documents own a separate runtime and must never hydrate the
// still-active desktop while a PJAX response is being prepared.
export function isAuthenticationResponse({ url, appId = '', pageMode = '' } = {}) {
  if (appId === 'auth' || pageMode === 'auth') return true;
  try {
    const pathname = new URL(url).pathname;
    return /^\/(?:login|logout|signup|password-reset)(?:\/|$)/.test(pathname);
  } catch { return false; }
}

// Only a complete 200 response can replace the window. A GET may hand its
// 4xx document to the browser; an unsuccessful form action must never replay.
export function navigationResponseAction(status, method = 'GET') {
  if (status === 200) return 'render';
  if (status >= 400 && status < 500 && String(method).toUpperCase() === 'GET') return 'native';
  return 'failed';
}

export function hasNavigationTitle(doc) {
  // Accessible SVGs in the body may contain their own <title>.
  return doc.head?.querySelectorAll(':scope > title').length === 1 && Boolean(doc.title.trim());
}

// The cache and foreground renderer must agree on which application they
// would mount. Otherwise a malformed public response poisons every retry.
export function getWindowAppContent(doc, frame, appId) {
  const roots = doc.querySelectorAll('[data-window-content-root]');
  if (roots.length !== 1 || !frame?.contains(roots[0])) return null;
  const containers = roots[0].querySelectorAll('[data-window-content-variant], #pjax-container');
  if (containers.length !== 1) return null;
  const [container] = containers;
  if (container.dataset.windowContentVariant && container.dataset.windowContentVariant !== doc.body.dataset.windowVariant) return null;
  const apps = container.querySelectorAll('[data-app-root]');
  if (!appId || apps.length !== 1 || apps[0].dataset.appRoot !== appId) return null;
  if (appId === 'docsme' && !apps[0].querySelector('.docsme-main')) return null;
  return container;
}
