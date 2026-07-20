import { registerArchiveExplorer, initArchiveSidebar } from './runtime.js';
import { resolveExplorerArchivesProtocol } from './protocol.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../../shared/page-app-bridge.js';
import { invokeAlpineDestroyHooks } from '../../../shared/alpine-destroy.js';

queuePageAppRegistrar((Alpine) => {
  registerArchiveExplorer(Alpine);
});

registerPageAppLifecycle('explorer-archives', {
  resolveProtocol: resolveExplorerArchivesProtocol,
  hydrate(root) {
    return initArchiveSidebar(root);
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="archiveExplorer"]');
  },
  getDocumentState(_root, context) {
    return {
      title: context.documentTitle || document.title,
      windowTitle: context.documentTitle || document.title,
      windowVariant: 'browser'
    };
  }
});
