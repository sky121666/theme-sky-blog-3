import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';
import { resolveBangumisAppProtocol } from './protocol.js';
import { registerBangumisExplorer } from './runtime.js';

queuePageAppRegistrar((Alpine) => {
  registerBangumisExplorer(Alpine);
});

registerPageAppLifecycle('bangumis', {
  resolveProtocol: resolveBangumisAppProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="bangumisExplorer"]');
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.bangumis-app-shell');
    const chromeTitle = shell?.dataset.bangumisChromeTitle || '';
    const chromeSubtitle = shell?.dataset.bangumisChromeSubtitle || '';
    const siteTitle = shell?.dataset.bangumisSiteTitle || '';
    const resolvedTitle = chromeTitle
      ? (siteTitle ? `${chromeTitle} - ${siteTitle}` : chromeTitle)
      : (context.documentTitle || document.title);

    return {
      title: resolvedTitle,
      windowTitle: chromeTitle || resolvedTitle,
      windowSubtitle: chromeSubtitle,
      windowVariant: 'bangumis'
    };
  }
});
