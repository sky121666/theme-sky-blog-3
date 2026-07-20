/**
 * Desktop widget protocol parsing and normalization.
 *
 * The server serializes this contract into a non-executable
 * `application/json` script. Direct loads install the raw JSON during HTML
 * bootstrap, while PJAX responses are normalized and installed here before
 * the content switch starts.
 */

export const DESKTOP_WIDGET_PROTOCOL_ATTRIBUTE = 'data-theme-desktop-widget-protocol';
export const DESKTOP_WIDGET_PROTOCOL_EVENT = 'theme:desktop-widget-protocol';

const DEFAULT_DOUBAN_API_BASE = '/apis/api.douban.moony.la/v1alpha1/doubanmovies';

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function asFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeDesktopWidgetSources(rawSources, siteUrl = '') {
  const sources = asRecord(rawSources);
  const siteProfile = asRecord(sources.siteProfile);
  const currentUser = asRecord(sources.currentUser);
  const steamProfile = asRecord(sources.steamProfile);
  const steamStats = asRecord(sources.steamStats);

  return {
    siteProfile: {
      title: asString(siteProfile.title),
      subtitle: asString(siteProfile.subtitle),
      logo: asString(siteProfile.logo),
      url: asString(siteProfile.url, asString(siteUrl))
    },
    currentUser: {
      authenticated: currentUser.authenticated === true,
      name: asString(currentUser.name),
      displayName: asString(currentUser.displayName),
      avatar: asString(currentUser.avatar),
      bio: asString(currentUser.bio),
      permalink: asString(currentUser.permalink, '/uc') || '/uc'
    },
    latestPosts: asArray(sources.latestPosts),
    popularPosts: asArray(sources.popularPosts),
    categories: asArray(sources.categories),
    siteStats: sources.siteStats || null,
    randomTags: asArray(sources.randomTags),
    momentsAvailable: sources.momentsAvailable === true,
    recentMoments: asArray(sources.recentMoments),
    bangumisAvailable: sources.bangumisAvailable === true,
    bangumisUrl: asString(sources.bangumisUrl, '/bangumis') || '/bangumis',
    bangumisByStatus: asRecord(sources.bangumisByStatus),
    bangumiStatusCounts: asRecord(sources.bangumiStatusCounts),
    friendsAvailable: sources.friendsAvailable === true,
    recentFriends: asArray(sources.recentFriends),
    friendsUrl: asString(sources.friendsUrl, '/friends') || '/friends',
    docsmeAvailable: sources.docsmeAvailable === true,
    docsmeUrl: asString(sources.docsmeUrl, '/docs') || '/docs',
    docsmeProjects: asArray(sources.docsmeProjects),
    archivesUrl: asString(sources.archivesUrl, '/archives') || '/archives',
    fallbackCover: asString(sources.fallbackCover),
    photosAvailable: sources.photosAvailable === true,
    photos: asArray(sources.photos),
    photoGroups: asArray(sources.photoGroups),
    photosUrl: asString(sources.photosUrl, '/photos') || '/photos',
    doubanAvailable: sources.doubanAvailable === true,
    doubanUrl: asString(sources.doubanUrl, '/douban') || '/douban',
    doubanApiBase: asString(sources.doubanApiBase, DEFAULT_DOUBAN_API_BASE) || DEFAULT_DOUBAN_API_BASE,
    steamAvailable: sources.steamAvailable === true,
    steamUrl: asString(sources.steamUrl, '/steam') || '/steam',
    steamProfile: {
      playing: steamProfile.playing === true,
      statusText: asString(steamProfile.statusText),
      personaName: asString(steamProfile.personaName),
      avatarFull: asString(steamProfile.avatarFull),
      profileUrl: asString(steamProfile.profileUrl),
      steamLevel: asFiniteNumber(steamProfile.steamLevel),
      currentGameName: asString(steamProfile.currentGameName)
    },
    steamStats: {
      totalGames: asFiniteNumber(steamStats.totalGames),
      recentPlaytimeFormatted: asString(steamStats.recentPlaytimeFormatted),
      recentPlaytimeMinutes: asFiniteNumber(steamStats.recentPlaytimeMinutes)
    },
    steamRecentGames: asArray(sources.steamRecentGames),
    steamOwnedGames: asArray(sources.steamOwnedGames)
  };
}

