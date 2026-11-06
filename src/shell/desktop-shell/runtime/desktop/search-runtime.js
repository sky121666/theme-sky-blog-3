/** SearchWidget 的模态框与表单可能位于两个独立的 Shadow DOM。 */
const SEARCH_STYLE_OBSERVER_TIMEOUT_MS = 2000;
const SEARCH_STYLE_RETRY_MS = 50;
let searchStyleObserver = null;
let searchStyleObserverTimer = null;
let searchStyleRetryTimer = null;
const keyboardRoots = new WeakSet();

function searchControls(root) {
  const controls = [];
  for (const node of root.children) {
    if (node.inert || node.hidden) continue;
    if (node.matches('button, input, select, textarea, a[href], [tabindex]')
      && !node.matches(':disabled') && node.tabIndex >= 0
      && node.getClientRects().length && getComputedStyle(node).visibility === 'visible') {
      controls.push(node);
    }
    controls.push(...searchControls(node.shadowRoot || node));
  }
  return controls;
}

function bindSearchKeyboard(root) {
  if (keyboardRoots.has(root)) return;
  keyboardRoots.add(root);
  // Stay inside this modal's event path; Escape and all outside input remain official.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const controls = searchControls(root);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1);
    const active = event.composedPath().find((node) => controls.includes(node));
    if (active && active !== (event.shiftKey ? first : last)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  });
}

