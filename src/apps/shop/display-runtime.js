import { normalizeShopDisplay, parseShopDisplayPreferences, SHOP_DISPLAY_PREFS_KEY } from './display-model.js';

export { SHOP_DISPLAY_PREFS_KEY } from './display-model.js';

const displayCleanups = new WeakMap();

export function hydrateShopDisplay(root) {
  const app = root?.matches?.('[data-app-root="shop"]') ? root : root?.querySelector('[data-app-root="shop"]');
  if (!app || app.dataset.shopScene !== 'products' || app.dataset.shopEntryView !== 'catalog') return () => {};
  displayCleanups.get(app)?.();

  const win = app.ownerDocument.defaultView;
  const controller = new win.AbortController();
  let feedback = null;
  let preferences;
  try {
    preferences = parseShopDisplayPreferences(win.localStorage.getItem(SHOP_DISPLAY_PREFS_KEY));
  } catch {
    preferences = normalizeShopDisplay(null);
  }
  function render() {
    app.dataset.shopDisplayView = 'catalog';
    app.dataset.shopLayout = preferences.layout;
    app.dataset.shopSize = preferences.size;
    app.querySelectorAll('[data-shop-display-layout]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.shopDisplayLayout === preferences.layout));
    });
    app.querySelectorAll('[data-shop-display-size]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.shopDisplaySize === preferences.size));
    });
    app.querySelectorAll('[data-shop-display-size-select]').forEach((select) => {
      select.value = preferences.size;
    });
  }

  function updateDisplay(changes) {
    const next = normalizeShopDisplay({ ...preferences, ...changes });
    if (next.layout === preferences.layout && next.size === preferences.size) return;
    preferences = next;
    try { win.localStorage.setItem(SHOP_DISPLAY_PREFS_KEY, JSON.stringify(preferences)); } catch { /* Storage is optional. */ }
    render();
    const status = app.querySelector('[data-shop-display-status]');
    if (status) status.textContent = `${preferences.layout === 'list' ? '列表' : '卡片'}展示，${({ small: '小', medium: '中', large: '大' })[preferences.size]}尺寸`;
    feedback?.cancel();
    // The layout is committed immediately. A single short confirmation belongs
    // to this local control, never to the shared navigation or every card.
    if (!win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      feedback = app.querySelector('[data-shop-catalog]')?.animate?.(
        [{ opacity: 0.84 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' }
      ) || null;
    }
  }

  app.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    const button = event.target.closest?.('button[data-shop-display-layout], button[data-shop-display-size]');
    if (!button || !app.contains(button) || button.disabled) return;
    updateDisplay({
      layout: button.dataset.shopDisplayLayout ?? preferences.layout,
      size: button.dataset.shopDisplaySize ?? preferences.size
    });
  }, { signal: controller.signal });
  app.addEventListener('change', (event) => {
    if (event.defaultPrevented) return;
    const select = event.target.closest?.('select[data-shop-display-size-select]');
    if (select && app.contains(select) && !select.disabled) updateDisplay({ size: select.value });
  }, { signal: controller.signal });
  render();

  const cleanup = () => {
    feedback?.cancel();
    controller.abort();
    if (displayCleanups.get(app) === cleanup) displayCleanups.delete(app);
  };
  displayCleanups.set(app, cleanup);
  return cleanup;
}
