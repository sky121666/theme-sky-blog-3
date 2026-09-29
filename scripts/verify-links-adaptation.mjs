import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CURRENT_USER_API,
  LINK_CORE_API,
  LINK_APPLICATION_API,
  LINK_DETAIL_API,
  LINK_FEED_API,
  LINK_FEED_CONSOLE_API,
  LINK_FEED_DISCOVERY_API,
  LINK_FEED_UNREAD_SUMMARY_API,
  USER_PERMISSIONS_API,
  buildCsrfHeaders,
  buildLinkApplicationPayload,
  buildLinkFeedApiUrl,
  buildPluginLinkPayload,
  formatBackendMetadataFailure,
  formatCreateFailure,
  formatFeedFailure,
  formatMetadataFailure,
  normalizeLinkFeedPage,
  normalizeLinkCapabilities,
  normalizeUrl,
  parseSiteMetadata,
  prepareLinksLocalNavigation,
  registerLinksExplorer,
  registerLinkSubmitForm,
  resolveMetadataUrl,
  sanitizePlainText
} from '../src/apps/links/runtime.js';

const linksPage = readFileSync(new URL('../templates/links.html', import.meta.url), 'utf8');
const linksTemplate = readFileSync(new URL('../templates/modules/links-app/list.html', import.meta.url), 'utf8');
const linksWindow = readFileSync(new URL('../templates/modules/links-app/window.html', import.meta.url), 'utf8');
const linksRuntime = readFileSync(new URL('../src/apps/links/runtime.js', import.meta.url), 'utf8');
const linksStyles = readFileSync(new URL('../src/apps/links/styles/index.css', import.meta.url), 'utf8');

