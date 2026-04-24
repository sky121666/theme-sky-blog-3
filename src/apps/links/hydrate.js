import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import { queuePageAppRegistrar, registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { resolveLinksAppProtocol } from './protocol.js';
import { registerLinksExplorer, registerLinkSubmitForm } from './runtime.js';

queuePageAppRegistrar((Alpine) => {
  registerLinksExplorer(Alpine);
  registerLinkSubmitForm(Alpine);
});

registerPageAppLifecycle('links', {
  resolveProtocol: resolveLinksAppProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="linksExplorer"], [x-data="linkSubmitForm"]');
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.links-app-shell');
    const chromeTitle = shell?.dataset.linksChromeTitle || '';
    const chromeSubtitle = shell?.dataset.linksChromeSubtitle || '';
    const resolvedTitle = context.documentTitle || document.title;

    return {
      title: resolvedTitle,
      windowTitle: chromeTitle || resolvedTitle,
      windowSubtitle: chromeSubtitle || '',
      windowVariant: 'links'
    };
  }
});
