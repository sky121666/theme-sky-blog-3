import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import { queuePageAppRegistrar, registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { resolveLinksAppProtocol } from './protocol.js';
import { registerLinksExplorer, registerLinkSubmitForm, prepareLinksLocalNavigation } from './runtime.js';

queuePageAppRegistrar((Alpine) => {
  registerLinksExplorer(Alpine);
  registerLinkSubmitForm(Alpine);
});

registerPageAppLifecycle('links', {
  resolveProtocol: resolveLinksAppProtocol,
  hydrate() {
    return null;
  },
  prepareLocalNavigation: prepareLinksLocalNavigation,
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="linksExplorer"], [x-data="linkSubmitForm"]');
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.links-app-shell');
    const liveTitle = shell && window.Alpine?.$data?.(shell)?.activeHeaderTitle?.();
    const chromeTitle = shell?.dataset.linksChromeTitle || '';
    const resolvedTitle = context.documentTitle || document.title;

    return {
      title: resolvedTitle,
      windowTitle: liveTitle || chromeTitle || resolvedTitle,
      windowSubtitle: '',
      windowVariant: 'links'
    };
  }
});