function appendStyle(root, id, css) {
  if (root.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  root.appendChild(style);
}

function searchFormStyles(scope) {
  return `
    ${scope} > div:first-of-type,
    ${scope} > div:last-of-type {
      background: var(--mac-search-chrome) !important;
      border-color: var(--halo-search-widget-divider-color) !important;
      padding: 12px 14px !important;
    }
    ${scope} form {
      height: 50px !important;
      border-radius: 12px !important;
      background: var(--mac-search-input) !important;
      border: 1px solid var(--halo-search-widget-divider-color) !important;
      box-shadow: none !important;
      transition: border-color 120ms ease-out, box-shadow 120ms ease-out !important;
    }
    ${scope} form:focus-within {
      border-color: color-mix(in srgb, var(--halo-search-widget-primary-color) 70%, transparent) !important;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--halo-search-widget-primary-color) 16%, transparent) !important;
    }
    ${scope} input {
      font-size: 16px !important;
      letter-spacing: -0.01em !important;
      caret-color: var(--halo-search-widget-primary-color);
    }
    ${scope} input::placeholder { color: var(--halo-search-widget-muted-color) !important; }
    ${scope} li[data-index] {
      border: 1px solid transparent !important;
      border-radius: 9px !important;
      background: transparent !important;
      box-shadow: none !important;
      transition: background-color 100ms ease-out, border-color 100ms ease-out !important;
    }
    @media (hover: hover) and (pointer: fine) {
      ${scope} li[data-index]:hover {
        background: var(--halo-search-widget-hit-bg-color) !important;
      }
    }
    ${scope} li[data-index][class*='!bg-primary'] {
      background: var(--halo-search-widget-primary-color) !important;
      color: var(--theme-accent-contrast, #fff) !important;
    }
    ${scope} li[data-index][class*='!bg-primary'] :is(h2, p, span, mark) {
      color: var(--theme-accent-contrast, #fff) !important;
    }
    ${scope} li[data-index]:focus-visible {
      outline: 2px solid var(--halo-search-widget-primary-color);
      outline-offset: -2px;
    }
    ${scope} kbd {
      min-width: 23px !important;
      min-height: 22px !important;
      padding: 2px 5px !important;
      border-radius: 5px !important;
      background: var(--mac-search-input) !important;
      border-color: var(--halo-search-widget-kbd-border-color) !important;
      box-shadow: 0 1px 0 var(--halo-search-widget-divider-color) !important;
      font-size: 11px !important;
    }
    @media (max-width: 600px) {
      ${scope} > div:last-of-type { gap: 10px; justify-content: center; }
      ${scope} > div:last-of-type > div { margin-inline: 0 !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      ${scope} form, ${scope} li[data-index] { transition: none !important; }
    }
  `;
}

function injectSearchModalStyles(modalEl) {
  const root = modalEl?.shadowRoot;
  if (!root) return false;
  bindSearchKeyboard(root);
  appendStyle(root, 'mac-search-style', `
    :host {
      --mac-search-chrome: rgba(248, 248, 250, 0.82);
      --mac-search-input: rgba(255, 255, 255, 0.68);
      color-scheme: light;
    }
    :host-context(.dark), :host-context([data-color-scheme='dark']) {
      --mac-search-chrome: rgba(34, 34, 36, 0.84);
      --mac-search-input: rgba(255, 255, 255, 0.055);
      color-scheme: dark;
    }
    .modal__wrapper {
      align-items: flex-start !important;
      justify-content: center !important;
      padding: clamp(54px, 12vh, 120px) 16px max(16px, env(safe-area-inset-bottom)) !important;
      box-sizing: border-box;
    }
    .modal__layer { background: transparent !important; backdrop-filter: none !important; }
    .modal__content {
      width: min(640px, calc(100vw - 32px)) !important;
      max-width: 640px !important;
      max-height: min(78dvh, 760px) !important;
      border-radius: 18px !important;
      border: 1px solid rgba(255, 255, 255, 0.48) !important;
      background: rgba(248, 248, 250, 0.88) !important;
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22), 0 4px 14px rgba(15, 23, 42, 0.1) !important;
      backdrop-filter: blur(28px) saturate(160%) !important;
      -webkit-backdrop-filter: blur(28px) saturate(160%) !important;
      transform-origin: center top;
      animation: mac-search-enter 160ms cubic-bezier(0.16, 1, 0.3, 1) both !important;
    }
    :host-context(.dark) .modal__content,
    :host-context([data-color-scheme='dark']) .modal__content {
      border-color: rgba(255, 255, 255, 0.13) !important;
      background: rgba(30, 30, 32, 0.9) !important;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.18) !important;
    }
    @keyframes mac-search-enter {
      from { opacity: 0; transform: translateY(-4px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .modal__content { animation: none !important; }
    }
  `);
  const nestedForm = root.querySelector('search-form');
  if (nestedForm) {
    if (!nestedForm.shadowRoot) return false;
    appendStyle(nestedForm.shadowRoot, 'mac-search-form-style', searchFormStyles(':host'));
    return true;
  }
  // Keep the earlier plugin's single-shadow-root layout supported.
  if (!root.querySelector('form')) return false;
  appendStyle(root, 'mac-search-form-style', searchFormStyles('.modal__content'));
  return true;
}

function stopSearchWidgetObserver() {
  searchStyleObserver?.disconnect();
  searchStyleObserver = null;
  if (searchStyleRetryTimer !== null) {
    window.clearTimeout(searchStyleRetryTimer);
    searchStyleRetryTimer = null;
  }

  if (searchStyleObserverTimer !== null) {
    window.clearTimeout(searchStyleObserverTimer);
    searchStyleObserverTimer = null;
  }
}

function scanSearchWidgetStyles() {
  const modals = Array.from(document.querySelectorAll('search-modal'));
  if (!modals.length) return false;

  let allStyled = true;
  modals.forEach((modal) => {
    if (!injectSearchModalStyles(modal)) {
      allStyled = false;
    }
  });
  if (allStyled) {
    stopSearchWidgetObserver();
  }
  return allStyled;
}

export function openSearchWidget() {
  if (typeof window.SearchWidget?.open === 'function') {
    observeSearchWidget();
    window.SearchWidget.open();
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        scanSearchWidgetStyles();
      }, 0);
    });
    return true;
  }
  return false;
}

export function observeSearchWidget() {
  if (scanSearchWidgetStyles()) return;
  if (searchStyleObserver) return;

  searchStyleObserver = new MutationObserver(() => {
    scanSearchWidgetStyles();
  });

  searchStyleObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  searchStyleObserverTimer = window.setTimeout(() => {
    stopSearchWidgetObserver();
  }, SEARCH_STYLE_OBSERVER_TIMEOUT_MS);

  // attachShadow is not observable from the outer document. Retry only during
  // the existing two-second opening window, never for the lifetime of the page.
  const retry = () => {
    searchStyleRetryTimer = null;
    if (!searchStyleObserver || scanSearchWidgetStyles()) return;
    searchStyleRetryTimer = window.setTimeout(retry, SEARCH_STYLE_RETRY_MS);
  };
  searchStyleRetryTimer = window.setTimeout(retry, SEARCH_STYLE_RETRY_MS);
}
