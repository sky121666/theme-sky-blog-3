import './auth.css';

function isWindowsPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /win/i.test(platform);
}

function computeThumbSize(trackHeight, viewportHeight, scrollHeight) {
  const rawThumbHeight = Math.round((viewportHeight / scrollHeight) * trackHeight);
  const maxThumbHeight = Math.max(36, Math.round(trackHeight * 0.46));
  return Math.min(maxThumbHeight, Math.max(36, rawThumbHeight));
}

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

function initAuthScrollbars() {
  const body = document.body;
  if (!body?.classList.contains('auth-gateway-page')) return;
  if (!isWindowsPlatform()) return;

  syncAuthScrollbar();

  let activeTimer = 0;
  let dragState = null;
  const markActive = () => {
    body.classList.add('auth-scrollbar-active');
    window.clearTimeout(activeTimer);
    activeTimer = window.setTimeout(() => {
      body.classList.remove('auth-scrollbar-active');
    }, 520);
  };

  window.addEventListener('scroll', () => {
    syncAuthScrollbar();
    markActive();
  }, { passive: true });

  window.addEventListener('resize', () => {
    syncAuthScrollbar();
  }, { passive: true });

  document.addEventListener('pointermove', () => {
    syncAuthScrollbar();
  }, { passive: true });

  document.addEventListener('focusin', () => {
    syncAuthScrollbar();
    markActive();
  }, { passive: true });

  document.addEventListener('pointerdown', (event) => {
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
  }, { capture: true });

  const stopDrag = () => {
    if (!dragState) return;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    dragState = null;
  };

  window.addEventListener('pointermove', (event) => {
    const scrollEl = document.scrollingElement;
    if (!dragState || !scrollEl || event.pointerId !== dragState.pointerId) return;

    const delta = event.clientY - dragState.startClientY;
    const nextScrollTop = dragState.startScrollTop + (delta / dragState.maxThumbTop) * dragState.maxScrollTop;
    scrollEl.scrollTop = nextScrollTop;
    syncAuthScrollbar();
    markActive();
    event.preventDefault();
  }, { capture: true });

  window.addEventListener('pointerup', stopDrag, { capture: true });
  window.addEventListener('pointercancel', stopDrag, { capture: true });

  window.addEventListener('load', syncAuthScrollbar, { once: true });
}

initAuthScrollbars();
