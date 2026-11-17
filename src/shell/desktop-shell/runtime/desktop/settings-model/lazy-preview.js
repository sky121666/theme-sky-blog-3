import { createBoundedModuleLoader } from '../../shared/lazy-theme-config-client.js';

// Only the settings editor can preview/restore desktop appearance. A normal
// desktop visit or an anonymous settings click must not download this module.
export const loadSettingsPreview = createBoundedModuleLoader(() => import('./preview.js'), { label: '桌面设置预览' });
