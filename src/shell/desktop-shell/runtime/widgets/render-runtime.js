import { loadWidgetRenderer } from '../../../../widgets/loaders.js';
import { escapeHtml } from '../shared/utils.js';
import { normalizeMomentRecord } from '../shared/moments.js';
import { resolveLatestPostsSources } from './latest-posts-runtime.js';
import { widgetNeedsFinderData } from './source-types.js';

let dataRuntime = null;
let dataRuntimePromise = null;
let dataRuntimeError = false;
const dataRuntimeHosts = new WeakMap();
const pendingWidgetData = new WeakMap();

function notifyWidgetDataChanged(host, type) {
  host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
  host._widgetHtmlCache?.clear();
  host.onWidgetDataChanged?.(type);
}

function loadWidgetDataRuntime(host, type) {
  dataRuntimeError = false;
  dataRuntimePromise ||= import('./widget-data-runtime.js').then((runtime) => { dataRuntime = runtime; return runtime; });
  if (!dataRuntimeHosts.has(host.widgetRenderVersions)) {
    dataRuntimeHosts.set(host.widgetRenderVersions, new Set());
    void dataRuntimePromise.catch(() => {
      dataRuntimePromise = null;
      dataRuntimeError = true;
    }).finally(() => {
      const types = dataRuntimeHosts.get(host.widgetRenderVersions);
      dataRuntimeHosts.delete(host.widgetRenderVersions);
      if (host.widgetsDisposed === true) return;
      types.forEach((widgetType) => notifyWidgetDataChanged(host, widgetType));
    });
  }
  dataRuntimeHosts.get(host.widgetRenderVersions).add(type);
  return dataRuntimePromise;
}

export async function retryFinderWidgetDataWithHost(host, widget) {
  const runtime = dataRuntime || await loadWidgetDataRuntime(host, widget.widget);
  return runtime.retryFinderWidgetSources(host, widget);
}

const HYDRATED_SOURCE_WIDGET_TYPES = new Set([
  'halo.author_card',
  'halo.latest_posts',
  'halo.popular_posts',
  'halo.categories',
  'halo.site_stats',
  'halo.random_tags',
  'plugin-moments.recent',
  'plugin-bangumis.recent',
  'plugin-links.feed',
  'plugin-docsme.quick',
  'plugin-photos.gallery',
  'plugin-douban.showcase',
  'plugin-steam.summary'
]);

export function createWidgetRendererContext(state, options = {}) {
  return {
    now: state.now,
    modules: state.modules,
    sources: state.sources,
    weatherState: state.weatherState,
    escapeHtml,
    normalizeMomentRecord,
    mode: options.mode || (options.preview === true ? 'preview' : 'live'),
    surface: options.surface || state.surface || 'desktop'
  };
}

export function widgetCacheKey(widget, options = {}) {
  const mode = options.mode || (options.preview === true ? 'preview' : 'live');
  const metaStr = widget.meta && typeof widget.meta === 'object'
    ? Object.entries(widget.meta).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')
    : '';
  return `${widget.widget}:${widget.size}:${widget.key}:${widget.appearance || 'follow'}:surface=${options.surface || widget.surface || 'desktop'}:mode=${mode}:compact=${options.compact === true ? 1 : 0}:meta=${metaStr}`;
}

