import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

export const LINK_FEED_API = '/apis/api.link.halo.run/v1alpha1/linkfeeds';
export const LINK_FEED_CONSOLE_API = '/apis/console.api.link.halo.run/v1alpha1/rss/items';
export const LINK_FEED_UNREAD_SUMMARY_API = `${LINK_FEED_CONSOLE_API}/-/unread-summary`;
export const LINK_DETAIL_API = '/apis/console.api.link.halo.run/v1alpha1/links/-/detail';
export const LINK_FEED_DISCOVERY_API = '/apis/console.api.link.halo.run/v1alpha1/rss/discovery';
export const LINK_MANAGE_API = '/apis/console.api.link.halo.run/v1alpha1/links';
export const LINK_CORE_API = '/apis/core.halo.run/v1alpha1/links';
export const CURRENT_USER_API = '/apis/api.console.halo.run/v1alpha1/users/-';
export const USER_PERMISSIONS_API = '/apis/api.console.halo.run/v1alpha1/users';

const SITE_METADATA_TIMEOUT_MS = 8000;
const CAPABILITY_TIMEOUT_MS = 6000;
const SITE_METADATA_MAX_BYTES = 1_500_000;
const LINK_FEED_PAGE_SIZE = 20;
const HALO_ANONYMOUS_USERNAME = 'anonymousUser';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function textValue(value, maxLength = 0) {
  const text = sanitizePlainText(value);
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

export function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function buildCsrfHeaders(cookie = globalThis.document?.cookie || '') {
  const match = String(cookie).match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!match?.[1]) return {};

  let token = match[1];
  try {
    token = decodeURIComponent(token);
  } catch {
    // 保留原值，让服务端按标准 CSRF 校验拒绝异常令牌。
  }
  return { 'X-XSRF-TOKEN': token };
}

function decodeTextEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  return String(value || '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const radix = String(code).toLowerCase().startsWith('x') ? 16 : 10;
      const valueText = radix === 16 ? String(code).slice(1) : String(code);
      const codePoint = Number.parseInt(valueText, radix);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (match, name) => namedEntities[name.toLowerCase()] || match);
}

export function sanitizePlainText(value) {
  return decodeTextEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

export function resolveMetadataUrl(value, baseUrl) {
  try {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';
    const url = new URL(rawValue, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function readableHost(value) {
  try {
    const host = new URL(String(value || '').trim()).hostname || '';
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return String(value || '').trim();
  }
}

function isJsonResponse(response) {
  return String(response?.headers?.get?.('content-type') || '').toLowerCase().includes('json');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }
  return copied;
}

async function readErrorMessage(response) {
  try {
    const payload = await response.clone().json();
    return String(payload?.detail || payload?.message || payload?.title || '').trim();
  } catch {
    try {
      return String(await response.text() || '').trim();
    } catch {
      return '';
    }
  }
}

function statusError(response, message = '') {
  const error = new Error(String(message || '').trim() || `HTTP ${response?.status || 0}`);
  error.status = Number(response?.status || 0);
  return error;
}

function abortError() {
  return new DOMException('操作已取消', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || abortError();
}

function withTimeout(controller, timeoutMs) {
  return globalThis.setTimeout(() => {
    controller.abort(new DOMException('请求超时', 'TimeoutError'));
  }, timeoutMs);
}

function normalizeCursor(value) {
  return String(value || '').trim();
}

export function buildLinkFeedApiUrl({
  groupName = '',
  linkName = '',
  scope = 'all',
  protectedMode = false,
  beforePublishedAt = '',
  beforeId = '',
  limit = LINK_FEED_PAGE_SIZE
} = {}, baseUrl = globalThis.location?.origin || 'http://localhost') {
  const url = new URL(protectedMode ? LINK_FEED_CONSOLE_API : LINK_FEED_API, baseUrl);
  const resolvedGroup = String(groupName || '').trim();
  const resolvedLink = resolvedGroup ? '' : String(linkName || '').trim();
  const resolvedScope = ['unread', 'favorite', 'later'].includes(scope) ? scope : 'all';
  const resolvedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || LINK_FEED_PAGE_SIZE));

  if (resolvedGroup) url.searchParams.set('groupName', resolvedGroup);
  if (resolvedLink) url.searchParams.set('linkName', resolvedLink);
  if (protectedMode && resolvedScope === 'unread') url.searchParams.set('read', 'false');
  if (protectedMode && resolvedScope === 'favorite') url.searchParams.set('favorite', 'true');
  if (protectedMode && resolvedScope === 'later') url.searchParams.set('readLater', 'true');
  if (beforePublishedAt) url.searchParams.set('beforePublishedAt', normalizeCursor(beforePublishedAt));
  if (beforeId) url.searchParams.set('beforeId', normalizeCursor(beforeId));
  url.searchParams.set('limit', String(resolvedLimit));
  return url;
}

export function normalizeLinkFeedPage(payload) {
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      linkName: String(item?.linkName || '').trim(),
      url: normalizeUrl(item?.url),
      title: textValue(item?.title, 300),
      summary: textValue(item?.summary, 2000),
      author: textValue(item?.author, 160),
      authorUrl: normalizeUrl(item?.authorUrl),
      authorLogo: normalizeUrl(item?.authorLogo),
      publishedAt: String(item?.publishedAt || '').trim(),
      fetchedAt: String(item?.fetchedAt || '').trim(),
      updatedAt: String(item?.updatedAt || '').trim(),
      read: item?.read === true,
      favorite: item?.favorite === true,
      readLater: item?.readLater === true
    }))
    .filter((item) => item.url);

  const nextBeforePublishedAt = normalizeCursor(payload?.nextBeforePublishedAt);
  const nextBeforeId = normalizeCursor(payload?.nextBeforeId);
  return {
    items,
    nextBeforePublishedAt,
    nextBeforeId,
    hasNext: payload?.hasNext === true && Boolean(nextBeforePublishedAt || nextBeforeId)
  };
}

export function formatFeedFailure(response, message = '') {
  const status = Number(response?.status || response || 0);
  const detail = sanitizePlainText(message);
  if (status === 404) return '站点尚未在 PluginLinks 设置中开启“公开 RSS 订阅动态”。';
  if (status === 400) return detail || '朋友圈筛选参数无效，请回到全部动态后重试。';
  if (status === 429) return '朋友圈请求过于频繁，请稍后重试。';
  if (status >= 500) return '朋友圈服务暂时不可用，请稍后重试。';
  return detail || '朋友圈加载失败，请检查网络后重试。';
}

function metadataContent(documentNode, selectors) {
  for (const selector of selectors) {
    const node = documentNode.querySelector(selector);
    const value = node?.getAttribute?.('content') || node?.getAttribute?.('href') || node?.textContent || '';
    const text = sanitizePlainText(value);
    if (text) return text;
  }
  return '';
}

function detectSitePlatform(generator) {
  const value = sanitizePlainText(generator).slice(0, 80);
  const normalized = value.toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('halo')) return 'Halo';
  if (normalized.includes('wordpress')) return 'WordPress';
  if (normalized.includes('typecho')) return 'Typecho';
  if (normalized.includes('hexo')) return 'Hexo';
  if (normalized.includes('hugo')) return 'Hugo';
  if (normalized.includes('ghost')) return 'Ghost';
  return value;
}

export function parseSiteMetadata(html, baseUrl) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('当前浏览器不支持 HTML 元数据解析');
  }

  const documentNode = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const title = metadataContent(documentNode, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'title'
  ]).slice(0, 120);
  const description = metadataContent(documentNode, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ]).slice(0, 500);
  const logo = resolveMetadataUrl(metadataContent(documentNode, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'link[rel~="apple-touch-icon"]',
    'link[rel~="icon"]'
  ]), baseUrl);
  const rssUrl = resolveMetadataUrl(metadataContent(documentNode, [
    'link[rel="alternate"][type="application/rss+xml"]',
    'link[rel="alternate"][type="application/atom+xml"]'
  ]), baseUrl);
  const platform = detectSitePlatform(metadataContent(documentNode, ['meta[name="generator"]']));

  return { title, description, logo, rssUrl, platform };
}

async function fetchSiteMetadata(url, signal) {
  const targetUrl = new URL(url);
  if (typeof window !== 'undefined'
    && window.location?.protocol === 'https:'
    && targetUrl.protocol === 'http:') {
    const error = new Error('mixed-content');
    error.code = 'mixed-content';
    throw error;
  }

  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    },
    signal
  });

  if (!response.ok || response.type === 'opaque' || response.status === 0) {
    const error = new Error(`HTTP ${response.status || 'blocked'}`);
    error.code = 'request-failed';
    error.status = Number(response.status || 0);
    throw error;
  }

  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    const error = new Error(`unsupported-content-type:${contentType}`);
    error.code = 'not-html';
    throw error;
  }

  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > SITE_METADATA_MAX_BYTES) {
    const error = new Error('site-html-too-large');
    error.code = 'too-large';
    throw error;
  }

  const html = await response.text();
  if (!html.trim()) {
    const error = new Error('empty-site-html');
    error.code = 'empty';
    throw error;
  }
  if (new Blob([html]).size > SITE_METADATA_MAX_BYTES) {
    const error = new Error('site-html-too-large');
    error.code = 'too-large';
    throw error;
  }

  const resolvedUrl = normalizeUrl(response.url) || url;
  const metadata = parseSiteMetadata(html, resolvedUrl);
  if (!metadata.title && !metadata.description && !metadata.logo && !metadata.rssUrl && !metadata.platform) {
    const error = new Error('site-metadata-empty');
    error.code = 'empty';
    throw error;
  }
  return metadata;
}

export function formatMetadataFailure(error) {
  if (error?.code === 'mixed-content') {
    return '当前页面使用 HTTPS，浏览器会阻止读取 HTTP 站点';
  }
  if (error?.code === 'not-html') {
    return '目标地址没有返回可识别的网页';
  }
  if (error?.code === 'too-large') {
    return '目标网页内容过大，已停止自动识别';
  }
  if (error?.code === 'timeout' || error?.name === 'TimeoutError') {
    return '目标站点响应超时';
  }
  return '浏览器读取被目标站点的跨域策略或访问规则阻止';
}

