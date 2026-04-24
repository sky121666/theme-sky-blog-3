import { getKnownAppIds } from './app-manifests.js';

const BROWSER_VARIANT = 'browser';
const NONE_VARIANT = 'none';

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
    id: 'photos',
    appId: 'photos',
    windowVariant: 'photos',
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => pathname === '/photos' || pathname === '/photos/' || /^\/photos\/page\/[^/]+\/?$/.test(pathname)
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
    matches: (pathname) => pathname === '/archives' || pathname === '/archives/'
  },
  {
    id: 'explorer-tags',
    appId: 'explorer-tags',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => /^\/(tags|tag)(\/|$)/.test(pathname)
  },
  {
    id: 'explorer-categories',
    appId: 'explorer-categories',
    windowVariant: BROWSER_VARIANT,
    pjaxMode: 'same-app',
    cacheKeyPolicy: 'app-path-search',
    matches: (pathname) => /^\/(categories|category)(\/|$)/.test(pathname)
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
    matches: (pathname) => /^\/archives\/[^/]+\/?$/.test(pathname)
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
