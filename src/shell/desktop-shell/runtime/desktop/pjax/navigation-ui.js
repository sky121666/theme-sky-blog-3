function dispatchMenubarClose() {
  window.dispatchEvent(new CustomEvent('theme-menubar-close'));
}

export function closeTransientNavigationUi() {
  document.documentElement.classList.add('theme-navigation-pending');
  dispatchMenubarClose();
}

export function clearTransientNavigationUi() {
  dispatchMenubarClose();
  document.documentElement.classList.remove('theme-navigation-pending');
}
