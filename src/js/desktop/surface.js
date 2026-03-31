import {
  DESKTOP_ICON_NODE_SPAN,
  computeDefaultDesktopIconPlacement,
  mergeDesktopIconLayout,
  normalizeDesktopIconInstance,
  readDesktopIconsBootstrap,
  renderDesktopIconGraphic,
  serializeDesktopIconInstance
} from '../icons/index.js';
import { flattenCategoryTree, renderDesktopWidget } from '../widgets/index.js';
import { escapeHtml, extractTextPreview, truncateText, toPositiveInt, cloneJsonValue } from '../shared/utils.js';
import { normalizeMomentRecord } from '../shared/moments.js';

import {
  DESKTOP_WIDGET_SIZE_MAP,
  DESKTOP_WIDGET_CATALOG,
  DESKTOP_WIDGET_CENTER_CATEGORIES,
  normalizeWidgetSize,
  normalizeWidgetInstance,
  serializeWidgetInstance,
  createWidgetInstance,
  getWidgetCatalogEntry,
  generateWidgetTitle,
  buildWidgetCatalog
} from '../widgets/catalog.js';
import {
  DESKTOP_LAYOUT_STORAGE_SCHEMA_VERSION,
  DESKTOP_SHELL_VERSION,
  setDesktopDebugAccess,
  desktopDebug,
  desktopDebugWarn,
  installDesktopDebugBridge
} from '../widgets/debug.js';
import {
  readDesktopWidgetsBootstrap,
  parseDesktopLayoutPayload,
  buildDesktopLayoutJsonString,
  applyDesktopLayoutJsonToThemeConfig,
  mergeDesktopWidgetLayout
} from '../widgets/persistence.js';
import {
  sortByDistance,
  loadCachedDesktopWidgetWeather,
  saveDesktopWidgetWeather,
  fetchDesktopWidgetWeather
} from '../widgets/weather-api.js';

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

