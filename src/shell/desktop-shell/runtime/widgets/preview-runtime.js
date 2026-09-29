import { enhanceDoubanShowcaseWidgets } from '../../../../widgets/plugin/douban-showcase/runtime.js';
import { initLazyImages } from '../shared/lazy-media.js';

/** Own only the enhanced nodes inside one currently visible preview body. */
export function createWidgetPreviewLifecycle(body, {
  enhance = enhanceDoubanShowcaseWidgets,
  loadImages = initLazyImages
} = {}) {
  let sections = new Set();
  let disposed = false;

  function clear() {
    for (const section of sections) section.__doubanShowcaseCleanup?.();
    sections.clear();
  }

  function sync() {
    if (disposed || !body.isConnected || body.dataset.widgetPreviewVisible !== 'true') {
      clear();
      return;
    }
    const nextSections = new Set(body.querySelectorAll('[data-douban-showcase]'));
    for (const section of sections) {
      if (!nextSections.has(section)) section.__doubanShowcaseCleanup?.();
    }
    sections = nextSections;
    loadImages(body);
    if (sections.size) enhance(body);
  }

  function dispose() {
    disposed = true;
    clear();
  }

  return { sync, clear, dispose };
}
