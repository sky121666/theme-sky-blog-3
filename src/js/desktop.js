import { registerShellComponents } from './desktop/shell.js';
import { registerDesktopSurface } from './desktop/surface.js';

export function registerComponents(Alpine) {
  registerShellComponents(Alpine);
  registerDesktopSurface(Alpine);
}
