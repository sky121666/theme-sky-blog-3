/**
 * macOS 桌面壳层 — 组件注册入口
 *
 * 所有逻辑已拆分到独立模块，此文件仅负责组装和注册顺序。
 */

import { initPjax } from './pjax/index.js';
import { initPrefetch } from './pjax/prefetch.js';
import { openSearchWidget } from './search.js';
import { registerWindowManager } from './window-manager.js';
import { registerWindowComponents } from './window.js';

const FLOATING_SCROLLBAR_SELECTOR = [
  '[data-window-scroll]',
  '#article-content pre',
  '.photos-sidebar',
  '.photos-albums-view',
  '.photos-grid-scroll',
  '.archive-sidebar-nav',
  '.archive-pane-scroll',
  '.tags-sidebar-nav',
  '.tags-preview-scroll',
  '.tag-posts-scroll',
  '.tag-preview-scroll',
  '.categories-sidebar-nav',
  '.categories-preview-scroll',
  '.category-posts-scroll',
  '.category-preview-scroll',
  '.desktop-widget-center-grid'
].join(', ');

function isHeaderSearchEnabled() {
  const menubar = document.querySelector('.menubar');
  return menubar?.dataset?.searchEnabled !== 'false';
}

function isWindowsPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /win/i.test(platform);
}

function resolveScrollContainer(target) {
  if (!(target instanceof Element)) return null;

  return target.matches(FLOATING_SCROLLBAR_SELECTOR)
    ? target
    : target.closest(FLOATING_SCROLLBAR_SELECTOR);
}

function computeThumbSize(trackSize, viewportSize, scrollSize, minThumbSize = 28) {
  const rawThumbSize = Math.round((viewportSize / scrollSize) * trackSize);
  const maxThumbSize = Math.max(minThumbSize, Math.round(trackSize * 0.46));
  return Math.min(maxThumbSize, Math.max(minThumbSize, rawThumbSize));
}

function syncOverlayScrollbar(scrollContainer) {
  if (!(scrollContainer instanceof HTMLElement)) return;

  const overlay = scrollContainer.querySelector(':scope > .window-scrollbar-overlay');
  const thumb = overlay?.querySelector('.window-scrollbar-thumb');
  if (!overlay || !thumb) return;

  const axis = scrollContainer.dataset.scrollbarAxis === 'x' ? 'x' : 'y';
  const viewportSize = axis === 'x' ? scrollContainer.clientWidth : scrollContainer.clientHeight;
  const scrollSize = axis === 'x' ? scrollContainer.scrollWidth : scrollContainer.scrollHeight;
  const maxScrollOffset = Math.max(scrollSize - viewportSize, 0);

  if (viewportSize <= 0 || maxScrollOffset <= 0) {
    overlay.dataset.hidden = 'true';
    thumb.style.setProperty('--window-scrollbar-thumb-top', '0px');
    thumb.style.setProperty('--window-scrollbar-thumb-height', '0px');
    thumb.style.setProperty('--window-scrollbar-thumb-left', '0px');
    thumb.style.setProperty('--window-scrollbar-thumb-width', '0px');
    return;
  }

  overlay.dataset.hidden = 'false';

  if (axis === 'x') {
    const trackWidth = Math.max(overlay.clientWidth, viewportSize - 4);
    const thumbWidth = computeThumbSize(trackWidth, viewportSize, scrollSize, 36);
    const maxThumbLeft = Math.max(trackWidth - thumbWidth, 0);
    const thumbLeft = Math.round((scrollContainer.scrollLeft / maxScrollOffset) * maxThumbLeft);

    thumb.style.setProperty('--window-scrollbar-thumb-left', `${thumbLeft}px`);
    thumb.style.setProperty('--window-scrollbar-thumb-width', `${thumbWidth}px`);
    return;
  }

  const trackHeight = Math.max(overlay.clientHeight, viewportSize - 4);
  const thumbHeight = computeThumbSize(trackHeight, viewportSize, scrollSize, 36);
  const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
  const thumbTop = Math.round((scrollContainer.scrollTop / maxScrollOffset) * maxThumbTop);

  thumb.style.setProperty('--window-scrollbar-thumb-top', `${thumbTop}px`);
  thumb.style.setProperty('--window-scrollbar-thumb-height', `${thumbHeight}px`);
}

