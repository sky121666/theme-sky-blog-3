const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function initErrorDialog(root = document) {
  if (root.body?.dataset?.errorPage !== 'true') return null;
  const layer = root.querySelector('.error-desktop-layer');
  const dialog = layer?.querySelector('[role="alertdialog"]');
  if (!layer || !dialog) return null;

  Array.from(root.body.children).forEach((child) => {
    if (child === layer || child.tagName === 'SCRIPT') return;
    child.inert = true;
    child.setAttribute('aria-hidden', 'true');
  });

  const focusDialog = () => dialog.focus({ preventScroll: true });
  requestAnimationFrame(focusDialog);

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      focusDialog();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeydown);
  return () => document.removeEventListener('keydown', onKeydown);
}
