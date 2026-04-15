import {
  registerCategoriesExplorer,
  registerCategoryPostsExplorer
} from './runtime.js';
import { resolveExplorerCategoriesProtocol } from './protocol.js';
import { invokeAlpineDestroyHooks } from '../../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../../shared/page-app-bridge.js';

queuePageAppRegistrar((Alpine) => {
  registerCategoriesExplorer(Alpine);
  registerCategoryPostsExplorer(Alpine);
});

registerPageAppLifecycle('explorer-categories', {
  resolveProtocol: resolveExplorerCategoriesProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="categoriesExplorer"], [x-data="categoryPostsExplorer"]');
  },
  getDocumentState(_root, context) {
    return {
      title: context.documentTitle || document.title,
      windowTitle: context.documentTitle || document.title,
      windowVariant: 'browser'
    };
  }
});
