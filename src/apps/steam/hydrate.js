import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';
import { resolveSteamAppProtocol } from './protocol.js';
import { registerSteamExplorer } from './runtime.js';
import { stripSteamSiteTitleSuffix } from './title.js';

queuePageAppRegistrar((Alpine) => {
  registerSteamExplorer(Alpine);
});

registerPageAppLifecycle('steam', {
  resolveProtocol: resolveSteamAppProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="steamExplorer"]');
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.steam-app-shell');
    const chromeTitle = shell?.dataset.steamChromeTitle || '';
    const chromeSubtitle = shell?.dataset.steamChromeSubtitle || '';
    const siteTitle = shell?.dataset.steamSiteTitle || '';
    const windowTitle = stripSteamSiteTitleSuffix(chromeTitle, siteTitle);
    const resolvedTitle = windowTitle
      ? (siteTitle ? `${windowTitle} - ${siteTitle}` : windowTitle)
      : (context.documentTitle || document.title);

    return {
      title: resolvedTitle,
      windowTitle: windowTitle || resolvedTitle,
      windowSubtitle: chromeSubtitle,
      windowVariant: 'steam'
    };
  }
});
