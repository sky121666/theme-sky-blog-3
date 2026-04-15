import {
  registerTagsExplorer,
  registerTagPostsExplorer
} from './runtime.js';
import { resolveExplorerTagsProtocol } from './protocol.js';
import { invokeAlpineDestroyHooks } from '../../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../../shared/page-app-bridge.js';

queuePageAppRegistrar((Alpine) => {
  registerTagsExplorer(Alpine);
  registerTagPostsExplorer(Alpine);
});

registerPageAppLifecycle('explorer-tags', {
  resolveProtocol: resolveExplorerTagsProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="tagsExplorer"], [x-data="tagPostsExplorer"]');
  },
  getDocumentState(_root, context) {
    return {
      title: context.documentTitle || document.title,
      windowTitle: context.documentTitle || document.title,
      windowVariant: 'browser'
    };
  }
});
