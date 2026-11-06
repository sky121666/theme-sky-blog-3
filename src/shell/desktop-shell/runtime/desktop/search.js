let runtimePromise = null;
let pendingOpen = null;

// Keep the shell's synchronous availability contract; load styling only on intent.
export function openSearchWidget() {
  if (typeof window.SearchWidget?.open !== 'function') return false;
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
    listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler, true));
  }
  function finish(open) {
    if (pendingOpen !== cancel) return;
    cancel();
    if (typeof window.SearchWidget?.open !== 'function') return;
    try { open(); } catch (error) { console.warn('[theme] SearchWidget failed to open', error); }
  }
  pendingOpen = cancel;
  listeners.forEach(([target, type, handler]) => target.addEventListener(type, handler, true));
  runtimePromise ||= import('./search-runtime.js').catch((error) => {
    runtimePromise = null;
    console.warn('[theme] Search styling failed to load', error);
    throw error;
  });
  runtimePromise.then(
    (runtime) => finish(() => runtime.openSearchWidget()),
    () => finish(() => window.SearchWidget.open())
  );
  return true;
}
