let runtimePromise = null;
let pendingOpen = null;
let pendingOptions;

// Keep the shell's synchronous availability contract; load styling only on intent.
export function openSearchWidget(options) {
  if (typeof window.SearchWidget?.open !== 'function') return false;
  pendingOptions = options;
  if (pendingOpen) return true;

  const onKeydown = (event) => { if (event.key === 'Escape') cancel(); };
  const listeners = [
    [window, 'keydown', onKeydown],
    [window, 'pagehide', cancel],
    [window, 'popstate', cancel],
    [document, 'theme:navigation-accepted', cancel]
  ];
  function cancel() {
    if (pendingOpen !== cancel) return;
    pendingOpen = null;
    pendingOptions = undefined;
    listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler, true));
  }
  function finish(open) {
    if (pendingOpen !== cancel) return;
    const latestOptions = pendingOptions;
    cancel();
    if (typeof window.SearchWidget?.open !== 'function') return;
    try { open(latestOptions); } catch (error) { console.warn('[theme] SearchWidget failed to open', error); }
  }
  pendingOpen = cancel;
  listeners.forEach(([target, type, handler]) => target.addEventListener(type, handler, true));
  runtimePromise ||= import('./search-widget-runtime.js').catch((error) => {
    runtimePromise = null;
    console.warn('[theme] Search styling failed to load', error);
    throw error;
  });
  runtimePromise.then(
    (runtime) => finish((current) => runtime.openSearchWidget(current)),
    () => finish((current) => window.SearchWidget.open(current))
  );
  return true;
}
