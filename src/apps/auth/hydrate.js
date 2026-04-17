import { initAuthBackLink, initAuthScrollbars, initAuthThemeToggle, initAuthToasts } from '../../entries/auth.js';
import { resolveAuthAppProtocol } from './protocol.js';

function syncAuthDocumentState(root, context) {
  const title = context?.documentTitle || document.title;
  const gatewayTitle = root?.querySelector('.auth-gateway-title')?.textContent?.trim() || title;

  document.title = title;
  if (document.body) {
    document.body.dataset.appId = 'auth';
    document.body.dataset.pageApp = 'auth';
    document.body.dataset.windowVariant = 'none';
    document.body.dataset.pageMode = 'auth';
  }

  return {
    title,
    windowTitle: gatewayTitle,
    windowVariant: 'none'
  };
}

export function hydrateAuthApp(root = document, extra = {}) {
  const protocol = resolveAuthAppProtocol(root);
  const cleanup = initAuthScrollbars(root);
  const themeCleanup = initAuthThemeToggle(root);
  const backCleanup = initAuthBackLink(root);
  const toastCleanup = initAuthToasts(root);
  const context = {
    appId: 'auth',
    documentTitle: extra.documentTitle || document.title,
    ssrProps: protocol.props,
    state: protocol.state,
    root: protocol.root || root,
    reason: extra.reason || 'auth-entry'
  };

  const documentState = syncAuthDocumentState(protocol.root || root, context);

  return {
    protocol,
    context,
    cleanup: () => {
      if (typeof cleanup === 'function') cleanup();
      if (typeof themeCleanup === 'function') themeCleanup();
      if (typeof backCleanup === 'function') backCleanup();
      if (typeof toastCleanup === 'function') toastCleanup();
    },
    documentState
  };
}
