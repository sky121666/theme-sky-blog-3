import { loadWidgetRenderer } from '../../../../widgets/loaders.js';
import { escapeHtml } from '../shared/utils.js';
import { normalizeMomentRecord } from '../shared/moments.js';
import { resolveLatestPostsSources } from './latest-posts-runtime.js';
import { bangumiWidgetDataStore } from '../../../../widgets/plugin/bangumis-recent/data.js';

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

function watchBangumiWidgetLoad(host, widget, promise) {
  if (!host._bangumiWidgetPending) host._bangumiWidgetPending = new Map();
  const key = widgetCacheKey(widget, { mode: 'live' });
  if (host._bangumiWidgetPending.has(key)) return;
  host._bangumiWidgetPending.set(key, promise);
  void promise.catch(() => {}).finally(() => {
    host._bangumiWidgetPending.delete(key);
    if (host.widgetsDisposed === true) return;
    const type = 'plugin-bangumis.recent';
    host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
    host._widgetHtmlCache?.clear();
    host.onWidgetDataChanged?.(type);
  });
}

export function retryBangumiWidgetDataWithHost(host, widget) {
  if (widget?.widget !== 'plugin-bangumis.recent') return null;
  const store = host.bangumiWidgetDataStore || bangumiWidgetDataStore;
  const promise = store.retry(widget);
  watchBangumiWidgetLoad(host, widget, promise);
  const type = 'plugin-bangumis.recent';
  host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
  host._widgetHtmlCache?.clear();
  host.onWidgetDataChanged?.(type);
  return promise;
}

export async function ensureWidgetRendererRuntime(host, widgetType) {
  const type = String(widgetType || '').trim();
  if (!type) return null;

  if (host.widgetRenderers[type]) {
    return host.widgetRenderers[type];
  }

  if (!host.widgetRendererPromises[type]) {
    host.widgetRendererPromises[type] = loadWidgetRenderer(type)
      .then((renderer) => {
        if (typeof renderer === 'function') {
          if (host.widgetRendererErrors) delete host.widgetRendererErrors[type];
          host.widgetRenderers[type] = renderer;
          host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
          host.onWidgetRendererReady?.(type);
        }
        return host.widgetRenderers[type] || null;
      })
      .catch((error) => {
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

  if (widgetNeedsHydratedSources(widget) && host.sources?.hydrated !== true) {
    return renderWidgetLoadingMarkup(widget, { pending: true });
  }

  let bangumiSources = null;
  if (widgetType === 'plugin-bangumis.recent' && host.sources?.bangumisAvailable === true) {
    const store = host.bangumiWidgetDataStore || bangumiWidgetDataStore;
    const snapshot = store.get(widget);
    if (renderOptions.mode === 'preview' && !snapshot?.sources) {
      return '<div class="desktop-widget-empty" role="status">添加后加载追番数据</div>';
    }
    if (renderOptions.mode === 'live' && options.visible === false) {
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    if (!snapshot) {
      watchBangumiWidgetLoad(host, widget, store.load(widget));
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    if (snapshot.status === 'loading') {
      watchBangumiWidgetLoad(host, widget, snapshot.promise);
      return renderWidgetLoadingMarkup(widget, { pending: true });
    }
    if (snapshot.status === 'error') return renderBangumiWidgetDataErrorMarkup();
    bangumiSources = { ...snapshot.sources, bangumiWidgetDataState: 'ready' };
  }

  const renderer = host.widgetRenderers[widgetType];

  if (!renderer) {
    if (host.widgetRendererErrors?.[widgetType]) return renderWidgetErrorMarkup();
    void ensureWidgetRendererRuntime(host, widgetType);
    return renderWidgetLoadingMarkup(widget);
  }

  if (!host._widgetHtmlCache) host._widgetHtmlCache = new Map();
  const sources = bangumiSources
    ? { ...resolveLatestPostsSources(host, widget), ...bangumiSources }
    : resolveLatestPostsSources(host, widget);
  const cacheKey = `${widgetCacheKey(widget, renderOptions)}:v=${renderVersion}`;
  const cached = host._widgetHtmlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const context = { ...createWidgetRendererContext(host, renderOptions), sources };
  const html = renderer(context, widget, renderOptions);
  host._widgetHtmlCache.set(cacheKey, html);
  return html;
}