assert.match(linksPage, /linkFeedFinder\.groupBy\(1\)/);
assert.match(linksPage, /feedPublicSources=\$\{feedGroups != null and !#lists\.isEmpty\(feedGroups\)\}/);
assert.match(linksPage, /initialFeedPage=\$\{feedPublicSources and currentView == 'friends'/);
assert.match(linksPage, /linkFeedFinder\.list\(\{limit: 20/);
assert.match(linksPage, /windowMetricsKey = 'links-wechat-v1'/);
assert.match(linksPage, /windowMaximizable = false/);
assert.match(linksTemplate, /plugin-contract: PluginLinks; surface: visitor-application; contract-version: 2\.3\.0/);
assert.match(linksTemplate, /data-link-application-enabled=\$\{linkApplicationEnabled == true\}/);
assert.match(linksTemplate, /isApplicationMode\(\) \? submitApplication\(\)/);
assert.match(linksTemplate, /x-bind:src="captchaImage \|\| null"/);
assert.match(linksTemplate, /class="links-rail"/);
assert.match(linksTemplate, /class="links-list-pane"/);
assert.match(linksTemplate, /class="links-detail-pane"/);
assert.match(linksTemplate, /data-links-initial-link=\$\{currentLink\}/);
assert.match(linksTemplate, /data-links-initial-feed-scope=\$\{currentFeedScope\}/);
assert.match(linksTemplate, /data-links-site-title=\$\{site\.title \?: ''\}/);
assert.match(linksTemplate, /id="view-friends"/);
assert.match(linksTemplate, /id="view-apply"/);
assert.match(linksTemplate, /id="links-apply-title"/);
assert.match(linksTemplate, /id="links-apply-site-url"/);
assert.match(linksTemplate, /showSavedFeed\('favorite'\)/);
assert.match(linksTemplate, /showSavedFeed\('later'\)/);
assert.match(linksTemplate, /class="links-chat-row links-feed-favorite-row"/);
assert.match(linksTemplate, /class="links-chat-row links-feed-later-row"/);
assert.doesNotMatch(linksTemplate, /links-rail-label">收藏|links-rail-label">稍后阅读/);
assert.doesNotMatch(linksTemplate, /links-saved-shortcuts/);
assert.match(linksTemplate, /icon-\[lucide--aperture\]/);
assert.match(linksTemplate, /toggleFeedFavorite\(\)/);
assert.match(linksTemplate, /toggleFeedReadLater\(\)/);
assert.match(linksTemplate, /toggleFeedRead\(\)/);
assert.doesNotMatch(linksTemplate, /preferMessage|links-mode-switch/);
assert.match(linksTemplate, /data-feed-list/);
assert.match(linksTemplate, /data-feed-link-url=/);
assert.doesNotMatch(linksTemplate, /class="links-feed-profile"/);
assert.doesNotMatch(linksTemplate, /class="links-detail-source-logo"/);
assert.doesNotMatch(linksTemplate, /class="links-detail-source-description"/);
assert.match(linksTemplate, /class="links-detail-source-meta"/);
assert.match(linksTemplate, /class="links-detail-source-link"/);
assert.match(linksTemplate, /th:attr="name=\$\{pluginName\}"/);
assert.match(linksWindow, /widthAttr='500'/);
assert.match(linksWindow, /maximizable=\$\{windowMaximizable != null \? windowMaximizable : 'true'\}/);
assert.match(linksTemplate, /trafficLights\(maximizable=false\)/);
assert.match(linksTemplate, /:inert="!detailOpen\(\)"/);
assert.match(linksTemplate, /formValidationMessage\(\)/);
assert.match(linksRuntime, /showAllFeed\(\)/);
assert.match(linksRuntime, /showSavedFeed\(scope\)/);
assert.match(linksRuntime, /consumeFeedItem\(item\)/);
assert.match(linksRuntime, /selectLink\(key\)/);
assert.match(linksRuntime, /activeFeedSource\(\)/);
assert.match(linksRuntime, /syncWindowLayout\(\)/);
assert.match(linksRuntime, /syncDocumentChrome\(\)/);
assert.match(linksRuntime, /document\.title = this\.siteTitle/);
assert.match(linksRuntime, /当前用户接口没有返回 JSON/);
assert.match(linksStyles, /--wx-green: #07c160/);
assert.match(linksStyles, /--wx-green-soft: #95ec69/);
assert.match(linksStyles, /--wx-green-pale: #dff7e8/);
assert.doesNotMatch(linksStyles, /--theme-accent|--mac-accent/);
assert.doesNotMatch(linksTemplate + linksStyles, /daisy(?:ui|-)/i);
assert.doesNotMatch(linksRuntime, /PluginLinks 2\.2\.1/);
assert.match(linksStyles, /\.links-rail-button\.is-active \{ color: var\(--wx-green\); background: transparent; \}/);
assert.match(linksStyles, /\.links-feed-all-row\.is-active \.links-row-avatar--moments/);
assert.match(linksStyles, /\.links-feed-unread-row\.is-active \.links-row-avatar--moments/);
assert.match(linksStyles, /\.links-feed-favorite-row\.is-active \.links-row-avatar--moments/);
assert.match(linksStyles, /\.links-feed-later-row\.is-active \.links-row-avatar--moments \{ color: var\(--wx-green\); \}/);
assert.match(linksStyles, /\.links-rail-drag \.traffic-lights \{[^}]*transform: none;/s);
assert.match(linksStyles, /\.links-row-avatar--moments > span \{ width: 26px; height: 26px; \}/);
assert.match(linksStyles, /\.links-feed-avatar\.is-fallback \{ background: var\(--wx-panel\); \}/);
assert.match(linksStyles, /color-scheme: dark;/);
assert.match(linksStyles, /select\.links-input option/);
assert.match(linksStyles, /\.links-detail-header\.is-feed-source \{/);
assert.doesNotMatch(linksStyles, /\.links-detail-source-logo/);
assert.doesNotMatch(linksStyles, /\.links-detail-source-description/);
assert.match(linksStyles, /\.links-detail-source-link:hover \{/);
assert.match(linksStyles, /\.links-feed-card\.is-unread::before \{/);
assert.match(linksStyles, /background: var\(--wx-danger\);/);
assert.doesNotMatch(linksStyles, /\.links-feed-card\.is-unread \{ box-shadow: inset 3px 0/);
assert.match(linksTemplate, /class="links-feed-open"[^>]*aria-label="阅读原文"/s);
assert.match(linksTemplate, /icon-\[lucide--chevron-right\]/);
assert.match(linksRuntime, /activeLinkName: this\.feedLinkName/);
assert.match(linksRuntime, /icon-\[lucide--ellipsis\]/);
assert.match(linksRuntime, /onToggleRead: \(id\) => this\.toggleFeedRead\(id\)/);
assert.match(linksRuntime, /displayLabel: '稍后读'/);
assert.match(linksRuntime, /label: '未读'/);
assert.match(linksRuntime, /document\.addEventListener\('keydown', this\._documentKeydownHandler\)/);
assert.match(linksStyles, /\.links-feed-overflow-trigger \{/);
assert.match(linksStyles, /\.links-feed-overflow-menu \{/);
assert.match(linksStyles, /\.links-feed-overflow\.is-open \.links-feed-overflow-menu \{/);
assert.match(linksStyles, /\.links-feed-overflow-action\.is-active \{ color: var\(--wx-green-soft\); \}/);
assert.match(linksStyles, /body\[data-page-app="links"\] #window-frame-root/);
assert.match(linksStyles, /height: 100dvh !important;/);
assert.match(linksStyles, /\.links-rail-label \{[^}]*position: static;/s);
assert.match(linksStyles, /\.links-detail-back,\s*\.links-detail-action,\s*\.links-detail-source-link \{[^}]*width: 40px;/s);
assert.match(linksStyles, /\.links-comments comment-widget,/);
assert.match(linksStyles, /--halo-cw-primary-1-color: var\(--wx-green\);/);
assert.match(linksStyles, /--halo-cw-primary-2-color: var\(--wx-green-pressed\);/);
assert.doesNotMatch(linksRuntime + linksStyles, /links-feed-state-actions|links-feed-state-action/);
assert.doesNotMatch(linksTemplate + linksStyles, /links-rail-settings|管理后台/);
assert.doesNotMatch(linksTemplate, /pluginFinder\.available\('link-submit'\)|data-link-submit-enabled/);
assert.doesNotMatch(linksTemplate, /link-submit-(?:title|site-url)/);
assert.doesNotMatch(linksRuntime, /anonymous\.link\.submit|LINK_SUBMIT_API|LINK_SUBMIT_GROUPS_API/);
assert.match(linksRuntime, new RegExp(LINK_FEED_API.replaceAll('/', '\\/')));
assert.match(linksRuntime, new RegExp(LINK_FEED_CONSOLE_API.replaceAll('/', '\\/')));
assert.equal(LINK_FEED_UNREAD_SUMMARY_API, `${LINK_FEED_CONSOLE_API}/-/unread-summary`);
assert.match(linksRuntime, new RegExp(LINK_DETAIL_API.replaceAll('/', '\\/')));
assert.match(linksRuntime, new RegExp(LINK_FEED_DISCOVERY_API.replaceAll('/', '\\/')));
assert.match(linksRuntime, new RegExp(LINK_CORE_API.replaceAll('/', '\\/')));
assert.match(linksRuntime, new RegExp(CURRENT_USER_API.replaceAll('/', '\\/')));
assert.match(linksRuntime, new RegExp(USER_PERMISSIONS_API.replaceAll('/', '\\/')));

assert.equal(normalizeUrl('https://example.test/path'), 'https://example.test/path');
assert.equal(normalizeUrl('http://example.test/path'), 'http://example.test/path');
assert.deepEqual(buildLinkApplicationPayload({
  url: 'https://example.test/',
  displayName: ' 示例 ',
  description: ' 说明 ',
  logo: '',
  email: 'a@example.test',
  rssUrl: 'https://example.test/rss.xml',
  groupName: 'friends'
}, 'challenge-1', 'aB123'), {
  url: 'https://example.test/',
  displayName: '示例',
  logo: '',
  description: '说明',
  email: 'a@example.test',
  feedUrls: ['https://example.test/rss.xml'],
  challengeId: 'challenge-1',
  captchaCode: 'aB123'
});
assert.equal(resolveMetadataUrl('/favicon.svg', 'https://example.test/path'), 'https://example.test/favicon.svg');
assert.equal(resolveMetadataUrl('data:image/svg+xml,test', 'https://example.test/'), '');
assert.equal(sanitizePlainText('测试<br><strong>友链</strong>&nbsp;&amp; 安全'), '测试 友链 & 安全');
assert.deepEqual(buildCsrfHeaders('theme=dark; XSRF-TOKEN=halo%3Acsrf%2Btoken; locale=zh-CN'), {
  'X-XSRF-TOKEN': 'halo:csrf+token'
});
assert.deepEqual(buildCsrfHeaders('theme=dark'), {});
for (const unsafeUrl of [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'ftp://example.test/file'
]) {
  assert.equal(normalizeUrl(unsafeUrl), '', `${unsafeUrl} must be rejected`);
}

const groupFeedUrl = buildLinkFeedApiUrl({
  groupName: 'friends',
  linkName: 'must-be-dropped',
  beforePublishedAt: '2026-07-22T00:00:00Z',
  beforeId: 'cursor-1',
  limit: 200
}, 'https://halo.test');
assert.equal(groupFeedUrl.pathname, LINK_FEED_API);
assert.equal(groupFeedUrl.searchParams.get('groupName'), 'friends');
assert.equal(groupFeedUrl.searchParams.has('linkName'), false, 'groupName and linkName must never be sent together');
assert.equal(groupFeedUrl.searchParams.get('beforeId'), 'cursor-1');
assert.equal(groupFeedUrl.searchParams.get('limit'), '100');

const favoriteFeedUrl = buildLinkFeedApiUrl({
  scope: 'favorite',
  protectedMode: true,
  limit: 20
}, 'https://halo.test');
assert.equal(favoriteFeedUrl.pathname, LINK_FEED_CONSOLE_API);
assert.equal(favoriteFeedUrl.searchParams.get('favorite'), 'true');
assert.equal(favoriteFeedUrl.searchParams.has('readLater'), false);

const laterFeedUrl = buildLinkFeedApiUrl({ scope: 'later', protectedMode: true }, 'https://halo.test');
assert.equal(laterFeedUrl.searchParams.get('readLater'), 'true');
const unreadFeedUrl = buildLinkFeedApiUrl({ scope: 'unread', protectedMode: true }, 'https://halo.test');
assert.equal(unreadFeedUrl.searchParams.get('read'), 'false');

const feedPage = normalizeLinkFeedPage({
  items: [
    {
      id: 'feed-1',
      linkName: 'link-a',
      url: 'https://source.test/post',
      title: '<strong>安全标题</strong>',
      summary: '<script>alert(1)</script> 正文',
      author: '来源 A',
      authorUrl: 'https://source.test',
      authorLogo: 'https://source.test/logo.png',
      publishedAt: '2026-07-22T00:00:00Z',
      read: false,
      favorite: true,
      readLater: true
    },
    { id: 'bad', url: 'javascript:alert(1)', title: 'bad' }
  ],
  hasNext: true,
  nextBeforePublishedAt: '2026-07-21T00:00:00Z',
  nextBeforeId: 'feed-2'
});
assert.equal(feedPage.items.length, 1);
assert.equal(feedPage.items[0].title, '安全标题');
assert.equal(feedPage.items[0].summary, 'alert(1) 正文');
assert.equal(feedPage.items[0].read, false);
assert.equal(feedPage.items[0].favorite, true);
assert.equal(feedPage.items[0].readLater, true);
assert.equal(feedPage.hasNext, true);

assert.deepEqual(normalizeLinkCapabilities({
  uiPermissions: ['plugin:links:view']
}, { metadata: { name: 'reader' } }), {
  authenticated: true,
  username: 'reader',
  canReadFeed: true,
  canManage: false
});
assert.deepEqual(normalizeLinkCapabilities({
  permissions: [{ metadata: { name: 'role-template-link-manage' } }]
}, { metadata: { name: 'manager' } }), {
  authenticated: true,
  username: 'manager',
  canReadFeed: true,
  canManage: true
});

assert.match(formatFeedFailure(404), /尚未.*公开 RSS|公开 RSS.*未开启/);
assert.match(formatFeedFailure(429), /频繁/);
assert.match(formatMetadataFailure({ code: 'mixed-content' }), /HTTPS.*HTTP/);
assert.match(formatMetadataFailure({ code: 'not-html' }), /没有返回可识别的网页/);
assert.match(formatBackendMetadataFailure({ status: 403 }), /没有链接管理权限/);
assert.match(formatCreateFailure({ status: 409 }), /已经存在/);
assert.match(formatCreateFailure({ status: 500 }), /暂时异常/);

const linkPayload = buildPluginLinkPayload({
  url: 'https://example.test/',
  displayName: '示例站点',
  description: '示例描述',
  logo: 'https://example.test/logo.png',
  groupName: 'friends',
  rssUrl: 'https://example.test/rss.xml'
});
assert.deepEqual(linkPayload, {
  apiVersion: 'core.halo.run/v1alpha1',
  kind: 'Link',
  metadata: { name: '', generateName: 'link-', annotations: {} },
  spec: {
    url: 'https://example.test/',
    displayName: '示例站点',
    description: '示例描述',
    logo: 'https://example.test/logo.png',
    groupName: 'friends',
    rss: { enabled: true, feedUrls: ['https://example.test/rss.xml'] }
  }
});

class TestDOMParser {
  parseFromString(html) {
    const source = String(html || '');
    const tags = Array.from(source.matchAll(/<(meta|link)\b[^>]*>/gi), (match) => match[0]);
    const parseAttributes = (tag) => Object.fromEntries(
      Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g), (match) => [match[1].toLowerCase(), match[3]])
    );
    return {
      querySelector(selector) {
        if (selector === 'title') {
          const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          return match ? { textContent: match[1], getAttribute() { return ''; } } : null;
        }
        const tagName = selector.startsWith('meta') ? 'meta' : 'link';
        const conditions = Array.from(
          selector.matchAll(/\[([\w:-]+)(~?=)"([^"]+)"\]/g),
          (match) => ({ name: match[1].toLowerCase(), operator: match[2], value: match[3] })
        );
        for (const tag of tags) {
          if (!tag.toLowerCase().startsWith(`<${tagName}`)) continue;
          const attributes = parseAttributes(tag);
          if (!conditions.every((condition) => condition.operator === '~='
            ? String(attributes[condition.name] || '').split(/\s+/).includes(condition.value)
            : attributes[condition.name] === condition.value)) continue;
          return {
            textContent: '',
            getAttribute(name) {
              return attributes[String(name).toLowerCase()] || '';
            }
          };
        }
        return null;
      }
    };
  }
}

function fakeResponse(status, payload = {}, options = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const contentType = options.contentType || (typeof payload === 'string' ? 'text/html; charset=utf-8' : 'application/json');
  return {
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    redirected: options.redirected === true,
    url: options.url || '',
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return contentType;
        if (String(name).toLowerCase() === 'content-length') return String(Buffer.byteLength(body));
        return null;
      }
    },
    clone() {
      return this;
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload;
    },
    async text() {
      return body;
    }
  };
}

let explorerFactory = null;
registerLinksExplorer({
  data(name, componentFactory) {
    assert.equal(name, 'linksExplorer');
    explorerFactory = componentFactory;
  }
});
assert.equal(typeof explorerFactory, 'function');
{
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls = [];
  const component = {
    destroyed: false,
    selectedGroup: 'stale-group',
    showPrimaryView(view, options) { calls.push({ view, options }); }
  };
  const shell = {
    isConnected: true,
    matches(selector) { return selector === '.links-app-shell'; }
  };
  const root = {
    querySelector(selector) { return selector === '.links-app-shell' ? shell : null; }
  };
  const location = new URL('https://halo.test/links');
  const testWindow = {
    location,
    Alpine: { $data(node) { assert.equal(node, shell); return component; } }
  };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
    const prepare = (sourceUrl, url, historyMode) => prepareLinksLocalNavigation(root, {
      sourceUrl, url, historyMode
    });
    for (const [sourceUrl, url] of [
      ['https://halo.test/links?view=friends&group=x', 'https://halo.test/links'],
      ['https://halo.test/links#section', 'https://halo.test/links?view=friends'],
      ['https://other.test/links', 'https://halo.test/links?view=friends'],
      ['https://halo.test/links', 'https://halo.test/links?view=friends&group=x'],
      ['https://halo.test/links', 'https://halo.test/links#section'],
      ['https://halo.test/links', 'https://other.test/links?view=friends']
    ]) {
      assert.equal(prepare(sourceUrl, url), null, `deep or foreign URL must use PJAX: ${sourceUrl} -> ${url}`);
    }
    assert.deepEqual(calls, [], 'rejected preparation must not switch views');

    const toFriends = prepare('https://halo.test/links', 'https://halo.test/links?view=friends');
    assert.equal(typeof toFriends, 'function');
    assert.deepEqual(calls, [], 'preparing an accepted navigation must not switch views');
    assert.equal(component.selectedGroup, 'stale-group', 'preparing must not clear the current selection');
    assert.equal(testWindow.location.href, 'https://halo.test/links', 'preparing must not change history');
    assert.equal(toFriends(), true);
    assert.equal(component.selectedGroup, '');
    assert.deepEqual(calls.shift(), {
      view: 'friends',
      options: {
        historyMode: 'push',
        targetUrl: 'https://halo.test/links?view=friends',
        scrollToTop: true
      }
    });

    component.selectedGroup = 'another-group';
    const toLinks = prepare('https://halo.test/links?view=friends', 'https://halo.test/links');
    assert.equal(toLinks(), true);
    assert.equal(component.selectedGroup, '');
    assert.deepEqual(calls.shift(), {
      view: 'links',
      options: {
        historyMode: 'push',
        targetUrl: 'https://halo.test/links',
        scrollToTop: true
      }
    });

    const fromHistory = prepare('https://halo.test/links', 'https://halo.test/links?view=friends', 'none');
    assert.equal(fromHistory(), true);
    assert.deepEqual(calls.shift(), {
      view: 'friends',
      options: {
        historyMode: 'none',
        targetUrl: 'https://halo.test/links?view=friends',
        scrollToTop: false
      }
    });

    shell.isConnected = false;
    assert.equal(prepare('https://halo.test/links', 'https://halo.test/links?view=friends'), null);
    assert.equal(toFriends(), false, 'a plan prepared before disconnect must not commit after disconnect');
    shell.isConnected = true;
    component.destroyed = true;
    assert.equal(prepare('https://halo.test/links', 'https://halo.test/links?view=friends'), null);
    assert.equal(toLinks(), false, 'a plan prepared before destroy must not commit after destroy');
    assert.deepEqual(calls, [], 'rejected commits must not switch views');
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
}
{
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const historyCalls = [];
  const storageCalls = [];
  const history = {
    state: {
      url: 'https://halo.test/links?keep=1', title: '旧标题', uid: 'existing', keep: true,
      __browserNavIndex: 3, scrollPos: [4, 5], __browserWindowScroll: [6, 7]
    },
    pushState(...args) { historyCalls.push({ mode: 'push', args }); this.state = args[0]; },
    replaceState(...args) { historyCalls.push({ mode: 'replace', args }); this.state = args[0]; }
  };
  const testWindow = {
    location: new URL('https://halo.test/links?keep=1'),
    history,
    sessionStorage: { setItem(...args) { storageCalls.push(args); } },
    pjax: { lastUid: 'existing', maxUid: 'existing' },
    __browserSyncUiHistoryState(options) { historyCalls.push({ mode: 'helper', options }); }
  };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
    const explorer = explorerFactory();
    explorer.allLinksTitle = '全部友链';
    explorer.siteTitle = '示例站点';
    explorer.groups = [{ key: 'tools', label: '工具' }];
    explorer.selectedGroup = 'tools';
    explorer.syncUrl('push');
    assert.deepEqual(historyCalls, [{
      mode: 'helper',
      options: {
        url: 'https://halo.test/links?keep=1&group=tools',
        title: '工具 - 示例站点',
        mode: 'push',
        chrome: { windowTitle: '工具', windowSubtitle: '' }
      }
    }]);

    const previousState = history.state;
    testWindow.__browserSyncUiHistoryState = (options) => {
      historyCalls.push({ mode: 'helper-rejected', options });
      return false;
    };
    explorer.syncUrl('push');
    const pushedState = historyCalls[2].args[0];
    assert.equal(historyCalls[1].mode, 'helper-rejected');
    assert.equal(historyCalls[2].mode, 'push');
    assert.notEqual(pushedState, previousState);
    assert.equal(pushedState.url, 'https://halo.test/links?keep=1&group=tools');
    assert.equal(pushedState.title, '工具 - 示例站点');
    assert.equal(pushedState.keep, true);
    assert.deepEqual(pushedState.scrollPos, [4, 5]);
    assert.deepEqual(pushedState.__browserWindowScroll, [6, 7]);
    assert.equal(pushedState.__browserNavIndex, 4);
    assert.match(pushedState.uid, /^pjax\d+_[a-z0-9]+$/);
    assert.notEqual(pushedState.uid, previousState.uid);
    assert.deepEqual(storageCalls, [['sky_browser_nav_depth', '4']]);
    assert.equal(testWindow.pjax.lastUid, pushedState.uid);
    assert.equal(testWindow.pjax.maxUid, pushedState.uid);

    delete testWindow.__browserSyncUiHistoryState;
    testWindow.location = new URL('https://halo.test/links?keep=1&group=stale');
    explorer.selectedGroup = '';
    explorer.syncUrl('replace');
    const fallback = historyCalls[3];
    assert.equal(fallback.mode, 'replace');
    assert.deepEqual(fallback.args, [
      {
        ...pushedState,
        url: 'https://halo.test/links?keep=1',
        title: '全部友链 - 示例站点',
        __browserNavChrome: { windowTitle: '全部友链', windowSubtitle: '' }
      },
      '全部友链 - 示例站点',
      '/links?keep=1'
    ]);
    assert.notEqual(fallback.args[0], pushedState, 'fallback must not mutate the existing history entry');
    assert.equal(fallback.args[0].uid, pushedState.uid);
    assert.equal(fallback.args[0].__browserNavIndex, pushedState.__browserNavIndex);
    assert.equal(storageCalls.length, 1, 'replace must not advance browser history depth');
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
}

let factory = null;
registerLinkSubmitForm({
  data(name, componentFactory) {
    assert.equal(name, 'linkSubmitForm');
    factory = componentFactory;
  }
});
assert.equal(typeof factory, 'function');

function createModel() {
  const model = factory();
  const watchers = new Map();
  model.$watch = (name, callback) => watchers.set(name, callback);
  model.$root = {
    dataset: { linkApplicationEnabled: 'false' },
    querySelectorAll: () => [],
    closest: () => null
  };
  model.init();
  model.notifyFormChange = () => watchers.get('form')();
  model.form = {
    ...model.form,
    type: 'add',
    displayName: '示例站点',
    url: 'https://example.test/',
    description: '用于契约验证',
    groupName: 'friends'
  };
  model.submitGroups = [{ groupName: 'friends', displayName: '朋友们' }];
  return model;
}

const originalFetch = globalThis.fetch;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalCustomEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
const originalDOMParserDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
try {
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: TestDOMParser });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://halo.test', protocol: 'https:' },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      setTimeout(callback) { callback(); }
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      cookie: 'theme=dark; XSRF-TOKEN=contract%3Acsrf-token',
      getElementById() { return { close() {} }; },
      createElement() { throw new Error('clipboard fallback should not be used in this contract test'); }
    }
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class CustomEvent {
      constructor(type) { this.type = type; }
    }
  });
  const copiedDrafts = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { async writeText(value) { copiedDrafts.push(value); } } }
  });

  const parsedMetadata = parseSiteMetadata(`
    <html><head>
      <title>备用标题</title>
      <meta property="og:title" content="识别站点">
      <meta name="description" content="安全&lt;br&gt;简介">
      <meta name="generator" content="Halo 2.25">
      <link rel="icon" href="/favicon.svg">
      <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    </head></html>
  `, 'https://metadata.test/blog/');
  assert.deepEqual(parsedMetadata, {
    title: '识别站点',
    description: '安全 简介',
    logo: 'https://metadata.test/favicon.svg',
    rssUrl: 'https://metadata.test/rss.xml',
    platform: 'Halo'
  });

  const retainedFeedCard = { dataset: { feedId: 'feed-1' } };
  const retainedFeedList = {
    cards: [retainedFeedCard],
    replaceChildren() { this.cards = []; },
    querySelectorAll() { return this.cards; }
  };
  const refreshingFeed = explorerFactory();
  refreshingFeed.$root = {
    querySelector(selector) { return selector === '[data-feed-list]' ? retainedFeedList : null; }
  };
  const retainedFeedItem = { id: 'feed-1', title: '已加载动态' };
  refreshingFeed.feedItems = [retainedFeedItem];
  refreshingFeed.feedItemCount = 1;
  refreshingFeed.feedHasNext = true;
  refreshingFeed.feedNextId = 'next-id';
  refreshingFeed.feedNextPublishedAt = '2026-07-21T00:00:00Z';
  refreshingFeed.feedLoadedKey = 'public:all';
  refreshingFeed.feedStatus = 'ready';
  globalThis.fetch = async () => fakeResponse(503, { detail: '暂时不可用' });
  await refreshingFeed.replaceFeed();
  assert.deepEqual(retainedFeedList.cards, [retainedFeedCard], 'same-filter refresh failure must keep visible feed cards');
  assert.deepEqual(refreshingFeed.feedItems, [retainedFeedItem], 'same-filter refresh failure must keep feed detail data');
  assert.equal(refreshingFeed.feedItemCount, 1);
  assert.equal(refreshingFeed.feedHasNext, true, 'same-filter refresh failure must keep the next-page cursor');
  assert.equal(refreshingFeed.feedNextId, 'next-id');
  assert.equal(refreshingFeed.feedStatus, 'error', 'failed refresh must still expose a retry action');

  let failedPageRequests = 0;
  globalThis.fetch = async () => {
    failedPageRequests += 1;
    return fakeResponse(503, { detail: '暂时不可用' });
  };
  await refreshingFeed.loadNextFeed({ automatic: true });
  assert.equal(failedPageRequests, 0, 'intersection must stop retrying a failed feed cursor');
  await refreshingFeed.loadNextFeed();
  assert.equal(failedPageRequests, 1, 'the visible continue button must still retry the failed cursor');
  assert.match(linksTemplate, /x-intersect\.margin\.240px="loadNextFeed\(\{ automatic: true \}\)"/,
    'the intersection observer must use the guarded automatic path');

  const guestRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    guestRequests.push({ url: String(url), options });
    return fakeResponse(200, { user: { metadata: { name: 'anonymousUser' } } });
  };
  const guestModel = createModel();
  assert.equal(await guestModel.ensureCapability(), false);
  assert.equal(guestModel.capabilityStatus, 'guest');
  assert.equal(guestRequests.length, 1, 'guest must not probe protected PluginLinks APIs');

  globalThis.fetch = async () => fakeResponse(500, '<html>upstream error</html>');
  const failedCapabilityModel = createModel();
  assert.equal(await failedCapabilityModel.ensureCapability(), false);
  assert.equal(failedCapabilityModel.capabilityStatus, 'error', 'non-auth server failures must not be downgraded to guest');
  assert.match(failedCapabilityModel.result.message, /HTTP 500/);

  const managerRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    managerRequests.push({ url: requestUrl, options });
    if (requestUrl.includes(CURRENT_USER_API)) {
      return fakeResponse(200, { user: { metadata: { name: 'sky' }, spec: { displayName: 'Sky' } } });
    }
    if (requestUrl.includes('/permissions')) {
      return fakeResponse(200, { uiPermissions: ['plugin:links:view', 'plugin:links:manage'] });
    }
    if (requestUrl.includes(LINK_DETAIL_API)) {
      return fakeResponse(200, { title: '官方识别站点', description: '官方描述', icon: 'https://example.test/icon.png' });
    }
    if (requestUrl.includes(LINK_FEED_DISCOVERY_API)) {
      return fakeResponse(200, { feedUrls: ['https://example.test/feed.xml'] });
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };
  const managerModel = createModel();
  assert.equal(await managerModel.ensureCapability(), true);
  assert.equal(managerModel.capabilityStatus, 'manager');
  managerModel.form.url = 'https://example.test/';
  await managerModel.autofillFromUrl();
  assert.equal(managerModel.form.displayName, '官方识别站点');
  assert.equal(managerModel.form.description, '官方描述');
  assert.equal(managerModel.form.logo, 'https://example.test/icon.png');
  assert.equal(managerModel.form.rssUrl, 'https://example.test/feed.xml');
  assert.equal(managerModel.result.show, false, 'successful official recognition must stay silent');
  const protectedRequests = managerRequests.filter((request) => request.url.includes('/apis/console.api.link.halo.run/'));
  assert.equal(protectedRequests.length, 2, 'detail and RSS discovery should use official PluginLinks protected APIs');
  assert(managerRequests.some((request) => request.url.includes(`${USER_PERMISSIONS_API}/sky/permissions`)));
  assert(protectedRequests.every((request) => request.options.credentials === 'same-origin'));

  const fallbackModel = createModel();
  fallbackModel.canManage = true;
  fallbackModel.capabilityStatus = 'manager';
  fallbackModel.form.url = 'https://fallback.test/';
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes(LINK_DETAIL_API)) return fakeResponse(403, { title: 'Forbidden' });
    if (requestUrl.includes(LINK_FEED_DISCOVERY_API)) return fakeResponse(403, { title: 'Forbidden' });
    if (requestUrl === 'https://fallback.test/') {
      assert.equal(options.credentials, 'omit');
      return fakeResponse(200, '<title>浏览器识别站点</title><meta name="description" content="浏览器描述">', {
        url: requestUrl,
        contentType: 'text/html; charset=utf-8'
      });
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };
  await fallbackModel.autofillFromUrl();
  assert.equal(fallbackModel.form.displayName, '浏览器识别站点');
  assert.equal(fallbackModel.capabilityStatus, 'denied');
  assert.equal(fallbackModel.result.warning, true);
  assert.match(fallbackModel.result.message, /没有链接管理权限.*浏览器识别/);

  const createRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    createRequests.push({ url: String(url), options });
    return fakeResponse(201, { metadata: { name: 'link-created' } });
  };
  const createLinkModel = createModel();
  createLinkModel.canManage = true;
  createLinkModel.capabilityStatus = 'manager';
  await createLinkModel.createLink();
  assert.equal(createLinkModel.submitted, true);
  assert.equal(createLinkModel.result.success, true);
  assert.equal(createRequests.length, 1);
  assert.equal(createRequests[0].url, LINK_CORE_API);
  assert.equal(createRequests[0].options.credentials, 'same-origin');
  assert.equal(createRequests[0].options.headers['X-XSRF-TOKEN'], 'contract:csrf-token');
  assert.equal(JSON.parse(createRequests[0].options.body).metadata.generateName, 'link-');
  await createLinkModel.createLink();
  assert.equal(createRequests.length, 1, 'successful direct create must be terminal');

  globalThis.fetch = async () => fakeResponse(403, { title: 'Forbidden' });
  const deniedCreateModel = createModel();
  deniedCreateModel.canManage = true;
  deniedCreateModel.capabilityStatus = 'manager';
  await deniedCreateModel.createLink();
  assert.equal(deniedCreateModel.canManage, false);
  assert.equal(deniedCreateModel.isMessageMode(), true);
  assert.match(deniedCreateModel.result.message, /没有创建链接的权限.*留言申请/);

  const messageModel = createModel();
  messageModel.capabilityStatus = 'guest';
  messageModel.canManage = false;
  messageModel.form.email = 'hello@example.test';
  messageModel.form.rssUrl = 'https://example.test/rss.xml';
  assert.equal(messageModel.canCopyDraft(), true);
  assert.equal(messageModel.formValidationMessage(), '');
  messageModel.form.displayName = '';
  assert.match(messageModel.formValidationMessage(), /网站名称/);
  messageModel.form.displayName = '示例站点';
  await messageModel.copyAndGotoBoard();
  assert.match(copiedDrafts.at(-1), /^申请交换友链：/);
  assert.match(copiedDrafts.at(-1), /- 联系邮箱：hello@example\.test/);
  assert.match(copiedDrafts.at(-1), /- RSS 链接：https:\/\/example\.test\/rss\.xml/);

  const applicationRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    applicationRequests.push({ url: String(url), options });
    if (String(url).endsWith('/captcha')) {
      return fakeResponse(200, { challengeId: 'challenge-1', image: 'data:image/png;base64,aGVsbG8=' });
    }
    return fakeResponse(201, { id: 'link-app-1', status: 'PENDING' });
  };
  const applicationModel = createModel();
  applicationModel.applicationEnabled = true;
  applicationModel.capabilityStatus = 'guest';
  applicationModel.form.email = 'a@example.test';
  applicationModel.form.rssUrl = 'https://example.test/rss.xml';
  applicationModel.form.description = '';
  await applicationModel.refreshCaptcha();
  assert.equal(applicationModel.challengeId, 'challenge-1');
  assert.equal(applicationModel.canSubmitApplication(), false, 'CAPTCHA code is required');
  applicationModel.captchaCode = 'aB123';
  assert.equal(applicationModel.canSubmitApplication(), true, 'official application permits an empty description');
  await applicationModel.submitApplication();
  assert.equal(applicationModel.submitted, true);
  assert.match(applicationModel.result.message, /等待管理员审核/);
  assert.deepEqual(applicationRequests.map(({ url }) => url), [
    `${LINK_APPLICATION_API}/captcha`, LINK_APPLICATION_API
  ]);
  assert(applicationRequests.every(({ options }) => options.credentials === 'omit'));
  assert.equal(JSON.parse(applicationRequests[1].options.body).challengeId, 'challenge-1');
  assert.equal(applicationRequests[1].options.headers['X-XSRF-TOKEN'], undefined);

  // L1: the first request may finish after the user has started a different draft.
  const racingRequests = [];
  let resolveFirstApplication;
  let captchaCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/captcha')) {
      return fakeResponse(200, { challengeId: `challenge-${++captchaCount}`, image: 'data:image/png;base64,aGVsbG8=' });
    }
    assert.equal(String(url), LINK_APPLICATION_API);
    racingRequests.push(JSON.parse(options.body));
    if (racingRequests.length === 1) return new Promise((resolve) => { resolveFirstApplication = resolve; });
    return fakeResponse(201, { status: 'PENDING' });
  };
  const racingModel = createModel();
  racingModel.applicationEnabled = true;
  racingModel.capabilityStatus = 'guest';
  await racingModel.refreshCaptcha();
  racingModel.captchaCode = 'Ab123';
  const firstApplication = racingModel.submitApplication();
  racingModel.form.url = 'https://second.test/';
  await racingModel.notifyFormChange();
  await racingModel.fillFromUrl();
  resolveFirstApplication(fakeResponse(201, { status: 'PENDING' }));
  await firstApplication;
  assert.equal(racingRequests[0].url, 'https://example.test/');
  assert.equal(racingModel.form.url, 'https://second.test/');
  assert.equal(racingModel.submitted, false, 'the old success must not mark the edited draft as submitted');
  assert.match(racingModel.result.message, /当前表单.*尚未提交/);
  assert.equal(racingModel.challengeId, 'challenge-2', 'the edited draft must receive a fresh CAPTCHA');
  racingModel.captchaCode = 'Cd456';
  await racingModel.submitApplication();
  assert.equal(racingRequests[1].url, 'https://second.test/');
  assert.equal(racingModel.submitted, true, 'the second draft can be submitted independently');

  // L2: plain field edits, manual fill and autofill must each start a usable next application.
  racingModel.form.displayName = '第三个草稿';
  await racingModel.notifyFormChange();
  assert.equal(racingModel.submitted, false);
  assert.equal(racingModel.challengeId, 'challenge-3');
  assert.equal(racingModel.canSubmitApplication(), false, 'new drafts still require the new CAPTCHA code');
  racingModel.captchaCode = 'Ef789';
  assert.equal(racingModel.canSubmitApplication(), true);

  for (const fillMethod of ['fillFromUrl', 'autofillFromUrl']) {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('/captcha')) return fakeResponse(200, {
        challengeId: 'next-draft-captcha', image: 'data:image/png;base64,aGVsbG8='
      });
      assert.equal(String(url), 'https://example.test/');
      return fakeResponse(200, '<title>下一份申请</title>');
    };
    const nextDraft = createModel();
    nextDraft.applicationEnabled = true;
    nextDraft.capabilityStatus = 'guest';
    nextDraft.submitted = true;
    await nextDraft[fillMethod]();
    assert.equal(nextDraft.submitted, false);
    assert.equal(nextDraft.challengeId, 'next-draft-captcha', `${fillMethod} should obtain the next challenge`);
    assert.equal(requests.filter((url) => url.endsWith('/captcha')).length, 1);
  }

  for (const deniedStatus of [401, 403]) {
    for (const captchaStatus of [200, 503]) {
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        if (String(url) === LINK_CORE_API) return fakeResponse(deniedStatus, { title: 'Forbidden' });
        assert.equal(String(url), `${LINK_APPLICATION_API}/captcha`);
        return fakeResponse(captchaStatus, captchaStatus === 200
          ? { challengeId: 'downgrade-captcha', image: 'data:image/png;base64,aGVsbG8=' }
          : { detail: 'captcha unavailable' });
      };
      const downgraded = createModel();
      downgraded.applicationEnabled = true;
      downgraded.canManage = true;
      downgraded.capabilityStatus = 'manager';
      await downgraded.createLink();
      assert.equal(downgraded.canManage, false);
      assert.equal(downgraded.submitting, false);
      assert.deepEqual(requests, [LINK_CORE_API, `${LINK_APPLICATION_API}/captcha`]);
      assert.equal(downgraded.isApplicationMode(), captchaStatus === 200);
      assert.equal(downgraded.isMessageMode(), captchaStatus !== 200);
      if (captchaStatus === 200) {
        assert.equal(downgraded.challengeId, 'downgrade-captcha');
        downgraded.captchaCode = 'Ab123';
        assert.equal(downgraded.canSubmitApplication(), true);
      } else {
        assert.match(downgraded.result.message, /已切换为留言申请/);
      }
    }
  }

  for (const submitMethod of ['submitApplication', 'createLink']) {
    let resolveSubmission;
    let submissionSignal;
    globalThis.fetch = async (_url, options) => {
      submissionSignal = options.signal;
      return new Promise((resolve) => { resolveSubmission = resolve; });
    };
    const disposed = createModel();
    disposed.applicationEnabled = true;
    disposed.canManage = submitMethod === 'createLink';
    disposed.capabilityStatus = disposed.canManage ? 'manager' : 'guest';
    disposed.challengeId = 'current-captcha';
    disposed.captchaCode = 'Ab123';
    const submitting = disposed[submitMethod]();
    disposed.destroy();
    assert.equal(submissionSignal.aborted, true);
    resolveSubmission(fakeResponse(201, { status: 'PENDING' }));
    await submitting;
    assert.equal(disposed.submitted, false, 'a disposed form must ignore a late write response');
    assert.equal(disposed.result.show, false);
  }

  globalThis.fetch = async (url) => {
    assert.equal(String(url), `${LINK_APPLICATION_API}/captcha`);
    return fakeResponse(503, { detail: 'captcha unavailable' });
  };
  const captchaFailureModel = createModel();
  captchaFailureModel.applicationEnabled = true;
  captchaFailureModel.capabilityStatus = 'guest';
  await captchaFailureModel.refreshCaptcha();
  assert.equal(captchaFailureModel.applicationUnavailable, true);
  assert.equal(captchaFailureModel.isMessageMode(), true, 'CAPTCHA failure should preserve the message fallback');
  assert.match(captchaFailureModel.result.message, /已切换为留言申请/);
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of [
    ['navigator', originalNavigatorDescriptor],
    ['window', originalWindowDescriptor],
    ['document', originalDocumentDescriptor],
    ['CustomEvent', originalCustomEventDescriptor],
    ['DOMParser', originalDOMParserDescriptor]
  ]) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log('PluginLinks 2.3.0 links/feed/visitor-application adaptation contract passed');
