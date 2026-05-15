import { registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { resolveMomentsAppProtocol } from './protocol.js';

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

function normalizeMomentNotification(item = {}) {
  const spec = item.spec || {};
  const title = spec.title || '瞬间互动消息';
  const html = spec.htmlContent || '';
  const raw = spec.rawContent || '';
  const author = title.match(/^(.+?)\s*(?:评论了|回复)/)?.[1]?.trim() || '访客';
  const content = stripHtml(html) || stripHtml(raw) || title;
  const excerpt = content
    .replace(/^.+?你好：?/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id: item.metadata?.name || '',
    author,
    title,
    excerpt: excerpt || title,
    url: firstLinkFromHtml(html),
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
          <span class="moments-notification-title">${escapeHtml(item.title)}</span>
          <span class="moments-notification-excerpt">${escapeHtml(item.excerpt)}</span>
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
    const refresh = node.querySelector('[data-moments-notification-refresh]');
    const endpoint = (node.dataset.endpoint || window.__SKY_MOMENTS_NOTIFICATION_ENDPOINT__ || '').trim();
    const reasonType = node.dataset.reasonType || 'new-comment-on-moment';
    let loaded = false;
    let loading = false;
    let controller = null;

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

      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set('reasonType', reasonType);
      url.searchParams.set('page', '1');
      url.searchParams.set('size', String(MOMENT_NOTIFICATION_PAGE_SIZE));

      try {
        const response = await fetch(url.toString(), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });

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

        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items.map(normalizeMomentNotification) : [];
        if (!items.length) {
          setNotificationState(node, 'empty', '暂无瞬间互动');
          if (dot) dot.hidden = true;
        } else {
          renderNotificationItems(list, items);
          setNotificationState(node, 'ready', '');
          if (dot) dot.hidden = !items.some((item) => item.unread);
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

    function onRefresh(event) {
      event.preventDefault();
      event.stopPropagation();
      loaded = false;
      load({ force: true });
    }

    button?.addEventListener('click', toggle);
    refresh?.addEventListener('click', onRefresh);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
    setNotificationState(node, 'idle', '打开后加载互动消息');

    const cleanup = () => {
      controller?.abort();
      button?.removeEventListener('click', toggle);
      refresh?.removeEventListener('click', onRefresh);
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
    let cleanupDeferredNotifications = null;
    const notificationFrame = requestAnimationFrame(() => {
      cleanupDeferredNotifications = setupMomentNotifications(document);
    });
    return () => {
      cancelAnimationFrame(notificationFrame);
      cleanupScroll?.();
      cleanupNotifications?.();
      cleanupDeferredNotifications?.();
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
