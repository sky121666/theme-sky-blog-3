/**
 * macOS 桌面小组件 — Alpine.data 主入口
 *
 * 状态声明、init、computed getters 保留于此。
 * 业务逻辑拆分到同目录各 mixin 模块，通过 spread 注入。
 */

import {
  computeDefaultDesktopIconPlacement,
  mergeDesktopIconLayout,
  normalizeDesktopIconInstance,
  readDesktopIconsBootstrap,
  renderDesktopIconGraphic,
} from '../../icons/index.js';
import { flattenCategoryTree, renderDesktopWidget } from '../../widgets/index.js';
import { escapeHtml, toPositiveInt } from '../../shared/utils.js';
import { normalizeMomentRecord } from '../../shared/moments.js';

import {
  DESKTOP_WIDGET_SIZE_MAP,
  DESKTOP_WIDGET_CENTER_CATEGORIES,
  normalizeWidgetAppearance,
  buildWidgetCatalog,
  getWidgetCatalogEntry,
} from '../../widgets/catalog.js';
import {
  DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
  DESKTOP_SHELL_VERSION,
  setDesktopDebugAccess,
  desktopDebug,
  desktopDebugWarn,
  installDesktopDebugBridge
} from '../../widgets/debug.js';
import {
  readDesktopWidgetsBootstrap,
  parseDesktopLayoutPayload,
  buildDesktopLayoutJsonString,
  applyDesktopLayoutJsonToThemeConfig,
  mergeDesktopWidgetLayout
} from '../../widgets/persistence.js';
import {
  loadCachedDesktopWidgetWeather,
  saveDesktopWidgetWeather,
  fetchDesktopWidgetWeather
} from '../../widgets/weather-api.js';

/* ── Mixin modules ── */
import { gridMethods } from './grid.js';
import { placementMethods } from './placement.js';
import { dragMethods } from './drag.js';
import { editModeMethods } from './edit-mode.js';

/* ── Helpers ── */

function createWidgetRendererContext(state) {
  return {
    now: state.now,
    modules: state.modules,
    sources: state.sources,
    weatherState: state.weatherState,
    escapeHtml,
    normalizeMomentRecord
  };
}

/** Widgets that need per-second re-rendering */
const TICK_SENSITIVE_WIDGETS = new Set(['system.clock']);

/** Build a lightweight cache key from widget state */
function widgetCacheKey(widget, options = {}) {
  return `${widget.widget}:${widget.size}:${widget.key}:preview=${options.preview === true ? 1 : 0}:compact=${options.compact === true ? 1 : 0}`;
}

/* ── Alpine registration ── */

