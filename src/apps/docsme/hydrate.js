import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';
import { resolveDocsmeAppProtocol } from './protocol.js';
import { registerDocsmeApp } from './runtime.js';

queuePageAppRegistrar((Alpine) => {
  registerDocsmeApp(Alpine);
});

registerPageAppLifecycle('docsme', {
  resolveProtocol: resolveDocsmeAppProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="docsmeApp"]');
  },
  getDocumentState(root, context) {
    const app = root?.querySelector('[data-app-root="docsme"]');
    const chromeTitle = app?.dataset.docsmeChromeTitle || '';
    const chromeSubtitle = app?.dataset.docsmeChromeSubtitle || '';
    const siteTitle = app?.dataset.docsmeSiteTitle || '';
    const resolvedTitle = chromeTitle
      ? (siteTitle && !chromeTitle.includes(siteTitle) ? `${chromeTitle} - ${siteTitle}` : chromeTitle)
      : (context.documentTitle || document.title);

    return {
      title: resolvedTitle,
      windowTitle: chromeTitle || resolvedTitle,
      windowSubtitle: chromeSubtitle,
      windowVariant: 'docsme'
    };
  }
});
