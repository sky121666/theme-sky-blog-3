/**
 * Save-path desktop layout helpers.
 */

import { cloneJsonValue } from '../shared/utils.js';
import { serializeDesktopIconInstance, normalizeDesktopIconHref, mergeDesktopIconLayout } from '../icons/index.js';
import { DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION } from './debug-core.js';
import { serializeWidgetInstance, createWidgetInstance } from './catalog-core.js';
import { layoutConflict } from './persistence-conflict.js';

function buildDesktopWidgetLayoutPayload(layoutVersion, widgets, icons = [], columns = null) {
  return {
    version: DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
    layoutVersion,
    ...(columns ? { columns } : {}),
    instances: widgets
      .filter((widget) => !widget.hidden)
      .map((widget) => serializeWidgetInstance(widget)),
    // hasFullIconDefs = true 启用前端自管理模式：
    // icon 含完整定义（href/title/subtype…），deleted:true 为 tombstone
    hasFullIconDefs: true,
    icons: icons.map((icon) =>
      // tombstone 对象直接透传，普通图标走全字段序列化
      icon.deleted === true ? { key: icon.key, deleted: true } : serializeDesktopIconInstance(icon)
    )
  };
}

export function buildDesktopLayoutJsonString(layoutVersion, widgets, icons = [], columns = null) {
  return JSON.stringify(buildDesktopWidgetLayoutPayload(layoutVersion, widgets, icons, columns), null, 2);
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function selectedContentName(value) {
  return typeof value === 'string' ? value : value?.name ?? value?.metadata?.name ?? value?.value;
}

const customFields = [['href', 'href', '#'], ['subtype', 'type', 'folder'], ['external', 'external', false]];

function customValue(icon, field, fallback) {
  if (field === 'href') return normalizeDesktopIconHref(icon?.[field] || fallback).href;
  return field === 'external' ? icon?.[field] === true : icon?.[field] || fallback;
}

function sameCustomFields(left, right) {
  return customFields.every(([field, , fallback]) => customValue(left, field, fallback) === customValue(right, field, fallback));
}

export function assertPendingDesktopIconConflicts(surface, layoutJson) {
  const icons = parseJsonObject(layoutJson)?.icons || [];
  for (const saved of surface.pendingCustomIconConflicts || []) {
    const local = icons.find((icon) => icon.key === saved.key);
    if (local && (local.deleted || !sameCustomFields(local, saved))) throw layoutConflict();
  }
  surface.pendingCustomIconConflicts = [];
}

// The saved layout is the editor's baseline, never the latest config's layout.
function mergeCustomIconEdits(container, layoutJson, baselineLayoutJson) {
  const payload = parseJsonObject(layoutJson);
  if (!payload || payload.hasFullIconDefs !== true || !Array.isArray(payload.icons)) return layoutJson;
  const baseline = parseJsonObject(baselineLayoutJson);
  const oldIcons = new Map((baseline?.hasFullIconDefs === true && Array.isArray(baseline.icons) ? baseline.icons : []).filter((icon) => icon?.key).map((icon) => [icon.key, icon]));
  const backend = container.desktop?.icons;
  if (!backend) return layoutJson;
  const items = backend.custom_icons ?? [];
  if (!Array.isArray(items)) throw layoutConflict();
  const remote = new Map(items.map((item) => [item?.name, item]));
  if (remote.size !== items.length || items.some((item) => !normalizeDesktopIconHref(item?.href || '#').valid)) throw layoutConflict();
  const localKeys = new Set();
  const needsPlacement = new Set();
  for (const icon of payload.icons) {
    if (!icon?.key?.startsWith('icon-custom-')) continue;
    if (localKeys.has(icon.key)) throw layoutConflict();
    localKeys.add(icon.key);
    const name = icon.key.slice('icon-custom-'.length);
    const old = oldIcons.get(icon.key);
    const current = remote.get(name);
    const oldActive = old && old.deleted !== true;
    const fieldsChanged = oldActive && !sameCustomFields(icon, old);
    const remoteChanged = oldActive && current && customFields.some(([local, field, fallback]) => customValue(current, field, fallback) !== customValue(old, local, fallback));
    if (icon.deleted === true) {
      if (oldActive && remoteChanged) throw layoutConflict();
      if (oldActive) remote.delete(name);
      else if (current) {
        // An old tombstone must not erase an entry reintroduced elsewhere.
        delete icon.deleted;
        needsPlacement.add(icon.key);
        icon.title ??= name;
        for (const [local, field, fallback] of customFields) icon[local] = customValue(current, field, fallback);
      } else if (!old && baseline?.hasFullIconDefs !== true) throw layoutConflict();
      continue;
    }
    if (oldActive && !current) {
      if (fieldsChanged) throw layoutConflict();
      Object.assign(icon, { deleted: true });
      continue;
    }
    if (!current) {
      const item = { name };
      for (const [local, field, fallback] of customFields) item[field] = customValue(icon, local, fallback);
      remote.set(name, item);
      continue;
    }
    for (const [local, field, fallback] of customFields) {
      const localValue = customValue(icon, local, fallback);
      const remoteValue = customValue(current, field, fallback);
      if (!oldActive) {
        // Without a complete baseline, a differing definition is ambiguous.
        if (localValue !== remoteValue) throw layoutConflict();
      } else {
        const oldValue = customValue(old, local, fallback);
        if (localValue !== oldValue) {
          if (remoteValue !== oldValue && remoteValue !== localValue) throw layoutConflict();
          current[field] = localValue;
        }
      }
      icon[local] = customValue(current, field, fallback);
    }
    if (oldActive && icon.href !== old.href) delete icon.pjaxApp;
    if (icon.external === true) icon.pjax = false;
  }
  for (const [name, item] of remote) {
    const key = `icon-custom-${name}`;
    if (localKeys.has(key)) continue;
    const icon = { ...(oldIcons.get(key) || {}), key, title: name };
    delete icon.deleted;
    for (const [local, field, fallback] of customFields) icon[local] = customValue(item, field, fallback);
    if (icon.external === true) icon.pjax = false;
    payload.icons.push(icon);
    needsPlacement.add(icon.key);
  }
  // Reuse the legacy placement path, which reserves both icons and widgets.
  const active = payload.icons.filter((icon) => icon.deleted !== true);
  const positioned = active.filter((icon) => Number(icon.x ?? icon.baseX) > 0 && Number(icon.y ?? icon.baseY) > 0);
  const placed = new Map(mergeDesktopIconLayout(active, { icons: positioned },
    (payload.instances || []).map((widget) => createWidgetInstance(widget.widget || '', widget)))
    .map((icon) => [icon.key, icon]));
  for (const icon of active) {
    if (needsPlacement.has(icon.key) && !positioned.includes(icon)) Object.assign(icon, { x: placed.get(icon.key).x, y: placed.get(icon.key).y });
  }
  backend.custom_icons = [...remote.values()];
  const merged = JSON.stringify(payload);
  return merged === JSON.stringify(parseJsonObject(layoutJson)) ? layoutJson : JSON.stringify(payload, null, 2);
}

export function reconcileSavedDesktopLayout(surface, submittedJson, savedJson, savedSnapshot, originalTombstones) {
  const payload = parseJsonObject(savedJson);
  if (savedJson === submittedJson || !payload?.hasFullIconDefs) return;
  const submitted = new Map((parseJsonObject(submittedJson)?.icons || []).map((icon) => [icon.key, icon]));
  const merged = new Map(payload.icons.map((icon) => [icon.key, icon]));
  const normalized = new Map(mergeDesktopIconLayout([], payload).map((icon) => [icon.key, {
    ...merged.get(icon.key), ...icon, subtype: merged.get(icon.key).subtype || 'folder'
  }]));
  const pendingTombstones = surface.iconTombstones.filter((icon) => !originalTombstones.has(icon));
  const pendingDeleted = new Set(pendingTombstones.map((icon) => icon.key));
  surface.icons = surface.icons.filter((icon) => {
    const old = submitted.get(icon.key);
    const saved = merged.get(icon.key);
    if (!old || !saved) return true;
    const untouched = sameCustomFields(icon, old);
    if (saved.deleted && untouched) return false;
    for (const [field, , fallback] of customFields) {
      if (!saved.deleted && customValue(icon, field, fallback) === customValue(old, field, fallback)) {
        icon[field] = field === 'href' ? normalized.get(icon.key).href : saved[field];
        if (field === 'href' && saved.href !== old.href) icon.pjaxApp = saved.pjaxApp || '';
      }
    }
    icon.pjax = normalizeDesktopIconHref(icon.href).pjax && !icon.external && icon.pjax !== false;
    return true;
  });
  const currentByKey = new Map(surface.icons.map((icon) => [icon.key, icon]));
  for (const [key, icon] of normalized) {
    if (submitted.has(key) && !submitted.get(key).deleted || pendingDeleted.has(key)) continue;
    const local = currentByKey.get(key);
    if (local) {
      if (!sameCustomFields(local, icon)) (surface.pendingCustomIconConflicts ||= []).push(icon);
    } else {
      const pos = mergeDesktopIconLayout([...surface.icons, icon], { icons: surface.icons }, surface.widgets)
        .find((item) => item.key === key);
      if (pos.x !== icon.x || pos.y !== icon.y) surface.serverLayoutMutationVersion++;
      surface.icons.push({ ...icon, x: pos.x, y: pos.y, baseX: pos.x, baseY: pos.y });
    }
  }
  const savedTombstones = payload.icons.filter((icon) => icon.deleted === true);
  surface.iconTombstones = [...new Map([...savedTombstones, ...pendingTombstones].map((icon) => [icon.key, icon])).values()];
  savedSnapshot.icons = [...normalized.values()];
  savedSnapshot.tombstones = savedTombstones;
}

function applyDesktopLayoutJsonToGroup(container, layoutJson, baselineLayoutJson) {
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    return false;
  }

  const mergeWithBaseline = baselineLayoutJson !== undefined;
  if (mergeWithBaseline) layoutJson = mergeCustomIconEdits(container, layoutJson, baselineLayoutJson);
  const baseline = parseJsonObject(baselineLayoutJson);
  const currentDesktopGroup = container.default_layout;

  if (typeof currentDesktopGroup === 'string') {
    const desktopGroup = parseJsonObject(currentDesktopGroup) || {};
    desktopGroup.layout_json = layoutJson;
    container.default_layout = JSON.stringify(desktopGroup);
  } else {
    const desktopGroup = currentDesktopGroup && typeof currentDesktopGroup === 'object' && !Array.isArray(currentDesktopGroup)
      ? currentDesktopGroup
      : {};
    container.default_layout = { ...desktopGroup, layout_json: layoutJson };
  }

  // 同步：当前端删除了后端设定的图标时，通过 tombstone 将其从后台主题设置中真实抹除
  const payload = parseJsonObject(layoutJson);
  if (payload && Array.isArray(payload.icons) && container.desktop?.icons) {
    const backendIcons = container.desktop.icons;
    const tombstoneKeys = payload.icons.filter((i) => i && i.deleted === true && i.key
      && (!mergeWithBaseline || (Array.isArray(baseline?.icons) && baseline.icons.some((old) => old.key === i.key && old.deleted !== true))))
      .map((i) => i.key);
    if (tombstoneKeys.length > 0) {
      if (!mergeWithBaseline && Array.isArray(backendIcons.custom_icons)) {
        backendIcons.custom_icons = backendIcons.custom_icons.filter(
          (item) => item && !tombstoneKeys.includes(`icon-custom-${item.name}`)
        );
      }
      if (Array.isArray(backendIcons.categories)) {
        backendIcons.categories = backendIcons.categories.filter(
          (item) => !tombstoneKeys.includes(`icon-category-${selectedContentName(item)}`)
        );
      }
      if (Array.isArray(backendIcons.tags)) {
        backendIcons.tags = backendIcons.tags.filter(
          (item) => !tombstoneKeys.includes(`icon-tag-${selectedContentName(item)}`)
        );
      }
      if (Array.isArray(backendIcons.posts)) {
        backendIcons.posts = backendIcons.posts.filter(
          (item) => !tombstoneKeys.includes(`icon-post-${selectedContentName(item)}`)
        );
      }
      if (Array.isArray(backendIcons.single_pages)) {
        backendIcons.single_pages = backendIcons.single_pages.filter(
          (item) => !tombstoneKeys.includes(`icon-page-${selectedContentName(item)}`)
        );
      }
    }

    // 将前端新增的图标推送到后端的 custom_icons 配置供管理
    const activeCustomIcons = payload.icons.filter(
      (i) => payload.hasFullIconDefs === true && i && i.deleted !== true
        && typeof i.key === 'string' && i.key.startsWith('icon-custom-')
    );
    if (!mergeWithBaseline && activeCustomIcons.length > 0) {
      if (!Array.isArray(backendIcons.custom_icons)) {
        backendIcons.custom_icons = [];
      }
      const existingByName = new Map(backendIcons.custom_icons.map((item) => [item?.name, item]));
      for (const icon of activeCustomIcons) {
        // The key owns identity; the desktop display title can be edited
        // independently and must never rename the backend entry.
        const newName = icon.key.replace('icon-custom-', '');
        const properties = { href: icon.href || '#', type: icon.subtype || 'folder', external: icon.external === true };
        const existing = existingByName.get(newName);
        if (existing) {
          Object.assign(existing, properties);
        } else {
          const item = { name: newName, ...properties };
          existingByName.set(newName, item);
          backendIcons.custom_icons.push(item);
        }
      }
    }
  }

  return true;
}

export function applyDesktopLayoutJsonToThemeConfig(config, layoutJson, baselineLayoutJson) {
  const nextConfig = cloneJsonValue(config) || {};

  if (nextConfig.spec?.value && applyDesktopLayoutJsonToGroup(nextConfig.spec.value, layoutJson, baselineLayoutJson)) {
    return nextConfig;
  }

  if (nextConfig.data && applyDesktopLayoutJsonToGroup(nextConfig.data, layoutJson, baselineLayoutJson)) {
    return nextConfig;
  }

  applyDesktopLayoutJsonToGroup(nextConfig, layoutJson, baselineLayoutJson);
  return nextConfig;
}
