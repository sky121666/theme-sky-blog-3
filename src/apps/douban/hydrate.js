import {
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';
import { resolveDoubanAppProtocol } from './protocol.js';
import { mountDoubanApp } from './runtime.js';

registerPageAppLifecycle('douban', {
  resolveProtocol: resolveDoubanAppProtocol,
  hydrate(root) {
    return mountDoubanApp(root?.querySelector('[data-app-root="douban"]') || root);
  },
  dispose(root) {
    const appRoot = root?.matches?.('[data-app-root="douban"]')
      ? root
      : root?.querySelector?.('[data-app-root="douban"]');
    appRoot?.__doubanAppDispose?.();
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('[data-app-root="douban"]');
    const chromeTitle = shell?.dataset.doubanTitle || '';
    const siteTitle = shell?.dataset.doubanSiteTitle || '';
    const resolvedTitle = chromeTitle
      ? (siteTitle ? `${chromeTitle} - ${siteTitle}` : chromeTitle)
      : (context.documentTitle || document.title);

    return {
      title: resolvedTitle,
      windowTitle: chromeTitle || resolvedTitle,
      windowSubtitle: '电影、图书、音乐、游戏和舞台剧',
      windowVariant: 'douban'
    };
  }
});
