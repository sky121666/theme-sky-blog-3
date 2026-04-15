function isWindowsPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /win/i.test(platform);
}

function computeThumbSize(trackHeight, viewportHeight, scrollHeight) {
  const rawThumbHeight = Math.round((viewportHeight / scrollHeight) * trackHeight);
  const maxThumbHeight = Math.max(36, Math.round(trackHeight * 0.46));
  return Math.min(maxThumbHeight, Math.max(36, rawThumbHeight));
}

let authScrollbarCleanup = null;

function ensureAuthScrollbar() {
  const root = document.documentElement;
  const body = document.body;

  if (!body?.classList.contains('auth-gateway-page')) return null;
  if (!isWindowsPlatform()) return null;

  root.classList.add('platform-windows-auth');

  let overlay = body.querySelector(':scope > .auth-scrollbar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'auth-scrollbar-overlay';
    overlay.dataset.hidden = 'true';
    overlay.setAttribute('aria-hidden', 'true');

    const thumb = document.createElement('div');
    thumb.className = 'auth-scrollbar-thumb';
    overlay.appendChild(thumb);
    body.appendChild(overlay);
  }

  return overlay;
}

function syncAuthScrollbar() {
  const overlay = ensureAuthScrollbar();
  const thumb = overlay?.querySelector('.auth-scrollbar-thumb');
  const scrollEl = document.scrollingElement;

  if (!overlay || !thumb || !scrollEl) return;

  const viewportHeight = window.innerHeight;
  const scrollHeight = scrollEl.scrollHeight;
  const maxScrollTop = Math.max(scrollHeight - viewportHeight, 0);

  if (viewportHeight <= 0 || maxScrollTop <= 0) {
    overlay.dataset.hidden = 'true';
    thumb.style.setProperty('--auth-scrollbar-thumb-top', '0px');
    thumb.style.setProperty('--auth-scrollbar-thumb-height', '0px');
    return;
  }

  const trackHeight = Math.max(overlay.clientHeight, viewportHeight - 8);
  const thumbHeight = computeThumbSize(trackHeight, viewportHeight, scrollHeight);
  const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
  const thumbTop = Math.round((scrollEl.scrollTop / maxScrollTop) * maxThumbTop);

  overlay.dataset.hidden = 'false';
  thumb.style.setProperty('--auth-scrollbar-thumb-top', `${thumbTop}px`);
  thumb.style.setProperty('--auth-scrollbar-thumb-height', `${thumbHeight}px`);
}

export function initAuthScrollbars(root = document) {
  if (typeof authScrollbarCleanup === 'function') {
    authScrollbarCleanup();
    authScrollbarCleanup = null;
  }

  const body = root.body || document.body;
  if (!body?.classList.contains('auth-gateway-page')) return null;
  if (!isWindowsPlatform()) return null;

  syncAuthScrollbar();

  let activeTimer = 0;
  let dragState = null;
  const cleanups = [];
  const addCleanup = (fn) => cleanups.push(fn);
  const markActive = () => {
    body.classList.add('auth-scrollbar-active');
    window.clearTimeout(activeTimer);
    activeTimer = window.setTimeout(() => {
      body.classList.remove('auth-scrollbar-active');
    }, 520);
  };

  const onScroll = () => {
    syncAuthScrollbar();
    markActive();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  addCleanup(() => window.removeEventListener('scroll', onScroll));

  const onResize = () => {
    syncAuthScrollbar();
  };
  window.addEventListener('resize', onResize, { passive: true });
  addCleanup(() => window.removeEventListener('resize', onResize));

  const onPointerProbe = () => {
    syncAuthScrollbar();
  };
  document.addEventListener('pointermove', onPointerProbe, { passive: true });
  addCleanup(() => document.removeEventListener('pointermove', onPointerProbe));

  const onFocusIn = () => {
    syncAuthScrollbar();
    markActive();
  };
  document.addEventListener('focusin', onFocusIn, { passive: true });
  addCleanup(() => document.removeEventListener('focusin', onFocusIn));

  const onPointerDown = (event) => {
    const thumb = event.target instanceof Element
      ? event.target.closest('.auth-scrollbar-thumb')
      : null;
    const overlay = thumb?.closest('.auth-scrollbar-overlay');
    const scrollEl = document.scrollingElement;
    if (!overlay || !scrollEl) return;

    const viewportHeight = window.innerHeight;
    const scrollHeight = scrollEl.scrollHeight;
    const maxScrollTop = Math.max(scrollHeight - viewportHeight, 0);
    if (viewportHeight <= 0 || maxScrollTop <= 0) return;

    const trackHeight = Math.max(overlay.clientHeight, viewportHeight - 8);
    const thumbHeight = computeThumbSize(trackHeight, viewportHeight, scrollHeight);
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    if (maxThumbTop <= 0) return;

    dragState = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startScrollTop: scrollEl.scrollTop,
      maxScrollTop,
      maxThumbTop
    };

    thumb.setPointerCapture?.(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    markActive();
    event.preventDefault();
  };
  document.addEventListener('pointerdown', onPointerDown, { capture: true });
  addCleanup(() => document.removeEventListener('pointerdown', onPointerDown, { capture: true }));

  const stopDrag = () => {
    if (!dragState) return;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    dragState = null;
  };

  const onDragMove = (event) => {
    const scrollEl = document.scrollingElement;
    if (!dragState || !scrollEl || event.pointerId !== dragState.pointerId) return;

    const delta = event.clientY - dragState.startClientY;
    const nextScrollTop = dragState.startScrollTop + (delta / dragState.maxThumbTop) * dragState.maxScrollTop;
    scrollEl.scrollTop = nextScrollTop;
    syncAuthScrollbar();
    markActive();
    event.preventDefault();
  };
  window.addEventListener('pointermove', onDragMove, { capture: true });
  addCleanup(() => window.removeEventListener('pointermove', onDragMove, { capture: true }));

  window.addEventListener('pointerup', stopDrag, { capture: true });
  window.addEventListener('pointercancel', stopDrag, { capture: true });
  addCleanup(() => window.removeEventListener('pointerup', stopDrag, { capture: true }));
  addCleanup(() => window.removeEventListener('pointercancel', stopDrag, { capture: true }));

  const onLoad = () => syncAuthScrollbar();
  window.addEventListener('load', onLoad, { once: true });

  authScrollbarCleanup = () => {
    window.clearTimeout(activeTimer);
    stopDrag();
    body.classList.remove('auth-scrollbar-active');
    cleanups.forEach((cleanup) => cleanup());
  };

  return authScrollbarCleanup;
}
