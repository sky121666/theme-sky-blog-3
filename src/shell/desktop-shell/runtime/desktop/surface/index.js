/**
 * macOS 桌面小组件 — Alpine.data 主入口
 *
 * 状态声明、init、computed getters 保留于此。
 * 业务逻辑拆分到同目录各 mixin 模块，通过 spread 注入。
 */

import {
  computeDefaultDesktopIconPlacement,
  mergeDesktopIconLayout,
  normalizeDesktopIconHref,
  normalizeDesktopIconInstance,
  readDesktopIconsBootstrap,
  renderDesktopIconGraphic,
  serializeDeletedIconTombstone,
} from '../../icons/index.js';
import { cloneJsonValue, escapeHtml, toPositiveInt } from '../../shared/utils.js';
import { normalizeMomentRecord } from '../../shared/moments.js';
import { markPjaxLinks, attachDynamicLinks } from '../pjax/link-attach.js';
import { inferPageAppFromUrl } from '../../../../../shell-core/runtime/route-manifest.js';
import { initLazyImages } from '../../shared/lazy-media.js';
import { initLazyComments } from '../../shared/lazy-comment.js';
import { createLogger } from '../../shared/debug.js';
import { loadWidgetRenderer } from '../../../../../widgets/loaders.js';
import { enhanceDoubanShowcaseWidgets } from '../../../../../widgets/plugin/douban-showcase/runtime.js';

import {
  createWidgetInstance,
  normalizeWidgetSize,
  normalizeWidgetAppearance,
  getWidgetCatalogEntry,
} from '../../widgets/catalog-core.js';
import {
  DESKTOP_SHELL_VERSION,
  setDesktopDebugAccess,
  desktopDebug,
  desktopDebugWarn
} from '../../widgets/debug-core.js';
import {
  readDesktopWidgetsBootstrap,
  parseDesktopLayoutPayload,
  mergeDesktopWidgetLayout
} from '../../widgets/persistence-read.js';
import {
  DESKTOP_WIDGET_PROTOCOL_EVENT,
  normalizeDesktopWidgetProtocol
} from '../../widgets/protocol.js';
import {
  desktopLayoutNeedsDataReload,
  serverLoadedWidgetTypes
} from './data-reload.js';

/* ── Mixin modules ── */
import { gridMethods } from './grid.js';
import { placementMethods } from './placement.js';

const { log: widgetPjaxLog } = createLogger('desktop-widget-pjax');

/* ── Helpers ── */

function createWidgetRendererContext(state, options = {}) {
  return {
    now: state.now,
    modules: state.modules,
    sources: state.sources,
    weatherState: state.weatherState,
    escapeHtml,
    normalizeMomentRecord,
    mode: options.mode || (options.preview === true ? 'preview' : 'live')
  };
}

/** Widgets that need per-second re-rendering */
const TICK_SENSITIVE_WIDGETS = new Set(['system.clock']);
const DEFAULT_WIDGET_CENTER_CATEGORIES = [{ id: 'all', label: '所有小组件' }];

function resolveDesktopIconApp(href, explicitApp = '') {
  if (explicitApp) return explicitApp;
  return inferPageAppFromUrl(href) || '';
}

/** Build a lightweight cache key from widget state */
function widgetCacheKey(widget, options = {}) {
  const mode = options.mode || (options.preview === true ? 'preview' : 'live');
  const metaStr = widget.meta && typeof widget.meta === 'object'
    ? Object.entries(widget.meta).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
    : '';
  return `${widget.widget}:${widget.size}:${widget.key}:${widget.appearance || 'follow'}:mode=${mode}:compact=${options.compact === true ? 1 : 0}:meta=${metaStr}`;
}

function renderWidgetLoadingMarkup() {
  return '<div class="desktop-widget-loading" role="status" aria-live="polite"><span class="sr-only">组件加载中</span><span class="desktop-widget-loading-bar"></span><span class="desktop-widget-loading-bar desktop-widget-loading-bar--short"></span></div>';
}

/* ── Alpine registration ── */

