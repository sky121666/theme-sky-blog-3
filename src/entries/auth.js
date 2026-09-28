function isWindowsPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /win/i.test(platform);
}

let volatileAuthTheme = null;

function resolveTheme(root = document.documentElement) {
  if (volatileAuthTheme !== null) return volatileAuthTheme;
  const validModes = ['light', 'dark', 'system'];
  const configured = root?.getAttribute('data-default-theme');
  const defaultTheme = validModes.includes(configured) ? configured : 'system';
  try {
    const saved = localStorage.getItem('theme');
    return validModes.includes(saved) ? saved : defaultTheme;
  } catch (_error) {
    return defaultTheme;
  }
}

function isDarkTheme(theme) {
  return theme === 'dark'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyTheme(theme, root = document.documentElement) {
  const nextTheme = theme || 'system';
  const dark = isDarkTheme(nextTheme);

  root.classList.remove('dark', 'light', 'system', 'color-scheme-auto', 'color-scheme-dark', 'color-scheme-light');
  root.classList.add(nextTheme === 'system' ? 'color-scheme-auto' : `color-scheme-${nextTheme}`);
  root.classList.add(nextTheme);
  root.setAttribute('data-color-scheme', nextTheme);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
  if (dark) root.classList.add('dark');

  document.querySelectorAll('[data-auth-theme-toggle]').forEach((button) => {
    const showSun = dark;
    button.setAttribute('data-theme-mode', nextTheme);
    button.setAttribute('aria-label', showSun ? '切换到亮色模式' : '切换到暗色模式');
    button.setAttribute('title', showSun ? '切换到亮色模式' : '切换到暗色模式');

    const moon = button.querySelector('.auth-theme-toggle-icon-moon');
    const sun = button.querySelector('.auth-theme-toggle-icon-sun');
    if (moon) moon.hidden = showSun;
    if (sun) sun.hidden = !showSun;
  });
}

export function initAuthThemeToggle(root = document) {
  const buttons = root.querySelectorAll('[data-auth-theme-toggle]');
  if (!buttons.length) return null;
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const onClick = () => {
    const current = resolveTheme(document.documentElement);
    const next = isDarkTheme(current) ? 'light' : 'dark';
    volatileAuthTheme = next;
    try {
      localStorage.setItem('theme', next);
      volatileAuthTheme = null;
    } catch (_error) {
      // Preserve the current tab's choice when browser storage is unavailable.
    }
    applyTheme(next, document.documentElement);
  };

  buttons.forEach((button) => {
    if (button.dataset.themeToggleBound === 'true') return;
    button.dataset.themeToggleBound = 'true';
    button.addEventListener('click', onClick);
  });

  const onSystemThemeChange = () => {
    if (resolveTheme(document.documentElement) !== 'system') return;
    applyTheme('system', document.documentElement);
  };
  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', onSystemThemeChange);
  } else {
    systemThemeQuery.addListener?.(onSystemThemeChange);
  }

  applyTheme(resolveTheme(document.documentElement), document.documentElement);

  return () => {
    if (typeof systemThemeQuery.removeEventListener === 'function') {
      systemThemeQuery.removeEventListener('change', onSystemThemeChange);
    } else {
      systemThemeQuery.removeListener?.(onSystemThemeChange);
    }
    buttons.forEach((button) => {
      if (button.dataset.themeToggleBound !== 'true') return;
      button.dataset.themeToggleBound = 'false';
      button.removeEventListener('click', onClick);
    });
  };
}

export function initAuthBackLink(root = document) {
  const buttons = root.querySelectorAll('[data-auth-go-back]');
  if (!buttons.length) return null;

  const onClick = (event) => {
    event.preventDefault();
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/';
  };

  buttons.forEach((button) => {
    if (button.dataset.authBackBound === 'true') return;
    button.dataset.authBackBound = 'true';
    button.addEventListener('click', onClick);
  });

  return () => {
    buttons.forEach((button) => {
      if (button.dataset.authBackBound !== 'true') return;
      button.dataset.authBackBound = 'false';
      button.removeEventListener('click', onClick);
    });
  };
}