function computeDragMetrics(scrollContainer) {
  if (!(scrollContainer instanceof HTMLElement)) return null;

  const overlay = scrollContainer.querySelector(':scope > .window-scrollbar-overlay');
  const thumb = overlay?.querySelector('.window-scrollbar-thumb');
  if (!overlay || !thumb) return null;

  const axis = scrollContainer.dataset.scrollbarAxis === 'x' ? 'x' : 'y';
  const viewportSize = axis === 'x' ? scrollContainer.clientWidth : scrollContainer.clientHeight;
  const scrollSize = axis === 'x' ? scrollContainer.scrollWidth : scrollContainer.scrollHeight;
  const maxScrollOffset = Math.max(scrollSize - viewportSize, 0);

  if (viewportSize <= 0 || maxScrollOffset <= 0) return null;

  const trackSize = axis === 'x'
    ? Math.max(overlay.clientWidth, viewportSize - 4)
    : Math.max(overlay.clientHeight, viewportSize - 4);
  const thumbSize = computeThumbSize(trackSize, viewportSize, scrollSize, 36);

  return {
    axis,
    maxScrollOffset,
    maxThumbTravel: Math.max(trackSize - thumbSize, 0)
  };
}

function ensureOverlayScrollbar(scrollContainer) {
  if (!(scrollContainer instanceof HTMLElement)) return;

  if (scrollContainer.querySelector(':scope > .window-scrollbar-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'window-scrollbar-overlay';
  overlay.dataset.hidden = 'true';
  overlay.setAttribute('aria-hidden', 'true');

  const thumb = document.createElement('div');
  thumb.className = 'window-scrollbar-thumb';
  overlay.appendChild(thumb);
  scrollContainer.appendChild(overlay);
  syncOverlayScrollbar(scrollContainer);
}

export function initFloatingScrollbars() {
  if (window.__THEME_FLOATING_SCROLLBARS__) return;
  window.__THEME_FLOATING_SCROLLBARS__ = true;

  const isWindows = isWindowsPlatform();
  document.documentElement.classList.toggle('platform-windows', isWindows);

  const activeTimers = new WeakMap();
  const initializedContainers = new Set();
  let dragState = null;

  function stopDrag() {
    if (!dragState) return;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    dragState = null;
  }

  const clearActiveTimer = (scrollContainer) => {
    const timer = activeTimers.get(scrollContainer);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      activeTimers.delete(scrollContainer);
    }
    delete scrollContainer.dataset.scrollbarActive;
  };

  const releaseContainer = (scrollContainer) => {
    clearActiveTimer(scrollContainer);
    initializedContainers.delete(scrollContainer);
    if (dragState?.container === scrollContainer) {
      stopDrag();
    }
  };

  const pruneDisconnectedContainers = () => {
    initializedContainers.forEach((scrollContainer) => {
      if (!scrollContainer.isConnected) {
        releaseContainer(scrollContainer);
      }
    });

    if (dragState?.container && !dragState.container.isConnected) {
      stopDrag();
    }
  };

  const markScrollActive = (scrollContainer) => {
    if (!(scrollContainer instanceof HTMLElement) || !scrollContainer.isConnected) return;

    scrollContainer.dataset.scrollbarActive = 'true';

    const previousTimer = activeTimers.get(scrollContainer);
    if (previousTimer) {
      window.clearTimeout(previousTimer);
    }

    const timer = window.setTimeout(() => {
      delete scrollContainer.dataset.scrollbarActive;
      activeTimers.delete(scrollContainer);
    }, 520);

    activeTimers.set(scrollContainer, timer);
  };

  const registerContainer = (target) => {
    const scrollContainer = target instanceof HTMLElement && target.matches(FLOATING_SCROLLBAR_SELECTOR)
      ? target
      : resolveScrollContainer(target);
    if (!scrollContainer || !scrollContainer.isConnected) return null;

    scrollContainer.classList.add('floating-scrollbar-host');
    scrollContainer.dataset.scrollbarAxis = scrollContainer.matches('#article-content pre') ? 'x' : 'y';

    if (isWindows) {
      ensureOverlayScrollbar(scrollContainer);
    }

    initializedContainers.add(scrollContainer);
    syncOverlayScrollbar(scrollContainer);
    return scrollContainer;
  };

  const registerAllContainers = () => {
    document.querySelectorAll(FLOATING_SCROLLBAR_SELECTOR).forEach((scrollContainer) => {
      registerContainer(scrollContainer);
    });
  };

  const refreshFloatingScrollbars = () => {
    pruneDisconnectedContainers();
    registerAllContainers();
  };

  window.__THEME_FLOATING_SCROLLBAR_DEBUG__ = {
    snapshot() {
      const containers = Array.from(initializedContainers);
      const connected = containers.filter((scrollContainer) => scrollContainer.isConnected).length;
      return {
        initialized: containers.length,
        connected,
        disconnected: containers.length - connected
      };
    }
  };

  registerAllContainers();

  document.addEventListener('scroll', (event) => {
    const scrollContainer = registerContainer(event.target);
    if (!scrollContainer) return;
    markScrollActive(scrollContainer);
  }, { capture: true, passive: true });

  document.addEventListener('pointerover', (event) => {
    registerContainer(event.target);
  }, { capture: true, passive: true });

  document.addEventListener('focusin', (event) => {
    registerContainer(event.target);
  }, { capture: true, passive: true });

  document.addEventListener('load', (event) => {
    registerContainer(resolveScrollContainer(event.target));
  }, { capture: true, passive: true });

  document.addEventListener('theme:content-swapped', refreshFloatingScrollbars);
  document.addEventListener('pjax:complete', refreshFloatingScrollbars);

  document.addEventListener('pointerdown', (event) => {
    const thumb = event.target instanceof Element
      ? event.target.closest('.window-scrollbar-thumb')
      : null;
    const scrollContainer = thumb?.closest('.floating-scrollbar-host');

    if (!(scrollContainer instanceof HTMLElement)) return;

    const metrics = computeDragMetrics(scrollContainer);
    if (!metrics || metrics.maxThumbTravel <= 0) return;

    dragState = {
      container: scrollContainer,
      axis: metrics.axis,
      pointerId: event.pointerId,
      startClient: metrics.axis === 'x' ? event.clientX : event.clientY,
      startScrollOffset: metrics.axis === 'x' ? scrollContainer.scrollLeft : scrollContainer.scrollTop,
      maxScrollOffset: metrics.maxScrollOffset,
      maxThumbTravel: metrics.maxThumbTravel
    };

    thumb.setPointerCapture?.(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    markScrollActive(scrollContainer);
    event.preventDefault();
  }, { capture: true });

  window.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (!dragState.container.isConnected) {
      stopDrag();
      return;
    }

    const delta = (dragState.axis === 'x' ? event.clientX : event.clientY) - dragState.startClient;
    const nextScrollOffset = dragState.maxThumbTravel > 0
      ? dragState.startScrollOffset + (delta / dragState.maxThumbTravel) * dragState.maxScrollOffset
      : dragState.startScrollOffset;

    if (dragState.axis === 'x') {
      dragState.container.scrollLeft = nextScrollOffset;
    } else {
      dragState.container.scrollTop = nextScrollOffset;
    }

    syncOverlayScrollbar(dragState.container);
    markScrollActive(dragState.container);
    event.preventDefault();
  }, { capture: true });

  window.addEventListener('pointerup', stopDrag, { capture: true });
  window.addEventListener('pointercancel', stopDrag, { capture: true });

  window.addEventListener('resize', () => {
    pruneDisconnectedContainers();
    initializedContainers.forEach((scrollContainer) => {
      syncOverlayScrollbar(scrollContainer);
    });
  }, { passive: true });
}

export function registerShellComponents(Alpine) {
  // 1. Stores 必须最先注册（其它组件依赖 $store.windowManager / $store.theme）
  registerWindowManager(Alpine);

  initFloatingScrollbars();

  // 2. 窗口组件（titlebar + draggableWindow）
  registerWindowComponents(Alpine);

  // 3. Pjax 引擎（依赖 $store.windowManager）
  initPjax(Alpine);

  // 4. 全局快捷键（首次打开搜索时才启动短生命周期样式观察）
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (!isHeaderSearchEnabled()) return;
      if (openSearchWidget()) {
        event.preventDefault();
      }
    }
  });

  // 5. 轻量预取（不阻塞首屏，空闲时初始化）
  (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 1500))(() => {
    initPrefetch();
  });
}
