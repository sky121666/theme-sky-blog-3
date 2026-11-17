import { beginLaunchPreview } from './launch-preview.js';

const CONTENT = {
  shop: '.shop-product-layout, .shop-catalog-grid, .shop-home, .shop-category-overview',
  reader: '#article-content',
  'explorer-categories': '.category-posts-scroll',
  'explorer-tags': '.tag-posts-scroll',
  'explorer-author': '.author-posts-scroll',
  'explorer-archives': '.archive-columns'
};
const SELECTION = {
  shop: '.shop-sidebar .shop-nav-link[aria-current="page"]',
  docsme: '.docsme-tree-link.is-active'
};
const installations = new WeakMap();

// Presentation consumes the existing accepted/ready lifecycle. It never delays
// navigation, mutates history or runs an outgoing animation before a request.
export function installNavigationMotion(doc = document, win = window) {
  if (installations.has(doc)) return installations.get(doc);
  let pending = null;
  let closePreview;
  let historyIndex = Number(win.history.state?.__browserNavIndex) || 0;
  const active = new Map();
  const preference = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const currentApp = () => doc.body?.dataset.appId || doc.body?.dataset.pageApp || '';
  const selected = app => SELECTION[app] ? doc.querySelector(SELECTION[app]) : null;

  function cancel() {
    closePreview?.();
    closePreview = null;
    for (const [animation, cleanup] of active) {
      animation.cancel();
      cleanup?.();
    }
    active.clear();
  }

  function play(target, frames, timing, cleanup) {
    if (!target?.isConnected || !target.animate) { cleanup?.(); return; }
    try {
      const animation = target.animate(frames, timing);
      active.set(animation, cleanup);
      void animation.finished.catch(() => {}).finally(() => {
        if (!active.has(animation)) return;
        active.delete(animation);
        cleanup?.();
      });
    } catch { cleanup?.(); }
  }

  function moveSelection(previous, app) {
    if (!previous || pending?.app !== app) return;
    const row = selected(app);
    const rect = row?.getBoundingClientRect();
    if (!rect?.width || !rect.height || Math.abs(previous.y - rect.y) < 1
      || (previous.href && previous.href === row.href)) return;
    const style = win.getComputedStyle(row);
    if (style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent') return;
    const highlight = doc.createElement('span');
    highlight.className = 'theme-navigation-selection';
    highlight.setAttribute('aria-hidden', 'true');
    highlight.style.backgroundColor = style.backgroundColor;
    highlight.style.borderRadius = style.borderRadius;
    const transition = row.style.getPropertyValue('transition');
    const priority = row.style.getPropertyPriority('transition');
    row.style.setProperty('transition', 'none', 'important');
    row.classList.add('theme-navigation-selected');
    row.prepend(highlight);
    const cleanup = () => {
      highlight.remove();
      row.classList.remove('theme-navigation-selected');
      // Commit the restored active fill before reinstating its normal hover
      // transition, so it cannot fade out and back in after the moving layer.
      if (row.isConnected) win.getComputedStyle(row).backgroundColor;
      if (transition) row.style.setProperty('transition', transition, priority);
      else row.style.removeProperty('transition');
    };
    play(highlight, [
      { transform: `translate(${previous.x - rect.x}px, ${previous.y - rect.y}px) scale(${previous.width / rect.width}, ${previous.height / rect.height})` },
      { transform: 'none' }
    ], { duration: 180, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }, cleanup);
  }

  const accepted = ({ detail }) => {
    cancel();
    closePreview = beginLaunchPreview(doc, win, detail);
    const app = currentApp();
    const row = selected(app);
    const rect = row?.getBoundingClientRect();
    const targetIndex = Number(win.history.state?.__browserNavIndex);
    pending = {
      ...detail, app,
      shopScene: doc.querySelector('[data-shop-scene]')?.dataset.shopScene,
      backward: detail.source === 'popstate' && targetIndex < historyIndex,
      selection: rect?.width && rect.height && rect.x + rect.width > 0 && rect.y + rect.height > 0
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, href: row.href } : null
    };
  };
  const ready = ({ detail }) => {
    historyIndex = Number(win.history.state?.__browserNavIndex) || 0;
    if (detail.intentId !== pending?.intentId) return;
    closePreview?.();
    closePreview = null;
    if (!reduced()) {
      moveSelection(pending.selection, detail.appId);
      const selector = CONTENT[detail.appId];
      const target = selector && detail.root?.querySelector(selector);
      if (target && detail.mode !== 'local') {
        const shopScene = doc.querySelector('[data-shop-scene]')?.dataset.shopScene;
        const enteringDetail = (detail.appId === 'reader' && pending.app.startsWith('explorer-'))
          || (detail.appId === 'shop' && pending.shopScene === 'products' && shopScene === 'product');
        const leavingDetail = detail.appId === 'shop' && pending.shopScene === 'product' && shopScene === 'products';
        const transform = pending.backward || leavingDetail ? 'translateX(-8px)'
          : pending.source === 'popstate' || enteringDetail ? 'translateX(8px)' : 'translateY(3px)';
        play(target, [{ opacity: 0.82, transform }, { opacity: 1, transform: 'none' }], {
          duration: 160, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)'
        });
      }
    }
    pending = null;
  };
  const settled = ({ detail }) => {
    if (detail.intentId === pending?.intentId) { closePreview?.(); closePreview = null; pending = null; }
  };
  const preferenceChanged = () => { if (reduced()) cancel(); };
  doc.addEventListener('theme:navigation-accepted', accepted);
  doc.addEventListener('theme:pjax-ready', ready);
  doc.addEventListener('theme:navigation-settled', settled);
  preference?.addEventListener?.('change', preferenceChanged);
  win.addEventListener?.('pagehide', cancel);
  const dispose = () => {
    cancel();
    doc.removeEventListener('theme:navigation-accepted', accepted);
    doc.removeEventListener('theme:pjax-ready', ready);
    doc.removeEventListener('theme:navigation-settled', settled);
    preference?.removeEventListener?.('change', preferenceChanged);
    win.removeEventListener?.('pagehide', cancel);
    if (installations.get(doc) === dispose) installations.delete(doc);
  };
  installations.set(doc, dispose);
  return dispose;
}
