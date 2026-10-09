import { registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { resolveShopAppProtocol } from './protocol.js';
import { hydrateShop } from './runtime.js';

const cleanups = new WeakMap();

registerPageAppLifecycle('shop', {
  resolveProtocol: resolveShopAppProtocol,
  hydrate(root) {
    cleanups.get(root)?.();
    cleanups.set(root, hydrateShop(root));
  },
  dispose(root) {
    cleanups.get(root)?.();
    cleanups.delete(root);
  },
  getDocumentState(root, context) {
    const app = root?.matches?.('[data-app-root="shop"]') ? root : root?.querySelector('[data-app-root="shop"]');
    const chromeTitle = app?.querySelector('.shop-page-title')?.textContent.trim() || app?.dataset.shopChromeTitle || '商店';
    const siteTitle = app?.dataset.shopSiteTitle || '';
    return {
      title: siteTitle ? `${chromeTitle} - ${siteTitle}` : (context.documentTitle || chromeTitle),
      windowTitle: chromeTitle,
      windowSubtitle: '',
      windowVariant: 'shop'
    };
  }
});