export function initAuthToasts(root = document) {
  const host = root.querySelector('[data-auth-toast-host]');
  const toasts = host ? host.querySelectorAll('[data-auth-toast]') : root.querySelectorAll('[data-auth-toast]');
  if (!toasts.length) return null;

  const timers = [];
  toasts.forEach((toast, index) => {
    const timer = window.setTimeout(() => {
      toast.classList.add('is-hidden');
    }, 2800 + index * 180);
    timers.push(timer);
  });

  return () => {
    timers.forEach((timer) => window.clearTimeout(timer));
  };
}

function setAuthLockscreenStepState(step, active) {
  if (!step) return;
  step.setAttribute('aria-hidden', active ? 'false' : 'true');
  if (active) {
    step.removeAttribute('inert');
    step.inert = false;
    return;
  }
  step.setAttribute('inert', '');
  step.inert = true;
}

export function initAuthLockscreenFlow(root = document) {
  const form = root.querySelector('#login-form');
  const nativeFields = form?.querySelector('[data-auth-lockscreen-native]');
  if (!form || !nativeFields || form.dataset.authLockscreenBound === 'true') return null;

  const identityStep = nativeFields.querySelector('[data-auth-lockscreen-step="identity"]');
  const passwordStep = nativeFields.querySelector('[data-auth-lockscreen-step="password"]');
  const usernameInput = form.querySelector('#username');
  const passwordInput = form.querySelector('#password');
  const advanceButton = form.querySelector('[data-auth-lockscreen-advance]');
  const backButton = form.querySelector('[data-auth-lockscreen-back]');
  const passwordSubmit = form.querySelector('[data-auth-lockscreen-submit]');
  const accountLabel = form.querySelector('[data-auth-lockscreen-account-label]');
  const status = form.querySelector('[data-auth-lockscreen-status]');

  if (!identityStep || !passwordStep || !usernameInput || !passwordInput || !advanceButton || !passwordSubmit) {
    return null;
  }

  const originalPasswordRequired = passwordInput.required;
  const originalSubmitDisabled = passwordSubmit.disabled;
  let currentStep = 'identity';
  let focusTimer = 0;

  const announce = (message) => {
    if (!status) return;
    status.textContent = '';
    window.requestAnimationFrame(() => {
      status.textContent = message;
    });
  };

  const syncAccountLabel = () => {
    if (!accountLabel) return;
    accountLabel.textContent = usernameInput.value.trim() || '账户';
  };

  const setStep = (nextStep, { focus = true, message = '' } = {}) => {
    const passwordActive = nextStep === 'password';
    currentStep = passwordActive ? 'password' : 'identity';
    form.dataset.authLockscreenStep = currentStep;
    passwordInput.required = passwordActive && originalPasswordRequired;
    passwordSubmit.disabled = !passwordActive;
    setAuthLockscreenStepState(identityStep, !passwordActive);
    setAuthLockscreenStepState(passwordStep, passwordActive);
    syncAccountLabel();

    if (message) announce(message);
    if (!focus) return;

    window.clearTimeout(focusTimer);
    const focusDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
    focusTimer = window.setTimeout(() => {
      const target = passwordActive ? passwordInput : usernameInput;
      target.focus({ preventScroll: true });
    }, focusDelay);
  };

  const advance = () => {
    if (!usernameInput.reportValidity()) {
      usernameInput.focus({ preventScroll: true });
      return false;
    }
    setStep('password', { message: '请输入密码' });
    return true;
  };

  const onAdvance = (event) => {
    event.preventDefault();
    advance();
  };

  const onBack = (event) => {
    event.preventDefault();
    setStep('identity', { message: '请修改用户名或邮箱' });
  };

  const onIdentityKeydown = (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    advance();
  };

  const onSubmit = (event) => {
    if (currentStep !== 'identity') return;
    event.preventDefault();
    advance();
  };

  form.dataset.authLockscreenBound = 'true';
  form.dataset.authLockscreenReady = 'true';
  advanceButton.addEventListener('click', onAdvance);
  backButton?.addEventListener('click', onBack);
  usernameInput.addEventListener('keydown', onIdentityKeydown);
  usernameInput.addEventListener('input', syncAccountLabel);
  form.addEventListener('submit', onSubmit, true);
  setStep('identity', { focus: false });

  return () => {
    window.clearTimeout(focusTimer);
    advanceButton.removeEventListener('click', onAdvance);
    backButton?.removeEventListener('click', onBack);
    usernameInput.removeEventListener('keydown', onIdentityKeydown);
    usernameInput.removeEventListener('input', syncAccountLabel);
    form.removeEventListener('submit', onSubmit, true);
    passwordInput.required = originalPasswordRequired;
    passwordSubmit.disabled = originalSubmitDisabled;
    identityStep.removeAttribute('inert');
    passwordStep.removeAttribute('inert');
    identityStep.removeAttribute('aria-hidden');
    passwordStep.setAttribute('aria-hidden', 'true');
    delete form.dataset.authLockscreenBound;
    delete form.dataset.authLockscreenReady;
    delete form.dataset.authLockscreenStep;
  };
}

