/**
 * 主题外观模式管理
 */

export function resolveThemeMode() {
  const root = document.documentElement;
  const defaultTheme = root?.dataset?.defaultTheme || 'system';
  const savedTheme = localStorage.getItem('theme');
  return savedTheme || defaultTheme;
}

export function prefersReducedThemeMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

let themeTransitionCleanupTimer = 0;

export function runThemeTransition(apply) {
  const root = document.documentElement;

  if (typeof apply !== 'function' || prefersReducedThemeMotion()) {
    apply?.();
    return;
  }

  if (themeTransitionCleanupTimer) {
    window.clearTimeout(themeTransitionCleanupTimer);
    themeTransitionCleanupTimer = 0;
  }

  root.classList.add('theme-transitioning');
  const cleanup = (delay = 0) => {
    themeTransitionCleanupTimer = window.setTimeout(() => {
      root.classList.remove('theme-transitioning');
      themeTransitionCleanupTimer = 0;
    }, delay);
  };

  if (typeof document.startViewTransition === 'function') {
    const transition = document.startViewTransition(() => {
      apply();
    });
    transition.finished.then(cleanup, cleanup);
    return;
  }

  apply();
  cleanup(280);
}

export function applyRootThemeState(mode, mediaQuery) {
  const root = document.documentElement;
  const themeMode = mode || 'system';
  const isDark = themeMode === 'dark' || (themeMode === 'system' && !!mediaQuery?.matches);

  root.classList.remove('dark', 'light', 'system', 'color-scheme-auto', 'color-scheme-dark', 'color-scheme-light');
  root.classList.add(themeMode === 'system' ? 'color-scheme-auto' : `color-scheme-${themeMode}`);
  root.classList.add(themeMode);
  root.setAttribute('data-color-scheme', themeMode);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  return isDark;
}