export function normalizeDesktopWidgetProtocol(rawProtocol) {
  const protocol = asRecord(rawProtocol);
  const siteUrl = asString(protocol.siteUrl);
  const modules = asRecord(protocol.modules);
  const weather = asRecord(modules.weather);

  return {
    enabled: protocol.enabled === true,
    isHome: protocol.isHome === true,
    hideOnMobile: protocol.hideOnMobile === true,
    editEnabled: protocol.editEnabled === true,
    columns: asPositiveInt(protocol.columns, 12),
    gap: asPositiveInt(protocol.gap, 18),
    layoutVersion: asString(protocol.layoutVersion, 'v1') || 'v1',
    serverLayoutJson: asString(protocol.serverLayoutJson),
    themeName: asString(protocol.themeName, 'theme-sky-blog-3') || 'theme-sky-blog-3',
    themeJsonConfigEndpoint: asString(protocol.themeJsonConfigEndpoint),
    siteUrl,
    modules: {
      weather: {
        cityName: asString(weather.cityName, '北京'),
        refreshMinutes: asPositiveInt(weather.refreshMinutes, 30)
      }
    },
    instances: asArray(protocol.instances),
    sources: normalizeDesktopWidgetSources(protocol.sources, siteUrl)
  };
}

/**
 * Extract only the owned inert JSON script. This deliberately avoids parsing
 * the complete response into a detached document, which could trigger
 * resource fetches from unrelated response tags.
 */
export function parseDesktopWidgetProtocolFromResponse(responseText) {
  if (typeof responseText !== 'string' || !responseText) return null;

  const scriptStartPattern = /<script\b/gi;
  const scriptClosePattern = /<\/script\s*>/gi;
  const ownedAttributePattern = new RegExp(
    `\\s${DESKTOP_WIDGET_PROTOCOL_ATTRIBUTE}(?=\\s|=|/?>)`,
    'i'
  );
  let cursor = 0;

  while (cursor < responseText.length) {
    scriptStartPattern.lastIndex = cursor;
    const scriptStart = scriptStartPattern.exec(responseText);
    const commentStart = responseText.indexOf('<!--', cursor);

    if (commentStart >= 0 && (!scriptStart || commentStart < scriptStart.index)) {
      const commentEnd = responseText.indexOf('-->', commentStart + 4);
      if (commentEnd < 0) return null;
      cursor = commentEnd + 3;
      continue;
    }
    if (!scriptStart) return null;

    let quote = '';
    let openTagEnd = -1;
    for (let index = scriptStart.index + scriptStart[0].length; index < responseText.length; index += 1) {
      const character = responseText[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        openTagEnd = index;
        break;
      }
    }
    if (openTagEnd < 0) return null;

    scriptClosePattern.lastIndex = openTagEnd + 1;
    const scriptClose = scriptClosePattern.exec(responseText);
    if (!scriptClose) return null;

    const openTag = responseText.slice(scriptStart.index, openTagEnd + 1);
    const content = responseText.slice(openTagEnd + 1, scriptClose.index);
    cursor = scriptClose.index + scriptClose[0].length;
    if (!ownedAttributePattern.test(openTag)) continue;
    if (!/\btype\s*=\s*(["'])application\/json\1/i.test(openTag)) continue;

    try {
      return normalizeDesktopWidgetProtocol(JSON.parse(content));
    } catch (_error) {
      // Ignore a malformed owned payload and keep searching for a valid one.
    }
  }

  return null;
}

export function installDesktopWidgetProtocol(rawProtocol, targetWindow = globalThis.window) {
  if (!targetWindow) return null;
  const protocol = normalizeDesktopWidgetProtocol(rawProtocol);
  const desktopProtocol = asRecord(targetWindow.__THEME_DESKTOP_PROTOCOL__);
  targetWindow.__THEME_DESKTOP_PROTOCOL__ = Object.assign(desktopProtocol, {
    widgets: protocol
  });
  targetWindow.__THEME_WIDGETS__ = protocol;
  return protocol;
}

/**
 * Hydrate only a real home response. A non-home PJAX response must never
 * overwrite Finder-backed data that was already hydrated from the home page.
 */
export function syncHomeDesktopWidgetProtocolFromResponse(responseText, targetWindow = globalThis.window) {
  const protocol = parseDesktopWidgetProtocolFromResponse(responseText);
  if (!protocol?.isHome) return null;

  const installed = installDesktopWidgetProtocol(protocol, targetWindow);
  if (!installed || typeof targetWindow?.dispatchEvent !== 'function') return installed;

  const EventConstructor = targetWindow.CustomEvent || globalThis.CustomEvent;
  if (typeof EventConstructor === 'function') {
    targetWindow.dispatchEvent(new EventConstructor(DESKTOP_WIDGET_PROTOCOL_EVENT, {
      detail: { protocol: installed }
    }));
  }
  return installed;
}
