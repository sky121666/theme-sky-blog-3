const loadStartupSignals = () => import('../../../../../shared/startup-signals.js');

// The module import can finish after the window closes. Generation guards keep
// that late import from starting a visual layer over the next task.
export function createStartupSettingsMethods(loadSignals = loadStartupSignals) {
  let generation = 0;
  let activeSignals = null;
  let activeFocusTarget = null;
  const restorePreviewFocus = (store, target, current) => {
    if (!target?.focus) return;
    // Alpine applies the disabled binding before the next frame. A confirmed
    // close clears open immediately, even while its exit transition is visible.
    window.requestAnimationFrame(() => {
      if (current !== generation || !store.visible || !store.open || store.startupPreviewing || target.isConnected === false) return;
      target.focus({ preventScroll: true });
    });
  };
  return {
    startupPreviewing: false,
    siteLogo: '',
    async previewStartup() {
      if (!this.visible || this.startupPreviewing || this.value('desktop.startup.mode') !== 'boot'
        || this.validationError('desktop.startup.logo_url')) return false;
      const current = ++generation;
      const focusTarget = globalThis.document?.activeElement;
      activeFocusTarget = focusTarget;
      this.startupPreviewing = true;
      const config = {
        mode: 'boot', frequency: this.value('desktop.startup.frequency'),
        logoMode: this.value('desktop.startup.logo_mode'), logoUrl: this.value('desktop.startup.logo_url'),
        siteLogo: this.siteLogo, scene: 'desktop'
      };
      try {
        const signals = await loadSignals();
        if (current !== generation || !this.visible) return false;
        activeSignals = signals;
        await signals.previewStartup(config);
        return true;
      } catch (_error) {
        if (current === generation) {
          this.statusTone = 'warning';
          this.statusMessage = '启动演示暂不可用，草稿仍保留。';
        }
        return false;
      } finally {
        if (current === generation) {
          activeSignals = null;
          activeFocusTarget = null;
          this.startupPreviewing = false;
          restorePreviewFocus(this, focusTarget, current);
        }
      }
    },
    cancelStartupPreview() {
      const current = ++generation;
      const focusTarget = activeFocusTarget;
      activeSignals?.cancelStartupPreview();
      activeSignals = null;
      activeFocusTarget = null;
      this.startupPreviewing = false;
      restorePreviewFocus(this, focusTarget, current);
    }
  };
}
