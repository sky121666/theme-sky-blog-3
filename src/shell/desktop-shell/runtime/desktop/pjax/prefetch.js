// Idle initialization shares the same attention, flights and freshness rules
// as foreground navigation and Docsme. No second HTML hint/cache or early CSS.
let pending;

export function initPrefetch() {
  if (!pending) {
    pending = import('../../../../../shell-core/runtime/navigation-preload.js')
      .then(adapter => adapter.initializeNavigationPreload())
      .catch(error => {
        pending = null;
        console.warn('[theme] Navigation preloading unavailable:', error);
      });
  }
  return pending;
}