export function registerDesktopSurface(Alpine) {
  Alpine.data('desktopWidgets', () => ({
    /* ═══ State ═══ */
    enabled: false,
    isHome: false,
    homeDataHydrated: false,
    hideOnMobile: false,
    editEnabled: false,
    viewportWidth: 0,
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
    serverLayoutSaveState: 'idle',
    serverLayoutSaveMessage: '',
    serverLayoutMutationVersion: 0,
    serverLayoutSavedMutationVersion: 0,
    serverLoadedWidgetTypes: [],
    serverLayoutReloadRequired: false,
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
      bangumisAvailable: false,
      bangumisUrl: '/bangumis',
      bangumisByStatus: {},
      bangumiStatusCounts: {},
      friendsAvailable: false,
      recentFriends: [],
      friendsUrl: '/friends',
      docsmeAvailable: false,
      docsmeUrl: '/docs',
      docsmeProjects: [],
      archivesUrl: '/archives',
      fallbackCover: '',
      photosAvailable: false,
      photos: [],
      photoGroups: [],
      photosUrl: '/photos',
      doubanAvailable: false,
      doubanUrl: '/douban',
      doubanApiBase: '/apis/api.douban.moony.la/v1alpha1/doubanmovies',
      steamAvailable: false,
      steamUrl: '/steam',
      steamProfile: {
        playing: false,
        statusText: '',
        personaName: '',
        avatarFull: '',
        profileUrl: '',
        steamLevel: 0,
        currentGameName: ''
      },
      steamStats: {
        totalGames: 0,
        recentPlaytimeFormatted: '',
        recentPlaytimeMinutes: 0
      },
      steamRecentGames: [],
      steamOwnedGames: []
    },
    iconsManaged: false,
    icons: [],
    defaultIcons: [],
    iconTombstones: [],   // [{key}] — 已删图标的 tombstone，保存时写入 JSON 防复活
    addIconForm: {
      open: false,
      title: '',
      href: '',
      subtype: 'folder',
      error: ''
    },
    widgetConfigForm: {
      open: false,
      mode: 'create',
      targetKey: '',
      widgetId: '',
      widgetType: '',
      size: '',
      catalogKey: '',
      title: '',
      configSchema: [],
      meta: {},
      previewWidget: null
    },
    widgetConfigOptionsError: '',
    widgetConfigOptionsPromise: null,
    widgetConfigOptionsRequestId: 0,
    widgetConfigOptionsAbortController: null,
    widgets: [],
    defaultWidgets: [],
    widgetCatalog: [],
    selectedDesktopKey: null,
    isEditing: false,
    editStage: 'add',
    desktopContextMenu: {
      open: false,
      x: 0,
      y: 0,
      isEditing: false,
      targetKind: 'desktop',
      targetKey: '',
      sourceSurface: 'desktop'
    },
    widgetCenterCategory: 'all',
    widgetCenterSearch: '',
    widgetCenterSelections: {},
    previewPlacement: null,
    dragState: {
      active: false,
      kind: '',
      key: '',
      pointerId: null,
      node: null,
      widget: null,
      widgetMarkup: '',
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
      hasMoved: false,
      notificationDropActive: false,
      notificationDropIndex: -1,
      notificationDropTop: 0,
      notificationDropLeft: 0,
      notificationDropWidth: 0,
      notificationDropHeight: 0
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
      data: null,
      entries: {}
    },
    weatherRequestId: 0,
    now: new Date(),
    tickTimer: null,
    routeSyncHandler: null,
    protocolHydrationHandler: null,
    resizeHandler: null,
    resizeVisibilityTimer: null,
    dragMoveHandler: null,
    dragEndHandler: null,
    dragCancelHandler: null,
    centerSheetMoveHandler: null,
    centerSheetEndHandler: null,
    lastVisibleNodeSignature: '',
    editingRuntime: null,
    editingRuntimePromise: null,
    weatherRuntime: null,
    weatherRuntimePromise: null,
    persistenceWriteRuntime: null,
    persistenceWriteRuntimePromise: null,
    widgetCatalogBuilder: null,
    widgetCenterCategoriesBuilder: null,
    widgetCatalogPromise: null,
    widgetRenderers: {},
    widgetRendererPromises: {},
    widgetRenderVersions: {},

    /* ═══ Mixin methods ═══ */
    ...gridMethods,
    ...placementMethods,

    isWidgetConfigFormValid() {
      return false;
    },

    previewPlacementClass() {
      return `desktop-widget-drop-preview${this.dragState.kind === 'icon' ? ' is-icon' : ''}`;
    },

    syncViewportState(measuredWidth = null) {
      if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
        this.viewportWidth = measuredWidth;
        return;
      }
      const shellWidth = this.$refs.gridShell?.clientWidth;
      this.viewportWidth = Number.isFinite(shellWidth) && shellWidth > 0
        ? shellWidth
        : (typeof window !== 'undefined' ? window.innerWidth : 0);
    },

    get isMobileViewport() {
      return this.viewportWidth > 0 && this.viewportWidth <= 640;
    },

    shouldSuppressWidgetsOnMobile() {
      return this.hideOnMobile && this.isMobileViewport;
    },

    hasVisibleWidgetType(widgetType) {
      return this.placedWidgets.some((widget) => widget.widget === widgetType);
    },

    hasVisibleWeatherWidget() {
      return this.hasVisibleWidgetType('system.weather');
    },

    hasTickSensitiveWidgets() {
      return this.placedWidgets.some((widget) => TICK_SENSITIVE_WIDGETS.has(widget.widget));
    },

    syncTickTimer() {
      if (this.hasTickSensitiveWidgets()) {
        if (!this.tickTimer) {
          this.tickTimer = window.setInterval(() => {
            this.now = new Date();
          }, 1000);
        }
        return;
      }

      if (this.tickTimer) {
        window.clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
    },

    syncWidgetRuntimes() {
      this.syncTickTimer();
      if (this.hasVisibleWeatherWidget()) return;

      this.weatherRequestId += 1;
      this.weatherState = {
        loading: false,
        error: '',
        data: null,
        entries: {}
      };
      this.invalidateWidgetCache();
    },

    setWidgetCenterCategory(categoryId) {
      this.widgetCenterCategory = categoryId;
    },

    widgetCenterCategoryLabel() {
      return this.widgetCenterCategories.find((item) => item.id === this.widgetCenterCategory)?.label || '全部';
    },

    widgetCenterResultText() {
      return `${this.filteredWidgetCatalog.length} 项`;
    },

    async ensureWidgetCenterCatalogReady() {
      if (this.widgetCatalogBuilder && this.widgetCenterCategoriesBuilder) {
        if (!this.widgetCatalog.length) {
          this.widgetCatalog = this.widgetCatalogBuilder(this.sources);
        }
        return this.widgetCatalog;
      }

      if (!this.widgetCatalogPromise) {
        this.widgetCatalogPromise = import('../../../../../widgets/catalog.js')
          .then((mod) => {
            this.widgetCatalogBuilder = mod.buildWidgetCatalog;
            this.widgetCenterCategoriesBuilder = mod.buildWidgetCenterCategories;
            this.widgetCatalog = mod.buildWidgetCatalog(this.sources);
            return this.widgetCatalog;
          })
          .finally(() => {
            this.widgetCatalogPromise = null;
          });
      }

      return this.widgetCatalogPromise;
    },

    async ensureEditingRuntime() {
      if (this.editingRuntime) {
        return this.editingRuntime;
      }

      if (!this.editingRuntimePromise) {
        this.editingRuntimePromise = Promise.all([
          this.ensureWidgetCenterCatalogReady(),
          import('./editing-runtime.js')
        ]).then(([, mod]) => {
          this.editingRuntime = mod.applyEditingRuntime(this);
          return this.editingRuntime;
        }).finally(() => {
          this.editingRuntimePromise = null;
        });
      }

      return this.editingRuntimePromise;
    },

    async ensureWeatherRuntime() {
      if (this.weatherRuntime) {
        return this.weatherRuntime;
      }

      if (!this.weatherRuntimePromise) {
        this.weatherRuntimePromise = import('../../widgets/weather-runtime.js')
          .then((mod) => {
            this.weatherRuntime = mod;
            return mod;
          })
          .finally(() => {
            this.weatherRuntimePromise = null;
          });
      }

      return this.weatherRuntimePromise;
    },

    async ensurePersistenceWriteRuntime() {
      if (this.persistenceWriteRuntime) {
        return this.persistenceWriteRuntime;
      }

      if (!this.persistenceWriteRuntimePromise) {
        this.persistenceWriteRuntimePromise = import('../../widgets/persistence-write.js')
          .then((mod) => {
            this.persistenceWriteRuntime = mod;
            return mod;
          })
          .finally(() => {
            this.persistenceWriteRuntimePromise = null;
          });
      }

      return this.persistenceWriteRuntimePromise;
    },

    async ensureWidgetRendererRuntime(widgetType) {
      const type = String(widgetType || '').trim();
      if (!type) return null;

      if (this.widgetRenderers[type]) {
        return this.widgetRenderers[type];
      }

      if (!this.widgetRendererPromises[type]) {
        this.widgetRendererPromises[type] = loadWidgetRenderer(type)
          .then((renderer) => {
            if (typeof renderer === 'function') {
              this.widgetRenderers[type] = renderer;
              this.widgetRenderVersions[type] = (this.widgetRenderVersions[type] || 0) + 1;
              this.invalidateWidgetCache(type);
              this.scheduleDesktopWidgetEnhancement();
            }
            return this.widgetRenderers[type] || null;
          })
          .finally(() => {
            delete this.widgetRendererPromises[type];
          });
      }

      return this.widgetRendererPromises[type];
    },

    async beginWidgetDrag(widget, event) {
      const runtime = await this.ensureEditingRuntime();
      return runtime.beginWidgetDrag.call(this, widget, event);
    },

    async beginIconDrag(key, event) {
      if (!this.isEditing || !this.isHome) return;
      desktopDebug('beginIconDrag', { key, editing: this.isEditing });
      const runtime = await this.ensureEditingRuntime();
      return runtime.beginIconDrag.call(this, key, event);
    },

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
      if (!sessionStorage.getItem(healKey) && !window.pjax) {
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

      if (!sessionStorage.getItem(healKey) && !window.pjax) {
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

    applyHomeWidgetProtocol(rawProtocol) {
      const bootstrap = normalizeDesktopWidgetProtocol(rawProtocol);
      if (!bootstrap.isHome) return false;

      // The persistent desktop layout is already initialized on a non-home
      // direct load. Returning home should hydrate Finder/plugin data only;
      // replacing layout state here would discard unsaved widget/icon edits.
      this.modules = bootstrap.modules;
      this.sources = bootstrap.sources;

      // Catalog entries and rendered HTML depend on Finder/plugin sources.
      // Rebuild synchronously when the lazy catalog runtime is already ready;
      // otherwise its pending import will read the newly installed sources.
      this.widgetCatalog = this.widgetCatalogBuilder
        ? this.widgetCatalogBuilder(this.sources)
        : [];
      this.invalidateWidgetCache();
      this.syncWidgetRuntimes();
      this.dispatchNotificationWidgetsChange();
      this.homeDataHydrated = true;
      desktopDebug('desktop home protocol hydrated', {
        preservedWidgets: this.widgets.length,
        sourceKeys: Object.keys(this.sources)
      });
      return true;
    },

    /* ═══ Init ═══ */

    async init() {
      // Skip heavy init on error pages — no widgets/icons needed
      if (document.body?.dataset.errorPage === 'true') {
        desktopDebug('desktop init: error page, skipping');
        this.enabled = false;
        return;
      }

      desktopDebug('desktop runtime init start');
      const bootstrap = readDesktopWidgetsBootstrap();

      const frontendDefaults = [];

      const serverLayout = parseDesktopLayoutPayload(bootstrap.serverLayoutJson, bootstrap.layoutVersion || 'v1', 'server');
      const resolvedWidgets = serverLayout
        ? mergeDesktopWidgetLayout(frontendDefaults, serverLayout)
        : frontendDefaults;

      this.syncViewportState();
      this.enabled = !!bootstrap.enabled;
      this.isHome = window.location.pathname === '/';
      this.homeDataHydrated = this.isHome && bootstrap.isHome === true;
      this.hideOnMobile = !!bootstrap.hideOnMobile;
      this.editEnabled = !!bootstrap.editEnabled;
      this.columns = toPositiveInt(bootstrap.columns, 12);
      this.gap = toPositiveInt(bootstrap.gap, 18);
      this.layoutVersion = bootstrap.layoutVersion || 'v1';
      this.siteUrl = bootstrap.siteUrl || '';
      this.themeName = bootstrap.themeName || 'theme-sky-blog-3';
      this.themeJsonConfigEndpoint = bootstrap.themeJsonConfigEndpoint || '';
      this.serverLayoutJson = bootstrap.serverLayoutJson || '';
      this.serverLayoutPayload = serverLayout;
      this.serverLoadedWidgetTypes = serverLoadedWidgetTypes(serverLayout);
      this.serverLayoutReloadRequired = false;
      setDesktopDebugAccess(false);
      this.modules = {
        weather: {
          cityName: (bootstrap.modules?.weather?.cityName || '').trim(),
          refreshMinutes: toPositiveInt(bootstrap.modules?.weather?.refreshMinutes, 30)
        }
      };
      this.sources = bootstrap.sources;
      this.defaultWidgets = resolvedWidgets.map((widget) => ({ ...widget }));
      this.syncDesktopBodyState();
      desktopDebug('desktop bootstrap', {
        enabled: this.enabled,
        isHome: this.isHome,
        layoutVersion: this.layoutVersion,
        columns: this.columns,
        gap: this.gap,
        widgetDefaults: this.defaultWidgets.length
      });

      this.widgets = this.defaultWidgets.map((widget) => ({ ...widget }));
      desktopDebug('desktop widgets initialized', {
        widgets: this.widgets.length
      });

      this.dispatchNotificationWidgetsChange();
      this.syncWidgetRuntimes();

      this.protocolHydrationHandler = (event) => {
        this.applyHomeWidgetProtocol(event.detail?.protocol);
      };
      this.routeSyncHandler = async () => {
        this.syncViewportState();
        this.isHome = window.location.pathname === '/';
        if (this.enabled && this.isHome && !this.homeDataHydrated) {
          desktopDebugWarn('desktop home protocol was not hydrated before PJAX completion');
        }
        this.closeDesktopContextMenu();
        this.invalidateWidgetCache();
        if (!this.isHome) {
          this.widgetConfigOptionsRequestId += 1;
          this.widgetConfigOptionsAbortController?.abort();
          this.widgetConfigOptionsAbortController = null;
          this.widgetConfigOptionsPromise = null;
          if (this.isEditing && typeof this.exitEditMode === 'function') {
            await this.exitEditMode();
          }
        } else if (this.hasVisibleWeatherWidget() && !this.weatherState.loading && !this.weatherState.data) {
          // Defer weather load to avoid blocking content navigation
          (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 1200))(() => this.loadWeather());
        }
        this.syncDesktopBodyState();
        this.scheduleDesktopRenderCheck();
        this.scheduleDesktopWidgetEnhancement();
      };

      this.resizeHandler = () => {
        this.syncViewportState();
        this.syncGridMetrics({ deferVisibility: true });
        this.syncWidgetRuntimes();
      };

      this.handleNotificationWidgetDragStart = (event) => {
        if (event.detail?.source && event.detail.source !== 'notification-center') return;
        const { widget, clientX, clientY, pointerId, rect, markup } = event.detail;
        this.beginWidgetDragFromNotification(widget, { clientX, clientY, pointerId, rect, markup });
      };
      this.handleWidgetContextMenu = (event) => {
        void this.openWidgetContextMenuFromEvent(event.detail || {});
      };

      window.addEventListener(DESKTOP_WIDGET_PROTOCOL_EVENT, this.protocolHydrationHandler);
      window.addEventListener('pjax:complete', this.routeSyncHandler);
      window.addEventListener('pageshow', this.routeSyncHandler);
      window.addEventListener('resize', this.resizeHandler);
      window.addEventListener('theme-notification-widget-drag-start', this.handleNotificationWidgetDragStart);
      window.addEventListener('theme-widget-context-menu', this.handleWidgetContextMenu);

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

        // Deferred: weather (cache-first instant, API call idle)
        if (this.hasVisibleWeatherWidget()) {
          (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 1200))(() => this.loadWeather());
        }

        // Deferred: widget renderer preload — shell + icons are critical,
        // widget bodies are deferred to idle time
        if (this.placedWidgets.length > 0) {
          (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 800))(() => {
            Array.from(new Set(this.placedWidgets.map((widget) => widget.widget))).forEach((widgetType) => {
              this.ensureWidgetRendererRuntime(widgetType);
            });
          });
        }

        // Install widget click delegate (one-time)
        this.installWidgetClickDelegate();
      });
    },

    /* ═══ Computed getters ═══ */

    get placedWidgets() {
      if (this.shouldSuppressWidgetsOnMobile()) {
        return [];
      }
      return this.widgets
        .filter((widget) => !widget.hidden && widget.surface !== 'notification-center')
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
      if (!this.widgetCenterCategoriesBuilder) {
        return DEFAULT_WIDGET_CENTER_CATEGORIES;
      }
      return this.widgetCenterCategoriesBuilder(this.widgetCatalog);
    },

    get filteredWidgetCatalog() {
      const keyword = this.widgetCenterSearch.trim().toLowerCase();
      return this.widgetCatalog.filter((entry) => {
        if (this.widgetCenterCategory !== 'all' && entry.widget !== this.widgetCenterCategory) {
          return false;
        }

        if (!keyword) return true;
        const haystack = `${entry.title} ${entry.kicker || ''} ${entry.description || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    },

    get groupedFilteredCatalog() {
      const items = this.filteredWidgetCatalog;
      if (!items.length) return [];
      const showHeaders = this.widgetCenterCategory === 'all' && !this.widgetCenterSearch.trim();
      if (!showHeaders) return items;

      const result = [];
      let lastWidget = '';
      for (const entry of items) {
        if (entry.widget !== lastWidget) {
          result.push({
            _type: 'header',
            _key: `hdr-${entry.widget}`,
            label: entry.title,
            description: entry.description || '',
            /* safe defaults so Alpine bindings on hidden card don't throw */
            widget: entry.widget, size: 'medium', catalogKey: '', sizeLabel: '', title: '', category: ''
          });
          lastWidget = entry.widget;
        }
        result.push(entry);
      }
      return result;
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
      const menuHeight = this.desktopContextMenu.targetKind === 'desktop' ? 210 : 252;
      const x = Math.min(this.desktopContextMenu.x, Math.max(16, window.innerWidth - menuWidth - 18));
      const y = Math.min(this.desktopContextMenu.y, Math.max(44, window.innerHeight - menuHeight - 18));
      return {
        left: `${x}px`,
        top: `${y}px`
      };
    },

    get saveShortcutHintMarkup() {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? '⌘' : 'Ctrl';
      const feedback = this.serverLayoutSaveMessage
        ? `<div class="desktop-save-hint-item desktop-save-hint-item--state is-${this.serverLayoutSaveState}"><span class="label">${escapeHtml(this.serverLayoutSaveMessage)}</span></div>`
        : '';
      return `
        <div class="desktop-save-hint-item">
          <kbd>${modKey}</kbd> <span>+</span> <kbd>S</kbd> <span class="label">保存</span>
        </div>
        <div class="desktop-save-hint-item">
          <kbd>${modKey}</kbd> <span>+</span> <kbd>A</kbd> <span class="label">整理图标</span>
        </div>
        <div class="desktop-save-hint-item">
          <kbd>Esc</kbd> <span class="label">退出</span>
        </div>
        ${feedback}
      `;
    },

    get desktopLayoutSaveFeedbackText() {
      return this.serverLayoutSaveMessage || '';
    },

    get desktopLayoutSaveFeedbackClass() {
      return `desktop-widget-center-save-feedback is-${this.serverLayoutSaveState || 'idle'}`;
    },

    /* ═══ Desktop interaction ═══ */

    handleDesktopSurfaceOutsideClick(event) {
      if (!event.target.closest('.desktop-node-slot--icon, .desktop-widget-center, .desktop-widgets-toolbar, .desktop-context-menu')) {
        this.selectedDesktopKey = null;
      }
      if (!event.target.closest('.desktop-context-menu')) {
        this.closeDesktopContextMenu();
      }
      /* click outside widget center frame → switch to decorate
         guard: skip if center was just opened (same event / x-if removed source from DOM) */
      if (this.showWidgetCenter
          && !event.target.closest('.desktop-widget-center-frame, .desktop-context-menu, .dock-container, #notification-center-panel')
          && Date.now() - (this._widgetCenterOpenedAt || 0) > 100) {
        this.setEditStage('decorate');
      }
    },

    handleDesktopKeydown(event) {
      /* ⌘+S / Ctrl+S → save layout */
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        if (this.isEditing) {
          event.preventDefault();
          this.saveDesktopEditing();
        }
      }
      /* ⌘+A / Ctrl+A → rearrange icons */
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'a') {
        if (this.isEditing) {
          event.preventDefault();
          this.reArrangeIcons();
        }
      }
      /* Esc → exit editing */
      if (event.key === 'Escape' && this.isEditing) {
        if (this.showWidgetCenter) {
          this.setEditStage('decorate');
        } else {
          this.exitEditMode();
        }
      }
    },

    handleDesktopSurfaceContextMenu(event) {
      if (!this.editEnabled || !this.isHome) return;
      if (event.target.closest('.desktop-widget-center, .desktop-node-slot, .dock-container, .window-layer')) return;
      event.preventDefault();
      void this.openWidgetEditorContextMenu(event.clientX, event.clientY);
    },

    async openWidgetEditorContextMenu(x, y) {
      await this.ensureEditingRuntime();
      const canManage = this.serverLayoutAccessReady
        ? this.canManageDefaultDesktopLayout
        : await this.probeServerLayoutConfigAccess();
      if (!canManage) return;
      this.selectedDesktopKey = null;
      this.desktopContextMenu = {
        open: true,
        x,
        y,
        isEditing: this.isEditing,
        targetKind: 'desktop',
        targetKey: '',
        sourceSurface: 'desktop'
      };
    },

    async openDesktopNodeContextMenu(node, event) {
      if (!this.editEnabled || !this.isHome || !node) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      await this.ensureEditingRuntime();
      const canManage = this.serverLayoutAccessReady
        ? this.canManageDefaultDesktopLayout
        : await this.probeServerLayoutConfigAccess();
      if (!canManage) return;

      this.selectedDesktopKey = node.key;
      this.desktopContextMenu = {
        open: true,
        x: event?.clientX || 96,
        y: event?.clientY || 96,
        isEditing: this.isEditing,
        targetKind: this.isWidgetNode(node) ? 'widget' : 'icon',
        targetKey: node.key,
        sourceSurface: node.surface || 'desktop'
      };
    },

    async openWidgetContextMenuFromEvent(detail = {}) {
      if (!this.editEnabled || !this.isHome) return;
      const key = detail.key || '';
      const node = key ? this.widgets.find((widget) => widget.key === key) : null;
      if (!node) return;
      await this.ensureEditingRuntime();
      const canManage = this.serverLayoutAccessReady
        ? this.canManageDefaultDesktopLayout
        : await this.probeServerLayoutConfigAccess();
      if (!canManage) return;

      this.selectedDesktopKey = key;
      this.desktopContextMenu = {
        open: true,
        x: detail.x || window.innerWidth - 220,
        y: detail.y || 160,
        isEditing: this.isEditing,
        targetKind: 'widget',
        targetKey: key,
        sourceSurface: detail.source || node.surface || 'desktop'
      };
    },

    closeDesktopContextMenu() {
      this.desktopContextMenu.open = false;
    },

    desktopContextTargetNode() {
      const key = this.desktopContextMenu.targetKey;
      if (!key) return null;
      if (this.desktopContextMenu.targetKind === 'icon') {
        return this.icons.find((icon) => icon.key === key) || null;
      }
      return this.widgets.find((widget) => widget.key === key) || null;
    },

    desktopContextTargetWidget() {
      return this.desktopContextMenu.targetKind === 'widget'
        ? this.desktopContextTargetNode()
        : null;
    },

    desktopContextTargetIcon() {
      return this.desktopContextMenu.targetKind === 'icon'
        ? this.desktopContextTargetNode()
        : null;
    },

    desktopNodeLoopKey(node) {
      if (!node) return '';
      if (this.isWidgetNode(node)) {
        return `${node.key}:${node.widget}:${node.size || 'medium'}:${node.renderKey || 0}`;
      }
      return node.key;
    },

    widgetContentRenderMode(widget) {
      const catalog = getWidgetCatalogEntry(widget?.widget);
      return Array.isArray(catalog?.sizes) && catalog.sizes.length > 1 ? 'html' : 'morph';
    },

    desktopContextWidgetSizeOptions() {
      const widget = this.desktopContextTargetWidget();
      if (!widget?.widget) return [];

      const catalogEntries = Array.isArray(this.widgetCatalog)
        ? this.widgetCatalog
          .filter((entry) => entry?.widget === widget.widget && entry?.size)
          .map((entry) => ({
            key: entry.catalogKey || `${entry.widget}:${entry.size}`,
            size: normalizeWidgetSize(entry.size),
            label: entry.sizeLabel || this.desktopContextWidgetSizeLabel(entry.size),
            title: entry.title || widget.title || '小组件'
          }))
        : [];

      const fallbackCatalog = getWidgetCatalogEntry(widget.widget);
      const fallbackSizes = Array.isArray(fallbackCatalog?.sizes) && fallbackCatalog.sizes.length > 0
        ? fallbackCatalog.sizes
        : [widget.size || fallbackCatalog?.size || 'medium'];
      const fallbackEntries = fallbackSizes.map((size) => ({
        key: `${widget.widget}:${normalizeWidgetSize(size)}`,
        size: normalizeWidgetSize(size),
        label: this.desktopContextWidgetSizeLabel(size),
        title: fallbackCatalog?.title || widget.title || '小组件'
      }));

      const seen = new Set();
      return [...catalogEntries, ...fallbackEntries].filter((entry) => {
        if (seen.has(entry.size)) return false;
        seen.add(entry.size);
        return true;
      }).map((entry) => ({
        ...entry,
        active: normalizeWidgetSize(widget.size) === entry.size
      }));
    },

    hasDesktopContextWidgetSizeOptions() {
      return this.desktopContextWidgetSizeOptions().length > 1;
    },

    desktopContextWidgetSizeLabel(size) {
      const labels = {
        small: '小',
        medium: '中',
        large: '大',
        'extra-large': '特大'
      };
      return labels[normalizeWidgetSize(size)] || '中';
    },

    isDesktopContextWidgetSizeActive(size) {
      const widget = this.desktopContextTargetWidget();
      return !!widget && normalizeWidgetSize(widget.size) === normalizeWidgetSize(size);
    },

    canDesktopContextWidgetMoveToNotification() {
      const widget = this.desktopContextTargetWidget();
      return !!widget && widget.surface !== 'notification-center';
    },

    canDesktopContextWidgetMoveToDesktop() {
      const widget = this.desktopContextTargetWidget();
      return !!widget && widget.surface === 'notification-center';
    },

    canDesktopContextWidgetConfigure() {
      const widget = this.desktopContextTargetWidget();
      return !!widget && getWidgetCatalogEntry(widget.widget)?.hasConfig === true;
    },

    async ensureDesktopEditingForAction(stage = 'decorate') {
      await this.ensureEditingRuntime();
      const canManage = this.serverLayoutAccessReady
        ? this.canManageDefaultDesktopLayout
        : await this.probeServerLayoutConfigAccess();
      if (!canManage) return false;

      if (!this.isEditing) {
        this.enterEditMode(stage);
      } else if (stage) {
        this.setEditStage(stage);
      }
      return true;
    },

    async openAddWidgetCenterFromContext() {
      this.closeDesktopContextMenu();
      await this.ensureDesktopEditingForAction('add');
    },

    async openAddIconFromContext() {
      this.closeDesktopContextMenu();
      const ready = await this.ensureDesktopEditingForAction('decorate');
      if (!ready) return;
      this.openAddIconForm();
    },

    async changeWidgetSizeFromContext(optionOrSize) {
      const widget = this.desktopContextTargetWidget();
      if (!widget) return;
      const option = typeof optionOrSize === 'object' && optionOrSize
        ? optionOrSize
        : this.desktopContextWidgetSizeOptions().find((entry) => entry.size === normalizeWidgetSize(optionOrSize));
      const nextSize = normalizeWidgetSize(option?.size || optionOrSize);
      if (normalizeWidgetSize(widget.size) === nextSize) {
        this.closeDesktopContextMenu();
        return;
      }

      const ready = await this.ensureDesktopEditingForAction('decorate');
      if (!ready) return;

      const replacement = createWidgetInstance(widget.widget, {
        key: widget.key,
        title: option?.title || widget.title,
        size: nextSize,
        appearance: widget.appearance,
        x: widget.x,
        y: widget.y,
        baseX: widget.baseX,
        baseY: widget.baseY,
        surface: widget.surface || 'desktop',
        order: widget.order,
        hidden: widget.hidden === true,
        meta: (widget.meta && typeof widget.meta === 'object') ? { ...widget.meta } : {}
      });

      if ((replacement.surface || 'desktop') === 'desktop') {
        const placement = this.findNearestAvailablePlacement(replacement, replacement.x || 1, replacement.y || 1, replacement.key);
        replacement.x = placement.x;
        replacement.y = placement.y;
        replacement.baseX = placement.x;
        replacement.baseY = placement.y;
      }

      replacement.renderKey = (Number(widget.renderKey) || 0) + 1;

      const widgetIndex = this.widgets.findIndex((entry) => entry.key === widget.key);
      if (widgetIndex >= 0) {
        this.widgets.splice(widgetIndex, 1, replacement);
      } else {
        Object.assign(widget, replacement);
      }
      this.selectedDesktopKey = replacement.key;
      this.invalidateWidgetCache();
      this.syncResponsiveVisibility();
      this.syncWidgetRuntimes();
      this.dispatchNotificationWidgetsChange();
      this.markDesktopLayoutDirty('组件尺寸已调整，保存后生效');
      this.closeDesktopContextMenu();
    },

    async moveWidgetToNotificationFromContext() {
      const widget = this.desktopContextTargetWidget();
      if (!widget) return;
      const ready = await this.ensureDesktopEditingForAction('decorate');
      if (!ready) return;

      const moved = this.applyNotificationWidgetOrder(widget.key, Number.POSITIVE_INFINITY);
      if (moved) {
        this.previewPlacement = null;
        this.selectedDesktopKey = widget.key;
        this.syncResponsiveVisibility();
        this.syncWidgetRuntimes();
        this.dispatchNotificationWidgetsChange();
        this.markDesktopLayoutDirty('组件已移到通知中心，保存后生效');
      }
      this.closeDesktopContextMenu();
    },

    async moveWidgetToDesktopFromContext() {
      const widget = this.desktopContextTargetWidget();
      if (!widget) return;
      const ready = await this.ensureDesktopEditingForAction('decorate');
      if (!ready) return;

      widget.surface = 'desktop';
      const placement = this.findNearestAvailablePlacement(widget, widget.x || 1, widget.y || 1, widget.key);
      widget.x = placement.x;
      widget.y = placement.y;
      widget.baseX = placement.x;
      widget.baseY = placement.y;
      widget.w = placement.w;
      widget.h = placement.h;
      this.selectedDesktopKey = widget.key;
      this.syncResponsiveVisibility();
      this.syncWidgetRuntimes();
      this.dispatchNotificationWidgetsChange();
      this.markDesktopLayoutDirty('组件已移到桌面，保存后生效');
      this.closeDesktopContextMenu();
    },

    async editDesktopContextWidgetConfig() {
      const widget = this.desktopContextTargetWidget();
      if (!widget || !this.canDesktopContextWidgetConfigure()) return;
      const ready = await this.ensureDesktopEditingForAction('decorate');
      if (!ready) return;
      this.openWidgetConfigFormForExisting(widget);
      this.closeDesktopContextMenu();
    },

    async removeDesktopContextTarget() {
      const target = this.desktopContextTargetNode();
      if (!target) return;
      const ready = await this.ensureDesktopEditingForAction('decorate');
      if (!ready) return;

      if (this.desktopContextMenu.targetKind === 'icon') {
        this.removeIcon(target.key);
      } else {
        await this.hideWidget(target.key);
        this.dispatchNotificationWidgetsChange();
      }
      this.closeDesktopContextMenu();
    },

    async openWidgetEditorFromDesktopMenu() {
      this.closeDesktopContextMenu();
      await this.ensureEditingRuntime();
      const canManage = this.serverLayoutAccessReady
        ? this.canManageDefaultDesktopLayout
        : await this.probeServerLayoutConfigAccess();
      if (!canManage) return;
      this.enterEditMode('decorate');
    },

    syncDesktopBodyState() {
      document.body.classList.toggle('desktop-widget-center-open', this.showWidgetCenter);
      document.body.classList.toggle('desktop-editing', this.isEditing);
    },

    syncLayoutSnapshotAsDefaults(widgets = this.widgets, icons = this.icons) {
      this.defaultWidgets = (cloneJsonValue(widgets) || []).map((widget) => ({
        ...widget,
        baseX: widget.baseX ?? widget.x,
        baseY: widget.baseY ?? widget.y
      }));
      this.defaultIcons = (cloneJsonValue(icons) || []).map((icon) => ({
        ...icon,
        baseX: icon.baseX ?? icon.x,
        baseY: icon.baseY ?? icon.y
      }));
    },

    dispatchNotificationWidgetsChange() {
      window.dispatchEvent(new CustomEvent('theme-notification-widgets-change', {
        detail: { widgets: this.widgets.map((widget) => ({ ...widget })) }
      }));
    },

    markDesktopLayoutDirty(message = '有未保存更改') {
      this.serverLayoutMutationVersion += 1;
      this.serverLayoutSaveState = 'dirty';
      this.serverLayoutSaveMessage = this.serverLayoutSaving
        ? '保存中；新的修改仍需再次保存'
        : message;
    },

    desktopLayoutSaveButtonLabel() {
      if (this.serverLayoutSaving || this.serverLayoutSaveState === 'saving') return '保存中...';
      if (this.serverLayoutSaveState === 'saved') return '已保存';
      return '保存';
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

    async saveLayoutJsonToServer(layoutJson, snapshot = null) {
      if (!this.themeJsonConfigEndpoint || !this.canManageDefaultDesktopLayout) {
        this.serverLayoutSaveState = 'failed';
        this.serverLayoutSaveMessage = '保存失败，请检查登录状态或后台权限';
        desktopDebugWarn('desktop default layout save skipped: no permission', {
          endpoint: this.themeJsonConfigEndpoint,
          themeName: this.themeName,
          canManageDefaultDesktopLayout: this.canManageDefaultDesktopLayout
        });
        return false;
      }

      if (this.serverLayoutSaving) {
        this.serverLayoutSaveState = 'dirty';
        this.serverLayoutSaveMessage = '已有保存任务进行中，请稍后再次保存';
        return false;
      }

      const savedSnapshot = snapshot || {
        mutationVersion: this.serverLayoutMutationVersion,
        widgets: cloneJsonValue(this.widgets) || [],
        icons: cloneJsonValue(this.icons) || [],
        requiresDataReload: desktopLayoutNeedsDataReload(this.widgets, this.serverLoadedWidgetTypes)
      };

      this.serverLayoutSaving = true;
      this.serverLayoutSaveState = 'saving';
      this.serverLayoutSaveMessage = '保存中...';
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
        const { applyDesktopLayoutJsonToThemeConfig } = await this.ensurePersistenceWriteRuntime();
        const nextConfig = applyDesktopLayoutJsonToThemeConfig(currentConfig, layoutJson);

        // Halo 2.x CSRF：从 cookie 中读取 XSRF-TOKEN 并作为 header 回传
        const csrfToken = document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || '';
        const putHeaders = {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        };
        if (csrfToken) {
          putHeaders['X-XSRF-TOKEN'] = decodeURIComponent(csrfToken);
        }

        const putResponse = await fetch(this.themeJsonConfigEndpoint, {
          method: 'PUT',
          credentials: 'include',
          headers: putHeaders,
          body: JSON.stringify(nextConfig)
        });

        if (!putResponse.ok) {
          const body = await putResponse.text().catch(() => '');
          desktopDebugWarn('PUT json-config failed', { status: putResponse.status, body: body.slice(0, 160) });
          throw new Error(`PUT theme json-config failed: ${putResponse.status} ${body.slice(0, 160)}`.trim());
        }

        this.serverLayoutJson = layoutJson;
        this.serverLayoutPayload = parseDesktopLayoutPayload(layoutJson, this.layoutVersion, 'saved-server');
        this.serverLayoutSavedMutationVersion = savedSnapshot.mutationVersion;
        this.syncLayoutSnapshotAsDefaults(savedSnapshot.widgets, savedSnapshot.icons);
        const hasNewerChanges = this.serverLayoutMutationVersion !== savedSnapshot.mutationVersion;
        this.serverLayoutReloadRequired = !hasNewerChanges && savedSnapshot.requiresDataReload === true;
        this.serverLayoutSaveState = hasNewerChanges ? 'dirty' : 'saved';
        this.serverLayoutSaveMessage = hasNewerChanges
          ? '本次快照已保存；保存期间的新修改仍未保存'
          : '已保存';
        desktopDebug('desktop default layout saved to server', {
          endpoint: this.themeJsonConfigEndpoint,
          themeName: this.themeName,
          payloadSize: layoutJson.length
        });
        return !hasNewerChanges;
      } catch (error) {
        this.serverLayoutSaveState = 'failed';
        this.serverLayoutSaveMessage = '保存失败，请检查登录状态或后台权限';
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
      if (this.serverLayoutSaving) {
        this.serverLayoutSaveState = 'dirty';
        this.serverLayoutSaveMessage = '已有保存任务进行中，请稍后再次保存';
        return false;
      }

      const { buildDesktopLayoutJsonString } = await this.ensurePersistenceWriteRuntime();
      const snapshot = {
        mutationVersion: this.serverLayoutMutationVersion,
        widgets: cloneJsonValue(this.widgets) || [],
        icons: cloneJsonValue(this.icons) || [],
        tombstones: cloneJsonValue(this.iconTombstones) || [],
        requiresDataReload: desktopLayoutNeedsDataReload(this.widgets, this.serverLoadedWidgetTypes)
      };
      // 将 tombstone 合并到 icons 数组末尾，写入 JSON 防止被删图标复活
      const iconsWithTombstones = [...snapshot.icons, ...snapshot.tombstones];
      const layoutJson = buildDesktopLayoutJsonString(this.layoutVersion, snapshot.widgets, iconsWithTombstones, this.currentColumns);
      return this.saveLayoutJsonToServer(layoutJson, snapshot);
    },

    /* ═══ Desktop icons ═══ */

    openAddIconForm() {
      this.addIconForm = { open: true, title: '', href: '', subtype: 'folder', error: '' };
    },

    closeAddIconForm() {
      this.addIconForm = { open: false, title: '', href: '', subtype: 'folder', error: '' };
    },

    submitAddIconForm() {
      const href = this.addIconForm.href.trim();
      if (!href) return;
      const link = normalizeDesktopIconHref(href, window.location.origin);
      if (!link.valid) {
        this.addIconForm.error = '仅支持站内路径或 http/https 链接';
        return;
      }
      this.addIconForm.error = '';
      const title = this.addIconForm.title.trim() || (() => {
        try { return new URL(link.href, window.location.origin).hostname || link.href; } catch { return link.href; }
      })();
      this.addCustomIcon(title, link.href, this.addIconForm.subtype);
      this.closeAddIconForm();
    },

    addCustomIcon(title, href, subtype = 'folder') {
      const link = normalizeDesktopIconHref(href, window.location.origin);
      if (!link.valid) return false;
      let basename = title.replace(/\s+/g, '-');
      let targetKey = `icon-custom-${basename}`;
      let suffixId = 0;
      while (this.icons.some(i => i.key === targetKey) || this.iconTombstones.some(i => i.key === targetKey)) {
        suffixId++;
        targetKey = `icon-custom-${basename}-${suffixId}`;
      }
      const key = targetKey;
      const pos = this.findFreeIconSlot();
      this.icons.push({
        key,
        kind: 'icon',
        title,
        href: link.href,
        subtype,
        pjax: link.pjax,
        pjaxApp: '',
        external: link.external,
        dataId: key,
        x: pos.x,
        y: pos.y,
        baseX: pos.x,
        baseY: pos.y,
        w: 1,
        h: 1
      });
      this.iconsManaged = true;
      this.normalizeVisibleLayout();
      this.syncResponsiveVisibility();
      this.markDesktopLayoutDirty('图标已添加，保存后生效');
      desktopDebug('icon added', { key, title, href: link.href, pos });
      return true;
    },

    findFreeIconSlot() {
      const occupied = new Set(this.icons.map((ic) => `${ic.baseX ?? ic.x},${ic.baseY ?? ic.y}`));
      for (const w of this.widgets.filter((w) => !w.hidden)) {
        for (let dx = 0; dx < (w.w || 1); dx++) {
          for (let dy = 0; dy < (w.h || 1); dy++) {
            occupied.add(`${w.x + dx},${w.y + dy}`);
          }
        }
      }
      const maxRows = this.maxVisibleRows || 8;
      for (let col = 1; col <= 100; col++) {
        for (let row = 1; row <= maxRows; row++) {
          if (!occupied.has(`${col},${row}`)) return { x: col, y: row };
        }
      }
      return { x: this.icons.length + 1, y: 1 };
    },

    handleDesktopIconClick(event, key) {
      const icon = this.findIconByKey(key);
      desktopDebug('icon click', { key, href: icon?.href, pjax: icon?.pjax, editing: this.isEditing, target: event.target?.tagName });

      if (this.isEditing) {
        this.selectedDesktopKey = key;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      this.closeDesktopContextMenu();
      this.selectedDesktopKey = null;

      const link = normalizeDesktopIconHref(icon?.href || '', window.location.origin);
      if (!link.valid) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!icon?.pjax || link.external || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      let url;
      try {
        url = new URL(link.href, window.location.origin);
      } catch (_error) {
        return;
      }
      if (url.origin !== window.location.origin || !window.pjax) return;

      event.preventDefault();
      desktopDebug('icon pjax fallback', { key, href: url.pathname + url.search });
      window.pjax.loadUrl(url.pathname + url.search, { triggerElement: event.currentTarget });
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
          pjaxApp: resolveDesktopIconApp(icon.href, icon.pjaxApp || ''),
          external: icon.external,
          subtype: icon.subtype,
          dataId: icon.dataId
        };
      });

      const serverDefaultIcons = mergeDesktopIconLayout(defaultIcons, serverLayout, this.widgets, this.maxVisibleRows || 8).map((icon) => {
        const sourceIcon = defaultIcons.find((item) => item.key === icon.key);
        const link = normalizeDesktopIconHref(icon.href || sourceIcon?.href || '#', window.location.origin);
        return {
          ...icon,
          href: link.href,
          pjax: link.pjax && (icon.pjax ?? sourceIcon?.pjax) !== false,
          pjaxApp: resolveDesktopIconApp(link.href, icon.pjaxApp || sourceIcon?.pjaxApp || ''),
          external: link.external,
          subtype: icon.subtype || sourceIcon?.subtype || 'folder',
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
          pjaxApp: resolveDesktopIconApp(sourceIcon?.href || '#', sourceIcon?.pjaxApp || ''),
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

    /**
     * 删除桌面图标。
     * 写入 tombstone 而非直接移除，防止后端传来的同 key 图标在下次加载时复活。
     */
    removeIcon(key) {
      const index = this.icons.findIndex((icon) => icon.key === key);
      if (index === -1) return;

      // 记录 tombstone，保存时写入 JSON 阻止后端同 key 图标复活
      if (!this.iconTombstones.some((t) => t.key === key)) {
        this.iconTombstones.push(serializeDeletedIconTombstone(key));
      }

      this.icons = this.icons.filter((icon) => icon.key !== key);

      if (this.dragState.key === key) {
        this.endDrag();
      }
      this.selectedDesktopKey = null;
      this.syncResponsiveVisibility();
      this.markDesktopLayoutDirty('图标已移除，保存后生效');
    },

    /**
     * 一键整理桌面图标：按当前顺序从 (1,1) 开始列优先重排。
     */
    reArrangeIcons() {
      const cols = this.currentColumns || this.columns || 12;
      const rows = this.maxVisibleRows || 8;

      // 收集所有可见 widget 占用的格子
      const occupied = new Set();
      for (const w of this.widgets.filter(w => !w.hidden)) {
        for (let dx = 0; dx < (w.w || 1); dx++) {
          for (let dy = 0; dy < (w.h || 1); dy++) {
            occupied.add(`${w.x + dx},${w.y + dy}`);
          }
        }
      }

      // 按列优先顺序找空位放置图标
      let placed = 0;
      for (let col = 1; placed < this.icons.length && col <= 100; col++) {
        for (let row = 1; placed < this.icons.length && row <= rows; row++) {
          if (!occupied.has(`${col},${row}`)) {
            const icon = this.icons[placed];
            icon.x = icon.baseX = col;
            icon.y = icon.baseY = row;
            placed++;
          }
        }
      }

      this.normalizeVisibleLayout();
      this.syncResponsiveVisibility();
      this.markDesktopLayoutDirty('图标已整理，保存后生效');
      desktopDebug('icons rearranged', { count: this.icons.length });
    },

    /* ═══ Layout integrity ═══ */

    ensureDesktopLayoutIntegrity() {
      const baseColumns = Math.max(1, this.serverLayoutPayload?.columns || this.columns || this.currentColumns || 12);
      const isPlacementCorrupt = (node) => {
        const width = Math.max(1, Number(node.w) || 1);
        const maxX = Math.max(1, baseColumns - width + 1);
        return !Number.isFinite(node.baseX)
          || !Number.isFinite(node.baseY)
          || node.baseX < 1
          || node.baseY < 1
          || node.baseX > maxX;
      };

      const clampCorruptNode = (node) => {
        const width = Math.max(1, Number(node.w) || 1);
        const maxX = Math.max(1, baseColumns - width + 1);
        node.baseX = Math.min(maxX, Math.max(1, Number.isFinite(node.baseX) ? node.baseX : 1));
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

    widgetTypeClass(widget) {
      const typeToken = String(widget.widget || 'widget')
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-|-$/g, '');
      return `is-${widget.size} widget--${typeToken}`;
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
          this.isEditing ? 'is-editing' : ''
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
        this.isEditing ? 'is-editing' : ''
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

    normalizeWeatherCityName(value) {
      return String(value || '').trim();
    },

    weatherEntryKey(cityName) {
      return this.normalizeWeatherCityName(cityName).toLowerCase();
    },

    resolveWeatherWidgetConfig(widget) {
      const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
      const cityName = this.normalizeWeatherCityName(meta.cityName) || this.normalizeWeatherCityName(this.modules.weather.cityName);
      const refreshMinutes = toPositiveInt(meta.refreshMinutes, this.modules.weather.refreshMinutes || 30);
      return {
        cityName,
        refreshMinutes: Math.min(Math.max(refreshMinutes, 10), 240),
        key: this.weatherEntryKey(cityName)
      };
    },

    resolveWeatherLoadTargets() {
      const targets = new Map();
      this.placedWidgets
        .filter((widget) => widget.widget === 'system.weather')
        .forEach((widget) => {
          const config = this.resolveWeatherWidgetConfig(widget);
          if (config.cityName && config.key) {
            targets.set(config.key, config);
          }
        });
      return Array.from(targets.values());
    },

    async loadWeather(forceRefresh = false) {
      if (!this.hasVisibleWeatherWidget()) {
        return;
      }
      // Dedup: skip if already in-flight (pageshow + $nextTick can race)
      if (this.weatherState.loading && !forceRefresh) {
        return;
      }

      const targets = this.resolveWeatherLoadTargets();
      if (!targets.length) {
        this.weatherState = {
          loading: false,
          error: '请先在后台为天气组件配置城市。',
          data: null,
          entries: {}
        };
        return;
      }

      const {
        loadCachedDesktopWidgetWeather,
        saveDesktopWidgetWeather,
        fetchDesktopWidgetWeather
      } = await this.ensureWeatherRuntime();

      const nextEntries = { ...(this.weatherState.entries || {}) };
      const pendingTargets = [];

      targets.forEach((target) => {
        if (!forceRefresh) {
          const cached = loadCachedDesktopWidgetWeather(target.cityName, target.refreshMinutes);
          if (cached) {
            nextEntries[target.key] = {
              loading: false,
              error: '',
              data: cached
            };
            return;
          }
        }
        pendingTargets.push(target);
        nextEntries[target.key] = {
          loading: true,
          error: '',
          data: nextEntries[target.key]?.data || null
        };
      });

      const primaryKey = targets[0]?.key || '';
      const primaryEntry = nextEntries[primaryKey] || null;
      if (!pendingTargets.length && primaryEntry?.data) {
        this.weatherState = {
          loading: false,
          error: '',
          data: primaryEntry.data,
          entries: nextEntries
        };
        this.invalidateWidgetCache();
        return;
      }

      this.weatherRequestId += 1;
      const requestId = this.weatherRequestId;
      this.weatherState = {
        ...this.weatherState,
        entries: nextEntries,
        loading: true,
        error: ''
      };

      try {
        const results = await Promise.allSettled(
          pendingTargets.map(async (target) => {
            const data = await fetchDesktopWidgetWeather(target.cityName);
            saveDesktopWidgetWeather(target.cityName, data);
            return { target, data };
          })
        );
        if (requestId !== this.weatherRequestId) return;

        const resolvedEntries = { ...(this.weatherState.entries || {}) };
        results.forEach((result, index) => {
          const target = pendingTargets[index];
          if (result.status === 'fulfilled') {
            resolvedEntries[target.key] = {
              loading: false,
              error: '',
              data: result.value.data
            };
            return;
          }

          resolvedEntries[target.key] = {
            loading: false,
            error: '天气数据暂时不可用。',
            data: resolvedEntries[target.key]?.data || null
          };
        });

        const resolvedPrimary = resolvedEntries[primaryKey] || Object.values(resolvedEntries).find((entry) => entry?.data);
        this.weatherState = {
          loading: false,
          error: resolvedPrimary?.error || '',
          data: resolvedPrimary?.data || null,
          entries: resolvedEntries
        };
        this.invalidateWidgetCache();
      } catch (_error) {
        if (requestId !== this.weatherRequestId) return;

        this.weatherState = {
          loading: false,
          error: '天气数据暂时不可用。',
          data: null,
          entries: Object.fromEntries(targets.map((target) => [target.key, {
            loading: false,
            error: '天气数据暂时不可用。',
            data: this.weatherState.entries?.[target.key]?.data || null
          }]))
        };
        this.invalidateWidgetCache();
      }
    },

    /* ═══ Widget body rendering ═══ */

    renderWidgetBody(widget, options = {}) {
      const wType = widget?.widget || '';
      const renderOptions = {
        ...options,
        mode: options.mode || (options.preview === true ? 'preview' : 'live'),
        compact: options.preview === true ? false : (!this.isMobileViewport && this.cellSize <= 60)
      };

      const renderer = this.widgetRenderers[wType];

      if (!renderer) {
        void this.ensureWidgetRendererRuntime(wType);
        return renderWidgetLoadingMarkup();
      }

      // Tick-sensitive widgets always re-render
      if (TICK_SENSITIVE_WIDGETS.has(wType)) {
        return renderer(createWidgetRendererContext(this, renderOptions), widget, renderOptions);
      }

      // For non-tick widgets, cache and reuse HTML to prevent img flicker
      if (!this._widgetHtmlCache) this._widgetHtmlCache = new Map();
      const renderVersion = this.widgetRenderVersions[wType] || 0;
      const cKey = `${widgetCacheKey(widget, renderOptions)}:v=${renderVersion}`;
      const cached = this._widgetHtmlCache.get(cKey);
      if (cached !== undefined) return cached;

      const html = renderer(createWidgetRendererContext(this, renderOptions), widget, renderOptions);
      this._widgetHtmlCache.set(cKey, html);
      return html;
    },

    /** Invalidate widget render cache (call after data/layout changes) */
    invalidateWidgetCache(widgetType = '') {
      if (this._widgetHtmlCache) {
        if (!widgetType) {
          this._widgetHtmlCache.clear();
        } else {
          const prefix = `${String(widgetType)}:`;
          Array.from(this._widgetHtmlCache.keys()).forEach((key) => {
            if (String(key).includes(prefix) || String(key).startsWith(`${widgetType}:`)) {
              this._widgetHtmlCache.delete(key);
            }
          });
        }
      }
      this.scheduleDesktopWidgetEnhancement();
    },

    /* ═══ Desktop widget PJAX enhancement ═══ */

    /**
     * Scan real desktop widget bodies and attach PJAX links + lazy inits.
     * Only targets `.desktop-widgets-grid .desktop-widget-body`, never
     * the widget-center preview area.
     */
    enhanceDesktopWidgetBodies(root) {
      const grid = root || this.$refs.grid;
      if (!grid) return;

      const bodies = grid.querySelectorAll('.desktop-widget-body');
      if (!bodies.length) return;

      let totalAnchors = 0;
      let internalLinks = 0;
      let attachedCount = 0;

      bodies.forEach((body) => {
        const anchors = body.querySelectorAll('a[href]');
        totalAnchors += anchors.length;

        markPjaxLinks(body);
        const attached = attachDynamicLinks(body);
        attachedCount += attached;

        anchors.forEach((a) => {
          if (a.classList.contains('pjax-link')) internalLinks++;
        });

        initLazyImages(body);
        initLazyComments(body);
        enhanceDoubanShowcaseWidgets(body);
      });

      if (grid.querySelector('[data-tag-focus]')) {
        void import('../../../../../widgets/halo/random-tags/render.js')
          .then((runtime) => runtime.ensureTagFocusRotation?.(grid))
          .catch(() => {});
      }

      widgetPjaxLog('enhance:', totalAnchors, 'anchors,', internalLinks, 'internal,', attachedCount, 'attached');
    },

    /**
     * Schedule widget enhancement after x-html has finished rendering.
     * Uses double-rAF inside $nextTick to guarantee DOM is settled.
     * Coalesces rapid-fire calls — only the last scheduled run executes.
     */
    scheduleDesktopWidgetEnhancement() {
      if (this._widgetEnhanceScheduled) return;
      this._widgetEnhanceScheduled = true;
      if (this._widgetEnhanceRafId) {
        cancelAnimationFrame(this._widgetEnhanceRafId);
        this._widgetEnhanceRafId = 0;
      }
      this.$nextTick(() => {
        this._widgetEnhanceRafId = requestAnimationFrame(() => {
          this._widgetEnhanceRafId = requestAnimationFrame(() => {
            this._widgetEnhanceRafId = 0;
            this._widgetEnhanceScheduled = false;
            this.enhanceDesktopWidgetBodies();
          });
        });
      });
    },

    /**
     * One-time click delegate on `.desktop-widgets-grid` as PJAX fallback.
     * Catches any internal link click that wasn't properly attached.
     */
    installWidgetClickDelegate() {
      if (this._widgetClickDelegateInstalled) return;
      this._widgetClickDelegateInstalled = true;

      const grid = this.$refs.grid;
      if (!grid) return;

      grid.addEventListener('click', (e) => {
        // [P1] Block widget navigation clicks when editing mode is enabled
        const isWidget = e.target.closest('.desktop-widget-card');
        if (this.isEditing && isWidget) {
          if (!e.target.closest('.desktop-widget-remove-btn')) {
            e.preventDefault();
            e.stopPropagation();
            widgetPjaxLog('navigation blocked in edit mode');
            return;
          }
        }

        const link = e.target.closest('.desktop-widget-body a[href]');
        if (!link) return;

        // Skip: widget-center preview, external targets, special protocols
        if (link.closest('.desktop-widget-center')) return;
        if (link.target === '_blank') return;
        if (link.hasAttribute('download')) return;
        const href = link.getAttribute('href') || '';
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
        if (href === '#' || (href.startsWith('#') && !href.startsWith('#/'))) return;

        // Only intercept pjax-link that is internal
        if (!link.classList.contains('pjax-link')) return;

        try {
          const url = new URL(link.href, window.location.origin);
          if (url.origin !== window.location.origin) return;
        } catch (_err) {
          return;
        }

        // If already handled by normal pjax attach, let it through
        if (link.hasAttribute('data-pjax-attached')) return;

        // Fallback: prevent full-page navigation, use pjax.loadUrl
        e.preventDefault();
        e.stopPropagation();
        widgetPjaxLog('click-delegate fallback:', link.href);
        if (window.pjax) {
          window.pjax.loadUrl(link.href);
        }
      }, true); // capture phase — run before bubbling handlers

      widgetPjaxLog('click-delegate installed on grid');
    }
  }));
}
