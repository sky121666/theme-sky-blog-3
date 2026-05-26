import { registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';
import { resolveMomentsAppProtocol } from './protocol.js';
import { setupMomentInteractions } from './interactions.js';
import { setupMomentPublish } from './publish.js';

function setupMomentsScrollChrome(root = document) {
  const appRoot = root && typeof root === 'object' ? root : document;
  const win = appRoot.closest?.('.moments-window')
    || appRoot.querySelector?.('.moments-window')
    || document.querySelector('.moments-window');
  if (!win) return null;

  const body = appRoot.closest?.('.moments-body')
    || win.querySelector('.moments-body');
  const bar = win.querySelector('.window-titlebar');
  if (!body || !bar) return null;

  if (body._momentsScrollFn) {
    body.removeEventListener('scroll', body._momentsScrollFn);
    body._momentsScrollFn = null;
  }

  const isFeed = !!body.querySelector('.moments-app--feed');
  if (!isFeed) {
    bar.classList.remove('scrolled');
    return () => {
      bar.classList.remove('scrolled');
    };
  }

  function onScroll() {
    const cover = body.querySelector('.moments-cover');
    const threshold = cover ? cover.offsetHeight - 48 : 200;
    bar.classList.toggle('scrolled', body.scrollTop > threshold);
  }

  body._momentsScrollFn = onScroll;
  body.addEventListener('scroll', onScroll, { passive: true });

  let tries = 0;
  (function poll() {
    const cover = body.querySelector('.moments-cover');
    if ((cover && cover.offsetHeight > 0) || tries > 20) {
      onScroll();
      return;
    }
    tries += 1;
    requestAnimationFrame(poll);
  })();

  return () => {
    if (body._momentsScrollFn) {
      body.removeEventListener('scroll', body._momentsScrollFn);
      body._momentsScrollFn = null;
    }
    bar.classList.remove('scrolled');
  };
}

const MOMENT_NOTIFICATION_PAGE_SIZE = 10;
const MOMENT_NOTIFICATION_FETCH_SIZE = 50;
const MOMENT_NOTIFICATION_USER_ENDPOINT = '/apis/api.console.halo.run/v1alpha1/users/-';
const MOMENT_NOTIFICATION_ENDPOINT = '/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications';
const MOMENT_NOTIFICATION_MARK_READ_ENDPOINT = '/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications/{name}/mark-as-read';
const HALO_ANONYMOUS_USERNAME = 'anonymousUser';

function stripHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function firstImageFromHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return template.content.querySelector('img')?.getAttribute('src') || '';
}

function firstLinkFromHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return template.content.querySelector('a[href]')?.getAttribute('href') || '';
}

function normalizeMomentHref(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw, window.location.origin);
    if (/^\/moments(?:\/|\?|#|$)/i.test(url.pathname)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return raw;
  } catch (_error) {
    return raw;
  }
}

function textFromSelector(value = '', selector = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return stripHtml(template.content.querySelector(selector)?.innerHTML || '');
}

function targetTextFromHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  const anchor = template.content.querySelector('a[href]');
  return stripHtml(anchor?.innerHTML || '');
}

function recipientFromNotification(html = '', raw = '') {
  const honorific = textFromSelector(html, '.honorific');
  const source = honorific || stripHtml(raw);
  const match = source.match(/@?([\w\u4e00-\u9fa5.-]+)\s*你好/);
  return match?.[1]?.trim() || '';
}

function interactionFromTitle(title = '', raw = '') {
  const source = `${title} ${stripHtml(raw)}`.replace(/\s+/g, ' ').trim();
  const actorMatch = source.match(/^(.+?)\s*(评论了|回复了|回复)/);
  const actor = actorMatch?.[1]?.trim() || '访客';
  const verb = actorMatch?.[2] || '';
  const isReply = verb.includes('回复') || /回复了你的评论|回复你/.test(source);
  const object = /你的评论|回复你/.test(source) ? '你' : '你的瞬间';
  const action = isReply ? '回复' : '评论';
  return { actor, action, object };
}

function isJsonResponse(response) {
  return (response.headers.get('content-type') || '').includes('application/json');
}

async function fetchJson(url, signal) {
  const response = await fetch(url.toString(), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  });
  return response;
}

