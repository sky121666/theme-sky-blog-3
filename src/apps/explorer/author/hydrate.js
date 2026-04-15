import { registerAuthorPostsExplorer } from './runtime.js';
import { resolveExplorerAuthorProtocol } from './protocol.js';
import { invokeAlpineDestroyHooks } from '../../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../../shared/page-app-bridge.js';

queuePageAppRegistrar((Alpine) => {
  registerAuthorPostsExplorer(Alpine);
});

registerPageAppLifecycle('explorer-author', {
  resolveProtocol: resolveExplorerAuthorProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="authorPostsExplorer"]');
  },
  getDocumentState(_root, context) {
    return {
      title: context.documentTitle || document.title,
      windowTitle: context.documentTitle || document.title,
      windowVariant: 'browser'
    };
  }
});
