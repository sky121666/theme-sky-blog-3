import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CURRENT_USER_API,
  LINK_CORE_API,
  LINK_DETAIL_API,
  LINK_FEED_API,
  LINK_FEED_CONSOLE_API,
  LINK_FEED_DISCOVERY_API,
  LINK_FEED_UNREAD_SUMMARY_API,
  USER_PERMISSIONS_API,
  buildCsrfHeaders,
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
assert.match(linksTemplate, /plugin-contract: PluginLinks; contract-version: 2\.2\.1; tested-version: 2\.2\.1/);
assert.match(linksTemplate, /class="links-rail"/);
assert.match(linksTemplate, /class="links-list-pane"/);
assert.match(linksTemplate, /class="links-detail-pane"/);
assert.match(linksTemplate, /data-links-initial-link=\$\{currentLink\}/);
assert.match(linksTemplate, /data-links-initial-feed-scope=\$\{currentFeedScope\}/);
assert.match(linksTemplate, /id="view-friends"/);
assert.match(linksTemplate, /id="view-apply"/);
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
assert.match(linksTemplate, /class="links-feed-profile"/);
assert.match(linksTemplate, /th:attr="name=\$\{pluginName\}"/);
assert.match(linksWindow, /widthAttr='500'/);
assert.match(linksRuntime, /showAllFeed\(\)/);
assert.match(linksRuntime, /showSavedFeed\(scope\)/);
assert.match(linksRuntime, /consumeFeedItem\(item\)/);
assert.match(linksRuntime, /selectLink\(key\)/);
assert.match(linksRuntime, /activeFeedSource\(\)/);
assert.match(linksRuntime, /syncWindowLayout\(\)/);
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
assert.doesNotMatch(linksTemplate + linksStyles, /links-rail-settings|管理后台/);
assert.doesNotMatch(linksTemplate, /pluginFinder\.available\('link-submit'\)|data-link-submit-enabled/);
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

  const guestRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    guestRequests.push({ url: String(url), options });
    return fakeResponse(200, { user: { metadata: { name: 'anonymousUser' } } });
  };
  const guestModel = createModel();
  assert.equal(await guestModel.ensureCapability(), false);
  assert.equal(guestModel.capabilityStatus, 'guest');
  assert.equal(guestRequests.length, 1, 'guest must not probe protected PluginLinks APIs');

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
  await messageModel.copyAndGotoBoard();
  assert.match(copiedDrafts.at(-1), /^申请交换友链：/);
  assert.match(copiedDrafts.at(-1), /- 联系邮箱：hello@example\.test/);
  assert.match(copiedDrafts.at(-1), /- RSS 链接：https:\/\/example\.test\/rss\.xml/);
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

console.log('PluginLinks 2.2.1 links/feed/self-submit adaptation contract passed');
