import { cleanupPostOutline, initPostOutline } from './runtime/post-outline.js';
import { registerPostComponents } from './runtime/upvote.js';
import { resolveReaderAppProtocol } from './protocol.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';

queuePageAppRegistrar((Alpine) => {
  registerPostComponents(Alpine);
});

registerPageAppLifecycle('reader', {
  resolveProtocol: resolveReaderAppProtocol,
  hydrate(root) {
    initPostOutline(root);
    return cleanupPostOutline;
  },
  getDocumentState(root, context) {
    const title = root?.querySelector('.post-title')?.textContent?.trim() || context.documentTitle || document.title;
    return {
      title: context.documentTitle || document.title,
      windowTitle: title,
      windowVariant: 'browser'
    };
  }
});
