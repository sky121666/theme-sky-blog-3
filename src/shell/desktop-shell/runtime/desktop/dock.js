import { signalStartupFailure } from '../../../../shared/startup-signals.js';

/** Register before Alpine starts; load animation and geometry for mounted Docks. */
export function registerDock(Alpine) {
  Alpine.data('dock', () => ({
    _dockGeneration: 0,
    _dockCleanup: null,

    async init() {
      const generation = ++this._dockGeneration;
      this._dockCleanup?.();
      this._dockCleanup = null;
      try {
        const runtime = await import('./dock-runtime.js');
        if (generation !== this._dockGeneration) return;
        this._dockCleanup = runtime.mountDock(this);
        if (!this._dockCleanup) signalStartupFailure();
      } catch (error) {
        if (generation === this._dockGeneration) {
          signalStartupFailure();
          throw error;
        }
      }
    },

    destroy() {
      this._dockGeneration++;
      this._dockCleanup?.();
      this._dockCleanup = null;
    }
  }));
}