function widgetTypeClass(widgetType) {
  return String(widgetType || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function widgetNeedsHydratedSources(widget) {
  return HYDRATED_SOURCE_WIDGET_TYPES.has(String(widget?.widget || '').trim());
}

export function renderWidgetLoadingMarkup(widget = null, options = {}) {
  const size = String(widget?.size || 'medium').trim() || 'medium';
  const typeClass = widgetTypeClass(widget?.widget);
  const className = [
    'desktop-widget-loading',
    `is-${size}`,
    typeClass ? `widget--${typeClass}` : ''
  ].filter(Boolean).join(' ');
  const label = options.pending === true ? '内容加载中' : '组件加载中';

  return `
    <div class="${className}" role="status" aria-live="polite" aria-busy="true">
      <span class="sr-only">${label}</span>
      <span class="desktop-widget-loading-cover" aria-hidden="true"></span>
      <span class="desktop-widget-loading-content" aria-hidden="true">
        <span class="desktop-widget-loading-bar desktop-widget-loading-bar--label"></span>
        <span class="desktop-widget-loading-bar desktop-widget-loading-bar--title"></span>
        <span class="desktop-widget-loading-bar"></span>
        <span class="desktop-widget-loading-bar desktop-widget-loading-bar--short"></span>
      </span>
    </div>
  `;
}

export function renderWidgetErrorMarkup() {
  return '<div class="desktop-widget-empty desktop-widget-render-error" role="alert"><strong>组件加载失败</strong><span>资源暂时不可用，请刷新页面后重试。</span></div>';
}

function renderBangumiWidgetDataErrorMarkup() {
  return '<div class="wg-bangumis wg-bangumis--empty wg-bangumis--error" role="alert"><strong>追番数据暂时不可用</strong><p>读取失败，请稍后重试。</p><button type="button" data-bangumi-widget-retry>重试</button></div>';
}

function watchWidgetDataLoad(host, widget, promise) {
  const owner = host.widgetRenderVersions;
  if (!pendingWidgetData.has(owner)) pendingWidgetData.set(owner, new Set());
  const pending = pendingWidgetData.get(owner);
  if (pending.has(promise)) return;
  pending.add(promise);
  void promise.catch(() => {}).finally(() => {
    pending.delete(promise);
    if (host.widgetsDisposed === true) return;
    notifyWidgetDataChanged(host, widget.widget);
  });
}

async function retryWidgetStore(host, widget, type, storeName) {
  if (widget?.widget !== type) return null;
  const store = host[storeName] || (dataRuntime || await loadWidgetDataRuntime(host, type))[storeName];
  const promise = store.retry(widget);
  watchWidgetDataLoad(host, widget, promise);
  notifyWidgetDataChanged(host, type);
  return promise;
}

export function retryRandomTagsWidgetDataWithHost(host, widget) {
  return retryWidgetStore(host, widget, 'halo.random_tags', 'randomTagsWidgetDataStore');
}

export function retryBangumiWidgetDataWithHost(host, widget) {
  return retryWidgetStore(host, widget, 'plugin-bangumis.recent', 'bangumiWidgetDataStore');
}

export async function ensureWidgetRendererRuntime(host, widgetType) {
  if (host.widgetsDisposed === true) return null;
  const type = String(widgetType || '').trim();
  if (!type) return null;

  if (host.widgetRenderers[type]) {
    return host.widgetRenderers[type];
  }

  if (!host.widgetRendererPromises[type]) {
    host.widgetRendererPromises[type] = loadWidgetRenderer(type)
      .then((renderer) => {
        if (host.widgetsDisposed === true) return null;
        if (typeof renderer === 'function') {
          if (host.widgetRendererErrors) delete host.widgetRendererErrors[type];
          host.widgetRenderers[type] = renderer;
          host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
          host.onWidgetRendererReady?.(type);
        }
        return host.widgetRenderers[type] || null;
      })
      .catch((error) => {
        if (host.widgetsDisposed === true) return null;
        if (!host.widgetRendererErrors) host.widgetRendererErrors = {};
        host.widgetRendererErrors[type] = error?.message || 'renderer-load-failed';
        host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
        host.onWidgetRendererError?.(type, error);
        return null;
      })
      .finally(() => {
        delete host.widgetRendererPromises[type];
      });
  }

  return host.widgetRendererPromises[type];
}

export function renderWidgetBodyWithHost(host, widget, options = {}) {
  const widgetType = widget?.widget || '';
  const renderOptions = {
    ...options,
    surface: options.surface || widget?.surface || host.surface || 'desktop',
    mode: options.mode || (options.preview === true ? 'preview' : 'live'),
    compact: options.compact === true
  };
  // Keep an Alpine dependency even while rendering the asynchronous skeleton.
  const renderVersion = host.widgetRenderVersions[widgetType] || 0;

  // x-show keeps catalog cards mounted. A preview is a data consumer only
  // while its card intersects the visible library or settings dialog.
  if (renderOptions.mode === 'preview' && options.visible !== true) {
    return renderWidgetLoadingMarkup(widget, { pending: true });
  }

  if (widgetNeedsHydratedSources(widget) && host.sources?.hydrated !== true) {
    return renderWidgetLoadingMarkup(widget, { pending: true });
  }

  let loadedSources = null;
  if (widgetNeedsFinderData(widget, host.sources)) {
    if (options.visible === false) return renderWidgetLoadingMarkup(widget, { pending: true });
    if (dataRuntimeError) return '<div class="desktop-widget-empty desktop-widget-render-error" role="alert"><strong>内容暂时无法加载</strong><button type="button" data-widget-source-retry>重试</button></div>';
    if (!dataRuntime) {
      void loadWidgetDataRuntime(host, widgetType);
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    const snapshot = dataRuntime.resolveFinderWidgetSources(host, widget);
    if (snapshot.status === 'loading') return renderWidgetLoadingMarkup(widget, { pending: true });
    if (snapshot.status === 'error') {
      return '<div class="desktop-widget-empty desktop-widget-render-error" role="alert"><strong>内容暂时无法加载</strong><button type="button" data-widget-source-retry>重试</button></div>';
    }
    loadedSources = snapshot.sources;
  }
  if (widgetType === 'halo.random_tags' && host.sources?.loaded?.['halo.random_tags'] !== true
    && !(Array.isArray(host.sources?.randomTags) && host.sources.randomTags.length)) {
    if (options.visible === false) return renderWidgetLoadingMarkup(widget, { pending: true });
    const store = host.randomTagsWidgetDataStore || dataRuntime?.randomTagsWidgetDataStore;
    if (!store) {
      if (dataRuntimeError) return '<div class="desktop-widget-empty desktop-widget-render-error" role="alert"><strong>标签暂时无法加载</strong><button type="button" data-random-tags-widget-retry>重试</button></div>';
      void loadWidgetDataRuntime(host, widgetType);
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    const snapshot = store.get(host.sources);
    if (!snapshot || snapshot.status === 'loading') {
      watchWidgetDataLoad(host, widget, snapshot?.promise || store.load());
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    if (snapshot.status === 'error') {
      return '<div class="desktop-widget-empty desktop-widget-render-error" role="alert"><strong>标签暂时无法加载</strong><button type="button" data-random-tags-widget-retry>重试</button></div>';
    }
    loadedSources = snapshot.sources;
  }
  if (widgetType === 'plugin-bangumis.recent' && host.sources?.bangumisAvailable === true) {
    if (options.visible === false) {
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    const store = host.bangumiWidgetDataStore || dataRuntime?.bangumiWidgetDataStore;
    if (!store) {
      if (dataRuntimeError) return renderBangumiWidgetDataErrorMarkup();
      void loadWidgetDataRuntime(host, widgetType);
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    const snapshot = store.get(widget);
    if (!snapshot) {
      watchWidgetDataLoad(host, widget, store.load(widget));
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    if (snapshot.status === 'loading') {
      watchWidgetDataLoad(host, widget, snapshot.promise);
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    if (snapshot.status === 'error') return renderBangumiWidgetDataErrorMarkup();
    loadedSources = { ...snapshot.sources, bangumiWidgetDataState: 'ready' };
  }

  const renderer = host.widgetRenderers[widgetType];

  if (!renderer) {
    if (host.widgetRendererErrors?.[widgetType]) return renderWidgetErrorMarkup();
    void ensureWidgetRendererRuntime(host, widgetType);
    return renderWidgetLoadingMarkup(widget);
  }

  if (!host._widgetHtmlCache) host._widgetHtmlCache = new Map();
  const sources = loadedSources
    ? { ...resolveLatestPostsSources(host, widget), ...loadedSources }
    : resolveLatestPostsSources(host, widget);
  const now = host.now instanceof Date ? host.now : new Date();
  const dayKey = widgetType === 'halo.random_tags'
    ? `:day=${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}` : '';
  const cacheKey = `${widgetCacheKey(widget, renderOptions)}:v=${renderVersion}${dayKey}`;
  const cached = host._widgetHtmlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const context = { ...createWidgetRendererContext(host, renderOptions), sources };
  const html = renderer(context, widget, renderOptions);
  host._widgetHtmlCache.set(cacheKey, html);
  return html;
}
