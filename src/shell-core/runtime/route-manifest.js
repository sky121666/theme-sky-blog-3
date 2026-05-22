import { getKnownAppIds } from './app-manifests.js';

const BROWSER_VARIANT = 'browser';
const NONE_VARIANT = 'none';
const DEFAULT_THEME_ROUTES = Object.freeze({
  categoriesUri: '/categories',
  tagsUri: '/tags',
  archivesUri: '/archives'
});

function normalizeRoutePrefix(value, fallback) {
  let route = typeof value === 'string' ? value.trim() : '';
  if (!route) route = fallback;

  route = route.split('#')[0].split('?')[0].trim();
  if (!route.startsWith('/')) route = `/${route}`;
  if (route.length > 1) route = route.replace(/\/+$/, '');
  return route || fallback;
}

function getThemeRoutes() {
  const configured = globalThis.window?.__SKY_THEME_ROUTES__ || {};
  return {
    categoriesUri: normalizeRoutePrefix(configured.categoriesUri, DEFAULT_THEME_ROUTES.categoriesUri),
    tagsUri: normalizeRoutePrefix(configured.tagsUri, DEFAULT_THEME_ROUTES.tagsUri),
    archivesUri: normalizeRoutePrefix(configured.archivesUri, DEFAULT_THEME_ROUTES.archivesUri)
  };
}

function matchesRoutePrefix(pathname, routePrefix) {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

function matchesConfiguredOrLegacyRoute(pathname, routeKey, legacyPrefixes = []) {
  const routePrefix = getThemeRoutes()[routeKey];
  if (matchesRoutePrefix(pathname, routePrefix)) return true;
  return legacyPrefixes.some((legacyPrefix) => legacyPrefix !== routePrefix && matchesRoutePrefix(pathname, legacyPrefix));
}

function matchesArchiveRoute(pathname) {
  const routePrefix = getThemeRoutes().archivesUri;
  if (pathname === routePrefix || pathname === `${routePrefix}/`) return true;

  const archivePath = pathname.startsWith(`${routePrefix}/`)
    ? pathname.slice(routePrefix.length)
    : '';
  if (!archivePath) return false;

  return /^\/\d{4}(?:\/\d{1,2})?\/?$/.test(archivePath);
}

function matchesDefaultReaderRoute(pathname) {
  if (!/^\/archives\/[^/]+\/?$/.test(pathname)) return false;
  return !matchesArchiveRoute(pathname);
}

const ROUTE_RULES = [
  {
    id: 'home',
    appId: '',
    windowVariant: NONE_VARIANT,
    pjaxMode: 'none',
    cacheKeyPolicy: 'pathname',
    matches: (pathname) => pathname === '/'
  },
  {
    id: 'moments',
    appId: 'moments',
    windowVariant: 'moments',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/moments' || pathname === '/moments/' || /^\/moments\/[^/]+\/?$/.test(pathname)
  },
  {
    id: 'friends',
    appId: 'friends',
    windowVariant: 'friends',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/friends' || pathname === '/friends/' || /^\/friends\/page\/[^/]+\/?$/.test(pathname)
  },
  {
    id: 'links',
    appId: 'links',
    windowVariant: 'links',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/links' || pathname === '/links/'
  },
  {
    id: 'bangumis',
    appId: 'bangumis',
    windowVariant: 'bangumis',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/bangumis' || pathname === '/bangumis/' || /^\/bangumis\/page\/[^/]+\/?$/.test(pathname)
  },
  {
    id: 'douban',
    appId: 'douban',
    windowVariant: 'douban',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/douban' || pathname === '/douban/' || /^\/douban\/page\/[^/]+\/?$/.test(pathname)
  },
  {
    id: 'steam',
    appId: 'steam',
    windowVariant: 'steam',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/steam' || pathname === '/steam/' || /^\/steam\/page\/[^/]+\/?$/.test(pathname)
  },
  {
    id: 'equipments',
    appId: 'equipments',
    windowVariant: 'equipments',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/equipments' || pathname === '/equipments/' || /^\/equipments\/page\/[^/]+\/?$/.test(pathname)
  },
  {
    id: 'docsme',
    appId: 'docsme',
    windowVariant: 'docsme',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/docs' || pathname === '/docs/' || /^\/docs\/.+/.test(pathname)
  },
  {
    id: 'photos',
    appId: 'photos',
    windowVariant: 'photos',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/photos' || pathname === '/photos/' || /^\/photos\/(?:page\/)?[^/]+\/?$/.test(pathname)
  },
  {
    id: 'auth',
    appId: 'auth',
    windowVariant: NONE_VARIANT,
    pjaxMode: 'none',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => /^\/(login|signup|logout)(\/|$)/.test(pathname) || /^\/password-reset(\/|$)/.test(pathname)
  },
  {
    id: 'explorer-archives',
    appId: 'explorer-archives',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => matchesArchiveRoute(pathname)
  },
  {
    id: 'explorer-tags',
    appId: 'explorer-tags',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => matchesConfiguredOrLegacyRoute(pathname, 'tagsUri', ['/tags', '/tag'])
  },
  {
    id: 'explorer-categories',
    appId: 'explorer-categories',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => matchesConfiguredOrLegacyRoute(pathname, 'categoriesUri', ['/categories', '/category'])
  },
  {
    id: 'explorer-author',
    appId: 'explorer-author',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => /^\/(author|authors)(\/|$)/.test(pathname)
  },
  {
    id: 'reader',
    appId: 'reader',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'none',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => matchesDefaultReaderRoute(pathname)
  }
];

function normalizeUrlLike(urlLike) {
  try {
    return urlLike instanceof URL ? urlLike : new URL(urlLike, window.location.origin);
  } catch (_error) {
    return null;
  }
}

export function resolveRoute(urlLike) {
  const url = normalizeUrlLike(urlLike);
  if (!url || url.origin !== window.location.origin) return null;

  const pathname = url.pathname;
  const matched = ROUTE_RULES.find((rule) => rule.matches(pathname));
  if (!matched) return null;

  return {
    ...matched,
    preloadAssets: matched.appId ? [matched.appId] : [],
    pathname,
    search: url.search,
    hash: url.hash
  };
}

export function inferPageAppFromUrl(urlLike) {
  return resolveRoute(urlLike)?.appId ?? null;
}

export function inferWindowVariantFromUrl(urlLike) {
  return resolveRoute(urlLike)?.windowVariant ?? '';
}

export function getRoutePjaxMode(urlLike) {
  return resolveRoute(urlLike)?.pjaxMode ?? 'none';
}

export function getRoutableAppIds() {
  return getKnownAppIds().filter(Boolean);
}
