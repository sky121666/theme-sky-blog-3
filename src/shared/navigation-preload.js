import SwupPreloadPlugin from '@swup/preload-plugin';
import { getSwupClient, registerPreparedPageReader } from './swup-client.js';
import { classifyLinkClick } from './navigation-link-policy.js';
import { getWindowAppContent, hasNavigationTitle } from './navigation-response.js';
import { isCompleteHtmlDocument, isHtmlDocumentResponse } from './html-document.js';

const SELECTOR = 'a.pjax-link[href], .menubar a[href], a.dock-icon[href]';
const PUBLIC_APPS = new Set(['docsme', 'explorer-archives', 'explorer-categories', 'explorer-tags', 'links', 'moments', 'photos', 'reader']);
const MAX_PAGES = 12, MAX_AGE_MS = 20_000, MAX_SPECULATIVE = 2;
const READ_QUERY = new Set(['page', 'comment-page', 'preview-theme']);
const ACTION_SEGMENT = /(?:^|\/)(?:api|apis|actuator|console|login|logout|signup|password-reset|auth|account|user|users|cart|carts|checkout|order|orders|payment|payments|pay|delete|remove|create|update|subscribe|unsubscribe|like|unlike|download)(?:\/|$)/i;
const ACTION_QUERY = /action|token|logout|login|password|delete|remove|create|update|subscribe|unsubscribe|payment|checkout|cart|order|redirect|returnurl/i;
let client;
let integration = { resolveRoute: () => null, getAppManifest: () => null, warmAppAssets: () => {} };

function navigationUrl(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Expected a same-origin navigation URL');
  }
  url.hash = '';
  return url.href;
}

function publicRoute(key) {
  const url = new URL(key);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  if (ACTION_SEGMENT.test(pathname) || /[\\\x00-\x20]|%2f|%5c/i.test(pathname)) return null;
  const route = integration.resolveRoute(url);
  if (!PUBLIC_APPS.has(route?.appId)) return null;
  // Existing Docsme representation queries remain supported. Other public
  // routes only speculate on query keys whose read-only purpose is known.
  for (const [name, value] of url.searchParams) {
    if (ACTION_QUERY.test(name)) return null;
    if (route.appId === 'docsme') continue;
    if (url.searchParams.getAll(name).length !== 1) return null;
    if (READ_QUERY.has(name) && (name === 'preview-theme' || /^[1-9]\d*$/.test(value))) continue;
    if (name === 'p' && ['explorer-categories', 'explorer-tags'].includes(route.appId)
      && /^[1-9]\d*$/.test(value)) continue;
    if (name === 'tag' && route.appId === 'moments' && value.length > 0
      && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value)) continue;
    if (route.appId === 'photos' && ((name === 'view' && value === 'albums')
      || (name === 'group' && /^[\w.-]{1,253}$/.test(value)))) continue;
    return null;
  }
  return route;
}

export function canPreloadPage(url) {
  try { return Boolean(publicRoute(navigationUrl(url))); } catch { return false; }
}

function expiresAt(headers, startedAt) {
  const control = headers.get('cache-control') || '';
  if (headers.has('vary') || /(?:^|,)\s*(?:no-cache|no-store|private)\s*(?:=|,|$)/i.test(control)) return 0;
  const ages = [...control.matchAll(/(?:^|,)\s*max-age\s*=\s*(?:"(\d+)"|(\d+))\s*(?=,|$)/gi)];
  if (ages.length !== 1) return 0;
  const maxAge = Number(ages[0][1] ?? ages[0][2]) * 1000;
  const ageValue = headers.get('age') ?? '0';
  if (!/^\d+$/.test(ageValue)) return 0;
  const age = Number(ageValue) * 1000, date = Date.parse(headers.get('date'));
  const deadline = startedAt + Math.min(MAX_AGE_MS, maxAge - age);
  return Math.min(deadline, Number.isFinite(date) ? date + maxAge : deadline);
}

function completeHtml(html, route) {
  if (!isCompleteHtmlDocument(html)) return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const { appId, pageApp, pageMode, windowVariant } = doc.body.dataset;
  const modes = route.appId === 'reader' ? ['browser-reader'] : integration.getAppManifest(route.appId)?.sameVariantPageModes || [];
  const frames = doc.querySelectorAll('#window-frame-root');
  if (!hasNavigationTitle(doc) || frames.length !== 1
    || (appId || pageApp) !== route.appId || (appId && pageApp && appId !== pageApp)
    || !modes.includes(pageMode) || windowVariant !== route.windowVariant) return false;
  return Boolean(getWindowAppContent(doc, frames[0], route.appId));
}

function responseLike(page) {
  return {
    ok: page.status >= 200 && page.status < 300, status: page.status,
    url: page.responseUrl, headers: new Headers(page.headers),
    text: async () => page.html, clone: () => responseLike(page)
  };
}