export function formatBackendMetadataFailure(error) {
  const status = Number(error?.status || 0);
  if (status === 401) return '当前登录已失效，官方后台识别未执行';
  if (status === 403) return '当前账号没有链接管理权限，官方后台识别被拒绝';
  if (status === 400 || status === 422) return '目标网址未通过官方后台校验';
  if (status === 429) return '官方后台识别请求过于频繁';
  if (status >= 500) return '官方后台识别服务暂时异常';
  if (error?.name === 'TimeoutError') return '官方后台识别请求超时';
  return '官方后台识别请求失败';
}

export function formatCreateFailure(error) {
  const status = Number(error?.status || 0);
  const detail = sanitizePlainText(error?.message || '');
  if (status === 401) return '登录状态已失效，不能直接添加友链。';
  if (status === 403) return '当前账号没有创建链接的权限。';
  if (status === 400 || status === 422) return detail && !/^HTTP\s/i.test(detail)
    ? `链接内容未通过校验：${detail}`
    : '链接内容未通过校验，请检查网址、名称、Logo、分组和 RSS 地址。';
  if (status === 409) return '该网址或链接资源已经存在，请改用修改申请。';
  if (status === 429) return '创建请求过于频繁，请稍后再试。';
  if (status >= 500) return '链接管理服务暂时异常，请稍后再试。';
  return detail && !/^HTTP\s/i.test(detail) ? detail : '直接添加友链失败，请稍后重试。';
}

export function buildPluginLinkPayload(form = {}) {
  const url = normalizeUrl(form.url);
  const logo = normalizeUrl(form.logo);
  const rssUrl = normalizeUrl(form.rssUrl);
  const spec = {
    url,
    displayName: textValue(form.displayName, 120),
    description: textValue(form.description, 500)
  };
  const groupName = String(form.groupName || '').trim();
  if (logo) spec.logo = logo;
  if (groupName) spec.groupName = groupName;
  if (rssUrl) {
    spec.rss = {
      enabled: true,
      feedUrls: [rssUrl]
    };
  }

  return {
    apiVersion: 'core.halo.run/v1alpha1',
    kind: 'Link',
    metadata: {
      name: '',
      generateName: 'link-',
      annotations: {}
    },
    spec
  };
}

function formatFeedTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const valueOf = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${valueOf('year')}年${valueOf('month')}月${valueOf('day')}日 ${valueOf('hour')}:${valueOf('minute')}`;
}

function iconNode(className) {
  const node = document.createElement('span');
  node.className = className;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function externalAnchor(className, href, text = '') {
  const anchor = document.createElement('a');
  anchor.className = className;
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (text) anchor.textContent = text;
  return anchor;
}

function feedOverflowAction({ field, icon, label, displayLabel = label, title = label, checked = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `links-feed-overflow-action${checked ? ' is-active' : ''}`;
  button.dataset.feedAction = field;
  button.title = title;
  button.setAttribute('aria-label', label);
  button.setAttribute('role', 'menuitemcheckbox');
  button.setAttribute('aria-checked', String(checked));
  const actionIcon = iconNode(icon);
  actionIcon.dataset.feedActionIcon = '';
  const actionLabel = document.createElement('span');
  actionLabel.className = 'links-feed-overflow-label';
  actionLabel.dataset.feedActionLabel = '';
  actionLabel.textContent = displayLabel;
  button.append(actionIcon, actionLabel);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick?.();
  });
  return button;
}

function setFeedOverflowOpen(container, open, { focusFirst = false, restoreFocus = false } = {}) {
  if (!container) return;
  const trigger = container.querySelector('.links-feed-overflow-trigger');
  const menu = container.querySelector('.links-feed-overflow-menu');
  if (!trigger || !menu) return;
  container.classList.toggle('is-open', open);
  trigger.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-hidden', String(!open));
  if (open && focusFirst) {
    requestAnimationFrame(() => menu.querySelector('.links-feed-overflow-action')?.focus({ preventScroll: true }));
  } else if (!open && restoreFocus) {
    trigger.focus({ preventScroll: true });
  }
}

function closeFeedOverflowMenus(root, { except = null, restoreFocus = false } = {}) {
  if (!root) return;
  root.querySelectorAll('[data-feed-overflow].is-open').forEach((container) => {
    if (container === except) return;
    setFeedOverflowOpen(container, false, { restoreFocus });
  });
}

function syncFeedOverflowAction(article, field, {
  active = false,
  checked = false,
  icon,
  label,
  displayLabel = label,
  title = label
}) {
  const button = article.querySelector(`[data-feed-action="${field}"]`);
  if (!button) return;
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-checked', String(checked));
  button.setAttribute('aria-label', label);
  button.title = title;
  const actionIcon = button.querySelector('[data-feed-action-icon]');
  if (actionIcon && icon) actionIcon.className = icon;
  const actionLabel = button.querySelector('[data-feed-action-label]');
  if (actionLabel) actionLabel.textContent = displayLabel;
}

function refreshFeedCardState(article, item) {
  article.classList.toggle('is-unread', item.read !== true);
  syncFeedOverflowAction(article, 'favorite', {
    active: item.favorite === true,
    checked: item.favorite === true,
    icon: 'icon-[lucide--star]',
    label: '收藏',
    title: item.favorite ? '取消收藏' : '收藏'
  });
  syncFeedOverflowAction(article, 'later', {
    active: item.readLater === true,
    checked: item.readLater === true,
    icon: 'icon-[lucide--bookmark]',
    label: '稍后阅读',
    displayLabel: '稍后读',
    title: item.readLater ? '移出稍后阅读' : '稍后阅读'
  });
  syncFeedOverflowAction(article, 'read', {
    checked: item.read !== true,
    icon: item.read ? 'icon-[lucide--mail]' : 'icon-[lucide--mail-open]',
    label: '未读',
    title: item.read ? '设为未读' : '设为已读'
  });
}

function createFeedCard(item, {
  protectedMode = false,
  onSourceClick,
  onOpen,
  onToggleFavorite,
  onToggleLater,
  onToggleRead
} = {}) {
  const article = document.createElement('article');
  article.className = 'links-feed-card is-entering';
  article.dataset.feedItem = '';
  article.dataset.feedId = item.id;
  article.dataset.feedLinkName = item.linkName;

  const avatar = externalAnchor('links-feed-avatar', item.authorUrl || item.url);
  avatar.tabIndex = -1;
  avatar.setAttribute('aria-hidden', 'true');
  if (item.authorLogo) {
    const image = document.createElement('img');
    image.src = item.authorLogo;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    avatar.appendChild(image);
  } else {
    avatar.classList.add('is-fallback');
    avatar.appendChild(iconNode('icon-[lucide--rss]'));
  }

  const copy = document.createElement('div');
  copy.className = 'links-feed-copy';
  const head = document.createElement('div');
  head.className = 'links-feed-head';
  head.appendChild(externalAnchor('links-feed-author', item.authorUrl || item.url, item.author || '未知来源'));
  if (item.publishedAt) {
    const time = document.createElement('time');
    time.className = 'links-feed-time';
    time.dateTime = item.publishedAt;
    time.textContent = formatFeedTime(item.publishedAt);
    head.appendChild(time);
  }
  copy.appendChild(head);

  const heading = document.createElement('h2');
  heading.className = 'links-feed-title';
  if (protectedMode) {
    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'links-feed-title-button';
    titleButton.textContent = item.title || '未命名动态';
    titleButton.addEventListener('click', () => onOpen?.(item.id));
    heading.appendChild(titleButton);
  } else {
    heading.appendChild(externalAnchor('', item.url, item.title || '未命名动态'));
  }
  copy.appendChild(heading);
  if (item.summary) {
    const summary = document.createElement('p');
    summary.className = 'links-feed-summary';
    summary.textContent = item.summary;
    copy.appendChild(summary);
  }

  const footer = document.createElement('div');
  footer.className = 'links-feed-footer';
  if (item.linkName) {
    const source = document.createElement('button');
    source.type = 'button';
    source.className = 'links-feed-source-action';
    source.textContent = '只看此来源';
    source.addEventListener('click', () => onSourceClick?.(item.linkName));
    footer.appendChild(source);
  }
  const utilities = document.createElement('div');
  utilities.className = 'links-feed-utilities';
  const original = externalAnchor('links-feed-open', item.url);
  original.setAttribute('aria-label', '阅读原文');
  original.title = '阅读原文';
  original.appendChild(iconNode('icon-[lucide--arrow-up-right]'));
  utilities.appendChild(original);
  if (protectedMode) {
    const overflow = document.createElement('div');
    overflow.className = 'links-feed-overflow';
    overflow.dataset.feedOverflow = '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'links-feed-overflow-trigger';
    trigger.setAttribute('aria-label', '更多操作');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = '更多操作';
    trigger.appendChild(iconNode('icon-[lucide--ellipsis]'));

    const menu = document.createElement('div');
    menu.className = 'links-feed-overflow-menu';
    menu.id = `links-feed-menu-${String(item.id || 'item').replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '动态操作');
    menu.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-controls', menu.id);

    const closeAndRun = (callback) => {
      setFeedOverflowOpen(overflow, false);
      trigger.focus({ preventScroll: true });
      callback?.(item.id);
    };
    const favorite = feedOverflowAction({
      field: 'favorite',
      icon: 'icon-[lucide--star]',
      label: '收藏',
      title: item.favorite ? '取消收藏' : '收藏',
      checked: item.favorite,
      onClick: () => closeAndRun(onToggleFavorite)
    });
    const later = feedOverflowAction({
      field: 'later',
      icon: 'icon-[lucide--bookmark]',
      label: '稍后阅读',
      displayLabel: '稍后读',
      title: item.readLater ? '移出稍后阅读' : '稍后阅读',
      checked: item.readLater,
      onClick: () => closeAndRun(onToggleLater)
    });
    const read = feedOverflowAction({
      field: 'read',
      icon: item.read ? 'icon-[lucide--mail]' : 'icon-[lucide--mail-open]',
      label: '未读',
      title: item.read ? '设为未读' : '设为已读',
      checked: item.read !== true,
      onClick: () => closeAndRun(onToggleRead)
    });
    menu.append(favorite, later, read);
    overflow.append(menu, trigger);

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = !overflow.classList.contains('is-open');
      closeFeedOverflowMenus(article.closest('[data-feed-list]') || article);
      setFeedOverflowOpen(overflow, shouldOpen, { focusFirst: shouldOpen && event.detail === 0 });
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    menu.addEventListener('keydown', (event) => {
      const actions = Array.from(menu.querySelectorAll('.links-feed-overflow-action:not(:disabled)'));
      if (actions.length === 0) return;
      const currentIndex = actions.indexOf(document.activeElement);
      let targetIndex = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (currentIndex + 1) % actions.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + actions.length) % actions.length;
      if (event.key === 'Home') targetIndex = 0;
      if (event.key === 'End') targetIndex = actions.length - 1;
      if (targetIndex >= 0) {
        event.preventDefault();
        actions[targetIndex]?.focus({ preventScroll: true });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setFeedOverflowOpen(overflow, false, { restoreFocus: true });
      }
    });
    overflow.addEventListener('focusout', () => {
      requestAnimationFrame(() => {
        if (!overflow.contains(document.activeElement)) setFeedOverflowOpen(overflow, false);
      });
    });
    utilities.appendChild(overflow);
  }
  footer.appendChild(utilities);
  copy.appendChild(footer);

  article.append(avatar, copy);
  refreshFeedCardState(article, item);
  return article;
}