export function registerDesktopSurface(Alpine) {
  // =========== 6. 首页桌面小组件 ===========
  Alpine.data('desktopWidgets', () => ({
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
      clock: { showSeconds: false },
      weather: {
        enabled: true,
        cityName: '北京',
        refreshMinutes: 30
      },
      siteStats: { enabled: true },
      authorCard: { enabled: true }
    },
    sources: {
      latestPosts: [],
      siteStats: null,
      randomTags: [],
      momentsAvailable: false,
      recentMoments: []
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

    async init() {
      installDesktopDebugBridge();
      desktopDebug('desktop runtime init start');
      const bootstrap = readDesktopWidgetsBootstrap();
      const bootstrapWidgets = Array.isArray(bootstrap.instances)
        ? bootstrap.instances.map((instance, index) => normalizeWidgetInstance(instance, index))
        : [];
      const serverLayout = parseDesktopLayoutPayload(bootstrap.serverLayoutJson, bootstrap.layoutVersion || 'v1', 'server');

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
        clock: {
          showSeconds: !!bootstrap.modules?.clock?.showSeconds
        },
        weather: {
          enabled: !!bootstrap.modules?.weather?.enabled,
          cityName: (bootstrap.modules?.weather?.cityName || '').trim(),
          refreshMinutes: toPositiveInt(bootstrap.modules?.weather?.refreshMinutes, 30)
        },
        authorCard: {
          enabled: bootstrap.modules?.authorCard?.enabled !== false
        },
        siteStats: {
          enabled: bootstrap.modules?.siteStats?.enabled !== false
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
        recentMoments: Array.isArray(bootstrap.sources?.recentMoments) ? bootstrap.sources.recentMoments : []
      };
      this.widgetCatalog = buildWidgetCatalog(this.sources, this.modules);
      const serverDefaultWidgets = mergeDesktopWidgetLayout(bootstrapWidgets, serverLayout);
      this.defaultWidgets = serverDefaultWidgets.map((widget) => ({ ...widget }));
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
        if (!this.isHome) {
          this.exitEditMode();
        } else if (this.modules.weather.enabled && !this.weatherState.loading && !this.weatherState.data) {
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
        if (this.modules.weather.enabled) {
          this.loadWeather();
        }
      });
    },

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

    countVisibleWidgetsByType(widgetType) {
      return this.widgets.filter((widget) => widget.widget === widgetType && !widget.hidden).length;
    },

    isWidgetTypeVisible(widgetType) {
      return this.countVisibleWidgetsByType(widgetType) > 0;
    },

    hasReplaceTarget(widgetType) {
      return !!this.findReplaceTarget(widgetType);
    },

    widgetCenterCategoryLabel() {
      return this.widgetCenterCategories.find((item) => item.id === this.widgetCenterCategory)?.label || '全部';
    },

    widgetCenterResultText() {
      const count = this.filteredWidgetCatalog.length;
      return `${count} 项`;
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

    isWidgetWithinVisibleArea(widget) {
      return widget.y + widget.h - 1 <= this.maxVisibleRows;
    },

    placementOverlaps(x, y, w, h, placement) {
      const noOverlap =
        x + w - 1 < placement.x ||
        placement.x + placement.w - 1 < x ||
        y + h - 1 < placement.y ||
        placement.y + placement.h - 1 < y;

      return !noOverlap;
    },

    isResponsiveVisible(node) {
      return this.visibleDesktopNodeKeys.includes(node.key);
    },

    syncResponsiveVisibility() {
      this.visibleDesktopNodeKeys = this.placedDesktopNodes
        .filter((node) => this.isNodeWithinVisibleArea(node))
        .map((node) => node.key);
      const signature = this.visibleDesktopNodeKeys.join('|');
      if (signature !== this.lastVisibleNodeSignature) {
        this.lastVisibleNodeSignature = signature;
        desktopDebug('responsive desktop visibility updated', {
          visibleCount: this.visibleDesktopNodeKeys.length,
          visibleKeys: this.visibleDesktopNodeKeys
        });
      }
    },

    isNodeWithinVisibleArea(node) {
      if (node.kind === 'widget' && node.hidden) return false;
      return node.y + node.h - 1 <= this.maxVisibleRows;
    },

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
      const layoutJson = buildDesktopLayoutJsonString(this.layoutVersion, this.widgets, this.icons);
      return this.saveLayoutJsonToServer(layoutJson);
    },

    syncDesktopBodyState() {
      document.body.classList.toggle('desktop-widget-center-open', this.showWidgetCenter);
      document.body.classList.toggle('desktop-editing', this.isEditing);
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

    openWidgetEditorFromDesktopMenu() {
      if (!this.canManageDefaultDesktopLayout) return;
      this.closeDesktopContextMenu();
      this.enterEditMode('add');
    },

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

    getCenterSheetDampedOffset(delta) {
      if (delta <= 0) return 0;
      if (delta <= 108) return delta * 0.66;
      return Math.min(236, 71 + Math.pow(delta - 108, 0.9) * 6.2);
    },

    async saveDesktopEditing() {
      if (this.canManageDefaultDesktopLayout) {
        const saved = await this.saveDefaultLayoutToServer();
        if (!saved) return;
      }

      await this.exitEditMode();
    },

    enterEditMode(stage = 'add') {
      this.closeDesktopContextMenu();
      this.endCenterSheetDrag(true);
      this.isEditing = true;
      this.editStage = stage === 'decorate' ? 'decorate' : 'add';
      this.widgetCenterCategory = 'all';
      this.widgetCenterSearch = '';
      this.ensureWidgetCenterSelections();
      this.syncDesktopBodyState();
    },

    async exitEditMode() {
      this.closeDesktopContextMenu();
      this.endCenterSheetDrag(true);
      this.isEditing = false;
      this.editStage = 'add';
      this.previewPlacement = null;
      this.endDrag();
      this.syncDesktopBodyState();
    },

    setEditStage(stage) {
      if (!this.isEditing) return;
      this.endCenterSheetDrag(true);
      this.editStage = stage === 'decorate' ? 'decorate' : 'add';
      this.previewPlacement = null;
      if (this.editStage === 'add') {
        this.ensureWidgetCenterSelections();
      }
      this.syncDesktopBodyState();
    },

    beginCenterSheetDrag(event) {
      if (!this.showWidgetCenter) return;
      if (this.centerSheetDrag.active) return;

      const isMouseEvent = event.type === 'mousedown';
      if (isMouseEvent && event.button !== 0) return;

      this.centerSheetDrag = {
        active: true,
        source: isMouseEvent ? 'mouse' : 'pointer',
        pointerId: event.pointerId ?? null,
        startY: event.clientY,
        currentY: event.clientY,
        rawOffsetY: 0,
        offsetY: 0
      };

      if (!isMouseEvent && event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch (error) {
          // Ignore pointer capture failures and fall back to document listeners.
        }
      }

      this.centerSheetMoveHandler = (moveEvent) => this.onCenterSheetDragMove(moveEvent);
      this.centerSheetEndHandler = () => this.onCenterSheetDragEnd();

      document.addEventListener('mousemove', this.centerSheetMoveHandler);
      document.addEventListener('mouseup', this.centerSheetEndHandler);
      document.addEventListener('pointermove', this.centerSheetMoveHandler);
      document.addEventListener('pointerup', this.centerSheetEndHandler);
      document.addEventListener('pointercancel', this.centerSheetEndHandler);
    },

    onCenterSheetDragMove(event) {
      if (!this.centerSheetDrag.active) return;
      if (this.centerSheetDrag.source === 'pointer'
        && this.centerSheetDrag.pointerId !== null
        && event.pointerId !== undefined
        && event.pointerId !== this.centerSheetDrag.pointerId) return;
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      const delta = Math.max(0, event.clientY - this.centerSheetDrag.startY);
      this.centerSheetDrag.currentY = event.clientY;
      this.centerSheetDrag.rawOffsetY = delta;
      this.centerSheetDrag.offsetY = this.getCenterSheetDampedOffset(delta);
    },

    onCenterSheetDragEnd() {
      if (!this.centerSheetDrag.active) return;

      const shouldClose = this.centerSheetDrag.rawOffsetY >= 144 || this.centerSheetDrag.offsetY >= 104;
      if (shouldClose) {
        this.setEditStage('decorate');
        return;
      }

      this.endCenterSheetDrag(true);
    },

    endCenterSheetDrag(resetOffset = false) {
      if (this.centerSheetMoveHandler) {
        document.removeEventListener('mousemove', this.centerSheetMoveHandler);
        document.removeEventListener('pointermove', this.centerSheetMoveHandler);
        this.centerSheetMoveHandler = null;
      }

      if (this.centerSheetEndHandler) {
        document.removeEventListener('mouseup', this.centerSheetEndHandler);
        document.removeEventListener('pointerup', this.centerSheetEndHandler);
        document.removeEventListener('pointercancel', this.centerSheetEndHandler);
        this.centerSheetEndHandler = null;
      }

      this.centerSheetDrag = {
        active: false,
        source: '',
        pointerId: null,
        startY: 0,
        currentY: 0,
        rawOffsetY: resetOffset ? 0 : this.centerSheetDrag.rawOffsetY,
        offsetY: resetOffset ? 0 : this.centerSheetDrag.offsetY
      };
    },

    setWidgetCenterCategory(categoryId) {
      this.widgetCenterCategory = categoryId;
    },

    sizeLabel(size) {
      if (size === 'small') return '小';
      if (size === 'large') return '大';
      return '中';
    },

    catalogStatusText(entry) {
      if (this.isWidgetTypeVisible(entry.widget)) {
        return '已在桌面，可直接替换。';
      }

      return entry.description || (entry.category === 'plugin' ? '来自插件' : '可添加到桌面');
    },

    buildPreviewWidget(entry, size = entry.size) {
      return createWidgetInstance(entry.widget, {
        key: `preview-${entry.widget}`,
        title: entry.title,
        size
      });
    },

    widgetVariantSizes(entry) {
      return entry.sizes || [entry.size || 'medium'];
    },

    ensureWidgetCenterSelections() {
      this.widgetCatalog.forEach((entry) => {
        if (!this.widgetCenterSelections[entry.widget]) {
          this.widgetCenterSelections[entry.widget] = entry.size || this.widgetVariantSizes(entry)[0] || 'medium';
        }
      });
    },

    selectedWidgetVariantSize(entry) {
      return normalizeWidgetSize(
        this.widgetCenterSelections[entry.widget]
        || entry.size
        || this.widgetVariantSizes(entry)[0]
        || 'medium'
      );
    },

    selectWidgetVariant(widgetType, size) {
      this.widgetCenterSelections[widgetType] = normalizeWidgetSize(size);
    },

    isWidgetVariantSelected(entry, size) {
      return this.selectedWidgetVariantSize(entry) === normalizeWidgetSize(size);
    },

    selectedWidgetVariant(entry) {
      return this.buildPreviewWidget(entry, this.selectedWidgetVariantSize(entry));
    },

    usesStandalonePreviewSkin(widget) {
      return ['halo.latest_posts', 'halo.popular_posts', 'system.weather', 'plugin-moments.recent'].includes(widget?.widget);
    },

    selectedWidgetVariantStyle(entry) {
      return this.getVariantPreviewStyle(this.selectedWidgetVariantSize(entry));
    },

    getVariantPreviewStyle(size) {
      if (size === 'small') {
        return '--desktop-widget-preview-width: 136px; --desktop-widget-preview-height: 136px;';
      }

      if (size === 'large') {
        return '--desktop-widget-preview-width: 224px; --desktop-widget-preview-height: 244px;';
      }

      return '--desktop-widget-preview-width: 224px; --desktop-widget-preview-height: 136px;';
    },

    findReplaceTarget(widgetType) {
      return [...this.widgets].reverse().find((widget) => widget.widget === widgetType && !widget.hidden) || null;
    },

    normalizeSingleInstanceTypes() {
      const chosenByType = new Map();

      for (let index = this.widgets.length - 1; index >= 0; index -= 1) {
        const widget = this.widgets[index];
        const current = chosenByType.get(widget.widget);

        if (!current) {
          chosenByType.set(widget.widget, { index, widget });
          continue;
        }

        if (current.widget.hidden && !widget.hidden) {
          chosenByType.set(widget.widget, { index, widget });
        }
      }

      const keepIndexes = new Set([...chosenByType.values()].map((entry) => entry.index));
      const normalized = this.widgets.filter((_, index) => keepIndexes.has(index));
      const changed = normalized.length !== this.widgets.length;

      if (changed) {
        this.widgets = normalized;
      }

      return changed;
    },

    async resetLayout() {
      this.widgets = this.defaultWidgets.map((widget) => ({ ...widget }));
      this.icons = this.defaultIcons.map((icon) => ({ ...icon }));
      this.normalizeSingleInstanceTypes();
      this.previewPlacement = null;
      this.syncGridMetrics();
    },

    async addWidgetFromCatalog(widgetType, size = null) {
      if (this.isWidgetTypeVisible(widgetType)) {
        return;
      }

      const nextSize = normalizeWidgetSize(size || getWidgetCatalogEntry(widgetType)?.size || 'medium');
      let candidate = this.widgets.find((widget) => widget.widget === widgetType && widget.hidden);

      if (candidate) {
        candidate.hidden = false;
      } else {
        candidate = createWidgetInstance(widgetType, {
          title: generateWidgetTitle(widgetType),
          size: nextSize
        });
        this.widgets.push(candidate);
      }

      if (candidate.size !== nextSize) {
        const catalogEntry = DESKTOP_WIDGET_CATALOG[candidate.widget] || {};
        const span = catalogEntry.sizeOverrides?.[nextSize] || DESKTOP_WIDGET_SIZE_MAP[nextSize];
        candidate.size = nextSize;
        candidate.w = span.w;
        candidate.h = span.h;
      }

      const placement = this.findNearestAvailablePlacement(candidate, candidate.x, candidate.y, candidate.key);
      candidate.x = placement.x;
      candidate.y = placement.y;
      candidate.baseX = placement.x;
      candidate.baseY = placement.y;
      candidate.w = placement.w;
      candidate.h = placement.h;

      if (widgetType === 'system.weather') {
        this.loadWeather();
      }

      this.normalizeSingleInstanceTypes();
      this.syncResponsiveVisibility();
    },

    async replaceWidgetFromCatalog(widgetType, size = null) {
      const target = this.findReplaceTarget(widgetType);
      if (!target) {
        await this.addWidgetFromCatalog(widgetType, size);
        return;
      }

      const nextSize = normalizeWidgetSize(size || getWidgetCatalogEntry(widgetType)?.size || target.size || 'medium');
      const catalogEntry = DESKTOP_WIDGET_CATALOG[widgetType] || {};
      const span = catalogEntry.sizeOverrides?.[nextSize] || DESKTOP_WIDGET_SIZE_MAP[nextSize];
      target.size = nextSize;
      target.w = span.w;
      target.h = span.h;

      const desiredPlacement = this.clampPlacement(target, target.x, target.y);
      const placements = this.resolvePlacementsForDrop(target.key, desiredPlacement);
      this.applyResolvedPlacements(placements);
      this.syncBasePlacements(placements);
      this.normalizeSingleInstanceTypes();
      this.syncResponsiveVisibility();

      if (widgetType === 'system.weather') {
        this.loadWeather();
      }
    },

    async hideWidget(key) {
      const widget = this.widgets.find((entry) => entry.key === key);
      if (!widget) return;

      widget.hidden = true;
      if (this.dragState.key === key) {
        this.endDrag();
      }
      this.syncResponsiveVisibility();
    },

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

    previewPlacementClass() {
      return `desktop-widget-drop-preview${this.dragState.kind === 'icon' ? ' is-icon' : ''}`;
    },

    renderDesktopIconGraphic(node) {
      return renderDesktopIconGraphic(node?.subtype || 'folder');
    },

    widgetKicker(widget) {
      return getWidgetCatalogEntry(widget.widget)?.kicker || '桌面组件';
    },

    getWidgetStyle(widget) {
      return this.placementToAbsoluteStyle(widget);
    },

    placementToAbsoluteStyle(placement) {
      const width = placement.w * this.cellSize + (placement.w - 1) * this.gap;
      const height = this.isIconNode(placement)
        ? (this.cellSize + this.gap)
        : (placement.h * this.cellSize + (placement.h - 1) * this.gap);
      const left = (placement.x - 1) * (this.cellSize + this.gap);
      const top = (placement.y - 1) * (this.cellSize + this.gap);
      return `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
    },

    syncGridMetrics(options = {}) {
      const { deferVisibility = false } = options;
      if (window.innerWidth <= 640) {
        this.cellSize = 56;
      } else if (window.innerWidth <= 820) {
        this.cellSize = 60;
      } else {
        this.cellSize = 68;
      }
      const shellWidth = this.$refs.gridShell?.clientWidth || window.innerWidth;
      const shellHeight = this.$refs.layer?.clientHeight || window.innerHeight;
      const shellStyle = this.$refs.gridShell ? window.getComputedStyle(this.$refs.gridShell) : null;
      const topInset = shellStyle ? parseFloat(shellStyle.paddingTop || '0') : 0;
      this.gridTopOffset = topInset;
      const usableHeight = Math.max(this.cellSize, shellHeight - topInset);
      const fitColumns = Math.max(4, Math.floor((shellWidth + this.gap) / (this.cellSize + this.gap)));
      this.currentColumns = fitColumns;
      this.gridWidth = this.currentColumns * this.cellSize + (this.currentColumns - 1) * this.gap;
      this.maxVisibleRows = Math.max(1, Math.floor((usableHeight + this.gap) / (this.cellSize + this.gap)));
      this.normalizeVisibleLayout();
      if (this.previewPlacement) {
        this.previewPlacement = this.findNearestAvailablePlacement(
          this.previewPlacement,
          this.previewPlacement.x,
          this.previewPlacement.y,
          this.dragState.key || ''
        );
      }

      if (this.resizeVisibilityTimer) {
        window.clearTimeout(this.resizeVisibilityTimer);
        this.resizeVisibilityTimer = null;
      }

      if (deferVisibility) {
        this.resizeVisibilityTimer = window.setTimeout(() => {
          this.resizeVisibilityTimer = null;
          this.syncResponsiveVisibility();
        }, 180);
        return;
      }

      this.syncResponsiveVisibility();
    },

    normalizeVisibleLayout() {
      const visibleWidgets = this.placedWidgets
        .sort((left, right) => {
          const areaLeft = left.w * left.h;
          const areaRight = right.w * right.h;
          if (areaLeft !== areaRight) return areaRight - areaLeft;
          const leftY = left.baseY ?? left.y;
          const rightY = right.baseY ?? right.y;
          if (leftY !== rightY) return leftY - rightY;
          return (left.baseX ?? left.x) - (right.baseX ?? right.x);
        });

      const visibleIcons = this.placedIcons
        .sort((left, right) => {
          const leftY = left.baseY ?? left.y;
          const rightY = right.baseY ?? right.y;
          if (leftY !== rightY) return leftY - rightY;
          return (left.baseX ?? left.x) - (right.baseX ?? right.x);
        });

      const resolvedPlacements = [];

      const placeNode = (node) => {
        const targetX = Math.min(Math.max(1, node.baseX ?? node.x), Math.max(1, this.currentColumns - node.w + 1));
        const targetY = Math.max(1, node.baseY ?? node.y);

        const placement = this.findNearestAvailablePlacementInPlacements(
          node,
          targetX,
          targetY,
          resolvedPlacements,
          node.key
        );

        resolvedPlacements.push({ key: node.key, x: placement.x, y: placement.y, w: placement.w, h: placement.h });
      };

      visibleWidgets.forEach(placeNode);
      visibleIcons.forEach(placeNode);

      this.applyResolvedPlacements(resolvedPlacements);
    },

    canPlaceWidget(x, y, w, h, excludeKey = '') {
      if (x < 1 || y < 1) return false;
      if (x + w - 1 > this.currentColumns) return false;
      return !this.placedDesktopNodes.some((node) => {
        if (node.key === excludeKey) return false;
        return this.placementOverlaps(x, y, w, h, node);
      });
    },

    maxOccupiedRow(excludeKey = '') {
      return this.placedDesktopNodes.reduce((max, node) => {
        if (node.key === excludeKey) return max;
        return Math.max(max, node.y + node.h - 1);
      }, 0);
    },

    clampPlacement(widget, preferredX, preferredY) {
      const w = widget.w;
      const h = widget.h;
      const maxX = Math.max(1, this.currentColumns - w + 1);
      const maxY = Math.max(1, this.maxVisibleRows - h + 1);
      return {
        x: Math.min(Math.max(preferredX, 1), maxX),
        y: Math.min(Math.max(preferredY, 1), maxY),
        w,
        h
      };
    },

    canPlaceInPlacements(x, y, w, h, placements, excludeKey = '') {
      if (x < 1 || y < 1) return false;
      if (x + w - 1 > this.currentColumns) return false;
      return !placements.some((placement) => {
        if (placement.key === excludeKey) return false;
        return this.placementOverlaps(x, y, w, h, placement);
      });
    },

    maxOccupiedRowInPlacements(placements, excludeKey = '') {
      return placements.reduce((max, placement) => {
        if (placement.key === excludeKey) return max;
        return Math.max(max, placement.y + placement.h - 1);
      }, 0);
    },

    findNearestAvailablePlacementInPlacements(widget, preferredX, preferredY, placements, excludeKey = '') {
      const w = widget.w;
      const h = widget.h;
      const maxX = Math.max(1, this.currentColumns - w + 1);
      const startX = Math.min(Math.max(preferredX, 1), maxX);
      const startY = Math.max(preferredY, 1);
      const xCandidates = sortByDistance(Array.from({ length: maxX }, (_, index) => index + 1), startX);
      const maxRow = Math.max(this.maxOccupiedRowInPlacements(placements, excludeKey) + 12, startY + 12);

      for (let y = startY; y <= maxRow; y += 1) {
        for (const x of xCandidates) {
          if (this.canPlaceInPlacements(x, y, w, h, placements, excludeKey)) {
            return { x, y, w, h };
          }
        }
      }

      return { x: 1, y: maxRow + 1, w, h };
    },

    findNearestAvailablePlacement(widget, preferredX, preferredY, excludeKey = '') {
      const w = widget.w;
      const h = widget.h;
      const maxX = Math.max(1, this.currentColumns - w + 1);
      const startX = Math.min(Math.max(preferredX, 1), maxX);
      const startY = Math.max(preferredY, 1);
      const xCandidates = sortByDistance(Array.from({ length: maxX }, (_, index) => index + 1), startX);
      const maxRow = Math.max(this.maxOccupiedRow(excludeKey) + 12, startY + 12);

      for (let y = startY; y <= maxRow; y += 1) {
        for (const x of xCandidates) {
          if (this.canPlaceWidget(x, y, w, h, excludeKey)) {
            return { x, y, w, h };
          }
        }
      }

      return { x: 1, y: maxRow + 1, w, h };
    },

    resolvePlacementsForDrop(dragKey, desiredPlacement) {
      const placed = [{ key: dragKey, ...desiredPlacement }];
      const visible = this.placedDesktopNodes
        .filter((node) => node.key !== dragKey)
        .sort((left, right) => {
          if (left.y === right.y) return left.x - right.x;
          return left.y - right.y;
        });

      visible.forEach((node) => {
        const placement = this.findNearestAvailablePlacementInPlacements(node, node.x, node.y, placed, node.key);
        placed.push({ key: node.key, ...placement });
      });

      return placed;
    },

    applyResolvedPlacements(placements) {
      const placementMap = new Map(placements.map((placement) => [placement.key, placement]));
      [...this.widgets, ...this.icons].forEach((node) => {
        const placement = placementMap.get(node.key);
        if (!placement) return;
        node.x = placement.x;
        node.y = placement.y;
        node.w = placement.w;
        node.h = placement.h;
      });
    },

    syncBasePlacements(placements) {
      const placementMap = new Map(placements.map((placement) => [placement.key, placement]));
      [...this.widgets, ...this.icons].forEach((node) => {
        const placement = placementMap.get(node.key);
        if (!placement) return;
        node.baseX = placement.x;
        node.baseY = placement.y;
      });
    },

    beginWidgetDrag(widget, event) {
      if (!this.isEditing || !this.isHome) return;
      if (this.editStage !== 'decorate') return;
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest('.desktop-widget-hide-btn, a, button')) return;
      this.selectedDesktopKey = null;

      const rect = event.currentTarget.getBoundingClientRect();
      this.dragState = {
        active: true,
        kind: 'widget',
        key: widget.key,
        node: { ...widget },
        widget: { ...widget },
        iconMarkup: '',
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        snapOffsetX: rect.width / 2,
        snapOffsetY: rect.height / 2,
        width: rect.width,
        height: rect.height,
        hasMoved: false
      };

      this.previewPlacement = {
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h
      };
      this.dragMoveHandler = (moveEvent) => this.onDragMove(moveEvent);
      this.dragEndHandler = () => this.onDragEnd();

      window.addEventListener('pointermove', this.dragMoveHandler);
      window.addEventListener('pointerup', this.dragEndHandler);
      document.body.style.userSelect = 'none';
      event.preventDefault();
    },

    beginIconDrag(key, event) {
      if (!this.isEditing || !this.isHome) return;
      if (this.editStage !== 'decorate') return;
      if (event.button !== undefined && event.button !== 0) return;

      const icon = this.findIconByKey(key);
      if (!icon) return;

      const rect = event.currentTarget.getBoundingClientRect();
      this.selectedDesktopKey = key;
      this.dragState = {
        active: true,
        kind: 'icon',
        key,
        node: { ...icon },
        widget: null,
        iconMarkup: event.currentTarget.innerHTML,
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        snapOffsetX: rect.width / 2,
        snapOffsetY: rect.height / 2,
        width: rect.width,
        height: rect.height,
        hasMoved: false
      };

      this.previewPlacement = {
        x: icon.x,
        y: icon.y,
        w: icon.w,
        h: icon.h
      };
      this.dragMoveHandler = (moveEvent) => this.onDragMove(moveEvent);
      this.dragEndHandler = () => this.onDragEnd();

      window.addEventListener('pointermove', this.dragMoveHandler);
      window.addEventListener('pointerup', this.dragEndHandler);
      document.body.style.userSelect = 'none';
      event.preventDefault();
    },

    onDragMove(event) {
      if (!this.dragState.active || !this.dragState.node) return;

      this.dragState.pointerX = event.clientX;
      this.dragState.pointerY = event.clientY;
      const moveX = event.clientX - this.dragState.startX;
      const moveY = event.clientY - this.dragState.startY;
      if (!this.dragState.hasMoved) {
        const distance = Math.hypot(moveX, moveY);
        if (distance < 6) return;
        this.dragState.hasMoved = true;
      }
      this.updatePreviewForPointer(event.clientX, event.clientY, this.dragState.node);
    },

    updatePreviewForPointer(clientX, clientY, widget) {
      const gridRect = this.$refs.grid?.getBoundingClientRect();
      if (!gridRect) return;

      const rawLeft = clientX - gridRect.left - this.dragState.offsetX;
      const rawTop = clientY - gridRect.top - this.dragState.offsetY;
      const stride = this.cellSize + this.gap;
      const guessedX = Math.round(rawLeft / stride) + 1;
      const guessedY = Math.round(rawTop / stride) + 1;

      const desired = this.clampPlacement(widget, guessedX, guessedY);
      this.previewPlacement = this.findNearestAvailablePlacement(widget, desired.x, desired.y, widget.key);
    },

    onDragEnd() {
      if (!this.dragState.active) return;

      const node = this.findDesktopNode(this.dragState.key);
      if (node && this.previewPlacement) {
        const placements = this.resolvePlacementsForDrop(node.key, this.previewPlacement);
        this.applyResolvedPlacements(placements);
        this.syncBasePlacements(placements);
        this.syncResponsiveVisibility();
      }

      this.endDrag();
    },

    endDrag() {
      this.previewPlacement = null;
      this.dragState = {
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
      };

      if (this.dragMoveHandler) {
        window.removeEventListener('pointermove', this.dragMoveHandler);
        this.dragMoveHandler = null;
      }

      if (this.dragEndHandler) {
        window.removeEventListener('pointerup', this.dragEndHandler);
        this.dragEndHandler = null;
      }

      document.body.style.userSelect = '';
    },

    async loadWeather(forceRefresh = false) {
      if (!this.modules.weather.enabled) return;

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
      } catch (_error) {
        if (requestId !== this.weatherRequestId) return;

        this.weatherState = {
          loading: false,
          error: '天气数据暂时不可用。',
          data: null
        };
      }
    },

    renderWidgetBody(widget, options = {}) {
      return renderDesktopWidget(createWidgetRendererContext(this), widget, options);
    }
  }));
}