function computeThumbSize(trackHeight, viewportHeight, scrollHeight) {
  const rawThumbHeight = Math.round((viewportHeight / scrollHeight) * trackHeight);
  const maxThumbHeight = Math.max(36, Math.round(trackHeight * 0.46));
  return Math.min(maxThumbHeight, Math.max(36, rawThumbHeight));
}

let authScrollbarCleanup = null;

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

export function initAuthScrollbars(root = document) {
  if (typeof authScrollbarCleanup === 'function') {
    authScrollbarCleanup();
    authScrollbarCleanup = null;
  }

  const body = root.body || document.body;
  if (!body?.classList.contains('auth-gateway-page')) return null;
  if (!isWindowsPlatform()) return null;

  syncAuthScrollbar();

  let activeTimer = 0;
  let dragState = null;
  const cleanups = [];
  const addCleanup = (fn) => cleanups.push(fn);
  const markActive = () => {
    body.classList.add('auth-scrollbar-active');
    window.clearTimeout(activeTimer);
    activeTimer = window.setTimeout(() => {
      body.classList.remove('auth-scrollbar-active');
    }, 520);
  };

  const onScroll = () => {
    syncAuthScrollbar();
    markActive();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  addCleanup(() => window.removeEventListener('scroll', onScroll));

  const onResize = () => {
    syncAuthScrollbar();
  };
  window.addEventListener('resize', onResize, { passive: true });
  addCleanup(() => window.removeEventListener('resize', onResize));

  const onFocusIn = () => {
    syncAuthScrollbar();
    markActive();
  };
  document.addEventListener('focusin', onFocusIn, { passive: true });
  addCleanup(() => document.removeEventListener('focusin', onFocusIn));

  const onPointerDown = (event) => {
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
  };
  document.addEventListener('pointerdown', onPointerDown, { capture: true });
  addCleanup(() => document.removeEventListener('pointerdown', onPointerDown, { capture: true }));

  const stopDrag = () => {
    if (!dragState) return;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    dragState = null;
  };

  const onDragMove = (event) => {
    const scrollEl = document.scrollingElement;
    if (!dragState || !scrollEl || event.pointerId !== dragState.pointerId) return;

    const delta = event.clientY - dragState.startClientY;
    const nextScrollTop = dragState.startScrollTop + (delta / dragState.maxThumbTop) * dragState.maxScrollTop;
    scrollEl.scrollTop = nextScrollTop;
    syncAuthScrollbar();
    markActive();
    event.preventDefault();
  };
  window.addEventListener('pointermove', onDragMove, { capture: true });
  addCleanup(() => window.removeEventListener('pointermove', onDragMove, { capture: true }));

  window.addEventListener('pointerup', stopDrag, { capture: true });
  window.addEventListener('pointercancel', stopDrag, { capture: true });
  addCleanup(() => window.removeEventListener('pointerup', stopDrag, { capture: true }));
  addCleanup(() => window.removeEventListener('pointercancel', stopDrag, { capture: true }));

  const onLoad = () => syncAuthScrollbar();
  window.addEventListener('load', onLoad, { once: true });

  authScrollbarCleanup = () => {
    window.clearTimeout(activeTimer);
    stopDrag();
    body.classList.remove('auth-scrollbar-active');
    cleanups.forEach((cleanup) => cleanup());
  };

  return authScrollbarCleanup;
}