async function resolveCurrentUsername(endpoint, signal) {
  const response = await fetchJson(new URL(endpoint, window.location.origin), signal);
  if (response.status === 401 || response.status === 403 || response.redirected) {
    return { status: 'unauthenticated' };
  }
  if (!response.ok || !isJsonResponse(response)) {
    return { status: response.status === 404 ? 'unsupported' : 'error' };
  }
  const data = await response.json();
  const username = data?.user?.metadata?.name || data?.metadata?.name || '';
  if (!username || username === HALO_ANONYMOUS_USERNAME || data?.user?.spec?.disabled === true) {
    return { status: 'unauthenticated' };
  }
  return { status: 'authenticated', username };
}

function buildUserNotificationUrl(endpoint, username) {
  const path = endpoint.includes('{username}')
    ? endpoint.replace('{username}', encodeURIComponent(username))
    : endpoint;
  const url = new URL(path, window.location.origin);
  url.searchParams.set('page', '1');
  url.searchParams.set('size', String(MOMENT_NOTIFICATION_FETCH_SIZE));
  url.searchParams.append('sort', 'metadata.creationTimestamp,desc');
  return url;
}

function buildMarkNotificationReadUrl(endpoint, username, notificationName) {
  const path = endpoint
    .replace('{username}', encodeURIComponent(username))
    .replace('{name}', encodeURIComponent(notificationName));
  return new URL(path, window.location.origin);
}