function currentFilterKey(groupName = '', linkName = '', scope = 'all', protectedMode = false) {
  const mode = protectedMode ? 'console' : 'public';
  const resolvedScope = ['unread', 'favorite', 'later'].includes(scope) ? scope : 'all';
  if (groupName) return `${mode}:group:${groupName}`;
  if (linkName) return `${mode}:link:${linkName}`;
  return `${mode}:${resolvedScope}`;
}

export function normalizeLinkCapabilities(payload = {}, user = null) {
  const uiPermissions = new Set(
    (Array.isArray(payload?.uiPermissions) ? payload.uiPermissions : [])
      .map((permission) => String(permission || '').trim())
      .filter(Boolean)
  );
  const resolvedRoleNames = new Set(
    (Array.isArray(payload?.permissions) ? payload.permissions : [])
      .map((role) => String(role?.metadata?.name || role?.name || '').trim())
      .filter(Boolean)
  );
  const canManage = uiPermissions.has('plugin:links:manage')
    || resolvedRoleNames.has('role-template-link-manage');
  const canReadFeed = canManage
    || uiPermissions.has('plugin:links:view')
    || resolvedRoleNames.has('role-template-link-view');
  return {
    authenticated: Boolean(user),
    username: String(user?.metadata?.name || '').trim(),
    canReadFeed,
    canManage
  };
}

export async function resolveLinkCapabilities(signal) {
  const user = await resolveCurrentUser(signal);
  throwIfAborted(signal);
  if (!user) return normalizeLinkCapabilities({}, null);

  const username = String(user.metadata?.name || '').trim();
  const requestUrl = new URL(
    `${USER_PERMISSIONS_API}/${encodeURIComponent(username)}/permissions`,
    window.location.origin
  );
  const response = await fetch(requestUrl, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal
  });
  if (!response.ok) throw statusError(response, await readErrorMessage(response));
  if (!isJsonResponse(response)) throw statusError(response, '权限接口没有返回 JSON');
  return normalizeLinkCapabilities(await response.json(), user);
}

