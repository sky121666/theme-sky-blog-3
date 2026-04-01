import { registerShellComponents } from './desktop/shell.js';
import { registerDesktopSurface } from './desktop/surface/index.js';

export function registerComponents(Alpine) {
  registerShellComponents(Alpine);
  registerDesktopSurface(Alpine);
}
