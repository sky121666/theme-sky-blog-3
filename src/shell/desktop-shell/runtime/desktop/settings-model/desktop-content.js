import { cloneThemeSettingsValue, resolveThemeConfigContainer } from '../theme-settings-core.js';
import { DESKTOP_ICON_NODE_SPAN, computeDefaultDesktopIconPlacement, normalizeDesktopIconHref } from '../../icons/bootstrap.js';
import { normalizeWidgetInstance } from '../../widgets/catalog-core.js';

const COLLECTIONS = {
  custom_icons: { prefix: 'icon-custom-' },
  categories: { prefix: 'icon-category-', source: 'categories', subtype: 'folder', app: 'explorer-categories' },
  tags: { prefix: 'icon-tag-', source: 'tags', subtype: 'folder', app: 'explorer-tags' },
  posts: { prefix: 'icon-post-', source: 'posts', subtype: 'document', app: 'reader' },
  single_pages: { prefix: 'icon-page-', source: 'singlepages', subtype: 'document', app: 'reader' }
};

function parseObject(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) { return null; }
}

function itemName(item) {
  return typeof item === 'string' ? item : item?.name ?? item?.metadata?.name ?? item?.value;
}

function collectionMap(items) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [itemName(item), item])
    .filter(([name]) => typeof name === 'string' && name));
}

function customProperties(item) {
  const link = normalizeDesktopIconHref(item.href);
  if (!link.valid) throw new Error(`桌面图标“${item.name}”的链接无效，请检查后重试。`);
  return {
    href: link.href,
    subtype: item.type || 'folder',
    external: item.external === true,
    pjax: link.pjax && item.external !== true
  };
}

function customChanged(previous, next) {
  return previous.href !== next.href || (previous.type || 'folder') !== (next.type || 'folder')
    || (previous.external === true) !== (next.external === true);
}