function isMomentNotification(item = {}) {
  const spec = item.spec || {};
  const html = spec.htmlContent || '';
  const raw = spec.rawContent || '';
  const link = firstLinkFromHtml(html);
  const text = `${spec.title || ''} ${stripHtml(html)} ${stripHtml(raw)}`;
  return /(?:^|\/)moments(?:\/|\?|#|$)/i.test(link)
    || /(?:瞬间|moment)/i.test(text);
}

function normalizeMomentNotification(item = {}) {
  const spec = item.spec || {};
  const title = spec.title || '瞬间互动消息';
  const html = spec.htmlContent || '';
  const raw = spec.rawContent || '';
  const interaction = interactionFromTitle(title, raw);
  const content = textFromSelector(html, '.content') || stripHtml(raw) || stripHtml(html) || title;
  const body = content
    .replace(/^@?.+?你好：?/, '')
    .replace(/^.+?以下是评论的具体内容：?/, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id: item.metadata?.name || '',
    author: interaction.actor,
    action: interaction.action,
    object: interaction.object,
    recipient: recipientFromNotification(html, raw),
    title,
    body: body || title,
    target: targetTextFromHtml(html),
    url: normalizeMomentHref(firstLinkFromHtml(html)),
    thumbnail: firstImageFromHtml(html),
    unread: spec.unread === true,
    timeText: timeAgo(item.metadata?.creationTimestamp)
  };
}

function renderNotificationItems(list, items) {
  if (!list) return;
  list.innerHTML = items.map((item) => {
    const initial = escapeHtml((item.author || '访').slice(0, 1).toUpperCase());
    const href = item.url ? escapeHtml(item.url) : '#';
    const thumb = item.thumbnail
      ? `<img class="moments-notification-thumb" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" decoding="async">`
      : '<span class="moments-notification-thumb is-empty"><span class="icon-[lucide--message-circle]" aria-hidden="true"></span></span>';
    return `
      <a class="moments-notification-item pjax-link${item.unread ? ' is-unread' : ''}"
         href="${href}"
         data-pjax-app="moments"
         data-notification-id="${escapeHtml(item.id)}">
        <span class="moments-notification-avatar">${initial}</span>
        <span class="moments-notification-copy">
          <span class="moments-notification-line">
            <b>${escapeHtml(item.author)}</b>
            <time>${escapeHtml(item.timeText)}</time>
          </span>
          <span class="moments-notification-message"><em>${escapeHtml(item.action)}${escapeHtml(item.object)}：</em>${escapeHtml(item.body)}</span>
          ${item.target ? `<span class="moments-notification-target">${escapeHtml(item.target)}</span>` : ''}
        </span>
        ${thumb}
      </a>`;
  }).join('');
}

function setNotificationState(node, state, message) {
  if (!node) return;
  node.dataset.state = state;
  const status = node.querySelector('[data-moments-notification-status]');
  if (status) {
    status.textContent = message || '';
    status.hidden = !message;
  }
}

function setupMomentNotifications(root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  const nodes = Array.from(scope.querySelectorAll('[data-moments-notification]'));
  if (!nodes.length && scope !== document) {
    nodes.push(...document.querySelectorAll('[data-moments-notification]'));
  }
  const cleanups = [];

  nodes.forEach((node) => {
    if (node._momentsNotificationCleanup) {
      node._momentsNotificationCleanup();
    }

    const button = node.querySelector('[data-moments-notification-toggle]');
    const panel = node.querySelector('[data-moments-notification-panel]');
    const list = node.querySelector('[data-moments-notification-list]');
    const dot = node.querySelector('[data-moments-notification-dot]');
    const userEndpoint = (node.dataset.userEndpoint || window.__SKY_MOMENTS_NOTIFICATION_USER_ENDPOINT__ || MOMENT_NOTIFICATION_USER_ENDPOINT).trim();
    const endpoint = (node.dataset.notificationsEndpoint || window.__SKY_MOMENTS_NOTIFICATION_ENDPOINT__ || MOMENT_NOTIFICATION_ENDPOINT).trim();
    const markReadEndpoint = (node.dataset.markReadEndpoint || window.__SKY_MOMENTS_NOTIFICATION_MARK_READ_ENDPOINT__ || MOMENT_NOTIFICATION_MARK_READ_ENDPOINT).trim();
    let loaded = false;
    let loading = false;
    let controller = null;
    let currentUsername = '';

    function syncUnreadDot() {
      if (!dot) return;
      dot.hidden = !list?.querySelector('.moments-notification-item.is-unread');
    }

    function markItemReadLocally(anchor) {
      if (!anchor?.classList.contains('is-unread')) return;
      anchor.classList.remove('is-unread');
      syncUnreadDot();
    }

    function removeItemLocally(anchor) {
      anchor?.remove();
      syncUnreadDot();
      if (!list?.querySelector('.moments-notification-item')) {
        setNotificationState(node, 'empty', '暂无新消息');
      }
    }

    async function markNotificationAsRead(notificationName) {
      if (!currentUsername || !notificationName || !markReadEndpoint) return false;
      try {
        const response = await fetch(buildMarkNotificationReadUrl(markReadEndpoint, currentUsername, notificationName), {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json'
          }
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`HTTP ${response.status}`);
        }
        return true;
      } catch (_error) {
        warnApiCall('moments', '瞬间通知已读标记失败', {
          notificationName,
          message: _error?.message || String(_error || ''),
          action: 'keep-unread-state',
          hint: '检查通知已读接口、当前登录态和 notificationName 是否仍存在。'
        });
        return false;
      }
    }

    async function load({ force = false } = {}) {
      if (loading || (loaded && !force)) return;
      if (!endpoint) {
        setNotificationState(node, 'unsupported', '当前 Halo 未开放用户通知接口');
        if (dot) dot.hidden = true;
        if (list) list.innerHTML = '';
        loaded = true;
        return;
      }
      loading = true;
      controller?.abort();
      controller = new AbortController();
      setNotificationState(node, 'loading', '正在加载瞬间互动...');
      if (list) list.innerHTML = '';

      try {
        const user = await resolveCurrentUsername(userEndpoint, controller.signal);
        if (user.status === 'unauthenticated') {
          setNotificationState(node, 'unauthenticated', '登录后查看瞬间互动消息');
          if (dot) dot.hidden = true;
          loaded = true;
          return;
        }
        if (user.status === 'unsupported') {
          setNotificationState(node, 'unsupported', '当前 Halo 未开放用户通知接口');
          if (dot) dot.hidden = true;
          loaded = true;
          return;
        }
        if (user.status !== 'authenticated') {
          throw new Error('Unable to resolve current user');
        }

        currentUsername = user.username;
        const url = buildUserNotificationUrl(endpoint, user.username);
        const response = await fetchJson(url, controller.signal);

        if (response.status === 401 || response.status === 403 || response.redirected) {
          setNotificationState(node, 'unauthenticated', '登录后查看瞬间互动消息');
          if (dot) dot.hidden = true;
          loaded = true;
          return;
        }

        if (response.status === 404) {
          setNotificationState(node, 'unsupported', '当前 Halo 未开放用户通知接口');
          if (dot) dot.hidden = true;
          loaded = true;
          return;
        }

        if (!response.ok || !isJsonResponse(response)) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const items = Array.isArray(data.items)
          ? data.items
            .filter(isMomentNotification)
            .map(normalizeMomentNotification)
            .filter((item) => item.unread)
            .slice(0, MOMENT_NOTIFICATION_PAGE_SIZE)
          : [];
        if (!items.length) {
          setNotificationState(node, 'empty', '暂无新消息');
          if (dot) dot.hidden = true;
        } else {
          renderNotificationItems(list, items);
          setNotificationState(node, 'ready', '');
          syncUnreadDot();
          if (window.pjax?.attachLink) {
            list.querySelectorAll('a.pjax-link:not([data-pjax-attached])').forEach((anchor) => {
              anchor.setAttribute('data-pjax-managed', 'true');
              window.pjax.attachLink(anchor);
            });
          }
        }
        loaded = true;
      } catch (error) {
        if (error?.name !== 'AbortError') {
          warnApiCall('moments', '瞬间通知加载失败', {
            message: error?.message || String(error || ''),
            action: 'show-notification-error',
            hint: '检查 Halo 用户通知接口、登录态、响应 Content-Type 和 Moments 通知过滤规则。'
          });
          setNotificationState(node, 'error', '加载失败，稍后重试');
          if (dot) dot.hidden = true;
        }
      } finally {
        loading = false;
      }
    }

    function close() {
      panel.hidden = true;
      button?.setAttribute('aria-expanded', 'false');
      node.classList.remove('is-open');
    }

    function open() {
      panel.hidden = false;
      button?.setAttribute('aria-expanded', 'true');
      node.classList.add('is-open');
      load();
    }

    function toggle(event) {
      event.preventDefault();
      event.stopPropagation();
      if (panel.hidden) open();
      else close();
    }

    function onDocumentClick(event) {
      if (!node.contains(event.target)) close();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') close();
    }

    async function onNotificationClick(event) {
      const anchor = event.target instanceof Element
        ? event.target.closest('.moments-notification-item[data-notification-id]')
        : null;
      if (!anchor) return;
      if (anchor.dataset.notificationReadPending === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const notificationName = anchor.dataset.notificationId || '';
      const href = anchor.getAttribute('href') || anchor.href || '';
      anchor.dataset.notificationReadPending = 'true';
      markItemReadLocally(anchor);
      const marked = await markNotificationAsRead(notificationName);
      if (marked) {
        removeItemLocally(anchor);
      }
      close();
      if (window.pjax?.loadUrl && href) {
        window.pjax.loadUrl(href);
        return;
      }
      if (href) {
        window.location.href = href;
      }
    }

    button?.addEventListener('click', toggle);
    list?.addEventListener('click', onNotificationClick, true);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
    setNotificationState(node, 'idle', '打开后加载消息');

    const cleanup = () => {
      controller?.abort();
      button?.removeEventListener('click', toggle);
      list?.removeEventListener('click', onNotificationClick, true);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeydown);
      node._momentsNotificationCleanup = null;
    };
    node._momentsNotificationCleanup = cleanup;
    cleanups.push(cleanup);
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}

if (typeof window !== 'undefined') {
  window.__momentsScrollSetup = () => setupMomentsScrollChrome(document);
}

registerPageAppLifecycle('moments', {
  resolveProtocol: resolveMomentsAppProtocol,
  hydrate(root) {
    const cleanupScroll = setupMomentsScrollChrome(root);
    const cleanupNotifications = setupMomentNotifications(document);
    const cleanupPublish = setupMomentPublish(document);
    const cleanupInteractions = setupMomentInteractions(root);
    let cleanupDeferredNotifications = null;
    let cleanupDeferredPublish = null;
    let cleanupDeferredInteractions = null;
    const notificationFrame = requestAnimationFrame(() => {
      cleanupDeferredNotifications = setupMomentNotifications(document);
      cleanupDeferredPublish = setupMomentPublish(document);
      cleanupDeferredInteractions = setupMomentInteractions(document);
    });
    return () => {
      cancelAnimationFrame(notificationFrame);
      cleanupScroll?.();
      cleanupNotifications?.();
      cleanupDeferredNotifications?.();
      cleanupPublish?.();
      cleanupDeferredPublish?.();
      cleanupInteractions?.();
      cleanupDeferredInteractions?.();
    };
  },
  getDocumentState(_root, context) {
    const isDetail = context.state?.scene === 'detail';
    return {
      title: context.documentTitle || document.title,
      windowTitle: isDetail ? '详情' : (context.documentTitle || document.title),
      windowVariant: 'moments'
    };
  }
});
