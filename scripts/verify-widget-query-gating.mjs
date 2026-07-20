import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DESKTOP_WIDGET_PROTOCOL_EVENT,
  normalizeDesktopWidgetSources,
  parseDesktopWidgetProtocolFromResponse,
  syncHomeDesktopWidgetProtocolFromResponse
} from '../src/shell/desktop-shell/runtime/widgets/protocol.js';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';

const layout = readFileSync(new URL('../templates/modules/shell/layout.html', import.meta.url), 'utf8');
const signup = readFileSync(new URL('../templates/gateway_fragments/signup.html', import.meta.url), 'utf8');
const randomTags = readFileSync(new URL('../src/widgets/halo/random-tags/render.js', import.meta.url), 'utf8');
const editMode = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js', import.meta.url), 'utf8');
const desktopSurface = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/surface/index.js', import.meta.url), 'utf8');
const desktopTemplate = readFileSync(new URL('../templates/modules/shell/desktop-widgets.html', import.meta.url), 'utf8');
const pjaxRuntime = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/pjax/index.js', import.meta.url), 'utf8');
const widgetProtocolRuntime = readFileSync(new URL('../src/shell/desktop-shell/runtime/widgets/protocol.js', import.meta.url), 'utf8');
const windowManager = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/window-manager.js', import.meta.url), 'utf8');

const widgetFlagContracts = [
  ['widgetsNeedsLatestPosts', 'halo.latest_posts'],
  ['widgetsNeedsPopularPosts', 'halo.popular_posts'],
  ['widgetsNeedsCategories', 'halo.categories'],
  ['widgetsNeedsSiteStats', 'halo.site_stats'],
  ['widgetsNeedsRandomTags', 'halo.random_tags'],
  ['widgetsNeedsMoments', 'plugin-moments.recent'],
  ['widgetsNeedsBangumis', 'plugin-bangumis.recent'],
  ['widgetsNeedsFriends', 'plugin-friends.recent'],
  ['widgetsNeedsDocsme', 'plugin-docsme.quick'],
  ['widgetsNeedsPhotos', 'plugin-photos.gallery'],
  ['widgetsNeedsDouban', 'plugin-douban.showcase'],
  ['widgetsNeedsSteam', 'plugin-steam.summary']
];

