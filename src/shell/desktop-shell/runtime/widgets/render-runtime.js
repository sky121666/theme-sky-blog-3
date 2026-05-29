import { loadWidgetRenderer } from '../../../../widgets/loaders.js';
import { escapeHtml } from '../shared/utils.js';
import { normalizeMomentRecord } from '../shared/moments.js';

export const TICK_SENSITIVE_WIDGETS = new Set(['system.clock']);

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

export function renderWidgetLoadingMarkup() {
  return '<div class="desktop-widget-loading" role="status" aria-live="polite"><span class="sr-only">组件加载中</span><span class="desktop-widget-loading-bar"></span><span class="desktop-widget-loading-bar desktop-widget-loading-bar--short"></span></div>';
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
          host.widgetRenderers[type] = renderer;
          host.widgetRenderVersions[type] = (host.widgetRenderVersions[type] || 0) + 1;
          host.onWidgetRendererReady?.(type);
        }
        return host.widgetRenderers[type] || null;
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
  const renderer = host.widgetRenderers[widgetType];

  if (!renderer) {
    void ensureWidgetRendererRuntime(host, widgetType);
    return renderWidgetLoadingMarkup();
  }

  if (TICK_SENSITIVE_WIDGETS.has(widgetType)) {
    return renderer(createWidgetRendererContext(host, renderOptions), widget, renderOptions);
  }

  if (!host._widgetHtmlCache) host._widgetHtmlCache = new Map();
  const renderVersion = host.widgetRenderVersions[widgetType] || 0;
  const cacheKey = `${widgetCacheKey(widget, renderOptions)}:v=${renderVersion}`;
  const cached = host._widgetHtmlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const html = renderer(createWidgetRendererContext(host, renderOptions), widget, renderOptions);
  host._widgetHtmlCache.set(cacheKey, html);
  return html;
}
