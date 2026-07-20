const LOADING_OVERLAY_SHOW_DELAY = 120;
const LOADING_OVERLAY_MIN_VISIBLE = 300;
const LOADING_OVERLAY_FADE_DURATION = 220;

export function setBusyState(target, busy) {
  if (!target) return;

  target.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export function clearBusyState(target) {
  setBusyState(target, false);
}

function getWindowLoadingRoot(scope) {
  if (!scope) return null;
  if (scope.matches?.('[data-window-content-root]')) return scope;
  return scope.querySelector?.('[data-window-content-root]') || scope;
}

function getControllerOverlay(controllerOrOverlay) {
  return controllerOrOverlay?.overlay || controllerOrOverlay;
}

export function createWindowLoadingController(scope, options = {}) {
  const contentRoot = getWindowLoadingRoot(scope);
  const overlay = contentRoot?.querySelector?.('[data-window-loading-overlay]');
  const showDelay = options.showDelay ?? LOADING_OVERLAY_SHOW_DELAY;
  const minVisible = options.minVisible ?? LOADING_OVERLAY_MIN_VISIBLE;
  const fadeDuration = options.fadeDuration ?? LOADING_OVERLAY_FADE_DURATION;

  let showTimer = null;
  let shownAt = 0;
  let visible = false;
  let finished = false;
  let finishTimer = null;
  let fadeTimer = null;
  let finishPromise = null;
  let resolveFinish = null;

  const clearShowTimer = () => {
    if (!showTimer) return;
    clearTimeout(showTimer);
    showTimer = null;
  };

  const reveal = () => {
    if (finished || !overlay) return;
    visible = true;
    shownAt = Date.now();
    overlay.removeAttribute('data-fading');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.display = '';
  };

  const clearFinishTimers = () => {
    if (finishTimer) clearTimeout(finishTimer);
    if (fadeTimer) clearTimeout(fadeTimer);
    finishTimer = null;
    fadeTimer = null;
  };

  const settleFinish = () => {
    resolveFinish?.();
    resolveFinish = null;
    finishPromise = null;
  };

  const concealImmediately = () => {
    clearFinishTimers();
    if (overlay) {
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.display = 'none';
      overlay.removeAttribute('data-fading');
    }
    setBusyState(contentRoot, false);
    settleFinish();
  };

  return {
    overlay,
    start() {
      setBusyState(contentRoot, true);
      if (!overlay) return this;

      overlay.removeAttribute('data-fading');
      if (showDelay <= 0) {
        reveal();
      } else {
        showTimer = setTimeout(reveal, showDelay);
      }
      return this;
    },
    finish(options = {}) {
      finished = true;
      clearShowTimer();

      if (options.immediate) {
        concealImmediately();
        return Promise.resolve();
      }

      if (finishPromise) return finishPromise;

      if (!overlay || !visible || !overlay.isConnected) {
        setBusyState(contentRoot, false);
        return Promise.resolve();
      }

      const elapsed = Date.now() - shownAt;
      const remaining = Math.max(0, minVisible - elapsed);

      finishPromise = new Promise((resolve) => {
        resolveFinish = resolve;
        finishTimer = setTimeout(() => {
          finishTimer = null;
          overlay.setAttribute('aria-hidden', 'true');
          overlay.setAttribute('data-fading', '');
          fadeTimer = setTimeout(() => {
            fadeTimer = null;
            overlay.style.display = 'none';
            overlay.removeAttribute('data-fading');
            setBusyState(contentRoot, false);
            settleFinish();
          }, fadeDuration);
        }, remaining);
      });
      return finishPromise;
    }
  };
}

export function showOverlay(contentRoot, options = {}) {
  return createWindowLoadingController(contentRoot, {
    showDelay: options.showDelay ?? LOADING_OVERLAY_SHOW_DELAY,
    minVisible: options.minVisible ?? LOADING_OVERLAY_MIN_VISIBLE,
    fadeDuration: options.fadeDuration ?? LOADING_OVERLAY_FADE_DURATION
  }).start();
}

export function hideOverlay(contentRoot, controllerOrOverlay, options = {}) {
  if (controllerOrOverlay?.finish) {
    return controllerOrOverlay.finish(options);
  }

  const overlay = getControllerOverlay(controllerOrOverlay);
  if (!overlay) {
    setBusyState(contentRoot, false);
    return Promise.resolve();
  }

  overlay.setAttribute('aria-hidden', 'true');
  if (options.immediate) {
    overlay.style.display = 'none';
    overlay.removeAttribute('data-fading');
    setBusyState(contentRoot, false);
    return Promise.resolve();
  }

  overlay.setAttribute('data-fading', '');
  return new Promise((resolve) => {
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.removeAttribute('data-fading');
      setBusyState(contentRoot, false);
      resolve();
    }, LOADING_OVERLAY_FADE_DURATION);
  });
}

export function hasLoadingOverlay(controllerOrOverlay) {
  return !!getControllerOverlay(controllerOrOverlay);
}