export function registerLinksExplorer(Alpine) {
  Alpine.data('linksExplorer', () => ({
    activeView: 'links',
    selectedGroup: '',
    selectedLinkKey: '',
    selectedLink: null,
    feedScope: '',
    feedGroupName: '',
    feedLinkName: '',
    mobileDetailOpen: false,
    searchQuery: '',
    sortMode: 'default',
    totalLinks: 0,
    groups: [],
    links: [],
    feedGroups: [],
    feedSources: [],
    allLinksTitle: '全部友链',
    capabilityStatus: 'idle',
    canReadFeed: false,
    canManageLinks: false,
    unreadCount: 0,
    feedStatus: 'unknown',
    feedStatusMessage: '',
    feedItemCount: 0,
    feedHasNext: false,
    feedNextPublishedAt: '',
    feedNextId: '',
    feedLoading: false,
    feedReplacing: false,
    feedLoadedKey: 'all',
    feedItems: [],
    selectedFeedItemId: '',
    selectedFeedItem: null,
    feedActionBusy: {},
    feedActionMessage: '',
    feedRequestController: null,
    capabilityController: null,
    feedGeneration: 0,
    destroyed: false,
    _showBoardHandler: null,
    _popstateHandler: null,
    _windowResizeHandler: null,
    _documentClickHandler: null,
    _documentKeydownHandler: null,
    _windowTransitionTimer: 0,

    init() {
      this.destroyed = false;
      this.readDataset();
      this.applyLocationState(true);
      this._showBoardHandler = () => this.showBoard(true);
      this._popstateHandler = () => this.applyLocationState(false);
      this._windowResizeHandler = () => this.syncWindowLayout();
      this._documentClickHandler = (event) => {
        if (!event.target?.closest?.('[data-feed-overflow]')) this.closeFeedMenus();
      };
      this._documentKeydownHandler = (event) => {
        if (event.key === 'Escape') this.closeFeedMenus({ restoreFocus: true });
      };
      window.addEventListener('links:show-board', this._showBoardHandler);
      window.addEventListener('popstate', this._popstateHandler);
      window.addEventListener('resize', this._windowResizeHandler);
      document.addEventListener('click', this._documentClickHandler);
      document.addEventListener('keydown', this._documentKeydownHandler);
      if (this.activeView === 'friends' && this.detailOpen() && !this.isSavedFeedScope()) this.ensureFeedState();
      this.ensureLinkCapabilities();
      this.$nextTick(() => {
        this.syncWindowLayout();
      });
    },

    destroy() {
      this.destroyed = true;
      this.cancelFeedRequest();
      this.capabilityController?.abort();
      this.capabilityController = null;
      if (this._showBoardHandler) window.removeEventListener('links:show-board', this._showBoardHandler);
      if (this._popstateHandler) window.removeEventListener('popstate', this._popstateHandler);
      if (this._windowResizeHandler) window.removeEventListener('resize', this._windowResizeHandler);
      if (this._documentClickHandler) document.removeEventListener('click', this._documentClickHandler);
      if (this._documentKeydownHandler) document.removeEventListener('keydown', this._documentKeydownHandler);
      window.clearTimeout(this._windowTransitionTimer);
    },

    closeFeedMenus(options = {}) {
      closeFeedOverflowMenus(this.$root, options);
    },

    readDataset() {
      const groupNodes = Array.from(this.$root.querySelectorAll('[data-links-group]'));
      const linkNodes = Array.from(this.$root.querySelectorAll('[data-link-card]'));
      const feedGroupNodes = Array.from(this.$root.querySelectorAll('[data-feed-group]'));
      const feedSourceNodes = Array.from(this.$root.querySelectorAll('[data-feed-source]'));
      this.allLinksTitle = this.$root.dataset.linksAllTitle || '全部友链';

      this.groups = groupNodes.map((node) => ({
        key: node.dataset.groupKey || '',
        label: node.dataset.groupLabel || '',
        synthetic: node.dataset.groupSynthetic === 'true'
      }));
      this.feedGroups = feedGroupNodes.map((node) => ({
        key: node.dataset.feedGroupKey || '',
        label: node.dataset.feedGroupLabel || ''
      }));
      this.feedSources = feedSourceNodes.map((node) => {
        const description = sanitizePlainText(node.dataset.feedLinkDescription || '');
        const descriptionNode = node.querySelector('.links-row-preview');
        if (descriptionNode) descriptionNode.textContent = description || '查看该来源的 RSS 动态';
        node.dataset.feedLinkDescription = description;
        return {
          key: node.dataset.feedLinkKey || '',
          label: sanitizePlainText(node.dataset.feedLinkLabel || ''),
          description,
          logo: normalizeUrl(node.dataset.feedLinkLogo || ''),
          url: normalizeUrl(node.dataset.feedLinkUrl || '')
        };
      });

      this.links = linkNodes.map((node) => {
        const description = sanitizePlainText(node.dataset.linkDescription || '');
        const descriptionNode = node.querySelector('.link-card-desc');
        if (descriptionNode) descriptionNode.textContent = description || '这个站点还没有填写简介。';
        node.dataset.linkDescription = description;
        return {
          key: node.dataset.linkKey || '',
          groupKey: node.dataset.groupKey || '',
          groupLabel: sanitizePlainText(node.dataset.groupLabel || ''),
          name: sanitizePlainText(node.dataset.linkName || ''),
          description,
          url: node.dataset.linkUrl || '',
          logo: normalizeUrl(node.dataset.linkLogo || ''),
          priority: Number(node.dataset.linkPriority || 0),
          createdAt: node.dataset.linkCreated || ''
        };
      });

      this.totalLinks = this.links.length;
      this.selectedLinkKey = this.$root.dataset.linksInitialLink || '';
      this.selectedLink = this.links.find((link) => link.key === this.selectedLinkKey) || null;
      if (!this.selectedLink) this.selectedLinkKey = '';
      this.feedScope = ['all', 'unread', 'favorite', 'later'].includes(this.$root.dataset.linksInitialFeedScope)
        ? this.$root.dataset.linksInitialFeedScope
        : '';
      this.feedItemCount = Number(this.$root.dataset.feedInitialCount || 0);
      this.feedHasNext = this.$root.dataset.feedHasNext === 'true';
      this.feedNextPublishedAt = this.$root.dataset.feedNextPublishedAt || '';
      this.feedNextId = this.$root.dataset.feedNextId || '';
      this.feedLoadedKey = currentFilterKey(
        this.$root.dataset.linksInitialFeedGroup || '',
        this.$root.dataset.linksInitialFeedLink || '',
        this.feedScope,
        false
      );
      const hasPublicSources = this.$root.dataset.feedPublicSources === 'true';
      this.feedStatus = this.feedItemCount > 0 ? 'ready' : hasPublicSources ? 'unknown' : 'empty';
    },

    async ensureLinkCapabilities() {
      this.capabilityController?.abort();
      const controller = new AbortController();
      const timeoutId = withTimeout(controller, CAPABILITY_TIMEOUT_MS);
      this.capabilityController = controller;
      this.capabilityStatus = 'checking';

      try {
        const capabilities = await resolveLinkCapabilities(controller.signal);
        throwIfAborted(controller.signal);
        if (this.destroyed) return;
        this.canReadFeed = capabilities.canReadFeed;
        this.canManageLinks = capabilities.canManage;
        this.capabilityStatus = capabilities.authenticated ? 'ready' : 'guest';
        window.dispatchEvent(new CustomEvent('links:capabilities', { detail: capabilities }));

        if (this.canReadFeed) {
          this.refreshUnreadSummary();
          if (this.activeView === 'friends' && this.detailOpen()) await this.replaceFeed();
        } else if (this.isSavedFeedScope()) {
          this.feedScope = 'all';
          this.selectedFeedItemId = '';
          this.selectedFeedItem = null;
          this.feedStatus = 'unknown';
          this.syncUrl('replace');
          await this.replaceFeed();
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        const status = Number(error?.status || 0);
        this.canReadFeed = false;
        this.canManageLinks = false;
        this.capabilityStatus = status === 401 ? 'guest' : status === 403 ? 'denied' : 'error';
        window.dispatchEvent(new CustomEvent('links:capabilities', {
          detail: { authenticated: status !== 401, canReadFeed: false, canManage: false, error: true }
        }));
        if (this.isSavedFeedScope()) {
          this.feedScope = 'all';
          this.syncUrl('replace');
          this.replaceFeed();
        }
      } finally {
        globalThis.clearTimeout(timeoutId);
        if (this.capabilityController === controller) this.capabilityController = null;
      }
    },

    async refreshUnreadSummary() {
      if (!this.canReadFeed) return;
      try {
        const response = await fetch(LINK_FEED_UNREAD_SUMMARY_API, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw statusError(response, await readErrorMessage(response));
        if (!isJsonResponse(response)) throw statusError(response, '未读统计接口没有返回 JSON');
        const payload = await response.json();
        this.unreadCount = Math.max(0, Number(payload?.totalUnreadCount || 0));
      } catch (error) {
        if (Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403) {
          this.canReadFeed = false;
          this.unreadCount = 0;
        }
      }
    },

    isSavedFeedScope() {
      return this.feedScope === 'favorite' || this.feedScope === 'later';
    },

    clearFeedSelection() {
      this.selectedFeedItemId = '';
      this.selectedFeedItem = null;
    },

    showLinks() {
      this.activeView = 'links';
      this.selectedLinkKey = '';
      this.selectedLink = null;
      this.feedScope = '';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation();
    },

    setGroup(key) {
      this.activeView = 'links';
      this.selectedGroup = this.groups.some((group) => group.key === key) ? key : '';
      this.selectedLinkKey = '';
      this.selectedLink = null;
      this.commitNavigation();
    },

    selectLink(key) {
      const link = this.links.find((item) => item.key === String(key || ''));
      if (!link) return;
      this.activeView = 'links';
      this.selectedLinkKey = link.key;
      this.selectedLink = link;
      if (this.selectedGroup && link.groupKey !== this.selectedGroup) this.selectedGroup = '';
      this.commitNavigation();
    },

    showFriends(scrollToTop = true) {
      this.activeView = 'friends';
      this.selectedLinkKey = '';
      this.selectedLink = null;
      this.feedScope = '';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation({ scrollToTop });
    },

    showAllFeed() {
      this.activeView = 'friends';
      this.feedScope = 'all';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation();
      if (this.feedLoadedKey !== currentFilterKey('', '', 'all', this.canReadFeed)) this.replaceFeed();
      else this.ensureFeedState();
    },

    showUnreadFeed() {
      if (!this.canReadFeed) return;
      this.showFeedScope('unread');
    },

    showSavedFeed(scope) {
      if (!this.canReadFeed || !['favorite', 'later'].includes(scope)) return;
      this.showFeedScope(scope);
    },

    showFeedScope(scope) {
      this.activeView = 'friends';
      this.feedScope = ['all', 'unread', 'favorite', 'later'].includes(scope) ? scope : 'all';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation();
      const nextKey = currentFilterKey('', '', this.feedScope, this.canReadFeed);
      if (this.feedLoadedKey !== nextKey) this.replaceFeed();
      else this.ensureFeedState();
    },

    showFeedGroup(key) {
      const value = String(key || '').trim();
      this.activeView = 'friends';
      this.feedScope = '';
      this.feedGroupName = value;
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation();
      if (this.feedLoadedKey !== currentFilterKey(value, '', 'all', this.canReadFeed)) this.replaceFeed();
      else this.ensureFeedState();
    },

    showFeedSource(key) {
      const value = String(key || '').trim();
      if (!value) return;
      this.activeView = 'friends';
      this.feedScope = '';
      this.feedGroupName = '';
      this.feedLinkName = value;
      this.clearFeedSelection();
      this.commitNavigation();
      if (this.feedLoadedKey !== currentFilterKey('', value, 'all', this.canReadFeed)) this.replaceFeed();
      else this.ensureFeedState();
    },

    showApply() {
      this.activeView = 'apply';
      this.selectedLinkKey = '';
      this.selectedLink = null;
      this.feedScope = '';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation();
      window.dispatchEvent(new CustomEvent('links:submit-open'));
    },

    openSubmitAssistant() {
      this.showApply();
    },

    showBoard(scrollToTop = true) {
      this.activeView = 'board';
      this.selectedLinkKey = '';
      this.selectedLink = null;
      this.feedScope = '';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.clearFeedSelection();
      this.commitNavigation({ scrollToTop });
    },

    collapseDetail() {
      if (this.activeView === 'friends' && this.selectedFeedItem) {
        this.closeFeedItem();
        return;
      }
      if (this.activeView === 'links') {
        this.selectedLinkKey = '';
        this.selectedLink = null;
      } else if (this.activeView === 'friends') {
        this.feedScope = '';
        this.feedGroupName = '';
        this.feedLinkName = '';
        this.clearFeedSelection();
      } else {
        this.activeView = 'links';
      }
      this.commitNavigation();
    },

    commitNavigation({ historyMode = 'push', scrollToTop = true } = {}) {
      this.mobileDetailOpen = this.detailOpen();
      this.syncUrl(historyMode);
      if (scrollToTop) this.scrollActivePaneToTop();
      this.$nextTick(() => this.syncWindowLayout());
    },

    scrollActivePaneToTop() {
      const scroller = this.detailOpen()
        ? this.$root.querySelector('.links-detail-scroll')
        : this.$root.querySelector('.links-list-scroll');
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      scroller?.scrollTo?.({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    },

    syncWindowLayout() {
      const surface = this.$root.closest('[data-window-surface]');
      if (!surface) return;
      const isDesktop = window.innerWidth > 768;
      this.mobileDetailOpen = this.detailOpen();
      if (!isDesktop) {
        surface.style.transition = '';
        return;
      }

      const viewportPadding = 24;
      const compactWidth = 500;
      const expandedWidth = 1120;
      const targetWidth = Math.max(
        Math.min(compactWidth, window.innerWidth - viewportPadding * 2),
        Math.min(this.detailOpen() ? expandedWidth : compactWidth, window.innerWidth - viewportPadding * 2)
      );
      const rect = surface.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - targetWidth - viewportPadding);
      const nextLeft = Math.min(Math.max(viewportPadding, center - targetWidth / 2), maxLeft);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

      window.clearTimeout(this._windowTransitionTimer);
      surface.style.transition = reduceMotion
        ? 'none'
        : 'width 260ms cubic-bezier(0.22, 1, 0.36, 1), left 260ms cubic-bezier(0.22, 1, 0.36, 1)';
      surface.style.width = `${targetWidth}px`;
      surface.style.left = `${nextLeft}px`;
      surface.style.transform = 'none';
      this._windowTransitionTimer = window.setTimeout(() => {
        surface.style.transition = '';
      }, reduceMotion ? 0 : 280);
    },

    applyLocationState(canonicalize = false) {
      if (typeof window === 'undefined') return;
      const previousFeedKey = currentFilterKey(
        this.feedGroupName,
        this.feedLinkName,
        this.feedScope,
        this.canReadFeed
      );
      const url = new URL(window.location.href);
      const requestedView = url.searchParams.get('view') || '';
      const requestedGroup = url.searchParams.get('group') || '';
      const requestedLink = url.searchParams.get('link') || '';
      const requestedScope = url.searchParams.get('scope') || '';
      const requestedFeedItem = String(url.searchParams.get('itemId') || '').trim();
      const requestedFeedGroup = url.searchParams.get('groupName') || '';
      const requestedFeedLink = requestedFeedGroup ? '' : (url.searchParams.get('linkName') || '');
      const validGroup = requestedGroup && this.groups.some((group) => group.key === requestedGroup);
      const resolvedLink = this.links.find((link) => link.key === requestedLink) || null;
      let needsCanonicalUrl = Boolean(requestedView && !['friends', 'apply', 'board'].includes(requestedView));

      this.selectedGroup = '';
      this.selectedLinkKey = '';
      this.selectedLink = null;
      this.feedScope = '';
      this.feedGroupName = '';
      this.feedLinkName = '';
      this.selectedFeedItemId = '';
      this.selectedFeedItem = null;

      if (requestedView === 'board' || requestedView === 'apply') {
        this.activeView = requestedView;
        needsCanonicalUrl = needsCanonicalUrl
          || ['group', 'link', 'scope', 'groupName', 'linkName', 'itemId'].some((name) => url.searchParams.has(name));
      } else if (requestedView === 'friends') {
        this.activeView = 'friends';
        this.feedGroupName = requestedFeedGroup;
        this.feedLinkName = requestedFeedLink;
        this.feedScope = !requestedFeedGroup && !requestedFeedLink
          && ['all', 'unread', 'favorite', 'later'].includes(requestedScope)
          ? requestedScope
          : '';
        this.selectedFeedItemId = requestedFeedItem;
        needsCanonicalUrl = needsCanonicalUrl
          || url.searchParams.has('group')
          || url.searchParams.has('link')
          || (requestedScope && !['all', 'unread', 'favorite', 'later'].includes(requestedScope))
          || (Boolean(requestedFeedGroup) && url.searchParams.has('linkName'))
          || ((requestedFeedGroup || requestedFeedLink) && url.searchParams.has('scope'))
          || (requestedFeedItem && !this.feedScope && !requestedFeedGroup && !requestedFeedLink);
      } else {
        this.activeView = 'links';
        this.selectedGroup = validGroup ? requestedGroup : '';
        this.selectedLink = resolvedLink;
        this.selectedLinkKey = resolvedLink?.key || '';
        if (this.selectedLink && this.selectedGroup && this.selectedLink.groupKey !== this.selectedGroup) {
          this.selectedGroup = '';
          needsCanonicalUrl = true;
        }
        needsCanonicalUrl = needsCanonicalUrl
          || (url.searchParams.has('group') && !validGroup)
          || (url.searchParams.has('link') && !resolvedLink)
          || ['scope', 'groupName', 'linkName', 'itemId'].some((name) => url.searchParams.has(name));
      }

      this.mobileDetailOpen = this.detailOpen();
      if (canonicalize && needsCanonicalUrl) this.syncUrl('replace');
      if (!canonicalize && this.activeView === 'friends' && this.detailOpen()) {
        const nextFeedKey = currentFilterKey(
          this.feedGroupName,
          this.feedLinkName,
          this.feedScope,
          this.canReadFeed
        );
        if (nextFeedKey !== previousFeedKey || nextFeedKey !== this.feedLoadedKey) this.replaceFeed();
        else if (this.selectedFeedItemId) this.restoreSelectedFeedItem(true);
        else this.ensureFeedState();
      }
      this.$nextTick(() => this.syncWindowLayout());
    },

    syncUrl(mode = 'push') {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      for (const name of ['view', 'group', 'link', 'scope', 'groupName', 'linkName', 'itemId']) {
        url.searchParams.delete(name);
      }

      if (this.activeView === 'board' || this.activeView === 'apply') {
        url.searchParams.set('view', this.activeView);
      } else if (this.activeView === 'friends') {
        url.searchParams.set('view', 'friends');
        if (this.feedGroupName) url.searchParams.set('groupName', this.feedGroupName);
        else if (this.feedLinkName) url.searchParams.set('linkName', this.feedLinkName);
        else if (['all', 'unread', 'favorite', 'later'].includes(this.feedScope)) {
          url.searchParams.set('scope', this.feedScope);
        }
        if (this.selectedFeedItemId) url.searchParams.set('itemId', this.selectedFeedItemId);
      } else {
        if (this.selectedGroup) url.searchParams.set('group', this.selectedGroup);
        if (this.selectedLinkKey) url.searchParams.set('link', this.selectedLinkKey);
      }

      const target = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (target === current) return;
      const method = mode === 'replace' ? 'replaceState' : 'pushState';
      window.history[method](window.history.state, '', target);
    },

    cancelFeedRequest() {
      this.feedGeneration += 1;
      this.feedRequestController?.abort();
      this.feedRequestController = null;
      this.feedLoading = false;
      this.feedReplacing = false;
    },

    ensureFeedState() {
      if (this.feedStatus === 'unknown' && !this.feedLoading) this.replaceFeed();
    },

    refreshFeed() {
      this.replaceFeed();
    },

    replaceFeed() {
      return this.fetchFeedPage({ replace: true });
    },

    loadNextFeed() {
      if (!this.feedHasNext || this.feedLoading) return Promise.resolve(false);
      return this.fetchFeedPage({ replace: false });
    },

    async fetchFeedPage({ replace }) {
      if (this.destroyed || this.feedLoading && !replace) return false;
      if (this.isSavedFeedScope() && !this.canReadFeed) return false;
      const protectedMode = this.canReadFeed;
      const filterKey = currentFilterKey(
        this.feedGroupName,
        this.feedLinkName,
        this.feedScope,
        protectedMode
      );
      const generation = this.feedGeneration + 1;
      const controller = new AbortController();
      this.feedGeneration = generation;
      this.feedRequestController?.abort();
      this.feedRequestController = controller;
      this.feedLoading = true;
      this.feedReplacing = replace;
      this.feedStatusMessage = '';
      if (replace && this.feedItemCount === 0) this.feedStatus = 'checking';

      const requestUrl = buildLinkFeedApiUrl({
        groupName: this.feedGroupName,
        linkName: this.feedLinkName,
        scope: this.feedScope || 'all',
        protectedMode,
        beforePublishedAt: replace ? '' : this.feedNextPublishedAt,
        beforeId: replace ? '' : this.feedNextId,
        limit: LINK_FEED_PAGE_SIZE
      }, window.location.origin);

      try {
        const response = await fetch(requestUrl, {
          credentials: protectedMode ? 'same-origin' : 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) throw statusError(response, await readErrorMessage(response));
        if (!isJsonResponse(response)) throw statusError(response, '朋友圈接口没有返回 JSON');
        const page = normalizeLinkFeedPage(await response.json());
        page.items = page.items.map((item) => {
          const source = this.feedSources.find((candidate) => candidate.key === item.linkName);
          return {
            ...item,
            author: item.author || source?.label || '未知来源',
            authorUrl: item.authorUrl || source?.url || item.url,
            authorLogo: item.authorLogo || source?.logo || ''
          };
        });
        throwIfAborted(controller.signal);
        if (this.destroyed || generation !== this.feedGeneration || filterKey !== currentFilterKey(
          this.feedGroupName,
          this.feedLinkName,
          this.feedScope,
          protectedMode
        )) return false;

        const list = this.$root.querySelector('[data-feed-list]');
        if (!list) throw new Error('朋友圈列表容器不存在');
        if (replace) {
          list.replaceChildren();
          this.feedItems = [];
        }
        const knownIds = new Set(Array.from(list.querySelectorAll('[data-feed-id]'), (node) => node.dataset.feedId || ''));
        const fragment = document.createDocumentFragment();
        const inserted = [];
        for (const item of page.items) {
          if (item.id && knownIds.has(item.id)) continue;
          const card = createFeedCard(item, {
            protectedMode,
            onSourceClick: (linkName) => this.showFeedSource(linkName),
            onOpen: (id) => this.openFeedItem(id),
            onToggleFavorite: (id) => this.toggleFeedFavorite(id),
            onToggleLater: (id) => this.toggleFeedReadLater(id),
            onToggleRead: (id) => this.toggleFeedRead(id)
          });
          fragment.appendChild(card);
          inserted.push(card);
          this.feedItems.push(item);
          if (item.id) knownIds.add(item.id);
        }
        list.appendChild(fragment);
        requestAnimationFrame(() => inserted.forEach((card) => card.classList.remove('is-entering')));

        this.feedItemCount = list.querySelectorAll('[data-feed-item]').length;
        this.feedHasNext = page.hasNext;
        this.feedNextPublishedAt = page.nextBeforePublishedAt;
        this.feedNextId = page.nextBeforeId;
        this.feedLoadedKey = filterKey;
        this.feedStatus = this.feedItemCount > 0 ? 'ready' : 'empty';
        if (this.selectedFeedItemId) this.restoreSelectedFeedItem(true);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted || generation !== this.feedGeneration) return false;
        warnApiCall('links', 'PluginLinks 朋友圈加载失败', {
          endpoint: requestUrl.toString(),
          message: error?.message || String(error || ''),
          action: replace ? 'replace-link-feed' : 'append-link-feed',
          hint: protectedMode
            ? '检查当前用户 plugin:links:view 权限与 PluginLinks RSS 缓存。'
            : '检查链接插件的公开 RSS 设置与游标参数。'
        });
        if (replace) {
          this.$root.querySelector('[data-feed-list]')?.replaceChildren();
          this.feedItemCount = 0;
          this.feedHasNext = false;
          this.feedNextPublishedAt = '';
          this.feedNextId = '';
          this.feedLoadedKey = filterKey;
          this.feedItems = [];
          this.selectedFeedItem = null;
        }
        this.feedStatus = !protectedMode && Number(error?.status || 0) === 404 ? 'disabled' : 'error';
        this.feedStatusMessage = protectedMode && [401, 403].includes(Number(error?.status || 0))
          ? '当前登录账号没有读取 RSS 状态的权限。'
          : formatFeedFailure(error?.status || 0, error?.message || '');
        return false;
      } finally {
        if (generation === this.feedGeneration) {
          this.feedLoading = false;
          this.feedReplacing = false;
          if (this.feedRequestController === controller) this.feedRequestController = null;
        }
      }
    },

    restoreSelectedFeedItem(markRead = false) {
      if (!this.selectedFeedItemId) {
        this.selectedFeedItem = null;
        return false;
      }
      const item = this.feedItems.find((candidate) => candidate.id === this.selectedFeedItemId) || null;
      this.selectedFeedItem = item;
      if (item && markRead) this.consumeFeedItem(item);
      return Boolean(item);
    },

    openFeedItem(id) {
      if (!this.canReadFeed) return;
      const item = this.feedItems.find((candidate) => candidate.id === String(id || ''));
      if (!item) return;
      this.selectedFeedItemId = item.id;
      this.selectedFeedItem = item;
      this.feedActionMessage = '';
      this.syncUrl('push');
      this.scrollActivePaneToTop();
      this.consumeFeedItem(item);
    },

    closeFeedItem() {
      const closingItem = this.selectedFeedItem;
      this.clearFeedSelection();
      if (closingItem) this.removeFeedItemIfFiltered(closingItem);
      this.syncUrl('push');
      this.scrollActivePaneToTop();
    },

    removeFeedItemIfFiltered(item) {
      if (!item) return false;
      const excluded = this.feedScope === 'favorite' && !item.favorite
        || this.feedScope === 'later' && !item.readLater
        || this.feedScope === 'unread' && item.read;
      if (!excluded) return false;
      this.feedItems = this.feedItems.filter((candidate) => candidate.id !== item.id);
      this.$root.querySelector(`[data-feed-id="${CSS.escape(item.id)}"]`)?.remove();
      this.feedItemCount = this.$root.querySelectorAll('[data-feed-item]').length;
      this.feedStatus = this.feedItemCount > 0 ? 'ready' : 'empty';
      return true;
    },

    async consumeFeedItem(item) {
      if (!item || !this.canReadFeed) return;
      if (!item.read) await this.setFeedItemState(item.id, 'read', true, { silent: true });
      if (item.readLater) await this.setFeedItemState(item.id, 'later', false, { silent: true });
    },

    isFeedStateBusy(id, field) {
      return this.feedActionBusy[`${id}:${field}`] === true;
    },

    toggleFeedFavorite(id = this.selectedFeedItemId) {
      const item = this.feedItems.find((candidate) => candidate.id === id) || this.selectedFeedItem;
      if (!item) return Promise.resolve(false);
      return this.setFeedItemState(item.id, 'favorite', !item.favorite);
    },

    toggleFeedReadLater(id = this.selectedFeedItemId) {
      const item = this.feedItems.find((candidate) => candidate.id === id) || this.selectedFeedItem;
      if (!item) return Promise.resolve(false);
      return this.setFeedItemState(item.id, 'later', !item.readLater);
    },

    toggleFeedRead(id = this.selectedFeedItemId) {
      const item = this.feedItems.find((candidate) => candidate.id === id) || this.selectedFeedItem;
      if (!item) return Promise.resolve(false);
      return this.setFeedItemState(item.id, 'read', !item.read);
    },

    async setFeedItemState(id, field, value, { silent = false } = {}) {
      if (!this.canReadFeed || !id || !['read', 'favorite', 'later'].includes(field)) return false;
      const busyKey = `${id}:${field}`;
      if (this.feedActionBusy[busyKey]) return false;
      this.feedActionBusy = { ...this.feedActionBusy, [busyKey]: true };
      if (!silent) this.feedActionMessage = '';
      const endpoint = field === 'later' ? 'read-later' : field;
      const parameter = field === 'later' ? 'readLater' : field;
      const requestUrl = new URL(
        `${LINK_FEED_CONSOLE_API}/${encodeURIComponent(id)}/${endpoint}`,
        window.location.origin
      );
      requestUrl.searchParams.set(parameter, String(Boolean(value)));

      try {
        const response = await fetch(requestUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { Accept: 'application/json', ...buildCsrfHeaders() }
        });
        if (!response.ok) throw statusError(response, await readErrorMessage(response));
        const item = this.feedItems.find((candidate) => candidate.id === id);
        if (item) {
          const previousRead = item.read;
          item[field === 'later' ? 'readLater' : field] = Boolean(value);
          if (field === 'read' && previousRead !== item.read) {
            this.unreadCount = Math.max(0, this.unreadCount + (item.read ? -1 : 1));
          }
          const node = this.$root.querySelector(`[data-feed-id="${CSS.escape(id)}"]`);
          if (node) refreshFeedCardState(node, item);
        }
        if (this.selectedFeedItem?.id === id) {
          this.selectedFeedItem = { ...this.selectedFeedItem, [field === 'later' ? 'readLater' : field]: Boolean(value) };
        } else if (item) {
          this.removeFeedItemIfFiltered(item);
        }
        return true;
      } catch (error) {
        this.feedActionMessage = `状态更新失败：${Number(error?.status || 0) ? `HTTP ${error.status}` : '网络或服务异常'}`;
        warnApiCall('links', 'PluginLinks RSS 状态更新失败', {
          endpoint: requestUrl.toString(),
          message: error?.message || String(error || ''),
          action: `update-feed-${field}`,
          hint: '检查当前用户 plugin:links:view 权限与 CSRF 会话。'
        });
        return false;
      } finally {
        const nextBusy = { ...this.feedActionBusy };
        delete nextBusy[busyKey];
        this.feedActionBusy = nextBusy;
      }
    },

    detailOpen() {
      if (this.activeView === 'links') return Boolean(this.selectedLink);
      if (this.activeView === 'friends') return Boolean(
        ['all', 'unread', 'favorite', 'later'].includes(this.feedScope)
        || this.feedGroupName
        || this.feedLinkName
      );
      return this.activeView === 'apply' || this.activeView === 'board';
    },

    isLinkActive(key) {
      return this.activeView === 'links' && this.selectedLinkKey === String(key || '');
    },

    matchesFeedSource(el) {
      const query = normalizeText(this.searchQuery);
      if (!query) return true;
      return [
        el?.dataset?.feedLinkLabel || '',
        el?.dataset?.feedLinkDescription || ''
      ].map(normalizeText).join(' ').includes(query);
    },

    readableLinkHost(url) {
      return readableHost(url || '');
    },

    feedPublishedLabel(value) {
      return formatFeedTime(value);
    },

    detailTitle() {
      if (this.activeView === 'apply') return '添加友链';
      if (this.activeView === 'board') return '留言板';
      if (this.activeView === 'friends') return this.selectedFeedItem?.title || this.activeFeedLabel();
      return this.selectedLink?.name || '链接详情';
    },

    detailSubtitle() {
      if (this.activeView === 'apply') return '添加或申请友链';
      if (this.activeView === 'board') return '友链申请与站点留言';
      if (this.activeView === 'friends') {
        if (this.selectedFeedItem) return this.selectedFeedItem.author || 'RSS 动态';
        if (this.feedLoading && this.feedReplacing) return '正在更新…';
        return `${this.feedItemCount} 条动态`;
      }
      return this.selectedLink ? readableHost(this.selectedLink.url) : '';
    },

    isGroupActive(key) {
      return (this.selectedGroup || '') === (key || '');
    },

    isFeedGroupActive(key) {
      return !this.feedLinkName && this.feedGroupName === String(key || '');
    },

    isFeedLinkActive(key) {
      return !this.feedGroupName && this.feedLinkName === String(key || '');
    },

    matchesLink(link) {
      if (!link || this.activeView === 'friends') return false;
      if (this.selectedGroup && link.groupKey !== this.selectedGroup) return false;
      const query = normalizeText(this.searchQuery);
      if (!query) return true;
      return [link.name, link.description, link.url].map(normalizeText).join(' ').includes(query);
    },

    shouldShowLink(el) {
      const key = el?.dataset?.linkKey || '';
      return this.matchesLink(this.links.find((item) => item.key === key));
    },

    hasVisibleGroup(groupKey) {
      return this.links.some((link) => link.groupKey === groupKey && this.matchesLink(link));
    },

    groupVisibleCount(groupKey) {
      return this.links.filter((link) => link.groupKey === groupKey && this.matchesLink(link)).length;
    },

    visibleCount() {
      return this.links.filter((link) => this.matchesLink(link)).length;
    },

    linkHost(el) {
      return readableHost(el?.dataset?.linkUrl || '');
    },

    sortedVisibleLinks() {
      return this.links.filter((link) => this.matchesLink(link)).slice().sort((left, right) => {
        if (this.sortMode === 'name') return normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-CN');
        if (this.sortMode === 'recent') {
          const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
          const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
          if (leftTime !== rightTime) return rightTime - leftTime;
          return normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-CN');
        }
        if (left.priority !== right.priority) return Number(right.priority || 0) - Number(left.priority || 0);
        return normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-CN');
      });
    },

    activeGroupLabel() {
      if (!this.selectedGroup) return this.allLinksTitle;
      return this.groups.find((group) => group.key === this.selectedGroup)?.label || '当前分组';
    },

    activeFeedLabel() {
      if (this.feedScope === 'favorite') return '收藏';
      if (this.feedScope === 'later') return '稍后阅读';
      if (this.feedScope === 'unread') return '未读动态';
      if (this.feedLinkName) return this.feedSources.find((source) => source.key === this.feedLinkName)?.label || '当前来源';
      if (this.feedGroupName) return this.feedGroups.find((group) => group.key === this.feedGroupName)?.label || '当前分组动态';
      return '朋友圈';
    },

    activeFeedSource() {
      if (!this.feedLinkName) return null;
      return this.feedSources.find((source) => source.key === this.feedLinkName) || null;
    },

    activeHeaderTitle() {
      if (this.activeView === 'apply') return '添加友链';
      if (this.activeView === 'board') return '留言板';
      if (this.activeView === 'friends') return this.activeFeedLabel();
      return this.activeGroupLabel();
    },

    resultSummary() {
      if (this.activeView === 'apply') return '自动识别当前账号可用的提交方式';
      if (this.activeView === 'board') return '友链申请与站点留言';
      if (this.activeView === 'friends') {
        if (this.feedLoading && this.feedReplacing) return '正在更新动态…';
        if (this.feedStatus === 'disabled') return '公开 RSS 动态未开启';
        if (this.feedStatus === 'error') return '动态加载失败';
        if (this.feedStatus === 'checking') return '正在确认公开状态…';
        return `${this.feedItemCount} 条动态已加载`;
      }
      const count = this.visibleCount();
      if (this.searchQuery.trim()) return `${count} 个搜索结果`;
      if (this.selectedGroup) return `${count} 个友链`;
      return `共 ${this.totalLinks} 个友链`;
    },

    emptyTitle() {
      return this.searchQuery.trim() ? '没有匹配的友链' : '该分组暂无友链';
    },

    emptyText() {
      if (this.searchQuery.trim()) return `换一个关键词，或者回到${this.allLinksTitle}继续浏览。`;
      return `这个分组还没有收录站点，可以返回${this.allLinksTitle}继续浏览。`;
    },

    feedStatusTitle() {
      if (this.feedScope === 'favorite' && this.feedStatus === 'empty') return '还没有收藏内容';
      if (this.feedScope === 'later' && this.feedStatus === 'empty') return '稍后阅读是空的';
      if (this.feedScope === 'unread' && this.feedStatus === 'empty') return '动态都已读完';
      if (this.feedStatus === 'disabled') return '朋友圈暂未公开';
      if (this.feedStatus === 'error') return '朋友圈加载失败';
      if (this.feedStatus === 'empty') return this.feedGroupName || this.feedLinkName ? '当前来源暂无动态' : '这里还没有 RSS 动态';
      if (this.feedStatus === 'checking' || this.feedStatus === 'unknown') return '正在确认朋友圈状态';
      return '这里还没有 RSS 动态';
    },

    feedStatusText() {
      if (this.feedStatusMessage) return this.feedStatusMessage;
      if (this.feedStatus === 'disabled') return '管理员可在链接管理插件的 RSS 订阅设置中开启公开动态。';
      if (this.feedStatus === 'empty') return this.feedGroupName || this.feedLinkName
        ? '可以切换到全部动态，或等待该来源下次同步。'
        : this.canReadFeed
          ? '收藏或稍后阅读的内容会保存在 PluginLinks 中；未读状态也会在这里同步。'
          : '请在 PluginLinks 中启用友链 RSS 和公开动态；完成首次抓取后，内容会显示在这里。';
      if (this.feedStatus === 'checking' || this.feedStatus === 'unknown') return '不会显示骨架屏，确认完成后会直接展示结果。';
      return '请稍后重试。';
    },

    feedStatusIcon() {
      if (this.feedScope === 'favorite') return 'icon-[lucide--star]';
      if (this.feedScope === 'later') return 'icon-[lucide--bookmark]';
      if (this.feedScope === 'unread') return 'icon-[lucide--mail-check]';
      if (this.feedStatus === 'disabled') return 'icon-[lucide--lock-keyhole]';
      if (this.feedStatus === 'error') return 'icon-[lucide--circle-alert]';
      if (this.feedStatus === 'checking' || this.feedStatus === 'unknown') return 'icon-[lucide--loader-circle] is-spinning';
      return 'icon-[lucide--rss]';
    },

    cardOrder(el) {
      const key = el?.dataset?.linkKey || '';
      if (!key) return 0;
      const index = this.sortedVisibleLinks().findIndex((link) => link.key === key);
      return index >= 0 ? index : 0;
    }
  }));
}

async function resolveCurrentUser(signal) {
  const response = await fetch(CURRENT_USER_API, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal
  });
  if (response.status === 401 || response.status === 403 || response.redirected || !isJsonResponse(response)) return null;
  if (!response.ok) throw statusError(response, await readErrorMessage(response));
  const payload = await response.json();
  const user = payload?.user || payload;
  const username = String(user?.metadata?.name || '').trim();
  if (!username || username === HALO_ANONYMOUS_USERNAME || user?.spec?.disabled === true) return null;
  return user;
}

async function fetchOfficialLinkDetail(url, signal) {
  const detailUrl = new URL(LINK_DETAIL_API, window.location.origin);
  detailUrl.searchParams.set('url', url);
  const discoveryUrl = new URL(LINK_FEED_DISCOVERY_API, window.location.origin);
  discoveryUrl.searchParams.set('url', url);

  const fetchOfficial = async (requestUrl) => {
    const response = await fetch(requestUrl, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal
    });
    if (!response.ok) throw statusError(response, await readErrorMessage(response));
    if (!isJsonResponse(response)) throw statusError(response, '官方接口没有返回 JSON');
    return response.json();
  };

  const [detailResult, discoveryResult] = await Promise.allSettled([
    fetchOfficial(detailUrl),
    fetchOfficial(discoveryUrl)
  ]);
  throwIfAborted(signal);
  if (detailResult.status === 'rejected') throw detailResult.reason;
  const detail = detailResult.value || {};
  const feedUrls = discoveryResult.status === 'fulfilled' && Array.isArray(discoveryResult.value?.feedUrls)
    ? discoveryResult.value.feedUrls.map(normalizeUrl).filter(Boolean)
    : [];
  return {
    title: textValue(detail.title, 120),
    description: textValue(detail.description, 500),
    logo: normalizeUrl(detail.icon) || normalizeUrl(detail.image),
    rssUrl: feedUrls[0] || '',
    platform: 'PluginLinks 官方识别',
    discoveryError: discoveryResult.status === 'rejected' ? discoveryResult.reason : null
  };
}

