import { registerPhotosExplorer } from './runtime/explorer.js';
import { resolvePhotosAppProtocol } from './protocol.js';
import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';

queuePageAppRegistrar((Alpine) => {
  registerPhotosExplorer(Alpine);
});

registerPageAppLifecycle('photos', {
  resolveProtocol: resolvePhotosAppProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="photosExplorer"]');
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.photos-shell');
    const photosTitle = shell?.dataset.photosChromeTitle || '';
    const photosSubtitle = shell?.dataset.photosChromeSubtitle || '';
    const photosSiteTitle = shell?.dataset.photosSiteTitle || '';
    const resolvedTitle = photosTitle
      ? (photosSiteTitle ? `${photosTitle} - ${photosSiteTitle}` : photosTitle)
      : (context.documentTitle || document.title);

    return {
      title: resolvedTitle,
      windowTitle: photosTitle || resolvedTitle,
      windowSubtitle: photosSubtitle,
      windowVariant: 'photos'
    };
  }
});
