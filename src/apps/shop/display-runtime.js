import { normalizeShopDisplay, parseShopDisplayPreferences, SHOP_DISPLAY_PREFS_KEY } from './display-model.js';

export { SHOP_DISPLAY_PREFS_KEY } from './display-model.js';

const displayCleanups = new WeakMap();

export function hydrateShopDisplay(root) {
  const app = root?.matches?.('[data-app-root="shop"]') ? root : root?.querySelector('[data-app-root="shop"]');
  if (!app || app.dataset.shopScene !== 'products' || app.dataset.shopEntryView !== 'catalog') return () => {};
  displayCleanups.get(app)?.();

  const win = app.ownerDocument.defaultView;
  const controller = new win.AbortController();
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
    preferences = normalizeShopDisplay({ ...preferences, ...changes });
    try { win.localStorage.setItem(SHOP_DISPLAY_PREFS_KEY, JSON.stringify(preferences)); } catch { /* Storage is optional. */ }
    render();
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
    controller.abort();
    if (displayCleanups.get(app) === cleanup) displayCleanups.delete(app);
  };
  displayCleanups.set(app, cleanup);
  return cleanup;
}