function resourceIcon(definition, name, resources) {
  const resource = resources?.[definition.source]?.find((item) => item.name === name);
  const link = normalizeDesktopIconHref(resource?.permalink);
  if (!resource || resource.disabled || !resource.permalink || !link.valid || link.href === '#') {
    throw new Error(`桌面资源“${name}”暂不可用，请刷新对应分类、标签、文章或单页列表后重试。`);
  }
  return {
    title: resource.label || name,
    href: link.href,
    subtype: definition.subtype,
    external: link.external,
    pjax: link.pjax,
    pjaxApp: definition.app,
    dataId: name
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function findPlacement(layout) {
  const rectangles = [];
  let index = 0;
  for (const icon of layout.icons) {
    if (!icon || icon.deleted || !icon.key) continue;
    const fallback = computeDefaultDesktopIconPlacement(index++, layout.columns || 12, 8);
    rectangles.push({
      x: positiveInteger(icon.x ?? icon.baseX, fallback.x),
      y: positiveInteger(icon.y ?? icon.baseY, fallback.y),
      ...DESKTOP_ICON_NODE_SPAN
    });
  }
  for (const instance of Array.isArray(layout.instances) ? layout.instances : []) {
    const widget = normalizeWidgetInstance(instance);
    if (widget.hidden) continue;
    const node = instance?.realNode || instance;
    rectangles.push({
      x: widget.x, y: widget.y,
      w: Math.max(widget.w, positiveInteger(node?.w, widget.w)),
      h: Math.max(widget.h, positiveInteger(node?.h, widget.h))
    });
  }
  // An empty column starts at 1 or just beyond an occupied rectangle. This
  // avoids unbounded scanning when old data has an unusually large span.
  const columns = [...new Set([1, ...rectangles.map((rect) => rect.x + rect.w)])].sort((a, b) => a - b);
  const span = DESKTOP_ICON_NODE_SPAN;
  for (const x of columns) {
    for (let y = 1; y <= 8; y += span.h) {
      if (!rectangles.some((rect) => x < rect.x + rect.w && x + span.w > rect.x
        && y < rect.y + rect.h && y + span.h > rect.y)) return { x, y };
    }
  }
  throw new Error('无法为新增桌面图标找到空位，请先整理桌面布局。');
}

/**
 * Merge only explicit backend selection changes into an existing full layout.
 * The config passed to previousConfig must be the latest server configuration
 * from the same mutation; missing it intentionally produces no inferred delta.
 */
export function syncDesktopSettingsToLayout(nextConfig, changedPaths, { previousConfig = nextConfig, resources = {} } = {}) {
  const groups = [...new Set(changedPaths || [])]
    .filter((path) => path.startsWith('desktop.icons.'))
    .map((path) => path.slice('desktop.icons.'.length))
    .filter((group) => Object.hasOwn(COLLECTIONS, group));
  if (!groups.length) return nextConfig;

  const source = resolveThemeConfigContainer(nextConfig);
  const desktopGroup = parseObject(source.default_layout);
  const rawLayout = desktopGroup?.layout_json;
  const layout = parseObject(rawLayout);
  // Array/node/position-only formats retain the legacy merge path. Do not
  // promote them to full definitions merely by visiting or saving settings.
  if (!layout || layout.hasFullIconDefs !== true || Array.isArray(layout.nodes) || !Array.isArray(layout.icons)) return nextConfig;
  const previous = resolveThemeConfigContainer(previousConfig);
  const workingLayout = cloneThemeSettingsValue(layout);
  let changed = false;

  for (const group of groups) {
    const definition = COLLECTIONS[group];
    const before = collectionMap(previous.desktop?.icons?.[group]);
    const after = collectionMap(source.desktop?.icons?.[group]);
    for (const name of before.keys()) {
      if (after.has(name)) continue;
      const key = definition.prefix + name;
      const index = workingLayout.icons.findIndex((icon) => icon?.key === key);
      if (index < 0) workingLayout.icons.push({ key, deleted: true });
      else if (workingLayout.icons[index].deleted === true) continue;
      else workingLayout.icons[index] = { ...workingLayout.icons[index], deleted: true };
      changed = true;
    }
    for (const [name, item] of after) {
      const added = !before.has(name);
      if (!added && (group !== 'custom_icons' || !customChanged(before.get(name), item))) continue;
      const key = definition.prefix + name;
      const index = workingLayout.icons.findIndex((icon) => icon?.key === key);
      const existing = index < 0 ? null : workingLayout.icons[index];
      if (!added) {
        // Editing a remaining backend definition is not an undelete action.
        if (!existing || existing.deleted) continue;
        const properties = customProperties(item);
        workingLayout.icons[index] = {
          ...existing, ...properties,
          ...(existing.href !== properties.href && existing.pjaxApp ? { pjaxApp: '' } : {})
        };
      } else {
        const properties = group === 'custom_icons'
          ? { title: name, ...customProperties(item), pjaxApp: '', dataId: name }
          : resourceIcon(definition, name, resources);
        if (existing && !existing.deleted) {
          // A desktop-created item can predate its backend selection. Its
          // explicit display title and coordinates continue to belong to it.
          workingLayout.icons[index] = { ...existing, ...properties, title: existing.title ?? properties.title };
        } else {
          const { deleted: _deleted, ...metadata } = existing || {};
          const icon = { ...metadata, key, ...properties, ...findPlacement(workingLayout) };
          if (index < 0) workingLayout.icons.push(icon);
          else workingLayout.icons[index] = icon;
        }
      }
      changed = true;
    }
  }
  if (!changed) return nextConfig;
  const result = cloneThemeSettingsValue(nextConfig);
  const target = resolveThemeConfigContainer(result);
  const updatedGroup = { ...desktopGroup, layout_json: JSON.stringify(workingLayout, null, 2) };
  target.default_layout = typeof source.default_layout === 'string' ? JSON.stringify(updatedGroup) : updatedGroup;
  return result;
}