assert.match(layout, /widgetsAuthorConfigured = \$\{#strings\.contains\(desktopLayoutJson, 'halo\.author_card'\)\}/);
assert.match(layout, /widgetsNeedsAuthor = \$\{widgetsEnabled and isDesktopHome and widgetsAuthorConfigured\}/);

for (const [flag, widgetId] of widgetFlagContracts) {
  const escapedWidgetId = widgetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    layout,
    new RegExp(`${flag}\\s*=.*#strings\\.contains\\(desktopLayoutJson, '${escapedWidgetId}'\\)`),
    `${flag} must be derived from the saved desktop layout`
  );
  assert.match(
    layout,
    new RegExp(`${flag}\\s*=.*widgetsEnabled and isDesktopHome`),
    `${flag} must not trigger Finder data away from the desktop home page`
  );
}

assert.match(
  layout,
  /widgetsCatalogOptionsNeeded = \$\{widgetsEnabled and isDesktopHome and widgetsEditEnabled and notificationCenterAuthenticated\}/,
  'widget option data should only load for an authenticated home-page editor'
);
assert.match(
  layout,
  /currentContributor = \$\{widgetsRuntimeEnabled and isDesktopHome and notificationCenterAuthenticated and widgetsAuthorConfigured \? contributorFinder\.getContributor/,
  'contributor data must only load when widgets and the saved author widget are both enabled'
);
assert.match(layout, /widgetsLatestPosts = \$\{widgetsNeedsLatestPosts \? postFinder\.list\(/);
assert.match(layout, /widgetsPopularPosts = \$\{widgetsNeedsPopularPosts \? postFinder\.list\(/);
assert.match(layout, /widgetsCategoryTree = \$\{widgetsNeedsCategories \? categoryFinder\.listAsTree\(\)/);
assert.match(layout, /widgetsSiteStats = \$\{widgetsNeedsSiteStats \? siteStatsFinder\.getStats\(\)/);
assert.match(layout, /widgetsAllTags = \$\{widgetsNeedsRandomTags \? tagFinder\.listAll\(\)/);
assert.doesNotMatch(
  layout,
  /widgets(?:LatestPosts|PopularPosts|CategoryTree|SiteStats|AllTags) = \$\{widgetsEnabled \?/,
  'expensive core Finder calls must not be gated only by the global widgets switch'
);
assert.doesNotMatch(
  layout,
  /widgetsNeedsAuthor and !notificationCenterAuthenticated/,
  'the author card must not trigger unrelated post, stats, or moments Finder calls for guests'
);

const dataQueryContracts = [
  /widgetsRecentMoments = \$\{widgetsNeedsMoments and widgetsMomentsAvailable \? momentFinder\.list\(/,
  /widgetsBangumisAnimeWish = \$\{widgetsNeedsBangumis and widgetsBangumisAvailable \? bangumiFinder\.list\(/,
  /widgetsBangumisAnimeWatching = \$\{widgetsNeedsBangumis and widgetsBangumisAvailable \? bangumiFinder\.list\(/,
  /widgetsBangumisAnimeDone = \$\{widgetsNeedsBangumis and widgetsBangumisAvailable \? bangumiFinder\.list\(/,
  /widgetsBangumisDramaWish = \$\{widgetsNeedsBangumis and widgetsBangumisAvailable \? bangumiFinder\.list\(/,
  /widgetsBangumisDramaWatching = \$\{widgetsNeedsBangumis and widgetsBangumisAvailable \? bangumiFinder\.list\(/,
  /widgetsBangumisDramaDone = \$\{widgetsNeedsBangumis and widgetsBangumisAvailable \? bangumiFinder\.list\(/,
  /widgetsRecentFriends = \$\{widgetsNeedsFriends and widgetsFriendsAvailable \? friendFinder\.list\(/,
  /widgetsPhotos = \$\{widgetsNeedsPhotos and widgetsPhotosAvailable \? photoFinder\.list\(/,
  /widgetsPhotoGroups = \$\{widgetsNeedsPhotos and widgetsPhotosAvailable \? photoFinder\.groupBy\(\)/,
  /widgetsSteamProfile = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getProfile\(\)/,
  /widgetsSteamStats = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getStats\(\)/,
  /widgetsSteamRecentGames = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getRecentGames\(1\)/,
  /widgetsSteamWidgetGames = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getOwnedGames\(1, 12\)/
];

for (const contract of dataQueryContracts) {
  assert.match(layout, contract, `data Finder query must be gated by its saved widget: ${contract}`);
}

assert.doesNotMatch(
  layout,
  /widgetsPhotoGroups = \$\{[^\n]*widgetsCatalogOptionsNeeded[^\n]*photoFinder\.groupBy/,
  'the authenticated editor must not eagerly group every photo merely to populate the catalog'
);
assert.match(editMode, /const PHOTO_GROUPS_API = '\/apis\/api\.photo\.halo\.run\/v1alpha1\/photogroups';/);
assert.match(editMode, /async ensureWidgetConfigOptions\(widgetType\)[\s\S]*?fetch\(PHOTO_GROUPS_API,[\s\S]*?signal: controller\.signal/);
assert.match(editMode, /requestId !== this\.widgetConfigOptionsRequestId \|\| controller\.signal\.aborted \|\| !this\.isHome/);
assert.match(desktopTemplate, /type="application\/json"[\s\S]*?data-theme-desktop-widget-protocol/);
assert.match(desktopTemplate, /JSON\.parse\(payloadNode\.textContent \|\| '\{\}'\)/);
assert.doesNotMatch(desktopTemplate, /\b(?:eval|Function)\s*\(/, 'desktop protocol bootstrap must stay non-executable');
assert.doesNotMatch(widgetProtocolRuntime, /\b(?:eval|Function)\s*\(/, 'PJAX protocol parsing must use JSON.parse only');
assert.match(
  pjaxRuntime,
  /pjax\.handleResponse = function\(responseText,[\s\S]*?syncHomeDesktopWidgetProtocolFromResponse\(responseText\);[\s\S]*?_origHandleResponse\(/,
  'home widget data must hydrate before Pjax starts its DOM switch'
);
const routeSyncContract = desktopSurface.slice(
  desktopSurface.indexOf('this.routeSyncHandler = async () => {'),
  desktopSurface.indexOf('this.resizeHandler = () => {')
);
assert.doesNotMatch(routeSyncContract, /window\.location\.reload\(\)/, 'home route sync must not hard reload');

assert.match(signup, /if \(!response\.ok\) \{[\s\S]*?throw new Error\(errorMessage \|\| `验证码发送失败（HTTP \$\{response\.status\}）`\);/);
assert.doesNotMatch(
  signup,
  /if \(!response\.ok\) \{\s*const json = await response\.json\(\);[\s\S]*?\}\s*return response;/,
  'non-2xx verification-code responses must never fall through to the success cooldown'
);
assert.doesNotMatch(randomTags, /\bsetInterval\s*\(/, 'random-tags must not keep a permanent module-level interval');
assert.doesNotMatch(randomTags, /\b(?:addEventListener|MutationObserver)\b/, 'random-tags must not keep a permanent DOM listener merely to detect reinsertion');
assert.match(randomTags, /if \(!stages\.length\) \{\s*tagFocusTimer = null;/, 'random-tags should stop scheduling after its DOM is removed');
assert.match(desktopSurface, /ensureTagFocusRotation\?\.\(grid\)/, 'desktop x-html enhancement must restart cached random-tags markup');
assert.match(windowManager, /ensureTagFocusRotation\?\.\(root\)/, 'notification x-html enhancement must restart cached random-tags markup');
assert.match(
  windowManager,
  /this\.handleNotificationWidgetsChange = \(event\) => \{[\s\S]*?this\.notificationWidgetHtmlCache\.clear\(\);[\s\S]*?this\.notificationWidgetRenderTick \+= 1;[\s\S]*?this\.syncNotificationWidgets/,
  'home protocol hydration must invalidate notification widget markup too'
);

const normalizedSources = normalizeDesktopWidgetSources({
  latestPosts: [{ metadata: { name: 'post-a' } }],
  photos: null,
  steamStats: { totalGames: '12' }
}, 'https://blog.example.test');
assert.equal(normalizedSources.siteProfile.url, 'https://blog.example.test');
assert.deepEqual(normalizedSources.photos, []);
assert.equal(normalizedSources.steamStats.totalGames, 12);
assert.equal(normalizedSources.bangumisUrl, '/bangumis');

function protocolResponse(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<html><body><script type="application/json" data-theme-desktop-widget-protocol>${json}</script></body></html>`;
}

const homePayload = {
  enabled: true,
  isHome: true,
  editEnabled: true,
  columns: 14,
  gap: 20,
  layoutVersion: 'v2',
  serverLayoutJson: '',
  siteUrl: 'https://blog.example.test',
  modules: { weather: { cityName: '上海', refreshMinutes: 15 } },
  sources: {
    latestPosts: [{ metadata: { name: 'hydrated-post' } }],
    momentsAvailable: true,
    recentMoments: [{ metadata: { name: 'hydrated-moment' } }]
  }
};
const parsedHomePayload = parseDesktopWidgetProtocolFromResponse(protocolResponse(homePayload));
assert.equal(parsedHomePayload?.isHome, true);
assert.equal(parsedHomePayload?.sources.latestPosts[0]?.metadata?.name, 'hydrated-post');
const parsedAfterDecoy = parseDesktopWidgetProtocolFromResponse(
  `<script>window.note = '${DESKTOP_WIDGET_PROTOCOL_EVENT} data-theme-desktop-widget-protocol';</script>`
    + `<script type="application/json" data-theme-desktop-widget-protocol-extra>{"isHome":false}</script>`
    + `<!-- <script type="application/json" data-theme-desktop-widget-protocol>{"isHome":false}</script> -->`
    + protocolResponse(homePayload)
);
assert.equal(parsedAfterDecoy?.isHome, true, 'unowned marker, prefixed attribute, or comment must not shadow the owned JSON protocol script');

let desktopFactory = null;
registerDesktopSurface({
  data(name, factory) {
    assert.equal(name, 'desktopWidgets');
    desktopFactory = factory;
  }
});
assert.equal(typeof desktopFactory, 'function');

const hydrationSurface = desktopFactory();
let cacheInvalidations = 0;
let runtimeSyncs = 0;
let notificationSyncs = 0;
hydrationSurface.homeDataHydrated = false;
hydrationSurface.sources = normalizeDesktopWidgetSources({});
hydrationSurface.widgets = [{ key: 'dirty-widget', widget: 'halo.latest_posts', x: 2, y: 3 }];
hydrationSurface.defaultWidgets = [{ key: 'saved-widget', widget: 'system.clock', x: 1, y: 1 }];
hydrationSurface.icons = [{ key: 'dirty-icon', title: '未保存图标', x: 4, y: 2 }];
hydrationSurface.defaultIcons = [{ key: 'saved-icon', title: '已保存图标', x: 1, y: 2 }];
hydrationSurface.serverLayoutJson = '{"version":"dirty-layout"}';
hydrationSurface.serverLayoutPayload = { version: 'dirty-layout' };
hydrationSurface.serverLayoutMutationVersion = 7;
hydrationSurface.serverLayoutSavedMutationVersion = 5;
hydrationSurface.serverLayoutSaveState = 'dirty';
hydrationSurface.serverLayoutSaveMessage = '有未保存更改';
const layoutStateBeforeHydration = JSON.parse(JSON.stringify({
  widgets: hydrationSurface.widgets,
  defaultWidgets: hydrationSurface.defaultWidgets,
  icons: hydrationSurface.icons,
  defaultIcons: hydrationSurface.defaultIcons,
  serverLayoutJson: hydrationSurface.serverLayoutJson,
  serverLayoutPayload: hydrationSurface.serverLayoutPayload,
  serverLayoutMutationVersion: hydrationSurface.serverLayoutMutationVersion,
  serverLayoutSavedMutationVersion: hydrationSurface.serverLayoutSavedMutationVersion,
  serverLayoutSaveState: hydrationSurface.serverLayoutSaveState,
  serverLayoutSaveMessage: hydrationSurface.serverLayoutSaveMessage
}));
hydrationSurface.widgetCatalogBuilder = (sources) => [{
  widget: 'halo.latest_posts',
  hydratedCount: sources.latestPosts.length
}];
hydrationSurface.invalidateWidgetCache = () => { cacheInvalidations += 1; };
hydrationSurface.syncWidgetRuntimes = () => { runtimeSyncs += 1; };
hydrationSurface.dispatchNotificationWidgetsChange = () => { notificationSyncs += 1; };

const protocolListeners = new Map();
let reloadCount = 0;
let protocolWasInstalledBeforeSurfaceHydration = false;
let hydratedAtPjaxComplete = false;
const protocolWindow = {
  __THEME_DESKTOP_PROTOCOL__: {
    widgets: {
      isHome: true,
      sources: { latestPosts: [{ metadata: { name: 'previous-home-post' } }] }
    }
  },
  location: { reload() { reloadCount += 1; } },
  CustomEvent: class {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
  addEventListener(type, listener) {
    const listeners = protocolListeners.get(type) || [];
    listeners.push(listener);
    protocolListeners.set(type, listeners);
  },
  dispatchEvent(event) {
    for (const listener of protocolListeners.get(event.type) || []) listener(event);
    return true;
  }
};
protocolWindow.addEventListener(DESKTOP_WIDGET_PROTOCOL_EVENT, (event) => {
  protocolWasInstalledBeforeSurfaceHydration = protocolWindow.__THEME_WIDGETS__ === event.detail.protocol;
  hydrationSurface.applyHomeWidgetProtocol(event.detail.protocol);
});
protocolWindow.addEventListener('pjax:complete', () => {
  hydratedAtPjaxComplete = hydrationSurface.homeDataHydrated;
});

const previousHydratedProtocol = protocolWindow.__THEME_DESKTOP_PROTOCOL__.widgets;
const ignoredNonHome = syncHomeDesktopWidgetProtocolFromResponse(protocolResponse({
  enabled: true,
  isHome: false,
  sources: { latestPosts: [] }
}), protocolWindow);
assert.equal(ignoredNonHome, null);
assert.equal(
  protocolWindow.__THEME_DESKTOP_PROTOCOL__.widgets,
  previousHydratedProtocol,
  'a non-home response must preserve already hydrated home data'
);

const hydratedProtocol = syncHomeDesktopWidgetProtocolFromResponse(protocolResponse(homePayload), protocolWindow);
assert.equal(hydratedProtocol?.isHome, true);
assert.equal(protocolWasInstalledBeforeSurfaceHydration, true);
assert.equal(hydrationSurface.sources.latestPosts[0]?.metadata?.name, 'hydrated-post');
assert.equal(hydrationSurface.widgetCatalog[0]?.hydratedCount, 1);
assert.deepEqual({
  widgets: hydrationSurface.widgets,
  defaultWidgets: hydrationSurface.defaultWidgets,
  icons: hydrationSurface.icons,
  defaultIcons: hydrationSurface.defaultIcons,
  serverLayoutJson: hydrationSurface.serverLayoutJson,
  serverLayoutPayload: hydrationSurface.serverLayoutPayload,
  serverLayoutMutationVersion: hydrationSurface.serverLayoutMutationVersion,
  serverLayoutSavedMutationVersion: hydrationSurface.serverLayoutSavedMutationVersion,
  serverLayoutSaveState: hydrationSurface.serverLayoutSaveState,
  serverLayoutSaveMessage: hydrationSurface.serverLayoutSaveMessage
}, layoutStateBeforeHydration, 'home data hydration must preserve dirty desktop layout and save state');
assert.equal(cacheInvalidations, 1);
assert.equal(runtimeSyncs, 1);
assert.equal(notificationSyncs, 1);
protocolWindow.dispatchEvent(new protocolWindow.CustomEvent('pjax:complete'));
assert.equal(hydratedAtPjaxComplete, true, 'pjax:complete must observe hydrated home data');
assert.equal(reloadCount, 0, 'dynamic home hydration must not trigger a document reload');

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const timers = [];
let stages = [];

function createFocusStage() {
  const focused = new Set(['is-focus']);
  const items = [
    {
      classList: {
        contains(name) { return focused.has(name); },
        toggle(name, force) { force ? focused.add(name) : focused.delete(name); }
      }
    },
    {
      classList: {
        contains() { return false; },
        toggle(name, force) { this.focused = name === 'is-focus' && force; }
      }
    }
  ];
  return {
    items,
    querySelectorAll(selector) {
      return selector === '.wg-tag-focus-item' ? items : [];
    }
  };
}

try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      }
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector(selector) {
        return selector === '[data-tag-focus]' ? stages[0] || null : null;
      },
      querySelectorAll(selector) {
        return selector === '[data-tag-focus]' ? stages : [];
      }
    }
  });

  const moduleUrl = new URL('../src/widgets/halo/random-tags/render.js', import.meta.url);
  moduleUrl.searchParams.set('rotation-contract', String(Date.now()));
  const { ensureTagFocusRotation } = await import(moduleUrl.href);

  const firstStage = createFocusStage();
  stages = [firstStage];
  assert.equal(ensureTagFocusRotation(document), true, 'an inserted random-tags stage should start rotation');
  assert.equal(timers[0]?.delay, 4_000);
  const firstRotation = timers.shift();
  firstRotation?.callback();
  assert.equal(firstStage.items[1].classList.focused, true, 'the scheduled rotation should advance focus');

  stages = [];
  timers.shift()?.callback();
  assert.equal(timers.length, 0, 'rotation should stop after all stages are removed');

  const reinsertedStage = createFocusStage();
  stages = [reinsertedStage];
  assert.equal(ensureTagFocusRotation(document), true, 'cached x-html reinsertion should restart a stopped rotation');
  timers.shift()?.callback();
  assert.equal(reinsertedStage.items[1].classList.focused, true, 'the reinserted stage should rotate normally');

  stages = [];
  timers.shift()?.callback();

  const singleItemStage = createFocusStage();
  singleItemStage.items.splice(1);
  stages = [singleItemStage];
  assert.equal(ensureTagFocusRotation(document), true, 'a single-item stage may schedule one connectivity check');
  timers.shift()?.callback();
  assert.equal(timers.length, 0, 'a non-rotatable stage must not keep an idle timer alive');
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else delete globalThis.document;
}

console.log('widget Finder gating and signup failure contracts passed');