export function registerDesktopSurface(Alpine) {
  Alpine.data('desktopWidgets', () => ({
    /* ═══ State ═══ */
    enabled: false,
    isHome: false,
    editEnabled: false,
    columns: 12,
    currentColumns: 12,
    gap: 18,
    cellSize: 64,
    gridWidth: 0,
    gridTopOffset: 0,
    maxVisibleRows: 1,
    visibleDesktopNodeKeys: [],
    layoutVersion: 'v1',
    siteUrl: '',
    themeName: 'theme-sky-blog-3',
    themeJsonConfigEndpoint: '',
    serverLayoutJson: '',
    serverLayoutPayload: null,
    canManageDefaultDesktopLayout: false,
    serverLayoutAccessReady: false,
    serverLayoutSaving: false,
    modules: {
      weather: {
        cityName: '北京',
        refreshMinutes: 30
      }
    },
    sources: {
      latestPosts: [],
      siteStats: null,
      randomTags: [],
      momentsAvailable: false,
      recentMoments: [],
      archivesUrl: '/archives',
      fallbackCover: ''
    },
    iconsManaged: false,
    icons: [],
    defaultIcons: [],
    widgets: [],
    defaultWidgets: [],
    widgetCatalog: [],
    selectedDesktopKey: null,
    isEditing: false,
    editStage: 'add',
    desktopContextMenu: {
      open: false,
      x: 0,
      y: 0
    },
    widgetCenterCategory: 'all',
    widgetCenterSearch: '',
    widgetCenterSelections: {},
    previewPlacement: null,
    dragState: {
      active: false,
      kind: '',
      key: '',
      node: null,
      widget: null,
      iconMarkup: '',
      startX: 0,
      startY: 0,
      pointerX: 0,
      pointerY: 0,
      offsetX: 0,
      offsetY: 0,
      snapOffsetX: 0,
      snapOffsetY: 0,
      width: 0,
      height: 0,
      hasMoved: false
    },
    centerSheetDrag: {
      active: false,
      source: '',
      pointerId: null,
      startY: 0,
      currentY: 0,
      rawOffsetY: 0,
      offsetY: 0
    },
    weatherState: {
      loading: false,
      error: '',
      data: null
    },
    weatherRequestId: 0,
    now: new Date(),
    tickTimer: null,
    routeSyncHandler: null,
    resizeHandler: null,
    resizeVisibilityTimer: null,
    dragMoveHandler: null,
    dragEndHandler: null,
    centerSheetMoveHandler: null,
    centerSheetEndHandler: null,
    lastVisibleNodeSignature: '',

    /* ═══ Mixin methods ═══ */
    ...gridMethods,
    ...placementMethods,
    ...dragMethods,
    ...editModeMethods,

    /* ═══ Shell mount checks ═══ */

    ensureDesktopShellMounted() {
      const hasLayer = !!this.$refs.layer;
      const hasGridShell = !!this.$refs.gridShell;
      const hasGrid = !!this.$refs.grid;
      const shellVersion = this.$refs.surface?.dataset?.desktopShellVersion || '';
      const shellMatches = shellVersion === DESKTOP_SHELL_VERSION;
      const healKey = 'theme-desktop-shell-self-heal';
      if (hasLayer && hasGridShell && hasGrid && shellMatches) {
        sessionStorage.removeItem(healKey);
        desktopDebug('desktop shell mounted', {
          hasLayer,
          hasGridShell,
          hasGrid,
          shellVersion,
          expectedShellVersion: DESKTOP_SHELL_VERSION
        });
        return true;
      }

      desktopDebugWarn('desktop shell mismatch or missing nodes', {
        hasLayer,
        hasGridShell,
        hasGrid,
        shellVersion,
        expectedShellVersion: DESKTOP_SHELL_VERSION,
        willReload: !sessionStorage.getItem(healKey)
      });
      if (!sessionStorage.getItem(healKey)) {
        sessionStorage.setItem(healKey, '1');
        window.location.reload();
      }

      return false;
    },

    ensureDesktopNodesRendered() {
      const healKey = 'theme-desktop-nodes-self-heal';
      const domNodeCount = document.querySelectorAll('.desktop-node-slot').length;
      const expectedCount = this.visibleDesktopNodeKeys.length;

      if (expectedCount === 0 || domNodeCount > 0) {
        sessionStorage.removeItem(healKey);
        desktopDebug('desktop nodes rendered', {
          expectedCount,
          domNodeCount
        });
        return true;
      }

      desktopDebugWarn('desktop nodes missing from dom', {
        expectedCount,
        domNodeCount,
        willReload: !sessionStorage.getItem(healKey)
      });

      if (!sessionStorage.getItem(healKey)) {
        sessionStorage.setItem(healKey, '1');
        window.location.reload();
      }

      return false;
    },

    scheduleDesktopRenderCheck() {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          this.ensureDesktopNodesRendered();
        });
      });
    },

    /* ═══ Init ═══ */

    async init() {
      installDesktopDebugBridge();
      desktopDebug('desktop runtime init start');
      const bootstrap = readDesktopWidgetsBootstrap();

      const frontendDefaults = [];

      const serverLayout = parseDesktopLayoutPayload(bootstrap.serverLayoutJson, bootstrap.layoutVersion || 'v1', 'server');
      const resolvedWidgets = serverLayout
        ? mergeDesktopWidgetLayout(frontendDefaults, serverLayout)
        : frontendDefaults;

      this.enabled = !!bootstrap.enabled;
      this.isHome = window.location.pathname === '/';
      this.editEnabled = !!bootstrap.editEnabled;
      this.columns = toPositiveInt(bootstrap.columns, 12);
      this.gap = toPositiveInt(bootstrap.gap, 18);
      this.layoutVersion = bootstrap.layoutVersion || 'v1';
      this.siteUrl = bootstrap.siteUrl || '';
      this.themeName = bootstrap.themeName || 'theme-sky-blog-3';
      this.themeJsonConfigEndpoint = bootstrap.themeJsonConfigEndpoint || '';
      this.serverLayoutJson = bootstrap.serverLayoutJson || '';
      this.serverLayoutPayload = serverLayout;
      setDesktopDebugAccess(false);
      this.modules = {
        weather: {
          cityName: (bootstrap.modules?.weather?.cityName || '').trim(),
          refreshMinutes: toPositiveInt(bootstrap.modules?.weather?.refreshMinutes, 30)
        }
      };
      this.sources = {
        siteProfile: {
          title: bootstrap.sources?.siteProfile?.title || '',
          subtitle: bootstrap.sources?.siteProfile?.subtitle || '',
          logo: bootstrap.sources?.siteProfile?.logo || '',
          url: bootstrap.sources?.siteProfile?.url || this.siteUrl || ''
        },
        latestPosts: Array.isArray(bootstrap.sources?.latestPosts) ? bootstrap.sources.latestPosts : [],
        popularPosts: Array.isArray(bootstrap.sources?.popularPosts) ? bootstrap.sources.popularPosts : [],
        categories: Array.isArray(bootstrap.sources?.categories) ? bootstrap.sources.categories : [],
        siteStats: bootstrap.sources?.siteStats || null,
        randomTags: Array.isArray(bootstrap.sources?.randomTags) ? bootstrap.sources.randomTags : [],
        momentsAvailable: !!bootstrap.sources?.momentsAvailable,
        recentMoments: Array.isArray(bootstrap.sources?.recentMoments) ? bootstrap.sources.recentMoments : [],
        archivesUrl: bootstrap.sources?.archivesUrl || '/archives',
        fallbackCover: bootstrap.sources?.fallbackCover || ''
      };
      this.widgetCatalog = buildWidgetCatalog(this.sources, this.modules);
      this.defaultWidgets = resolvedWidgets.map((widget) => ({ ...widget }));
      this.syncDesktopBodyState();
      desktopDebug('desktop bootstrap', {
        enabled: this.enabled,
        isHome: this.isHome,
        layoutVersion: this.layoutVersion,
        columns: this.columns,
        gap: this.gap,
        widgetDefaults: this.defaultWidgets.length,
        widgetCatalog: this.widgetCatalog.length
      });

      this.widgets = this.defaultWidgets.map((widget) => ({ ...widget }));
      const normalizedSingleInstance = this.normalizeSingleInstanceTypes();
      desktopDebug('desktop widgets initialized', {
        widgets: this.widgets.length,
        normalizedSingleInstance
      });

      this.tickTimer = window.setInterval(() => {
        this.now = new Date();
      }, 1000);

      this.routeSyncHandler = () => {
        this.isHome = window.location.pathname === '/';
        this.closeDesktopContextMenu();
        this.invalidateWidgetCache();
        if (!this.isHome) {
          this.exitEditMode();
        } else if (!this.weatherState.loading && !this.weatherState.data) {
          this.loadWeather();
        }
        this.syncDesktopBodyState();
        this.scheduleDesktopRenderCheck();
      };

      this.resizeHandler = () => {
        this.syncGridMetrics({ deferVisibility: true });
      };

      window.addEventListener('pjax:complete', this.routeSyncHandler);
      window.addEventListener('pageshow', this.routeSyncHandler);
      window.addEventListener('resize', this.resizeHandler);
      this.probeServerLayoutConfigAccess();

      this.$nextTick(async () => {
        if (!this.ensureDesktopShellMounted()) {
          return;
        }
        this.syncGridMetrics();
        this.bootstrapDesktopIcons(serverLayout);
        this.syncGridMetrics();
        this.ensureDesktopLayoutIntegrity();
        this.syncDesktopBodyState();
        desktopDebug('desktop post-bootstrap state', {
          widgets: this.widgets.length,
          icons: this.icons.length,
          visibleKeys: this.visibleDesktopNodeKeys
        });
        this.scheduleDesktopRenderCheck();
        this.loadWeather();
      });
    },

    /* ═══ Computed getters ═══ */

    get placedWidgets() {
      return this.widgets
        .filter((widget) => !widget.hidden)
        .sort((left, right) => {
          if (left.y === right.y) return left.x - right.x;
          return left.y - right.y;
        });
    },

    get placedIcons() {
      return this.icons
        .slice()
        .sort((left, right) => {
          if (left.y === right.y) return left.x - right.x;
          return left.y - right.y;
        });
    },

    get placedDesktopNodes() {
      return [...this.placedIcons, ...this.placedWidgets].sort((left, right) => {
        if (left.y === right.y) return left.x - right.x;
        return left.y - right.y;
      });
    },

    get visibleDesktopNodes() {
      const visibleKeySet = new Set(this.visibleDesktopNodeKeys);
      return this.placedDesktopNodes.filter((node) => visibleKeySet.has(node.key));
    },

    get widgetCenterCategories() {
      const categories = new Set(this.widgetCatalog.map((entry) => entry.category || 'halo'));
      return DESKTOP_WIDGET_CENTER_CATEGORIES.filter((item) => item.id === 'all' || categories.has(item.id));
    },

    get filteredWidgetCatalog() {
      const keyword = this.widgetCenterSearch.trim().toLowerCase();
      return this.widgetCatalog.filter((entry) => {
        if (this.widgetCenterCategory !== 'all' && entry.category !== this.widgetCenterCategory) {
          return false;
        }

        if (!keyword) return true;
        const haystack = `${entry.title} ${entry.kicker || ''} ${entry.description || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    },

    get showWidgetCenter() {
      return this.isEditing && this.editStage === 'add';
    },

    get gridStyle() {
      return `--desktop-widget-columns:${this.currentColumns};--desktop-widget-gap:${this.gap}px;--desktop-widget-cell-size:${this.cellSize}px;width:${this.gridWidth}px;`;
    },

    get previewStyle() {
      if (!this.previewPlacement) return 'display:none;';
      return this.placementToAbsoluteStyle(this.previewPlacement);
    },

    get snapGuides() {
      if (!this.previewPlacement || !this.dragState.active || !this.dragState.hasMoved) {
        return [];
      }

      const stride = this.cellSize + this.gap;
      const fullHeight = this.maxVisibleRows * this.cellSize + Math.max(0, this.maxVisibleRows - 1) * this.gap;
      const left = (this.previewPlacement.x - 1) * stride;
      const top = (this.previewPlacement.y - 1) * stride;
      const width = this.previewPlacement.w * this.cellSize + Math.max(0, this.previewPlacement.w - 1) * this.gap;
      const height = this.previewPlacement.h * this.cellSize + Math.max(0, this.previewPlacement.h - 1) * this.gap;
      const centerX = left + width / 2;
      const centerY = top + height / 2;

      return [
        {
          key: 'vertical',
          axis: 'vertical',
          style: `left:${centerX}px;top:0;height:${fullHeight}px;`
        },
        {
          key: 'horizontal',
          axis: 'horizontal',
          style: `left:0;top:${centerY}px;width:${this.gridWidth}px;`
        }
      ];
    },

    get dragGhostStyle() {
      if (!this.dragState.active || !this.dragState.hasMoved) return 'display:none;';
      const left = this.dragState.pointerX - this.dragState.offsetX;
      const top = this.dragState.pointerY - this.dragState.offsetY;
      return `left:${left}px;top:${top}px;width:${this.dragState.width}px;height:${this.dragState.height}px;`;
    },

    get centerSheetStyle() {
      const offset = Math.max(0, this.centerSheetDrag.offsetY || 0);
      const tension = Math.min(offset / 220, 1);
      const scale = 1 - tension * 0.024;
      const radiusBonus = 14 * tension;
      const transition = this.centerSheetDrag.active ? 'none' : 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)';
      return `transform: translateY(${offset}px) scale(${scale.toFixed(4)}); transform-origin: center bottom; transition: ${transition}; --desktop-widget-center-tension:${tension.toFixed(4)}; --desktop-widget-center-radius-bonus:${radiusBonus.toFixed(2)}px;`;
    },

    get centerBackdropStyle() {
      const offset = Math.max(0, this.centerSheetDrag.offsetY || 0);
      const transition = this.centerSheetDrag.active ? 'none' : 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)';
      return `transform: translateY(${offset}px); transition: ${transition};`;
    },

    get showDesktopContextMenu() {
      return this.desktopContextMenu.open && !this.showWidgetCenter;
    },

    get desktopContextMenuPositionStyle() {
      const menuWidth = 188;
      const menuHeight = this.isEditing ? 184 : 52;
      const x = Math.min(this.desktopContextMenu.x, Math.max(16, window.innerWidth - menuWidth - 18));
      const y = Math.min(this.desktopContextMenu.y, Math.max(44, window.innerHeight - menuHeight - 18));
      return {
        left: `${x}px`,
        top: `${y}px`
      };
    },

    /* ═══ Desktop interaction ═══ */

    handleDesktopSurfaceOutsideClick(event) {
      if (!event.target.closest('.desktop-node-slot--icon, .desktop-widget-center, .desktop-widgets-toolbar, .desktop-context-menu')) {
        this.selectedDesktopKey = null;
      }
      if (!event.target.closest('.desktop-context-menu')) {
        this.closeDesktopContextMenu();
      }
    },

    handleDesktopSurfaceContextMenu(event) {
      if (!this.canManageDefaultDesktopLayout || !this.editEnabled || !this.isHome) return;
      if (event.target.closest('.desktop-widget-center, .desktop-node-slot, .dock-container, .window-layer')) return;
      event.preventDefault();
      this.selectedDesktopKey = null;
      this.desktopContextMenu = {
        open: true,
        x: event.clientX,
        y: event.clientY
      };
    },

    closeDesktopContextMenu() {
      this.desktopContextMenu.open = false;
    },

    openWidgetEditorFromDesktopMenu() {
      if (!this.canManageDefaultDesktopLayout) return;
      this.closeDesktopContextMenu();
      this.enterEditMode('add');
    },

    syncDesktopBodyState() {
      document.body.classList.toggle('desktop-widget-center-open', this.showWidgetCenter);
      document.body.classList.toggle('desktop-editing', this.isEditing);
    },

    syncCurrentLayoutAsDefaults() {
      this.defaultWidgets = this.widgets.map((widget) => ({
        ...widget,
        baseX: widget.baseX ?? widget.x,
        baseY: widget.baseY ?? widget.y
      }));
      this.defaultIcons = this.icons.map((icon) => ({
        ...icon,
        baseX: icon.baseX ?? icon.x,
        baseY: icon.baseY ?? icon.y
      }));
    },

    /* ═══ Server persistence ═══ */

    async probeServerLayoutConfigAccess() {
      this.serverLayoutAccessReady = false;
      this.canManageDefaultDesktopLayout = false;
      setDesktopDebugAccess(false);

      if (!this.editEnabled || !this.themeJsonConfigEndpoint) {
        this.serverLayoutAccessReady = true;
        return false;
      }

      try {
        const response = await fetch(this.themeJsonConfigEndpoint, {
          credentials: 'include',
          headers: {
            Accept: 'application/json'
          }
        });
        const contentType = response.headers.get('content-type') || '';
        this.canManageDefaultDesktopLayout = response.ok && contentType.includes('json');
        setDesktopDebugAccess(this.editEnabled && this.canManageDefaultDesktopLayout);
        desktopDebug('desktop default-layout capability checked', {
          endpoint: this.themeJsonConfigEndpoint,
          status: response.status,
          canManageDefaultDesktopLayout: this.canManageDefaultDesktopLayout
        });
      } catch (error) {
        this.canManageDefaultDesktopLayout = false;
        setDesktopDebugAccess(false);
        desktopDebugWarn('desktop default-layout capability check failed', {
          endpoint: this.themeJsonConfigEndpoint,
          error: error.message
        });
      }

      this.serverLayoutAccessReady = true;
      return this.canManageDefaultDesktopLayout;
    },

    async saveLayoutJsonToServer(layoutJson) {
      if (!this.themeJsonConfigEndpoint || !this.canManageDefaultDesktopLayout) {
        desktopDebugWarn('desktop default layout save skipped: no permission', {
          endpoint: this.themeJsonConfigEndpoint,
          themeName: this.themeName,
          canManageDefaultDesktopLayout: this.canManageDefaultDesktopLayout
        });
        return false;
      }

      this.serverLayoutSaving = true;
      desktopDebug('desktop default layout save start', {
        endpoint: this.themeJsonConfigEndpoint,
        themeName: this.themeName,
        payloadSize: layoutJson.length
      });

      try {
        const getResponse = await fetch(this.themeJsonConfigEndpoint, {
          credentials: 'include',
          headers: {
            Accept: 'application/json'
          }
        });

        if (!getResponse.ok) {
          const body = await getResponse.text().catch(() => '');
          throw new Error(`GET theme json-config failed: ${getResponse.status} ${body.slice(0, 160)}`.trim());
        }

        const currentConfig = await getResponse.json();
        const nextConfig = applyDesktopLayoutJsonToThemeConfig(currentConfig, layoutJson);
        const putResponse = await fetch(this.themeJsonConfigEndpoint, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(nextConfig)
        });

        if (!putResponse.ok) {
          const body = await putResponse.text().catch(() => '');
          throw new Error(`PUT theme json-config failed: ${putResponse.status} ${body.slice(0, 160)}`.trim());
        }

        this.serverLayoutJson = layoutJson;
        this.serverLayoutPayload = parseDesktopLayoutPayload(layoutJson, this.layoutVersion, 'saved-server');
        this.syncCurrentLayoutAsDefaults();
        desktopDebug('desktop default layout saved to server', {
          endpoint: this.themeJsonConfigEndpoint,
          themeName: this.themeName,
          payloadSize: layoutJson.length
        });
        return true;
      } catch (error) {
        desktopDebugWarn('desktop default layout save failed', {
          endpoint: this.themeJsonConfigEndpoint,
          themeName: this.themeName,
          error: error.message
        });
        return false;
      } finally {
        this.serverLayoutSaving = false;
      }
    },

    async saveDefaultLayoutToServer() {
      const layoutJson = buildDesktopLayoutJsonString(this.layoutVersion, this.widgets, this.icons, this.currentColumns);
      return this.saveLayoutJsonToServer(layoutJson);
    },

    /* ═══ Desktop icons ═══ */

    handleDesktopIconClick(event, key) {
      if (this.isEditing && this.editStage === 'decorate') {
        this.selectedDesktopKey = key;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      this.closeDesktopContextMenu();
      this.selectedDesktopKey = null;
    },

    findIconByKey(key) {
      return this.icons.find((icon) => icon.key === key) || null;
    },

    findDesktopNode(key) {
      return this.findIconByKey(key) || this.widgets.find((widget) => widget.key === key) || null;
    },

    getIconStyle(key) {
      if (!this.iconsManaged) return '';
      const icon = this.findIconByKey(key);
      if (!icon) return '';
      return this.placementToAbsoluteStyle(icon);
    },

    bootstrapDesktopIcons(serverLayout = null) {
      const bootstrapIcons = readDesktopIconsBootstrap();
      const defaultIcons = bootstrapIcons.map((icon, index) => {
        const defaultPlacement = computeDefaultDesktopIconPlacement(index, this.currentColumns || this.columns || 12, this.maxVisibleRows || 8);
        const fallbackX = icon.x ?? defaultPlacement.x;
        const fallbackY = icon.y ?? defaultPlacement.y;

        return {
          ...normalizeDesktopIconInstance({
            key: icon.key,
            title: icon.title,
            x: fallbackX,
            y: fallbackY,
            baseX: icon.baseX ?? fallbackX,
            baseY: icon.baseY ?? fallbackY
          }, {
            key: icon.key,
            title: icon.title,
            x: fallbackX,
            y: fallbackY
          }),
          href: icon.href,
          pjax: icon.pjax,
          external: icon.external,
          subtype: icon.subtype,
          dataId: icon.dataId
        };
      });

      const serverDefaultIcons = mergeDesktopIconLayout(defaultIcons, serverLayout).map((icon) => {
        const sourceIcon = defaultIcons.find((item) => item.key === icon.key);
        return {
          ...icon,
          href: sourceIcon?.href || '#',
          pjax: sourceIcon?.pjax !== false,
          external: sourceIcon?.external === true,
          subtype: sourceIcon?.subtype || 'folder',
          dataId: sourceIcon?.dataId || icon.title
        };
      });

      this.defaultIcons = serverDefaultIcons.map((icon) => ({ ...icon }));
      this.icons = serverDefaultIcons.map((icon) => {
        const sourceIcon = serverDefaultIcons.find((item) => item.key === icon.key);
        return {
          ...icon,
          href: sourceIcon?.href || '#',
          pjax: sourceIcon?.pjax !== false,
          external: sourceIcon?.external === true,
          subtype: sourceIcon?.subtype || 'folder',
          dataId: sourceIcon?.dataId || icon.title
        };
      });
      this.iconsManaged = this.icons.length > 0;
      desktopDebug('desktop icons initialized', {
        bootstrapIcons: bootstrapIcons.length,
        iconsManaged: this.iconsManaged,
        icons: this.icons.map((icon) => ({
          key: icon.key,
          x: icon.x,
          y: icon.y,
          baseX: icon.baseX,
          baseY: icon.baseY
        }))
      });
    },

    /* ═══ Layout integrity ═══ */

    ensureDesktopLayoutIntegrity() {
      const isPlacementCorrupt = (node) => {
        return !Number.isFinite(node.baseX)
          || !Number.isFinite(node.baseY)
          || node.baseX < 1
          || node.baseY < 1;
      };

      const clampCorruptNode = (node) => {
        node.baseX = Math.max(1, Number.isFinite(node.baseX) ? node.baseX : 1);
        node.baseY = Math.max(1, Number.isFinite(node.baseY) ? node.baseY : 1);
      };

      let changed = false;

      this.widgets.forEach((widget) => {
        if (isPlacementCorrupt(widget)) {
          clampCorruptNode(widget);
          changed = true;
        }
      });

      this.icons.forEach((icon) => {
        if (isPlacementCorrupt(icon)) {
          clampCorruptNode(icon);
          changed = true;
        }
      });

      if (changed) {
        desktopDebugWarn('repaired corrupt node placements', {});
      }

      this.normalizeVisibleLayout();
      this.syncResponsiveVisibility();

      if (!this.visibleDesktopNodeKeys.length && (this.defaultWidgets.length || this.defaultIcons.length)) {
        this.widgets = this.defaultWidgets.map((widget) => ({ ...widget }));
        this.icons = this.defaultIcons.map((icon) => ({ ...icon }));
        this.normalizeVisibleLayout();
        this.syncResponsiveVisibility();
        changed = true;
        desktopDebugWarn('repaired desktop layout to defaults', {
          reason: 'no visible desktop nodes after normalization'
        });
      }

      return changed;
    },

    /* ═══ Rendering ═══ */

    widgetCardClass(widget) {
      return `${this.widgetClassName(widget)}${widget.hidden ? ' is-hidden' : ''}`;
    },

    widgetClassName(widget) {
      const typeToken = String(widget.widget || 'widget')
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-|-$/g, '');
      const states = [`is-${widget.size}`, `widget--${typeToken}`];
      if (this.isEditing) states.push('is-editing');
      if (this.dragState.active && this.dragState.hasMoved && this.dragState.key === widget.key) states.push('is-drag-source');
      return states.join(' ');
    },

    isIconNode(node) {
      return node?.kind === 'icon';
    },

    isWidgetNode(node) {
      return !this.isIconNode(node);
    },

    desktopNodeClassName(node) {
      if (this.isIconNode(node)) {
        return [
          'desktop-icon',
          this.selectedDesktopKey === node.key ? 'selected' : '',
          this.dragState.active && this.dragState.key === node.key && this.dragState.hasMoved ? 'is-drag-source' : '',
          this.isEditing && this.editStage === 'decorate' ? 'is-editing' : ''
        ].filter(Boolean).join(' ');
      }

      return this.widgetCardClass(node);
    },

    desktopNodeSlotClassName(node) {
      return [
        'desktop-node-slot',
        this.isIconNode(node) ? 'desktop-node-slot--icon' : 'desktop-node-slot--widget',
        this.selectedDesktopKey === node.key ? 'is-selected' : '',
        this.dragState.active && this.dragState.key === node.key && this.dragState.hasMoved ? 'is-drag-source' : '',
        this.isEditing && this.editStage === 'decorate' ? 'is-editing' : ''
      ].filter(Boolean).join(' ');
    },

    desktopNodeContentClassName(node) {
      if (this.isIconNode(node)) {
        return [
          this.desktopNodeClassName(node),
          node.pjax ? 'pjax-link' : ''
        ].filter(Boolean).join(' ');
      }

      return this.widgetCardClass(node);
    },

    getDesktopNodeStyle(node) {
      return this.placementToAbsoluteStyle(node);
    },

    renderDesktopIconGraphic(node) {
      return renderDesktopIconGraphic(node?.subtype || 'folder');
    },

    widgetKicker(widget) {
      return getWidgetCatalogEntry(widget.widget)?.kicker || '桌面组件';
    },

    widgetAppearanceValue(widget) {
      return normalizeWidgetAppearance(widget?.appearance);
    },

    getWidgetStyle(widget) {
      return this.placementToAbsoluteStyle(widget);
    },

    /* ═══ Weather ═══ */

    async loadWeather(forceRefresh = false) {
      const cityName = this.modules.weather.cityName;
      if (!cityName) {
        this.weatherState = {
          loading: false,
          error: '请先在后台为天气组件配置城市。',
          data: null
        };
        return;
      }

      if (!forceRefresh) {
        const cached = loadCachedDesktopWidgetWeather(cityName, this.modules.weather.refreshMinutes);
        if (cached) {
          this.weatherState = {
            loading: false,
            error: '',
            data: cached
          };
          this.invalidateWidgetCache();
          return;
        }
      }

      this.weatherRequestId += 1;
      const requestId = this.weatherRequestId;
      this.weatherState = {
        ...this.weatherState,
        loading: true,
        error: ''
      };

      try {
        const data = await fetchDesktopWidgetWeather(cityName);
        if (requestId !== this.weatherRequestId) return;

        this.weatherState = {
          loading: false,
          error: '',
          data
        };
        saveDesktopWidgetWeather(cityName, data);
        this.invalidateWidgetCache();
      } catch (_error) {
        if (requestId !== this.weatherRequestId) return;

        this.weatherState = {
          loading: false,
          error: '天气数据暂时不可用。',
          data: null
        };
        this.invalidateWidgetCache();
      }
    },

    /* ═══ Widget body rendering ═══ */

    renderWidgetBody(widget, options = {}) {
      const wType = widget?.widget || '';
      const renderOptions = {
        ...options,
        compact: options.preview === true ? false : this.cellSize <= 60
      };

      // Tick-sensitive widgets always re-render
      if (TICK_SENSITIVE_WIDGETS.has(wType)) {
        return renderDesktopWidget(createWidgetRendererContext(this), widget, renderOptions);
      }

      // For non-tick widgets, cache and reuse HTML to prevent img flicker
      if (!this._widgetHtmlCache) this._widgetHtmlCache = new Map();
      const cKey = widgetCacheKey(widget, renderOptions);
      const cached = this._widgetHtmlCache.get(cKey);
      if (cached !== undefined) return cached;

      const html = renderDesktopWidget(createWidgetRendererContext(this), widget, renderOptions);
      this._widgetHtmlCache.set(cKey, html);
      return html;
    },

    /** Invalidate widget render cache (call after data/layout changes) */
    invalidateWidgetCache() {
      if (this._widgetHtmlCache) this._widgetHtmlCache.clear();
    }
  }));
}