function waitForConsumer(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// Keep the official plugin's device, Save-Data and delegated attention checks.
// Its batch/visible preloading and queue are deliberately unused: attention
// may start at most two guesses, while a chosen destination starts immediately.
class NavigationAttention extends SwupPreloadPlugin {
  constructor(onAttention) {
    super({ preloadInitialPage: false, preloadVisibleLinks: false, preloadHoveredLinks: true });
    this.onAttention = onAttention;
  }
  preloadLinks() {}
  preloadLinksOnAttention() {
    const options = { passive: true, capture: true };
    this.mouseEnterDelegate = this.swup.delegateEvent(SELECTOR, 'mouseenter', this.onMouseEnter, options);
    this.touchStartDelegate = this.swup.delegateEvent(SELECTOR, 'touchstart', this.onTouchStart, options);
    this.focusDelegate = this.swup.delegateEvent(SELECTOR, 'focus', this.onFocus, options);
  }
  async preload(link) {
    if (!link?.matches?.(SELECTOR) || link.closest('[data-no-swup]')) return;
    const decision = classifyLinkClick({ event: { button: 0 }, runtimeReady: true, currentUrl: location.href,
      baseTarget: document.querySelector('base[target]')?.getAttribute('target') || '',
      link: { rawHref: link.getAttribute('href'), resolvedHref: link.href, classOptIn: link.classList.contains('pjax-link'),
        targetPresent: link.hasAttribute('target'), target: link.getAttribute('target'), hasDownload: link.hasAttribute('download') }
    });
    if (decision.kind !== 'managed') return;
    try { await this.onAttention(navigationUrl(decision.href), link, this); } catch { /* An unchosen target has no UI to recover. */ }
  }
}

function createClient() {
  const swup = getSwupClient();
  if (swup.version !== '4.10.0') throw new Error('Navigation Swup lifecycle adapter needs a version audit');
  const flights = new Map(), resourceOnly = new Map();
  let acceptedIntent = null, acceptedFlight = null;
  let freshnessGeneration = 0;

  function prune() {
    swup.cache.prune((_url, page) => !page.expiresAt || page.expiresAt <= Date.now());
    for (const [key, deadline] of resourceOnly) if (deadline <= Date.now()) resourceOnly.delete(key);
  }
  function invalidate() {
    freshnessGeneration++;
    resourceOnly.clear(); swup.cache.clear();
    for (const [key, flight] of flights) {
      // Freshness is not navigation ownership. A focus/write signal cannot
      // revoke a user-selected read, including its accepted one-use lease.
      if (flight.consumers > 0 || acceptedFlight?.flight === flight) continue;
      flight.controller.abort();
      flights.delete(key);
    }
  }
  function cancelSpeculation(except) {
    for (const [key, flight] of flights) if (flight.speculative && key !== except) {
      flight.controller.abort(); flights.delete(key);
    }
  }
  function releaseAcceptedFlight() {
    const lease = acceptedFlight;
    acceptedFlight = null;
    if (lease && lease.flight.consumers === 0 && flights.get(lease.key) === lease.flight) {
      lease.flight.controller.abort(); flights.delete(lease.key);
    }
  }

  // fetchPage's writer cannot bypass the origin's freshness rules. Its request
  // hook owns one controller through headers AND body. A navigation can adopt
  // a speculative request; the last cancelled foreground consumer releases it.
  swup.visit.cache.write = false;
  swup.hooks.replace('fetch:request', async (visit, { url, options }, fetchRequest) => {
    if (!options.navigationFlight) return fetchRequest(visit, { url, options });
    const flight = options.navigationFlight;
    if (flights.get(flight.key) !== flight) throw new DOMException('Navigation request replaced', 'AbortError');
    const response = await fetch(flight.key, { headers: options.headers, credentials: 'same-origin',
      signal: flight.controller.signal, priority: flight.speculative ? 'low' : 'auto' });
    flight.response = response;
    flight.html = await response.text();
    flight.controller.signal.throwIfAborted();
    if (options.themeResponse) options.themeResponse.value = response;
    return { status: response.status, url: response.url, text: async () => flight.html };
  });

  function read(key, speculative) {
    prune();
    const route = publicRoute(key), cached = route && swup.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = flights.get(key);
    if (running) { if (!speculative) running.speculative = false; return running.promise; }
    if (speculative && (!route || resourceOnly.has(key)
      || [...flights.values()].filter(flight => flight.speculative).length >= MAX_SPECULATIVE)) return;
    if (!speculative) cancelSpeculation(key);
    const flight = { key, speculative, consumers: 0, controller: new AbortController(), startedAt: Date.now(), freshnessGeneration };
    flights.set(key, flight);
    const timer = window.setTimeout(() => flight.controller.abort(new DOMException('Page request timed out', 'TimeoutError')), 15_000);
    const visit = swup.createVisit({ to: key }); visit.cache.write = false;
    flight.promise = swup.fetchPage(key, { navigationFlight: flight, themeResponse: {}, visit, timeout: 0 }).catch(error => {
      if (flight.controller.signal.aborted) throw flight.controller.signal.reason;
      // Swup rejects 500 and empty bodies. Preserve those responses for the
      // established PJAX failure/redirect handling, including their status.
      if (!flight.response || flight.html === undefined) throw error;
      return { url: flight.response.url, html: flight.html };
    }).then(page => {
      flight.controller.signal.throwIfAborted();
      const response = flight.response;
      const entry = { ...page, status: response.status, responseUrl: response.url, headers: [...response.headers] };
      const eligible = route && response.status === 200 && !response.redirected && response.url === key
        && isHtmlDocumentResponse(response) && completeHtml(page.html, route);
      if (eligible && flight.freshnessGeneration === freshnessGeneration) {
        const deadline = expiresAt(response.headers, flight.startedAt);
        if (deadline > Date.now()) {
          swup.cache.set(key, { ...entry, expiresAt: deadline });
          if (swup.cache.size > MAX_PAGES) swup.cache.delete(swup.cache.all.keys().next().value);
        } else {
          resourceOnly.set(key, Date.now() + MAX_AGE_MS);
          if (resourceOnly.size > MAX_PAGES) resourceOnly.delete(resourceOnly.keys().next().value);
        }
      }
      return entry;
    }).finally(() => {
      window.clearTimeout(timer);
      if (flights.get(key) === flight) flights.delete(key);
    });
    return flight.promise;
  }

  swup.use(new NavigationAttention(async (key, link, plugin) => {
    prune();
    if (acceptedIntent !== null || integration.navigationPending?.() || !plugin.shouldPreload(key, { el: link })) return;
    // Local view admission retains fragments; only the HTML cache key omits them.
    if (integration.canNavigateLocally?.(link.href)) return;
    const route = integration.resolveRoute(key);
    // Explicit Reader hints also cover custom page/article permalinks. They
    // warm only trusted manifest resources, never opt an unknown URL into HTML.
    const hintedApp = !route && link.dataset?.pjaxApp === 'reader' ? 'reader' : '';
    const appId = route?.appId || hintedApp;
    if (appId && appId !== 'auth') void Promise.resolve(integration.warmAppAssets(appId)).catch(() => {});
    await read(key, true);
  }));
  document.addEventListener('theme:navigation-accepted', ({ detail }) => {
    releaseAcceptedFlight();
    acceptedIntent = detail.intentId;
    let key; try { key = navigationUrl(detail.url); } catch { /* Native destinations have no reusable flight. */ }
    if (key && integration.resolveRoute(key)?.appId === 'auth') invalidate();
    else {
      const flight = flights.get(key);
      if (flight) {
        // Acceptance owns this request before the coordinator's async setup
        // reaches load(). Keep only this intent's one-shot result, including
        // no-store HTML that completes during that gap; never cache it.
        flight.speculative = false;
        acceptedFlight = { intent: detail.intentId, key, flight, promise: flight.promise };
      }
      cancelSpeculation(key);
    }
  });
  document.addEventListener('theme:navigation-settled', ({ detail }) => {
    if (detail.intentId === acceptedFlight?.intent) releaseAcceptedFlight();
    if (detail.intentId === acceptedIntent) acceptedIntent = null;
  });
  document.addEventListener('pjax:send', event => {
    if (String(event.requestOptions?.requestMethod || 'GET').toUpperCase() !== 'GET') invalidate();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) invalidate(); });
  window.addEventListener('focus', invalidate);
  window.addEventListener('halo:comment:created', invalidate);
  document.addEventListener('theme:content-mutated', invalidate);

  return { async load(url, { signal } = {}) {
    if (signal?.aborted) throw signal.reason;
    const key = navigationUrl(url);
    const lease = acceptedFlight?.key === key && acceptedFlight.intent === acceptedIntent ? acceptedFlight : null;
    if (lease) acceptedFlight = null;
    const pending = lease ? lease.promise : read(key, false), flight = lease?.flight || flights.get(key);
    if (flight) flight.consumers++;
    try { return responseLike(await waitForConsumer(pending, signal)); }
    finally {
      if (flight && --flight.consumers === 0 && signal?.aborted
        && acceptedFlight?.flight !== flight && flights.get(key) === flight) {
        flight.controller.abort(signal.reason); flights.delete(key);
      }
    }
  } };
}

export function initializeNavigationPreload(dependencies) {
  if (dependencies) integration = { ...integration, ...dependencies };
  if (!client) {
    client = createClient();
    registerPreparedPageReader((url, options) => canPreloadPage(url) ? client.load(url, options) : null);
  }
}

export function fetchNavigationPage(url, options) {
  initializeNavigationPreload();
  return client.load(url, options);
}
