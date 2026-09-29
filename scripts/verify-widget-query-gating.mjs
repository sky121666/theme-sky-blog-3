import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DESKTOP_WIDGET_PROTOCOL_EVENT,
  normalizeDesktopWidgetSources,
  parseDesktopWidgetProtocolFromResponse,
  syncHomeDesktopWidgetProtocolFromResponse
} from '../src/shell/desktop-shell/runtime/widgets/protocol.js';
import {
  mergeDesktopWidgetLayout
} from '../src/shell/desktop-shell/runtime/widgets/persistence-read.js';
import {
  renderWidgetBodyWithHost,
  widgetNeedsHydratedSources
} from '../src/shell/desktop-shell/runtime/widgets/render-runtime.js';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';

const layout = readFileSync(new URL('../templates/modules/shell/layout.html', import.meta.url), 'utf8');
const signup = readFileSync(new URL('../templates/gateway_fragments/signup.html', import.meta.url), 'utf8');
const randomTags = readFileSync(new URL('../src/widgets/halo/random-tags/render.js', import.meta.url), 'utf8');
const editMode = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js', import.meta.url), 'utf8');
const desktopSurface = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/surface/index.js', import.meta.url), 'utf8');
const desktopTemplate = readFileSync(new URL('../templates/modules/shell/desktop-widgets.html', import.meta.url), 'utf8');
const titlebarTemplate = readFileSync(new URL('../templates/modules/shell/window-titlebar.html', import.meta.url), 'utf8');
const pjaxRuntime = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/pjax/index.js', import.meta.url), 'utf8');
const widgetProtocolRuntime = readFileSync(new URL('../src/shell/desktop-shell/runtime/widgets/protocol.js', import.meta.url), 'utf8');
const windowManager = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/window-manager.js', import.meta.url), 'utf8');
const widgetRegistry = readFileSync(new URL('../src/widgets/registry.js', import.meta.url), 'utf8');
const widgetLoaders = readFileSync(new URL('../src/widgets/loaders.js', import.meta.url), 'utf8');
const widgetCatalog = readFileSync(new URL('../src/widgets/catalog.js', import.meta.url), 'utf8');
const widgetDataReload = readFileSync(new URL('../src/shell/desktop-shell/runtime/desktop/surface/data-reload.js', import.meta.url), 'utf8');
const widgetPersistenceRead = readFileSync(new URL('../src/shell/desktop-shell/runtime/widgets/persistence-read.js', import.meta.url), 'utf8');
const notificationCenterCss = readFileSync(new URL('../src/shell/desktop-shell/styles/desktop/notification-center.css', import.meta.url), 'utf8');
const widgetBaseCss = readFileSync(new URL('../src/shell/desktop-shell/styles/widgets/base.css', import.meta.url), 'utf8');
const widgetRenderRuntime = readFileSync(new URL('../src/shell/desktop-shell/runtime/widgets/render-runtime.js', import.meta.url), 'utf8');
const clockCalendarRenderer = readFileSync(new URL('../src/widgets/shared/clock-calendar.js', import.meta.url), 'utf8');

