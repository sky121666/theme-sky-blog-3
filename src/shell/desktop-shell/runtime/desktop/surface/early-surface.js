/** Parser-time placeholders. No app data, resource requests, or saved-layout writes. */
import { calculateDockGeometry, readDockSettings } from '../dock-geometry.js';
import { readDesktopIconsBootstrap, mergeDesktopIconLayout } from '../../icons/bootstrap.js';
import { renderDesktopIconGraphic } from '../../icons/render.js';
import { normalizeDesktopWidgetProtocol } from '../../widgets/protocol.js';
import { parseDesktopLayoutPayload, mergeDesktopWidgetLayout } from '../../widgets/persistence-read.js';
import { measureDesktopGrid, projectDesktopLayout, desktopPlacementStyle, createDefaultDesktopIcons } from './layout-projection.js';

export function projectEarlyDesktopSurface(rawProtocol, rawIcons, viewport) {
  const protocol = normalizeDesktopWidgetProtocol(rawProtocol);
  const metrics = measureDesktopGrid({ ...viewport, gap: protocol.gap });
  const suppressWidgets = protocol.hideOnMobile && viewport.width <= 640;
  const layout = parseDesktopLayoutPayload(protocol.serverLayoutJson, protocol.layoutVersion);
  const widgets = mergeDesktopWidgetLayout([], layout);
  const options = { ...metrics, savedColumns: layout?.columns || protocol.columns, suppressWidgets };
  const initialWidgets = projectDesktopLayout({ ...options, widgets });
  const widgetPositions = new Map(initialWidgets.map((node) => [node.key, node]));
  const projectedWidgets = widgets.map((node) => ({ ...node, ...widgetPositions.get(node.key), kind: 'widget' }));
  const defaults = createDefaultDesktopIcons(readDesktopIconsBootstrap(rawIcons), metrics.currentColumns, metrics.maxVisibleRows);
  const icons = mergeDesktopIconLayout(defaults, layout, projectedWidgets, metrics.maxVisibleRows);
  const initialNodes = [...icons, ...projectedWidgets];
  const positions = projectDesktopLayout({ ...options, icons, widgets: projectedWidgets });
  const positionMap = new Map(positions.map((node) => [node.key, node]));
  const projectedNodes = initialNodes.map((node) => ({ ...node, ...positionMap.get(node.key) }));
  // Runtime also normalizes during its final integrity check before committing the DOM.
  const finalPositions = projectDesktopLayout({ ...options,
    icons: projectedNodes.filter((node) => node.kind === 'icon'),
    widgets: projectedNodes.filter((node) => node.kind !== 'icon')
  });
  const definitions = new Map([...icons, ...projectedWidgets].map((node) => [node.key, node]));
  const nodes = protocol.enabled && protocol.isHome
    ? finalPositions.map((node) => ({ ...definitions.get(node.key), ...node })).sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)
    : [];
  const gridWidth = suppressWidgets
    ? nodes.filter((node) => node.kind === 'icon').reduce((max, node) => Math.max(max, node.x), 1) * (metrics.cellSize + protocol.gap) - protocol.gap
    : metrics.currentColumns * (metrics.cellSize + protocol.gap) - protocol.gap;
  const rows = nodes.reduce((max, node) => Math.max(max, node.y + node.h - 1), metrics.maxVisibleRows);
  return { ...metrics, nodes, gap: protocol.gap, gridWidth, gridHeight: rows * (metrics.cellSize + protocol.gap) - protocol.gap };
}

function publishInitialDockGeometry(doc, win) {
  const dock = doc.querySelector('.dock-container');
  const bar = dock?.querySelector('.dock-bar');
  if (!dock || !bar) return;
  const pixels = (value, fallback = 0) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const settings = readDockSettings(dock.dataset, {
    reduceMotion: win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  });
  // Count the same actual SSR items used by the mounted Dock. Templates remain inert.
  const icons = Array.from(bar.querySelectorAll('.dock-icon')).filter((icon) =>
    !icon.hidden
    && !(icon.classList.contains('dock-settings-icon') && dock.dataset.settingsEnabled === 'false')
    && win.getComputedStyle(icon).display !== 'none');
  const separatorWidths = Array.from(bar.querySelectorAll('.dock-separator')).map((separator) => {
    const style = win.getComputedStyle(separator);
    return pixels(style.width) + pixels(style.marginLeft) + pixels(style.marginRight);
  });
  const geometry = calculateDockGeometry(settings, {
    viewportWidth: win.innerWidth,
    iconCount: icons.length,
    separatorWidths,
    bottomInset: pixels(win.getComputedStyle(dock).bottom, 12)
  });
  dock.style.setProperty('--dock-fit-scale', geometry.fitScale);
  doc.documentElement.style.setProperty('--desktop-dock-reserve', `${Math.ceil(geometry.desktopReserve)}px`);
}

