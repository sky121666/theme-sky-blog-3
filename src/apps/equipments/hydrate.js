import { invokeAlpineDestroyHooks } from '../../shared/alpine-destroy.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';
import { resolveEquipmentsAppProtocol } from './protocol.js';
import { registerEquipmentsExplorer } from './runtime.js';

queuePageAppRegistrar((Alpine) => {
  registerEquipmentsExplorer(Alpine);
});

registerPageAppLifecycle('equipments', {
  resolveProtocol: resolveEquipmentsAppProtocol,
  hydrate() {
    return null;
  },
  dispose(root) {
    invokeAlpineDestroyHooks(root, '[x-data="equipmentsExplorer"]');
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.equipments-app-shell');
    const chromeTitle = shell?.dataset.equipmentsChromeTitle || '';
    const chromeSubtitle = shell?.dataset.equipmentsChromeSubtitle || '';
    const siteTitle = shell?.dataset.equipmentsSiteTitle || '';
    const resolvedTitle = chromeTitle
      ? (siteTitle && !chromeTitle.includes(siteTitle) ? `${chromeTitle} - ${siteTitle}` : chromeTitle)
      : (context.documentTitle || document.title);

    return {
      title: resolvedTitle,
      windowTitle: chromeTitle || resolvedTitle,
      windowSubtitle: chromeSubtitle,
      windowVariant: 'equipments'
    };
  }
});