export function registerLinkSubmitForm(Alpine) {
  Alpine.data('linkSubmitForm', () => ({
    form: {
      type: 'add',
      displayName: '',
      url: '',
      logo: '',
      email: '',
      description: '',
      updateDescription: '',
      groupName: '',
      rssUrl: ''
    },
    detail: {
      displayName: '',
      description: '',
      logo: '',
      platform: ''
    },
    submitGroups: [],
    capabilityStatus: 'idle',
    canManage: false,
    capabilityController: null,
    capabilityPromise: null,
    submitting: false,
    submitted: false,
    markdown: '',
    previewVisible: false,
    fetchingMeta: false,
    autofillController: null,
    autofillGeneration: 0,
    autofillSnapshot: null,
    destroyed: false,
    copied: false,
    _openHandler: null,
    _capabilitiesHandler: null,
    result: {
      show: false,
      success: false,
      warning: false,
      message: ''
    },

    init() {
      this.destroyed = false;
      this.submitGroups = Array.from(this.$root.querySelectorAll('[data-submit-group-option]'), (option) => ({
        groupName: option.value,
        displayName: option.textContent?.trim() || option.value
      })).filter((group) => group.groupName);
      this._openHandler = () => this.prepareOpen();
      this._capabilitiesHandler = (event) => this.applyCapabilitySnapshot(event.detail || {});
      window.addEventListener('links:submit-open', this._openHandler);
      window.addEventListener('links:capabilities', this._capabilitiesHandler);
    },

    destroy() {
      this.destroyed = true;
      this.cancelAutofill();
      this.capabilityController?.abort();
      this.capabilityController = null;
      this.capabilityPromise = null;
      if (this._openHandler) window.removeEventListener('links:submit-open', this._openHandler);
      if (this._capabilitiesHandler) window.removeEventListener('links:capabilities', this._capabilitiesHandler);
    },

    prepareOpen() {
      this.result.show = false;
    },

    applyCapabilitySnapshot(capabilities) {
      this.canManage = capabilities?.canManage === true;
      this.capabilityStatus = !capabilities?.authenticated
        ? 'guest'
        : this.canManage ? 'manager' : capabilities?.error ? 'error' : 'denied';
    },

    async ensureCapability(force = false) {
      if (!force && this.capabilityPromise) return this.capabilityPromise;
      if (!force && ['manager', 'guest', 'denied'].includes(this.capabilityStatus)) return this.canManage;
      this.capabilityController?.abort();
      const controller = new AbortController();
      const timeoutId = withTimeout(controller, CAPABILITY_TIMEOUT_MS);
      this.capabilityController = controller;
      this.capabilityStatus = 'checking';
      this.canManage = false;

      this.capabilityPromise = (async () => {
        try {
          const capabilities = await resolveLinkCapabilities(controller.signal);
          throwIfAborted(controller.signal);
          this.canManage = capabilities.canManage;
          this.capabilityStatus = !capabilities.authenticated
            ? 'guest'
            : capabilities.canManage ? 'manager' : 'denied';
          return this.canManage;
        } catch (error) {
          if (error?.name === 'AbortError') return false;
          const status = Number(error?.status || 0);
          this.canManage = false;
          this.capabilityStatus = status === 401 ? 'guest' : status === 403 ? 'denied' : 'error';
          this.result = {
            show: true,
            success: false,
            warning: true,
            message: status === 403
              ? '当前账号没有链接管理权限，已切换为留言申请。'
              : `官方权限检查失败（${status ? `HTTP ${status}` : '网络或服务异常'}），已切换为留言申请。`
          };
          return false;
        } finally {
          globalThis.clearTimeout(timeoutId);
          if (this.capabilityController === controller) this.capabilityController = null;
          this.capabilityPromise = null;
        }
      })();
      return this.capabilityPromise;
    },

    capabilityIcon() {
      if (this.capabilityStatus === 'checking') return 'icon-[lucide--loader-circle] is-spinning';
      if (this.canManage && this.form.type === 'add') return 'icon-[lucide--shield-check]';
      if (this.capabilityStatus === 'denied' || this.capabilityStatus === 'error') return 'icon-[lucide--shield-alert]';
      return 'icon-[lucide--message-circle]';
    },

    capabilityLabel() {
      if (this.capabilityStatus === 'checking') return '正在确认提交方式';
      if (this.canManage && this.form.type === 'add') return '管理员直连';
      if (this.canManage) return '修改申请 · 留言确认';
      if (this.capabilityStatus === 'denied') return '已登录 · 无链接管理权限';
      if (this.capabilityStatus === 'error') return '权限检查失败 · 安全降级';
      return '访客申请';
    },

    capabilityDescription() {
      if (this.capabilityStatus === 'checking') return '只检查当前 Halo 会话，不会请求目标站点。';
      if (this.canManage && this.form.type === 'add') return '识别和创建均通过站点受保护接口完成。';
      if (this.canManage) return '修改已有链接仍生成申请内容，避免直接覆盖。';
      if (this.capabilityStatus === 'denied') return '不会尝试受保护写入，只生成可复制的申请内容。';
      if (this.capabilityStatus === 'error') return '为避免误用后台能力，本次只使用访客申请流程。';
      return '浏览器识别目标站点，确认后复制申请到留言板。';
    },

    cancelAutofill() {
      this.autofillGeneration += 1;
      this.autofillController?.abort();
      this.autofillController = null;
      this.fetchingMeta = false;
    },

    async fillFromUrl() {
      this.cancelAutofill();
      const normalized = normalizeUrl(this.form.url);
      this.copied = false;
      this.submitted = false;
      if (!normalized) {
        this.result = { show: true, success: false, warning: false, message: '请先输入有效的 HTTP 或 HTTPS 网站地址。' };
        return;
      }
      this.clearStaleAutofill(normalized);
      this.previewVisible = true;
      this.applyManualDraft(normalized);
      this.result.show = false;
    },

    async autofillFromUrl() {
      this.cancelAutofill();
      const normalized = normalizeUrl(this.form.url);
      this.copied = false;
      this.submitted = false;
      if (!normalized) {
        this.result = { show: true, success: false, warning: false, message: '请先输入有效的 HTTP 或 HTTPS 网站地址。' };
        return;
      }

      await this.ensureCapability();
      if (this.destroyed) return;
      this.clearStaleAutofill(normalized);
      this.fetchingMeta = true;
      this.previewVisible = true;
      this.result.show = false;
      const controller = new AbortController();
      const generation = ++this.autofillGeneration;
      const timeoutId = withTimeout(controller, SITE_METADATA_TIMEOUT_MS);
      this.autofillController = controller;
      const isLatest = () => !this.destroyed
        && generation === this.autofillGeneration
        && normalizeUrl(this.form.url) === normalized;
      let backendError = null;

      try {
        let metadata = null;
        if (this.canManage) {
          try {
            metadata = await fetchOfficialLinkDetail(normalized, controller.signal);
            if (metadata.discoveryError) {
              this.result = {
                show: true,
                success: false,
                warning: true,
                message: `${formatBackendMetadataFailure(metadata.discoveryError)}，站点基本信息已识别，RSS 请手动确认。`
              };
            }
          } catch (error) {
            backendError = error;
            const status = Number(error?.status || 0);
            if (status === 401 || status === 403) {
              this.canManage = false;
              this.capabilityStatus = status === 401 ? 'guest' : 'denied';
            }
          }
        }

        if (!metadata) {
          metadata = await fetchSiteMetadata(normalized, controller.signal);
          if (backendError) {
            this.result = {
              show: true,
              success: false,
              warning: true,
              message: `${formatBackendMetadataFailure(backendError)}，已改用浏览器识别。`
            };
          }
        }

        throwIfAborted(controller.signal);
        if (!isLatest()) return;
        this.detail = {
          displayName: metadata?.title || readableHost(normalized) || '待确认站点',
          description: metadata?.description || '',
          logo: metadata?.logo || '',
          platform: metadata?.platform || ''
        };
        this.syncFormFromDetail(normalized, true);
        this.form.rssUrl = metadata?.rssUrl || this.form.rssUrl;
        this.autofillSnapshot = {
          url: normalized,
          displayName: this.form.displayName,
          description: this.form.description,
          logo: this.form.logo,
          rssUrl: this.form.rssUrl
        };
        this.markdown = this.buildMarkdown(normalized);
      } catch (error) {
        if (!isLatest()) return;
        if (error?.name === 'AbortError' && controller.signal.reason?.name !== 'TimeoutError') return;
        if (controller.signal.reason?.name === 'TimeoutError') error.code = 'timeout';
        warnApiCall('links', '友链站点识别失败，已保留手动填写', {
          endpoint: normalized,
          message: error?.message || String(error || ''),
          action: 'generate-manual-draft',
          hint: '访客检查目标站 CORS；管理员检查 PluginLinks detail/discovery 权限与目标 URL。'
        });
        this.applyManualDraft(normalized);
        this.result = {
          show: true,
          success: false,
          warning: true,
          message: `${backendError ? `${formatBackendMetadataFailure(backendError)}；` : ''}${formatMetadataFailure(error)}。网址已保留，请手动填写。`
        };
      } finally {
        globalThis.clearTimeout(timeoutId);
        if (this.autofillController === controller) {
          this.autofillController = null;
          this.fetchingMeta = false;
        }
      }
    },

    applyManualDraft(url) {
      this.detail = {
        displayName: readableHost(url) || '待确认站点',
        description: '',
        logo: '',
        platform: ''
      };
      this.syncFormFromDetail(url, false);
      this.markdown = this.buildMarkdown(url);
    },

    clearStaleAutofill(url) {
      const snapshot = this.autofillSnapshot;
      if (!snapshot || snapshot.url === url) return;
      for (const field of ['displayName', 'description', 'logo', 'rssUrl']) {
        if (this.form[field] === snapshot[field]) this.form[field] = '';
      }
      this.autofillSnapshot = null;
      this.detail = { displayName: '', description: '', logo: '', platform: '' };
    },

    syncFormFromDetail(url, preferDetail = true) {
      this.form.url = url;
      if (preferDetail) {
        this.form.displayName = this.detail.displayName || this.form.displayName;
        this.form.description = this.detail.description || this.form.description;
        this.form.logo = this.detail.logo || this.form.logo;
        return;
      }
      this.form.displayName = this.form.displayName || this.detail.displayName;
    },

    onTypeChange() {
      this.submitted = false;
      this.copied = false;
      this.markdown = this.buildMarkdown(this.form.url);
    },

    isUpdateMode() {
      return this.form.type === 'update';
    },

    isDirectCreateMode() {
      return this.canManage && !this.isUpdateMode();
    },

    isMessageMode() {
      return !this.isDirectCreateMode();
    },

    canCreateDirect() {
      if (this.submitting || this.submitted || this.fetchingMeta || !this.isDirectCreateMode()) return false;
      if (!normalizeUrl(this.form.url)) return false;
      if (!String(this.form.displayName || '').trim()) return false;
      if (!String(this.form.description || '').trim()) return false;
      if (this.form.logo && !normalizeUrl(this.form.logo)) return false;
      if (this.form.rssUrl && !normalizeUrl(this.form.rssUrl)) return false;
      return true;
    },

    canCopyDraft() {
      if (this.fetchingMeta || !this.isMessageMode()) return false;
      if (!normalizeUrl(this.form.url)) return false;
      if (!String(this.form.displayName || '').trim()) return false;
      if (!String(this.form.description || '').trim()) return false;
      if (this.isUpdateMode() && !String(this.form.updateDescription || '').trim()) return false;
      return true;
    },

    primaryActionLabel() {
      if (this.isDirectCreateMode()) {
        if (this.submitted) return '已添加';
        if (this.submitting) return '正在添加…';
        return '添加到链接管理';
      }
      if (this.isUpdateMode()) return this.copied ? '已复制' : '复制修改申请到留言板';
      return this.copied ? '已复制' : '复制并前往留言板';
    },

    primaryActionNote() {
      if (this.isDirectCreateMode()) return this.submitted
        ? '链接已经写入 PluginLinks，刷新页面后可见。'
        : '将通过 Halo 受保护的标准 Link CRUD 接口直接创建。';
      if (this.isUpdateMode()) return '修改申请不会直接覆盖现有链接，由管理员确认后处理。';
      return '访客没有公开写入接口；复制后会切换到留言板。';
    },

    async createLink() {
      if (!this.canCreateDirect()) return;
      this.submitting = true;
      this.result.show = false;
      const payload = buildPluginLinkPayload(this.form);

      try {
        const response = await fetch(LINK_CORE_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...buildCsrfHeaders()
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw statusError(response, await readErrorMessage(response));
        this.submitted = true;
        this.result = {
          show: true,
          success: true,
          warning: false,
          message: '友链已添加到 PluginLinks。'
        };
      } catch (error) {
        const status = Number(error?.status || 0);
        if (status === 401 || status === 403) {
          this.canManage = false;
          this.capabilityStatus = status === 401 ? 'guest' : 'denied';
        }
        warnApiCall('links', 'PluginLinks 官方创建接口失败', {
          endpoint: LINK_CORE_API,
          message: error?.message || String(error || ''),
          action: 'create-link',
          hint: '检查当前用户 links 资源权限与 LinkSpec/groupName/rss 字段。'
        });
        this.result = {
          show: true,
          success: false,
          warning: false,
          message: `${formatCreateFailure(error)}${status === 401 || status === 403 ? ' 已切换为留言申请。' : ''}`
        };
      } finally {
        this.submitting = false;
      }
    },

    buildMarkdown(url = this.form.url) {
      const normalized = normalizeUrl(url) || String(url || '').trim();
      const lines = [
        this.form.type === 'update' ? '申请修改友链：' : '申请交换友链：',
        `- 网站名称：${this.form.displayName || this.detail.displayName || '请补充网站名称'}`,
        `- 网站地址：${normalized || '请补充网站地址'}`,
        `- Logo：${this.form.logo || this.detail.logo || '请补充 Logo 地址'}`,
        `- 网站描述：${this.form.description || this.detail.description || '请补充一句话简介'}`
      ];
      if (this.form.email) lines.push(`- 联系邮箱：${this.form.email}`);
      if (this.form.groupName) {
        const group = this.submitGroups.find((item) => item.groupName === this.form.groupName);
        lines.push(`- 申请分组：${group?.displayName || this.form.groupName}`);
      }
      if (this.form.rssUrl) lines.push(`- RSS 链接：${this.form.rssUrl}`);
      if (this.form.type === 'update' && this.form.updateDescription) lines.push(`- 修改说明：${this.form.updateDescription}`);
      return lines.join('\n');
    },

    async copyAndGotoBoard() {
      if (!this.canCopyDraft()) return;
      const markdown = this.buildMarkdown(this.form.url);
      this.markdown = markdown;
      try {
        const copied = await copyText(markdown);
        this.copied = copied;
        this.result = {
          show: true,
          success: copied,
          warning: false,
          message: copied ? '申请内容已复制，请粘贴到留言板。' : '复制失败，请手动复制申请内容。'
        };
        if (copied) {
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('links:show-board'));
          }, 240);
        }
      } catch {
        this.result = { show: true, success: false, warning: false, message: '复制失败，请手动复制申请内容。' };
      }
    }
  }));
}
