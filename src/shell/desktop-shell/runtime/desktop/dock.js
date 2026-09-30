/** Register before Alpine starts; load animation and geometry for mounted Docks. */
export function registerDock(Alpine) {
  Alpine.data('dock', () => ({
    _dockGeneration: 0,
    _dockCleanup: null,

    async init() {
      const generation = ++this._dockGeneration;
      this._dockCleanup?.();
      this._dockCleanup = null;
      let runtime;
      try {
        runtime = await import('./dock-runtime.js');
      } catch (error) {
        if (generation === this._dockGeneration) throw error;
        return;
      }
      if (generation !== this._dockGeneration) return;
      this._dockCleanup = runtime.mountDock(this);
    },

    destroy() {
      this._dockGeneration++;
      this._dockCleanup?.();
      this._dockCleanup = null;
    }
  }));
}
