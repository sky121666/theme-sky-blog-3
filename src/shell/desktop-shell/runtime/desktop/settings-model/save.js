import { applyThemeSettingsDraftToConfig, buildThemeSettingsDraft, themeSettingsValueAt, SETTINGS_FIELDS } from '../theme-settings-core.js';
import { normalizeDesktopIconHref } from '../../icons/bootstrap.js';
import { syncDesktopSettingsToLayout } from './desktop-content.js';

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function mergeSettingsChanges(latestConfig, draft, paths, { baseline, resources = {} } = {}) {
  const latest = buildThemeSettingsDraft(latestConfig);
  if (baseline) {
    for (const path of paths) {
      const current = themeSettingsValueAt(latest, path);
      if (!equal(current, themeSettingsValueAt(baseline, path)) && !equal(current, themeSettingsValueAt(draft, path))) {
        const label = SETTINGS_FIELDS.find((field) => field.path === path)?.label || path;
        throw new Error(`“${label}”已在其他位置修改。本次草稿已保留，请核对后重新打开设置。`);
      }
    }
  }
  if (paths.includes('desktop.icons.custom_icons')) {
    const names = new Set();
    for (const item of draft.desktop.icons.custom_icons) {
      if (!item.name.trim() || names.has(item.name)) throw new Error('桌面图标名称不能为空或重复，请检查自定义图标。');
      if (!normalizeDesktopIconHref(item.href).valid) throw new Error(`桌面图标“${item.name}”的链接无效。`);
      names.add(item.name);
    }
  }
  for (const path of paths.filter((key) => key === 'navigation.header.menu_name' || key === 'navigation.dock.menu_name')) {
    const name = themeSettingsValueAt(draft, path);
    if (name && !resources.menus?.some((item) => item.name === name && !item.disabled)) {
      throw new Error('所选菜单尚未加载或已不可用，请刷新菜单列表后重新选择。');
    }
  }
  return syncDesktopSettingsToLayout(applyThemeSettingsDraftToConfig(latestConfig, draft, paths), paths, { previousConfig: latestConfig, resources });
}
