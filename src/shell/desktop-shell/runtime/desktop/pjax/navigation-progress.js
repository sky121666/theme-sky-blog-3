export function createNavigationProgress(progress) {
  let timer = null;
  let advanceTimer = null;
  let visible = false;
  // NProgress.done() removes the global node from nested timers. Owning the
  // timers and synchronous cleanup keeps an old completion off the next bar.
  progress.configure({ trickle: false, speed: 0 });
  function advance() {
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      if (!visible) return;
      progress.trickle();
      advance();
    }, 120);
  }
  return {
    start() {
      if (timer !== null || visible) return;
      timer = setTimeout(() => {
        timer = null;
        visible = true;
        progress.start();
        advance();
      }, 140);
    },
    finish() {
      if (timer !== null) clearTimeout(timer);
      if (advanceTimer !== null) clearTimeout(advanceTimer);
      timer = null;
      advanceTimer = null;
      if (!visible) return;
      visible = false;
      progress.status = null;
      progress.remove();
    }
  };
}