export function renderEarlyDesktopSurface(root = document) {
  const container = root.querySelector('[data-early-desktop-surface]');
  const payload = root.querySelector('#theme-desktop-widget-protocol');
  if (!container || !payload || container.dataset.earlyRendered === 'true') return null;
  const doc = container.ownerDocument || root;
  const win = doc.defaultView || window;
  try {
    const rawProtocol = JSON.parse(payload.textContent || '{}');
    if (rawProtocol.enabled !== true || rawProtocol.isHome !== true || doc.body?.dataset.errorPage === 'true') return null;
    publishInitialDockGeometry(doc, win);
    container.hidden = false;
    const shell = container.querySelector('[data-early-desktop-grid-shell]');
    const grid = container.querySelector('[data-early-desktop-grid]');
    const projection = projectEarlyDesktopSurface(rawProtocol, win.__THEME_DESKTOP_PROTOCOL__?.icons || win.__THEME_DESKTOP_ICONS__ || [], {
      width: shell.clientWidth || win.innerWidth,
      height: container.clientHeight || win.innerHeight,
      topInset: parseFloat(win.getComputedStyle(shell).paddingTop || '0')
    });
    grid.style.cssText = `--desktop-widget-columns:${projection.currentColumns};--desktop-widget-gap:${projection.gap}px;--desktop-widget-cell-size:${projection.cellSize}px;width:${projection.gridWidth}px;min-height:${projection.gridHeight}px;`;
    const fragment = doc.createDocumentFragment();
    projection.nodes.forEach((node) => {
      const slot = doc.createElement('div');
      slot.className = `desktop-early-node desktop-early-node--${node.kind}`;
      slot.dataset.earlyDesktopKey = node.key;
      slot.style.cssText = desktopPlacementStyle(node, projection.cellSize, projection.gap);
      if (node.kind === 'icon') {
        const graphic = doc.createElement('div');
        graphic.className = 'desktop-icon-graphic';
        graphic.innerHTML = renderDesktopIconGraphic(node.subtype || 'folder');
        const label = doc.createElement('div');
        label.className = 'desktop-icon-label';
        label.textContent = node.title;
        slot.append(graphic, label);
      } else {
        const title = doc.createElement('div');
        title.className = 'desktop-early-widget-title';
        title.textContent = node.title;
        const content = doc.createElement('div');
        content.className = 'desktop-early-widget-content';
        slot.append(title, content);
      }
      fragment.append(slot);
    });
    grid.append(fragment);
    container.dataset.earlyRendered = 'true';
    return projection;
  } catch (_error) {
    container.hidden = true;
    return null;
  }
}

/** Hand off each slot only after its local content and exact projected geometry exist. */
export function reconcileEarlyDesktopSurface(surface) {
  const { grid, layer } = surface.$refs;
  if (!grid || !layer || surface.lastGridShellWidth === null || surface.widgetsDisposed) return false;
  const expected = surface.enabled && surface.isHome ? surface.placedDesktopNodes : [];
  const visibleKeys = new Set(surface.visibleDesktopNodeKeys);
  if (expected.some((node) => !visibleKeys.has(node.key))) return false;
  const layerStyle = window.getComputedStyle(layer);
  if (expected.length && (layerStyle.display === 'none' || layerStyle.visibility === 'hidden' || layer.hasAttribute?.('x-cloak'))) return false;
  const slots = Array.from(grid.querySelectorAll('.desktop-node-slot'));
  const early = surface.$refs.surface?.querySelector('[data-early-desktop-surface]') || document.querySelector('[data-early-desktop-surface]');
  const placeholders = Array.from(early?.querySelectorAll('[data-early-desktop-key]') || []);
  let complete = true;
  expected.forEach((node) => {
    const slot = slots.find((item) => item.dataset.desktopKey === node.key);
    const desired = Object.fromEntries(surface.getDesktopNodeStyle(node).split(';').filter(Boolean).map((part) => part.split(':')));
    const matches = slot && slot.querySelector(node.kind === 'icon' ? '.desktop-icon' : '.desktop-widget-body')
      && ['left', 'top', 'width', 'height'].every((key) => Math.abs(parseFloat(slot.style[key]) - parseFloat(desired[key])) < 0.5);
    if (!matches) { complete = false; return; }
    placeholders.filter((item) => item.dataset.earlyDesktopKey === node.key).forEach((item) => item.remove());
  });
  if (complete) early?.remove();
  return complete;
}
