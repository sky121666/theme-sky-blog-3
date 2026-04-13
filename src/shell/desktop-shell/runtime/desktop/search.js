/**
 * 搜索组件 Shadow DOM 样式注入
 */

function injectSearchModalStyles(modalEl) {
  const root = modalEl?.shadowRoot;
  if (!root || root.getElementById('mac-search-style')) return;

  const style = document.createElement('style');
  style.id = 'mac-search-style';
  style.textContent = `
    :host {
      --mac-search-panel-border-light: rgba(255, 255, 255, 0.55);
      --mac-search-panel-border-dark: rgba(255, 255, 255, 0.08);
      --mac-search-panel-shadow-light: 0 36px 88px rgba(15, 23, 42, 0.20);
      --mac-search-panel-shadow-dark: 0 36px 96px rgba(0, 0, 0, 0.55);
      --mac-search-form-light: rgba(255, 255, 255, 0.72);
      --mac-search-form-dark: rgba(44, 44, 46, 0.82);
      --mac-search-list-hover-light: rgba(15, 23, 42, 0.045);
      --mac-search-list-hover-dark: rgba(255, 255, 255, 0.06);
      --mac-search-kbd-light: rgba(255, 255, 255, 0.78);
      --mac-search-kbd-dark: rgba(58, 58, 60, 0.92);
      color-scheme: light;
    }

    :host-context(.dark),
    :host-context([data-color-scheme='dark']) {
      color-scheme: dark;
    }

    .modal__wrapper {
      align-items: flex-start !important;
      justify-content: center !important;
      padding: clamp(68px, 12vh, 120px) 16px 24px !important;
    }

    .modal__layer {
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    .modal__content {
      width: min(720px, calc(100vw - 32px)) !important;
      max-height: min(78vh, 760px) !important;
      overflow: hidden !important;
      border-radius: 24px !important;
      border: 1px solid var(--mac-search-panel-border-light) !important;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.76), rgba(248, 248, 250, 0.82)) !important;
      box-shadow: var(--mac-search-panel-shadow-light), inset 0 1px 0 rgba(255, 255, 255, 0.42) !important;
      backdrop-filter: blur(34px) saturate(180%) !important;
      -webkit-backdrop-filter: blur(34px) saturate(180%) !important;
    }

    :host-context(.dark) .modal__content,
    :host-context([data-color-scheme='dark']) .modal__content {
      border-color: var(--mac-search-panel-border-dark) !important;
      background: linear-gradient(to bottom, rgba(34, 34, 36, 0.82), rgba(28, 28, 30, 0.88)) !important;
      box-shadow: var(--mac-search-panel-shadow-dark), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
    }

    .modal__content > div:first-child,
    .modal__content > div:last-child {
      background: transparent !important;
    }

    .modal__content > div:first-child {
      border-bottom-width: 1px !important;
      border-bottom-color: var(--halo-search-widget-divider-color) !important;
      padding: 16px !important;
    }

    .modal__content > div:last-child {
      border-top-width: 1px !important;
      border-top-color: var(--halo-search-widget-divider-color) !important;
      padding: 12px 16px !important;
    }

    .modal__content form {
      height: 54px !important;
      border-radius: 16px !important;
      background: var(--mac-search-form-light) !important;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45) !important;
      backdrop-filter: blur(20px) saturate(150%) !important;
      -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
    }

    :host-context(.dark) .modal__content form,
    :host-context([data-color-scheme='dark']) .modal__content form {
      background: var(--mac-search-form-dark) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
    }

    .modal__content input {
      font-size: 15px !important;
      letter-spacing: -0.01em !important;
    }

    .modal__content input::placeholder {
      color: var(--halo-search-widget-muted-color) !important;
    }

    .modal__content li[data-index] {
      border: 1px solid transparent !important;
      border-radius: 14px !important;
      transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease !important;
      background: var(--halo-search-widget-hit-bg-color) !important;
      box-shadow: none !important;
    }

    .modal__content li[data-index]:hover {
      transform: translateY(-1px) !important;
      background: var(--mac-search-list-hover-light) !important;
      border-color: rgba(15, 23, 42, 0.06) !important;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06) !important;
    }

    :host-context(.dark) .modal__content li[data-index]:hover,
    :host-context([data-color-scheme='dark']) .modal__content li[data-index]:hover {
      background: var(--mac-search-list-hover-dark) !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22) !important;
    }

    .modal__content li[data-index][class*='!bg-primary'] {
      border-color: transparent !important;
      box-shadow: 0 10px 22px color-mix(in srgb, var(--halo-search-widget-primary-color) 20%, transparent) !important;
    }

    .modal__content kbd {
      min-width: 28px !important;
      min-height: 28px !important;
      border-radius: 10px !important;
      background: var(--mac-search-kbd-light) !important;
      border-color: var(--halo-search-widget-kbd-border-color) !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.36), var(--halo-search-widget-kbd-shadow) !important;
    }

    :host-context(.dark) .modal__content kbd,
    :host-context([data-color-scheme='dark']) .modal__content kbd {
      background: var(--mac-search-kbd-dark) !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05), var(--halo-search-widget-kbd-shadow) !important;
    }

    .modal__content mark {
      color: var(--halo-search-widget-primary-color) !important;
      background: transparent !important;
    }
  `;

  root.appendChild(style);
}

export function openSearchWidget() {
  if (typeof window.SearchWidget?.open === 'function') {
    window.SearchWidget.open();
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('search-modal').forEach(injectSearchModalStyles);
      }, 0);
    });
    return true;
  }
  return false;
}

export function observeSearchWidget() {
  const scan = () => {
    document.querySelectorAll('search-modal').forEach(injectSearchModalStyles);
  };

  scan();

  const observer = new MutationObserver(() => {
    scan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