const widgetFlagContracts = [
  ['widgetsNeedsLatestPosts', 'halo.latest_posts'],
  ['widgetsNeedsPopularPosts', 'halo.popular_posts'],
  ['widgetsNeedsCategories', 'halo.categories'],
  ['widgetsNeedsSiteStats', 'halo.site_stats'],
  ['widgetsNeedsRandomTags', 'halo.random_tags'],
  ['widgetsNeedsMoments', 'plugin-moments.recent'],
  ['widgetsNeedsBangumis', 'plugin-bangumis.recent'],
  ['widgetsNeedsLinksFeed', 'plugin-links.feed'],
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
  /widgetsCatalogOptionsNeeded = \$\{widgetsEnabled and isDesktopHome and widgetsEditEnabled and notificationCenterAuthenticated and !widgetsSourceRequest\}/,
  'widget option data should only load for an authenticated home-page editor'
);
assert.match(
  layout,
  /currentContributor = \$\{widgetsRuntimeEnabled and isDesktopHome and notificationCenterAuthenticated and widgetsAuthorConfigured and !widgetsSourceRequest \? contributorFinder\.getContributor/,
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
  /widgetsRecentFriendsPage = \$\{widgetsNeedsLinksFeed and widgetsFriendsAvailable \? linkFeedFinder\.list\(\{limit: 5\}\)/,
  /widgetsRecentFriends = \$\{widgetsRecentFriendsPage\}/,
  /widgetsPhotos = \$\{widgetsNeedsPhotos and widgetsPhotosAvailable \? photoFinder\.list\(/,
  /widgetsPhotoGroups = \$\{widgetsNeedsPhotos and widgetsPhotosAvailable and !widgetsSourceRequest \? photoFinder\.groupBy\(\)/,
  /widgetsSteamProfile = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getProfile\(\)/,
  /widgetsSteamStats = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getStats\(\)/,
  /widgetsSteamRecentGames = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getRecentGames\(1\)/,
  /widgetsSteamWidgetGames = \$\{widgetsNeedsSteam and widgetsSteamAvailable \? steamFinder\.getOwnedGames\(1, 12\)/
];

for (const contract of dataQueryContracts) {
  assert.match(layout, contract, `data Finder query must be gated by its saved widget: ${contract}`);
}
assert.doesNotMatch(layout, /\bbangumiFinder\.list\s*\(/, 'homepage Bangumi widgets must not invoke upstream Finder during SSR');
assert.doesNotMatch(desktopTemplate, /\bbangumis(?:Anime|Drama)(?:Wish|Watching|Done)\b|bangumi(?:Anime|Drama)(?:Wish|Watching|Done)Count/, 'desktop protocol must not serialize six placeholder Bangumi groups');

const activeWidgetContract = [widgetRegistry, widgetLoaders, widgetCatalog, widgetDataReload].join('\n');
assert.match(activeWidgetContract, /plugin-links\.feed/, 'PluginLinks RSS 小组件必须使用当前契约 ID');
assert.doesNotMatch(activeWidgetContract, /plugin-friends\.recent|friendFinder|friends-recent/, '旧朋友圈插件契约不得重新进入主题运行时');
assert.doesNotMatch(
  [layout, widgetPersistenceRead].join('\n'),
  /plugin-friends\.recent|friendFinder|friends-recent/,
  '已退出的朋友圈插件 ID、Finder 和渲染器不得留在活动布局代码'
);

assert.match(widgetRenderRuntime, /host\.sources\?\.hydrated !== true/, '数据未完成 hydration 时必须先渲染稳定占位');
assert.match(widgetRenderRuntime, /renderWidgetLoadingMarkup\(widget, \{ pending: true \}\)/, '待同步状态必须使用带组件尺寸的占位骨架');
assert.match(widgetBaseCss, /\.desktop-widget-loading-cover/, '占位骨架必须保留内容封面区域');
assert.match(widgetBaseCss, /\.desktop-widget-loading-content/, '占位骨架必须保留内容文本区域');
assert.match(widgetBaseCss, /\.desktop-widget-loading\.is-small\s*\{[\s\S]*?position:\s*relative;/, '小尺寸占位封面需要相对定位锚点');

assert.equal(widgetNeedsHydratedSources({ widget: 'halo.latest_posts' }), true);
assert.equal(widgetNeedsHydratedSources({ widget: 'system.clock' }), false);

const pendingWidget = { key: 'pending-latest', widget: 'halo.latest_posts', size: 'medium' };
const pendingHtml = renderWidgetBodyWithHost({
  sources: { hydrated: false },
  widgetRenderers: {
    'halo.latest_posts': () => '<div class="real-widget-content"></div>'
  },
  widgetRenderVersions: {},
  widgetRendererErrors: {},
  widgetRendererPromises: {},
  _widgetHtmlCache: new Map()
}, pendingWidget);
assert.match(pendingHtml, /desktop-widget-loading/);
assert.match(pendingHtml, /desktop-widget-loading-cover/);
assert.match(pendingHtml, /widget--halo-latest-posts/);
assert.match(pendingHtml, /aria-busy="true"/);

const hydratedHtml = renderWidgetBodyWithHost({
  sources: { hydrated: true, loaded: { 'halo.latest_posts': true } },
  widgetRenderers: {
    'halo.latest_posts': () => '<div class="real-widget-content"></div>'
  },
  widgetRenderVersions: {},
  widgetRendererErrors: {},
  widgetRendererPromises: {},
  _widgetHtmlCache: new Map()
}, pendingWidget);
assert.match(hydratedHtml, /real-widget-content/);

assert.doesNotMatch(
  layout,
  /widgetsPhotoGroups = \$\{[^\n]*widgetsCatalogOptionsNeeded[^\n]*photoFinder\.groupBy/,
  'the authenticated editor must not eagerly group every photo merely to populate the catalog'
);
assert.match(editMode, /const PHOTO_GROUPS_API = '\/apis\/api\.photo\.halo\.run\/v1alpha1\/photogroups';/);
assert.match(editMode, /async ensureWidgetConfigOptions\(widgetType\)[\s\S]*?fetch\(PHOTO_GROUPS_API,[\s\S]*?signal: controller\.signal/);
assert.match(editMode, /requestId !== this\.widgetConfigOptionsRequestId \|\| controller\.signal\.aborted \|\| !this\.isHome/);
assert.match(desktopTemplate, /type="application\/json"[\s\S]*?data-theme-desktop-widget-protocol/);
assert.match(desktopTemplate, /"hydrated": \[\[\$\{isHome\}\]\]/, 'widget source protocol must distinguish loaded home data from deferred non-home data');
assert.match(layout, /widgetsFriendsAvailable = \$\{\(!widgetsSourceRequest or widgetsNeedsLinksFeed\) and pluginFinder\.available\('PluginLinks', '>=2\.2\.1'\)\}/, 'PluginLinks availability remains correct on normal non-home loads and gated in source requests');
assert.match(desktopTemplate, /JSON\.parse\(payloadNode\.textContent \|\| '\{\}'\)/);
assert.doesNotMatch(desktopTemplate, /\b(?:eval|Function)\s*\(/, 'desktop protocol bootstrap must stay non-executable');
assert.doesNotMatch(widgetProtocolRuntime, /\b(?:eval|Function)\s*\(/, 'PJAX protocol parsing must use JSON.parse only');
assert.match(
  pjaxRuntime,
  /pjax\.handleResponse = (?:async )?function\(responseText,[\s\S]*?syncHomeDesktopWidgetProtocolFromResponse\(responseText\);[\s\S]*?_origHandleResponse\(/,
  'home widget data must hydrate before Pjax starts its DOM switch'
);
const routeSyncContract = desktopSurface.slice(
  desktopSurface.indexOf('this.routeSyncHandler = async (event) => {'),
  desktopSurface.indexOf('this.resizeHandler = () => {')
);
assert.doesNotMatch(routeSyncContract, /window\.location\.reload\(\)/, 'home route sync must not hard reload');
assert.match(desktopSurface, /window\.addEventListener\('theme:pjax-ready', this\.routeSyncHandler\);/);
assert.match(desktopSurface, /window\.removeEventListener\('theme:pjax-ready', this\.routeSyncHandler\);/);
assert.match(desktopSurface, /window\.addEventListener\('pageshow', this\.routeSyncHandler\);/);
assert.match(desktopSurface, /window\.removeEventListener\('pageshow', this\.routeSyncHandler\);/);
assert.doesNotMatch(desktopSurface, /window\.addEventListener\('pjax:complete', this\.routeSyncHandler\);/);
assert.match(windowManager, /document\.addEventListener\('theme:pjax-ready', \(\) => \{\s*this\.refresh\(\);/);
assert.match(windowManager, /document\.addEventListener\('theme:pjax-ready', this\.handlePjaxReady\);/);
assert.match(windowManager, /document\.removeEventListener\('theme:pjax-ready', this\.handlePjaxReady\);/);
assert.doesNotMatch(windowManager, /document\.addEventListener\('pjax:complete'/);
assert.equal((titlebarTemplate.match(/@theme:pjax-ready\.window="closeSharePanel\(\); sync\(\)"/g) || []).length, 2);
assert.doesNotMatch(titlebarTemplate, /@pjax:complete\.window=/);

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
assert.match(
  windowManager,
  /async ensureNotificationWidgetData\(\)[\s\S]*?ensureDesktopWidgetData\(\{ signal: controller.signal \}\)/,
  'desktop and notification widgets must share home protocol requests'
);
assert.match(
  windowManager,
  /surface: 'notification-center'[\s\S]*?\}, widget, \{ surface: 'notification-center'/,
  'notification widgets must render with their real surface context'
);
assert.match(
  clockCalendarRenderer,
  /--desktop-clock-duration:60s;--desktop-clock-delay:-\$\{elapsedSeconds\.toFixed\(3\)\}s/,
  'clock renderer must seed a wall-clock-aligned CSS animation delay'
);
assert.match(
  widgetBaseCss,
  /@keyframes desktop-widget-clock-rotate[\s\S]*?rotate\(360deg\)/,
  'clock hands must keep moving independently of Alpine DOM refreshes'
);
assert.doesNotMatch(
  [desktopTemplate, desktopSurface, windowManager].join('\n'),
  /clockRenderTick|notificationWidgetClockTick|TICK_SENSITIVE_WIDGETS/,
  'CSS-driven clocks must not trigger redundant per-second widget HTML re-rendering'
);
assert.match(
  notificationCenterCss,
  /@media \(width <= 640px\)[\s\S]*?--nc-panel-content-width:[^;]+;[\s\S]*?--nc-width:[^;]+;/,
  'mobile notification center must recompute derived width variables in the same scope'
);
assert.match(
  pjaxRuntime,
  /const result = prepareNavigation\(\{ url, source \}\);[\s\S]*?if \(result\.kind !== 'accepted'\)/,
  'PJAX must reject a navigation denied by the shared admission guard'
);
assert.match(
  desktopSurface,
  /registerNavigationGuard\(\{\s*id: 'desktop-layout',[\s\S]*?commit: \(snapshot\) =>/,
  'desktop layout discard must happen only in the shared guard commit phase'
);
assert.match(
  desktopSurface,
  /window\.addEventListener\('theme-open-widget-center', this\.handleOpenWidgetCenter\)/,
  'notification-center edit action must be handled by the persistent desktop surface'
);
assert.match(
  desktopSurface,
  /window\.addEventListener\('beforeunload', this\.handleBeforeUnload\)/,
  'full-page exits must retain native unsaved-layout protection'
);
assert.match(
  editMode,
  /discardDesktopEditingChanges\(\)[\s\S]*?this\.widgets = cloneJsonValue\(this\.defaultWidgets\)[\s\S]*?this\.iconTombstones = cloneJsonValue\(this\.defaultIconTombstones\)/,
  'confirmed discard must restore the last saved widgets, icons, and tombstones'
);

const droppedLegacyLayout = mergeDesktopWidgetLayout([], {
  instances: [{
    key: 'legacy-feed',
    title: '朋友圈',
    widget: 'plugin-friends.recent',
    size: 'medium',
    surface: 'notification-center'
  }]
});
assert.equal(droppedLegacyLayout.length, 0, '旧朋友圈小组件实例必须退出活动布局，不得静默迁移');

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
    hydrated: true,
    latestPosts: [{ metadata: { name: 'hydrated-post' } }],
    momentsAvailable: true,
    recentMoments: [{ metadata: { name: 'hydrated-moment' } }]
  }
};
const parsedHomePayload = parseDesktopWidgetProtocolFromResponse(protocolResponse(homePayload));
assert.equal(parsedHomePayload?.isHome, true);
assert.equal(parsedHomePayload?.sources.hydrated, true);
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

// These hosts must never ask for the home payload. Run the actual entrypoint;
// there is deliberately no browser/fetch available to hide an accidental load.
for (const state of [
  { enabled: false, widgets: [{ widget: 'halo.latest_posts' }] },
  { enabled: true, widgets: [] },
  { enabled: true, widgets: [{ widget: 'system.clock' }, { widget: 'system.calendar' }] },
  { enabled: true, widgets: [{ widget: 'halo.latest_posts', hidden: true }] },
  { enabled: true, widgets: [{ widget: 'halo.latest_posts', surface: 'notification-center' }] },
  { enabled: true, widgetsDisposed: true, widgets: [{ widget: 'halo.latest_posts' }] },
  { enabled: true, sources: { hydrated: true }, widgets: [{ widget: 'halo.latest_posts' }] },
  { enabled: true, widgets: [{ widget: 'halo.latest_posts' }], hideOnMobile: true, viewportWidth: 390 }
]) {
  const host = Object.assign(desktopFactory(), state);
  assert.equal(await host.ensureDesktopWidgetSources(), null);
  assert.equal(host.widgetDataPromise, null);
}

const repairSurface = desktopFactory();
repairSurface.serverLayoutPayload = { columns: 4 };
repairSurface.columns = 4;
repairSurface.currentColumns = 4;
repairSurface.widgets = [{ key: 'broken', widget: 'system.clock', baseX: 9, baseY: 1, x: 9, y: 1, w: 2, h: 2 }];
repairSurface.icons = [];
repairSurface.iconTombstones = [];
repairSurface.defaultWidgets = [];
repairSurface.defaultIcons = [];
repairSurface.defaultIconTombstones = [];
repairSurface.visibleDesktopNodeKeys = ['broken'];
repairSurface.normalizeVisibleLayout = () => {};
repairSurface.syncResponsiveVisibility = () => {};
assert.equal(repairSurface.ensureDesktopLayoutIntegrity(), true);
assert.equal(repairSurface.widgets[0].baseX, 3);
assert.equal(repairSurface.layoutIntegrityRepaired, true);
assert.equal(repairSurface.defaultWidgets[0].baseX, 3, 'runtime repair must also update the discard baseline');
repairSurface.markRepairedLayoutForSave();
assert.equal(repairSurface.serverLayoutMutationVersion, 1, 'an authorized editor must be prompted to persist repaired placement data');
assert.equal(repairSurface.serverLayoutSaveState, 'dirty');
assert.doesNotMatch(desktopSurface, /desktopDebugWarn\('repaired (?:corrupt node placements|desktop layout to defaults)'/, 'expected placement repair must not emit recurring warning noise');

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
let hydratedAtNavigationReady = false;
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
protocolWindow.addEventListener('theme:pjax-ready', () => {
  hydratedAtNavigationReady = hydrationSurface.homeDataHydrated;
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
protocolWindow.dispatchEvent(new protocolWindow.CustomEvent('theme:pjax-ready'));
assert.equal(hydratedAtNavigationReady, true, 'theme:pjax-ready must observe hydrated home data');
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

const removedWindowListeners = [];
const removedDocumentListeners = [];
try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      removeEventListener(type, handler) { removedWindowListeners.push([type, handler]); }
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      removeEventListener(type, handler) { removedDocumentListeners.push([type, handler]); }
    }
  });
  const disposedSurface = desktopFactory();
  const handler = () => {};
  for (const name of [
    'protocolHydrationHandler', 'themeSettingsWidgetSyncHandler', 'routeSyncHandler',
    'resizeHandler', 'handleNotificationWidgetDragStart', 'handleWidgetContextMenu',
    'handleOpenWidgetCenter', 'handleBeforeUnload', 'calendarVisibilityHandler'
  ]) disposedSurface[name] = handler;
  disposedSurface.stopCalendarRollover = () => {};
  disposedSurface.clearWeatherRefreshTimer = () => {};
  disposedSurface.destroy();
  assert.deepEqual(removedWindowListeners.map(([type]) => type), [
    DESKTOP_WIDGET_PROTOCOL_EVENT,
    'theme:widget-settings-change',
    'theme:pjax-ready',
    'pageshow',
    'resize',
    'theme-notification-widget-drag-start',
    'theme-widget-context-menu',
    'theme-open-widget-center',
    'beforeunload'
  ], 'destroy must release every surface-owned global window listener');
  assert.deepEqual(removedDocumentListeners, [['visibilitychange', handler]]);
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else delete globalThis.document;
}

console.log('widget Finder gating and signup failure contracts passed');
