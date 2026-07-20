const UPVOTED_STORAGE_KEY = 'halo.upvoted.moment.names';
const COMMENT_ENDPOINT = '/apis/api.halo.run/v1alpha1/comments';
const UPVOTE_ENDPOINT = '/apis/api.halo.run/v1alpha1/trackers/upvote';
const COMMENT_PAGE_SIZE = 10;
const REPLY_PAGE_SIZE = 5;
const COMMENT_PREVIEW_PAGE_SIZE = 5;
const REPLY_PREVIEW_PAGE_SIZE = 2;
const AUTO_COMMENT_CONCURRENCY = 3;
const COMMENTS_HASH = 'moment-comments';
const COMMENT_HASH_PREFIX = 'comment-';
const EMOJI_PRESETS = ['😀', '😄', '😂', '🤣', '😊', '😍', '😘', '😎', '🥳', '😭', '🥺', '😅', '👍', '👏', '🙏', '❤️', '🔥', '✨', '🎉', '🤔', '😴', '😋', '😤', '🙈'];
const SUBJECT_REF = {
  group: 'moment.halo.run',
  version: 'v1alpha1',
  kind: 'Moment'
};

const cardStates = new WeakMap();
const autoCommentQueue = [];
let autoCommentActive = 0;
let photoViewer = null;
let photoViewerRefCount = 0;

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function formatTime(value = '') {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function readUpvoted() {
  try {
    const value = JSON.parse(localStorage.getItem(UPVOTED_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeUpvoted(names) {
  try {
    localStorage.setItem(UPVOTED_STORAGE_KEY, JSON.stringify(Array.from(new Set(names.filter(Boolean)))));
  } catch {
    // Ignore storage failures. The server request has already completed.
  }
}

function itemText(item = {}) {
  return stripHtml(item.spec?.content || item.spec?.raw || '');
}

function ownerName(item = {}) {
  return item.owner?.displayName || item.spec?.owner?.displayName || item.spec?.owner?.name || '访客';
}

function ownerAvatar(item = {}) {
  return item.owner?.avatar || item.spec?.owner?.avatar || '';
}

function itemTime(item = {}) {
  return item.spec?.creationTime || item.metadata?.creationTimestamp || '';
}

function normalizeReply(reply = {}) {
  return {
    name: reply.metadata?.name || '',
    author: ownerName(reply),
    avatar: ownerAvatar(reply),
    text: itemText(reply),
    timeText: formatTime(itemTime(reply)),
    approved: reply.spec?.approved === true,
    quoteReply: reply.spec?.quoteReply || ''
  };
}

function normalizeComment(item = {}) {
  return {
    name: item.metadata?.name || '',
    author: ownerName(item),
    avatar: ownerAvatar(item),
    text: itemText(item),
    timeText: formatTime(itemTime(item)),
    approved: item.spec?.approved === true,
    replyPage: item.replies?.page || 1,
    replyHasMore: item.replies?.hasNext === true,
    replyTotal: Number(item.status?.visibleReplyCount ?? item.status?.replyCount ?? item.replies?.total ?? 0) || 0,
    replies: Array.isArray(item.replies?.items)
      ? item.replies.items.map(normalizeReply).filter((reply) => reply.text)
      : []
  };
}

function normalizeComments(data = {}) {
  return {
    page: Number(data.page) || 1,
    hasMore: data.hasNext === true,
    total: Number(data.total) || 0,
    comments: Array.isArray(data.items)
      ? data.items.map(normalizeComment).filter((comment) => comment.text)
      : []
  };
}

function normalizeReplies(data = {}) {
  return {
    page: Number(data.page) || 1,
    hasMore: data.hasNext === true,
    replies: Array.isArray(data.items)
      ? data.items.map(normalizeReply).filter((reply) => reply.text)
      : []
  };
}

function initials(name = '') {
  return String(name || '访').trim().slice(0, 1).toUpperCase() || '访';
}

function escapeCssIdent(value = '') {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function getCard(target) {
  return target instanceof Element ? target.closest('[data-moment-card]') : null;
}

function getCards(root = document) {
  const cards = [];
  if (root instanceof Element && root.matches('[data-moment-card]')) {
    cards.push(root);
  }
  if (root && typeof root.querySelectorAll === 'function') {
    cards.push(...root.querySelectorAll('[data-moment-card]'));
  }
  return Array.from(new Set(cards));
}

function getCount(card, type) {
  return Number.parseInt(card?.dataset?.[`${type}Count`] || '0', 10) || 0;
}

function createState(card) {
  const name = card.dataset.momentName || '';
  const isDetail = card.hasAttribute('data-moment-detail-comments');
  return {
    name,
    detailUrl: card.dataset.detailUrl || (name ? `/moments/${name}` : '/moments'),
    isDetail,
    commentsOpen: isDetail,
    composerOpen: false,
    commentsLoading: false,
    commentsLoaded: false,
    commentsPreview: false,
    autoCommentsQueued: false,
    commentsPage: 0,
    commentsHasMore: false,
    comments: [],
    replyTarget: null,
    submitting: false,
    message: '',
    tone: '',
    upvoting: false,
    abortController: null,
    commentsRequestGeneration: 0,
    detailFallback: false,
    hashFocusHandled: false,
    replyLoading: new Set()
  };
}

function getState(card) {
  if (!cardStates.has(card)) {
    cardStates.set(card, createState(card));
  }
  return cardStates.get(card);
}

function setMessage(state, message = '', tone = '') {
  state.message = message;
  state.tone = tone;
}

function replyHtml(reply, comment) {
  const author = escapeHtml(reply.author);
  const target = escapeHtml(comment.author);
  return `
    <div class="moment-feed-comment-reply"
         data-moment-reply="${escapeHtml(reply.name)}"
         data-author="${author}"
         data-moment-reply-to="${escapeHtml(comment.name)}"
         data-quote-reply="${escapeHtml(reply.name)}"
         data-reply-author="${author}"
         role="button"
         tabindex="0">
      <button type="button"
              class="moment-feed-comment-author"
              data-moment-reply-to="${escapeHtml(comment.name)}"
              data-quote-reply="${escapeHtml(reply.name)}"
              data-reply-author="${author}">${author}</button>
      <span class="moment-feed-reply-prefix">回复</span>
      <b>${target}</b>
      <span class="moment-feed-comment-colon">：</span>
      <span>${escapeHtml(reply.text)}</span>
    </div>
  `;
}

function commentHtml(comment, state) {
  const replies = comment.replies.length
    ? `<div class="moment-feed-comment-replies" data-moment-replies="${escapeHtml(comment.name)}">${comment.replies.map((reply) => replyHtml(reply, comment)).join('')}</div>`
    : `<div class="moment-feed-comment-replies" data-moment-replies="${escapeHtml(comment.name)}"></div>`;
  const repliesLoading = state.replyLoading.has(comment.name);
  const loadReplies = comment.replyHasMore
    ? `<button type="button" class="moment-feed-replies-more" data-moment-replies-more="${escapeHtml(comment.name)}" ${repliesLoading ? 'disabled' : ''}>${repliesLoading ? '加载中...' : '查看更多回复'}</button>`
    : '';

  return `
    <article class="moment-feed-comment" data-moment-comment="${escapeHtml(comment.name)}" data-author="${escapeHtml(comment.author)}">
      <div class="moment-feed-comment-main">
        <p class="moment-feed-comment-line"
           data-moment-reply-to="${escapeHtml(comment.name)}"
           data-reply-author="${escapeHtml(comment.author)}"
           role="button"
           tabindex="0">
          <button type="button" class="moment-feed-comment-author" data-moment-reply-to="${escapeHtml(comment.name)}" data-reply-author="${escapeHtml(comment.author)}">${escapeHtml(comment.author)}</button>
          <span class="moment-feed-comment-colon">：</span>
          <span>${escapeHtml(comment.text)}</span>
        </p>
        ${comment.replies.length || comment.replyHasMore ? replies : ''}
        ${loadReplies}
      </div>
    </article>
  `;
}

function syncCounts(card) {
  const upvoteCount = getCount(card, 'upvote');
  const stats = card.querySelector('[data-moment-stats]');
  const upvoteStat = card.querySelector('[data-moment-upvote-stat]');
  const upvoteNode = card.querySelector('[data-moment-upvote-count]');

  if (stats) {
    stats.hidden = !upvoteStat || upvoteCount <= 0;
  }
  if (upvoteStat) {
    upvoteStat.hidden = upvoteCount <= 0;
    upvoteStat.title = `${upvoteCount} 个点赞`;
  }
  if (upvoteNode) upvoteNode.textContent = String(upvoteCount);
}

function syncLiked(card) {
  const state = getState(card);
  const liked = readUpvoted().includes(state.name);
  card.classList.toggle('is-moment-upvoted', liked);
  card.classList.toggle('is-upvote-pending', state.upvoting);
  const button = card.querySelector('[data-moment-upvote]');
  const label = card.querySelector('[data-moment-upvote-label]');
  if (button) {
    button.disabled = liked || state.upvoting;
    button.setAttribute('aria-pressed', liked ? 'true' : 'false');
  }
  if (label) label.textContent = liked ? '已赞' : '赞';
}

function renderComments(card) {
  const state = getState(card);
  const hasUpvotes = getCount(card, 'upvote') > 0;
  const shouldShowPanel = state.isDetail || state.commentsOpen || hasUpvotes;
  const panel = card.querySelector('[data-moment-comments-panel]');
  const list = card.querySelector('[data-moment-comments-list]');
  const status = card.querySelector('[data-moment-comments-status]');
  const more = card.querySelector('[data-moment-comments-more]');
  const detailMore = card.querySelector('.moment-feed-comments-more');
  const replyBar = card.querySelector('[data-moment-reply-bar]');
  const replyLabel = card.querySelector('[data-moment-reply-label]');
  const input = card.querySelector('[data-moment-comment-input]');
  const submit = card.querySelector('[data-moment-comment-submit]');
  const form = card.querySelector('[data-moment-comment-form]');

  if (panel) panel.hidden = !shouldShowPanel;
  card.classList.toggle('is-comments-open', state.commentsOpen);
  card.classList.toggle('has-upvotes-only', hasUpvotes && !state.commentsOpen && state.comments.length === 0);
  if (panel) {
    panel.classList.toggle('is-loading', state.commentsLoading);
    panel.classList.toggle('has-comments', state.comments.length > 0);
  }
  if (status) {
    status.textContent = state.message;
    status.dataset.tone = state.tone;
    status.hidden = !state.message;
  }
  if (list) {
    const hideEmptyList = !state.commentsOpen && state.comments.length === 0;
    list.hidden = hideEmptyList;
    if (hideEmptyList) {
      list.innerHTML = '';
    } else if (state.commentsLoading && !state.commentsLoaded) {
      list.innerHTML = '<p class="moment-feed-comments-empty">正在加载评论...</p>';
    } else if (state.commentsOpen && !state.commentsLoaded && getCount(card, 'comment') > 0) {
      list.innerHTML = '<p class="moment-feed-comments-empty">评论加载中...</p>';
    } else if (state.comments.length) {
      list.innerHTML = state.comments.map((comment) => commentHtml(comment, state)).join('');
    } else {
      list.innerHTML = '<p class="moment-feed-comments-empty">暂无评论</p>';
    }
  }
  if (more) {
    more.hidden = !state.commentsHasMore;
    more.disabled = state.commentsLoading;
    more.textContent = state.commentsLoading && state.commentsLoaded
      ? '加载中...'
      : state.isDetail
        ? '查看更多评论'
        : '查看全部评论';
  }
  if (detailMore) {
    detailMore.href = `${state.detailUrl}#moment-comments`;
    detailMore.hidden = !state.detailFallback;
  }
  if (replyBar) replyBar.hidden = !state.replyTarget;
  if (replyLabel) {
    replyLabel.textContent = state.replyTarget ? `正在回复 ${state.replyTarget.author || '评论'}` : '';
  }
  if (input) {
    input.placeholder = state.replyTarget ? `回复 ${state.replyTarget.author || '评论'}` : '评论...';
  }
  card.querySelector('[data-moment-comment-editor]')?.classList.toggle('is-replying', !!state.replyTarget);
  if (form) form.hidden = !state.composerOpen;
  if (submit) {
    submit.textContent = state.submitting ? '发送中' : '发送';
    submit.disabled = state.submitting || !(input?.value || '').trim();
  }
}

function syncCommentSubmit(card) {
  const state = getState(card);
  const input = card.querySelector('[data-moment-comment-input]');
  const submit = card.querySelector('[data-moment-comment-submit]');
  if (input instanceof HTMLTextAreaElement) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 92)}px`;
  }
  if (submit) {
    submit.textContent = state.submitting ? '发送中' : '发送';
    submit.disabled = state.submitting || !(input?.value || '').trim();
  }
}

function setEmojiPanel(card, open) {
  const panel = card.querySelector('[data-moment-emoji-panel]');
  const toggle = card.querySelector('[data-moment-emoji-toggle]');
  if (!panel) return;
  panel.hidden = !open;
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function insertAtCursor(input, value) {
  if (!(input instanceof HTMLTextAreaElement) || !value) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
  const cursor = start + value.length;
  input.setSelectionRange(cursor, cursor);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function resolveUrl(value = '') {
  if (!value) return '';
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
}

function collectPhotoItems(target) {
  const group = target.closest('.moment-feed-gallery, .moment-media-grid') || target.parentElement;
  const nodes = Array.from(group?.querySelectorAll('[data-moment-photo]') || [target])
    .filter((node) => node?.dataset?.momentPhotoUrl || node?.querySelector?.('img'));
  const items = nodes.map((node) => {
    const img = node.querySelector('img');
    return {
      url: resolveUrl(node.dataset.momentPhotoUrl || img?.dataset?.src || img?.currentSrc || img?.src || ''),
      type: node.dataset.momentPhotoType || img?.getAttribute('type') || '',
      liveUrl: resolveUrl(node.dataset.momentPhotoLiveUrl || '')
    };
  }).filter((item) => item.url);
  return {
    items,
    index: Math.max(0, nodes.indexOf(target))
  };
}

function getPhotoViewer(root = document.body) {
  if (photoViewer) {
    if (root && photoViewer.overlay.parentElement !== root) {
      photoViewer.overlay.parentElement?.classList.remove('is-photo-viewer-open');
      root.appendChild(photoViewer.overlay);
    }
    return photoViewer;
  }
  const overlay = document.createElement('div');
  overlay.className = 'moment-photo-viewer';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '图片预览');
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="moment-photo-viewer-backdrop" data-photo-close></div>
    <div class="moment-photo-viewer-stage" data-photo-stage>
      <img class="moment-photo-viewer-image" data-photo-image alt="">
      <video class="moment-photo-viewer-live" data-photo-live playsinline muted loop hidden></video>
      <div class="moment-photo-viewer-loading" data-photo-loading>
        <span class="moment-photo-viewer-spinner" aria-hidden="true"></span>
      </div>
      <div class="moment-photo-viewer-error" data-photo-error hidden>
        <span class="icon-[lucide--image-off]" aria-hidden="true"></span>
        <span>图片加载失败</span>
      </div>
    </div>
    <button type="button" class="moment-photo-viewer-close" data-photo-close aria-label="关闭">
      <span class="icon-[lucide--x]" aria-hidden="true"></span>
    </button>
    <button type="button" class="moment-photo-viewer-nav is-prev" data-photo-prev aria-label="上一张">
      <span class="icon-[lucide--chevron-left]" aria-hidden="true"></span>
    </button>
    <button type="button" class="moment-photo-viewer-nav is-next" data-photo-next aria-label="下一张">
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    </button>
    <div class="moment-photo-viewer-counter" data-photo-counter></div>
    <div class="moment-photo-viewer-toolbar">
      <button type="button" data-photo-zoom-out aria-label="缩小"><span class="icon-[lucide--zoom-out]" aria-hidden="true"></span></button>
      <button type="button" data-photo-zoom-in aria-label="放大"><span class="icon-[lucide--zoom-in]" aria-hidden="true"></span></button>
      <button type="button" data-photo-reset aria-label="适应窗口"><span class="icon-[lucide--scan]" aria-hidden="true"></span></button>
      <button type="button" data-photo-live-toggle hidden><span class="icon-[lucide--play-circle]" aria-hidden="true"></span><span>实况</span></button>
    </div>
  `;
  root.appendChild(overlay);

  const state = {
    items: [],
    index: 0,
    scale: 1,
    pointX: 0,
    pointY: 0,
    panning: false,
    live: false,
    activePointers: new Map(),
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchStartPointX: 0,
    pinchStartPointY: 0,
    previousFocus: null,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    swipePointerType: '',
    startX: 0,
    startY: 0,
    oldPointX: 0,
    oldPointY: 0
  };
  const stage = overlay.querySelector('[data-photo-stage]');
  const image = overlay.querySelector('[data-photo-image]');
  const live = overlay.querySelector('[data-photo-live]');
  const loading = overlay.querySelector('[data-photo-loading]');
  const error = overlay.querySelector('[data-photo-error]');
  const counter = overlay.querySelector('[data-photo-counter]');
  const liveToggle = overlay.querySelector('[data-photo-live-toggle]');
  const closeButton = overlay.querySelector('.moment-photo-viewer-close');

  function current() {
    return state.items[state.index] || null;
  }

  function updateTransform({ immediate = false } = {}) {
    image.classList.toggle('is-panning', state.panning || immediate);
    live.classList.toggle('is-panning', state.panning || immediate);
    const transform = `translate(calc(-50% + ${state.pointX}px), calc(-50% + ${state.pointY}px)) scale(${state.scale})`;
    image.style.transform = transform;
    live.style.transform = transform;
    overlay.dataset.scale = String(Math.round(state.scale * 100));
  }

  function clampScale(value) {
    return Math.min(4, Math.max(0.5, Number(value.toFixed(2))));
  }

  function setScale(nextScale, focal = null) {
    const next = clampScale(nextScale);
    if (next === state.scale) return;
    if (focal) {
      const rect = stage.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const contentX = (focal.x - centerX - state.pointX) / state.scale;
      const contentY = (focal.y - centerY - state.pointY) / state.scale;
      state.pointX = focal.x - centerX - contentX * next;
      state.pointY = focal.y - centerY - contentY * next;
    }
    state.scale = next;
    updateTransform();
  }

  function setScaleFromBase(nextScale, focal, baseScale, basePointX, basePointY) {
    const next = clampScale(nextScale);
    if (focal) {
      const rect = stage.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const contentX = (focal.x - centerX - basePointX) / baseScale;
      const contentY = (focal.y - centerY - basePointY) / baseScale;
      state.pointX = focal.x - centerX - contentX * next;
      state.pointY = focal.y - centerY - contentY * next;
    }
    state.scale = next;
    updateTransform({ immediate: true });
  }

  function stageCenter() {
    const rect = stage.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  function resetView() {
    state.scale = 1;
    state.pointX = 0;
    state.pointY = 0;
    state.live = false;
    live.pause();
    live.hidden = true;
    image.hidden = true;
    loading.hidden = false;
    error.hidden = true;
    overlay.classList.remove('is-image-error');
    overlay.classList.add('is-loading');
    liveToggle?.classList.remove('is-active');
    updateTransform();
  }

  function setImageError() {
    image.hidden = true;
    live.hidden = true;
    loading.hidden = true;
    error.hidden = false;
    overlay.classList.remove('is-loading');
    overlay.classList.add('is-image-error');
  }

  function preloadAdjacent() {
    if (state.items.length <= 1) return;
    [-1, 1].forEach((step) => {
      const item = state.items[(state.index + step + state.items.length) % state.items.length];
      if (!item?.url) return;
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = item.url;
    });
  }

  function render() {
    const item = current();
    if (!item) return;
    resetView();
    image.src = item.url;
    image.dataset.originType = item.type;
    if (image.complete && image.naturalWidth > 0) {
      loading.hidden = true;
      overlay.classList.remove('is-loading');
      image.hidden = false;
    }
    if (item.liveUrl) live.src = item.liveUrl;
    else live.removeAttribute('src');
    liveToggle.hidden = !item.liveUrl;
    counter.textContent = state.items.length > 1 ? `${state.index + 1} / ${state.items.length}` : '';
    overlay.querySelector('[data-photo-prev]').hidden = state.items.length <= 1;
    overlay.querySelector('[data-photo-next]').hidden = state.items.length <= 1;
    preloadAdjacent();
  }

  function close() {
    overlay.hidden = true;
    overlay.parentElement?.classList.remove('is-photo-viewer-open');
    overlay.classList.remove('is-panning');
    state.panning = false;
    state.activePointers.clear();
    state.pinchStartDistance = 0;
    live.pause();
    image.removeAttribute('src');
    live.removeAttribute('src');
    if (state.previousFocus?.isConnected) {
      state.previousFocus.focus({ preventScroll: true });
    }
    state.previousFocus = null;
  }

  function show(items, index = 0, trigger = null) {
    state.items = items;
    state.index = index;
    state.previousFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    overlay.hidden = false;
    overlay.parentElement?.classList.add('is-photo-viewer-open');
    render();
    overlay.focus({ preventScroll: true });
    requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  }

  function move(step) {
    if (state.items.length <= 1) return;
    state.index = (state.index + step + state.items.length) % state.items.length;
    render();
  }

  function zoom(delta) {
    setScale(state.scale + delta, stageCenter());
  }

  function pointerDistance() {
    const points = Array.from(state.activePointers.values());
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function pointerCenter() {
    const points = Array.from(state.activePointers.values());
    if (points.length < 2) return null;
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  function toggleZoomAt(x, y) {
    if (overlay.classList.contains('is-image-error')) return;
    if (state.scale > 1.02) {
      state.scale = 1;
      state.pointX = 0;
      state.pointY = 0;
      updateTransform();
      return;
    }
    setScale(2, { x, y });
  }

  overlay.addEventListener('click', (event) => {
    if (event.target.closest('[data-photo-close]')) close();
    else if (event.target.closest('[data-photo-prev]')) move(-1);
    else if (event.target.closest('[data-photo-next]')) move(1);
    else if (event.target.closest('[data-photo-zoom-out]')) zoom(-0.2);
    else if (event.target.closest('[data-photo-zoom-in]')) zoom(0.2);
    else if (event.target.closest('[data-photo-reset]')) resetView();
    else if (event.target.closest('[data-photo-live-toggle]')) {
      const item = current();
      if (!item?.liveUrl) return;
      state.live = !state.live;
      image.hidden = state.live;
      live.hidden = !state.live;
      liveToggle.classList.toggle('is-active', state.live);
      if (state.live) live.play().catch(() => {});
      else live.pause();
    }
  });

  image.addEventListener('load', () => {
    loading.hidden = true;
    error.hidden = true;
    overlay.classList.remove('is-loading');
    overlay.classList.remove('is-image-error');
    if (!state.live) image.hidden = false;
  });

  image.addEventListener('error', setImageError);

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    setScale(state.scale + (event.deltaY > 0 ? -0.12 : 0.12), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  stage.addEventListener('dblclick', (event) => {
    event.preventDefault();
    toggleZoomAt(event.clientX, event.clientY);
  });

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      stage.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may be unavailable for synthetic or cancelled pointers.
    }
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.activePointers.size === 2) {
      state.panning = false;
      state.pinchStartDistance = pointerDistance();
      state.pinchStartScale = state.scale;
      state.pinchStartPointX = state.pointX;
      state.pinchStartPointY = state.pointY;
      overlay.classList.remove('is-panning');
      return;
    }
    state.panning = true;
    state.swipePointerType = event.pointerType;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.oldPointX = state.pointX;
    state.oldPointY = state.pointY;
    overlay.classList.add('is-panning');
    updateTransform({ immediate: true });
  });

  stage.addEventListener('pointermove', (event) => {
    if (overlay.hidden || !state.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.activePointers.size >= 2 && state.pinchStartDistance > 0) {
      const nextDistance = pointerDistance();
      const ratio = nextDistance / state.pinchStartDistance;
      setScaleFromBase(
        state.pinchStartScale * ratio,
        pointerCenter(),
        state.pinchStartScale,
        state.pinchStartPointX,
        state.pinchStartPointY
      );
      return;
    }
    if (!state.panning) return;
    state.pointX = state.oldPointX + event.clientX - state.startX;
    state.pointY = state.oldPointY + event.clientY - state.startY;
    updateTransform({ immediate: true });
  });

  function endPointer(event) {
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const elapsed = Date.now() - state.lastTapTime;
    const tapDistance = Math.hypot(event.clientX - state.lastTapX, event.clientY - state.lastTapY);
    const isTap = Math.hypot(dx, dy) < 10;
    if (state.activePointers.has(event.pointerId)) {
      state.activePointers.delete(event.pointerId);
    }
    try {
      stage.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    if (state.activePointers.size === 1) {
      const point = Array.from(state.activePointers.values())[0];
      state.panning = true;
      state.startX = point.x;
      state.startY = point.y;
      state.oldPointX = state.pointX;
      state.oldPointY = state.pointY;
      overlay.classList.add('is-panning');
      return;
    }
    state.pinchStartDistance = 0;
    state.panning = false;
    overlay.classList.remove('is-panning');
    if (state.swipePointerType !== 'mouse' && Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5 && state.scale <= 1.08) {
      move(dx < 0 ? 1 : -1);
      return;
    }
    if (state.swipePointerType !== 'mouse' && isTap) {
      if (elapsed > 0 && elapsed < 300 && tapDistance < 28) {
        toggleZoomAt(event.clientX, event.clientY);
        state.lastTapTime = 0;
      } else {
        state.lastTapTime = Date.now();
        state.lastTapX = event.clientX;
        state.lastTapY = event.clientY;
      }
    }
    updateTransform();
  }

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  function onViewerKeydown(event) {
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    }
  }

  function destroy() {
    close();
    window.removeEventListener('keydown', onViewerKeydown);
    overlay.remove();
  }

  window.addEventListener('keydown', onViewerKeydown);
  photoViewer = { overlay, show, close, destroy };
  return photoViewer;
}

function retainPhotoViewerLifecycle() {
  photoViewerRefCount += 1;
}

function releasePhotoViewerLifecycle() {
  photoViewerRefCount = Math.max(0, photoViewerRefCount - 1);
  if (photoViewerRefCount !== 0 || !photoViewer) return;
  const viewer = photoViewer;
  photoViewer = null;
  viewer.destroy();
}

function openPhotoViewer(target) {
  const { items, index } = collectPhotoItems(target);
  if (!items.length) return;
  const root = target.closest('.moments-window') || target.closest('[data-window-frame]') || document.body;
  getPhotoViewer(root).show(items, index, target);
}

function renderCard(card) {
  syncCounts(card);
  syncLiked(card);
  renderComments(card);
}

function wantsCommentsHashFocus() {
  const hash = decodeURIComponent(window.location.hash || '').replace(/^#/, '');
  return hash === COMMENTS_HASH || hash.startsWith(COMMENT_HASH_PREFIX);
}

function commentsHashTarget(card) {
  const hash = decodeURIComponent(window.location.hash || '').replace(/^#/, '');
  if (hash.startsWith(COMMENT_HASH_PREFIX)) {
    const name = hash.slice(COMMENT_HASH_PREFIX.length);
    if (name) {
      const comment = card.querySelector(`[data-moment-comment="${escapeCssIdent(name)}"]`);
      if (comment) return comment;
    }
  }
  return card.querySelector('[data-moment-comments-panel]') || card;
}

function scrollTargetIntoMomentsView(target) {
  if (!target) return;
  const scroller = target.closest('.moments-body');
  if (!scroller) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = Math.max(0, targetRect.top - scrollerRect.top + scroller.scrollTop - 18);
  scroller.scrollTo({ top: offset, behavior: 'smooth' });
}

function focusCommentsFromHash(card, { force = false } = {}) {
  const state = getState(card);
  if (!state.isDetail || !wantsCommentsHashFocus()) return;
  if (state.hashFocusHandled && !force) return;
  state.hashFocusHandled = true;

  state.commentsOpen = true;
  state.composerOpen = false;
  renderComments(card);

  requestAnimationFrame(() => {
    const target = commentsHashTarget(card);
    scrollTargetIntoMomentsView(target);
    const panel = card.querySelector('[data-moment-comments-panel]');
    panel?.classList.add('is-hash-target');
    window.setTimeout(() => panel?.classList.remove('is-hash-target'), 1400);
  });
}

function closeMenu(card) {
  const popover = card?.querySelector('[data-moment-action-popover]');
  const button = card?.querySelector('[data-moment-action-toggle]');
  if (popover) popover.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
  card?.classList.remove('is-action-open');
}

function closeAllMenus(root = document, exceptCard = null) {
  root.querySelectorAll('[data-moment-card].is-action-open').forEach((card) => {
    if (card !== exceptCard) closeMenu(card);
  });
}

function closeComments(root = document, exceptCard = null) {
  getCards(root).forEach((card) => {
    if (card === exceptCard) return;
    const state = getState(card);
    if (state.isDetail) return;
    if (!state.commentsOpen) return;
    state.commentsOpen = false;
    state.replyTarget = null;
    renderComments(card);
  });
}

function toggleMenu(card, root) {
  const popover = card.querySelector('[data-moment-action-popover]');
  const button = card.querySelector('[data-moment-action-toggle]');
  if (!popover) return;
  const shouldOpen = popover.hidden;
  closeAllMenus(root, shouldOpen ? card : null);
  popover.hidden = !shouldOpen;
  card.classList.toggle('is-action-open', shouldOpen);
  if (button) button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

async function upvoteMoment(card) {
  const state = getState(card);
  if (!state.name || state.upvoting || readUpvoted().includes(state.name)) return;
  state.upvoting = true;
  renderCard(card);

  try {
    const response = await fetch(UPVOTE_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        group: SUBJECT_REF.group,
        plural: 'moments',
        name: state.name
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    writeUpvoted([...readUpvoted(), state.name]);
    card.dataset.upvoteCount = String(getCount(card, 'upvote') + 1);
    setMessage(state, '');
  } catch {
    state.commentsOpen = true;
    setMessage(state, '点赞失败，请稍后再试', 'error');
  } finally {
    state.upvoting = false;
    renderCard(card);
  }
}

async function requestComments(state, page, { preview = false, signal } = {}) {
  const url = new URL(COMMENT_ENDPOINT, window.location.origin);
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(preview ? COMMENT_PREVIEW_PAGE_SIZE : COMMENT_PAGE_SIZE));
  url.searchParams.set('group', SUBJECT_REF.group);
  url.searchParams.set('version', SUBJECT_REF.version);
  url.searchParams.set('kind', SUBJECT_REF.kind);
  url.searchParams.set('name', state.name);
  url.searchParams.set('withReplies', 'true');
  url.searchParams.set('replySize', String(preview ? REPLY_PREVIEW_PAGE_SIZE : REPLY_PAGE_SIZE));
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  });
  if (response.status === 404) throw new Error('评论暂不可用');
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403 ? '登录后查看评论' : '评论加载失败');
  }
  return normalizeComments(await response.json());
}

async function loadComments(card, { page = 1, append = false, force = false, preview = false } = {}) {
  const state = getState(card);
  if (!state.name || state.commentsLoading) return;
  if (!append && state.commentsLoaded && !force) return;

  const previewMode = append ? state.commentsPreview : preview;
  state.abortController?.abort();
  const controller = new AbortController();
  const requestGeneration = state.commentsRequestGeneration + 1;
  state.commentsRequestGeneration = requestGeneration;
  state.abortController = controller;
  state.commentsLoading = true;
  state.commentsPreview = previewMode;
  state.detailFallback = false;
  setMessage(state, append ? '正在加载更多评论...' : '正在加载评论...');
  renderComments(card);

  const isCurrentRequest = () => (
    state.commentsRequestGeneration === requestGeneration
    && state.abortController === controller
    && !controller.signal.aborted
    && card.isConnected
  );

  try {
    const result = await requestComments(state, page, {
      preview: previewMode,
      signal: controller.signal
    });
    if (!isCurrentRequest()) return;
    state.comments = append ? [...state.comments, ...result.comments] : result.comments;
    state.commentsPage = result.page;
    state.commentsHasMore = result.hasMore;
    state.commentsLoaded = true;
    if (Number.isFinite(result.total) && result.total > getCount(card, 'comment')) {
      card.dataset.commentCount = String(result.total);
      syncCounts(card);
    }
    setMessage(state, '');
  } catch (error) {
    if (error?.name === 'AbortError' || !isCurrentRequest()) return;
    state.detailFallback = true;
    if (state.isDetail) showOfficialCommentsFallback(card);
    setMessage(state, error.message || '评论加载失败', 'error');
  } finally {
    if (state.commentsRequestGeneration === requestGeneration && state.abortController === controller) {
      state.commentsLoading = false;
      state.abortController = null;
      if (card.isConnected) {
        renderComments(card);
        focusCommentsFromHash(card, { force: true });
      }
    }
  }
}

function showOfficialCommentsFallback(card) {
  const fallback = card.querySelector('[data-moment-official-comments]');
  if (!fallback) return;
  fallback.hidden = false;
  fallback.style.display = '';
}

function shouldAutoPreviewComments(card) {
  const state = getState(card);
  return !state.isDetail && getCount(card, 'comment') > 0;
}

function drainAutoCommentQueue() {
  while (autoCommentActive < AUTO_COMMENT_CONCURRENCY && autoCommentQueue.length > 0) {
    const card = autoCommentQueue.shift();
    const state = getState(card);
    state.autoCommentsQueued = false;
    if (!card.isConnected || state.isDetail || state.commentsLoaded || state.commentsLoading || getCount(card, 'comment') <= 0) {
      continue;
    }
    autoCommentActive += 1;
    state.commentsOpen = true;
    void loadComments(card, { preview: true }).finally(() => {
      autoCommentActive = Math.max(0, autoCommentActive - 1);
      drainAutoCommentQueue();
    });
  }
}

function enqueueAutoCommentPreview(card) {
  const state = getState(card);
  if (state.isDetail || state.commentsLoaded || state.commentsLoading || state.autoCommentsQueued) return;
  if (getCount(card, 'comment') <= 0) return;
  state.autoCommentsQueued = true;
  autoCommentQueue.push(card);
  drainAutoCommentQueue();
}

async function openComments(card, root) {
  const state = getState(card);
  closeMenu(card);
  state.commentsOpen = true;
  state.composerOpen = true;
  renderComments(card);
  await loadComments(card, { preview: !state.isDetail });
  card.querySelector('[data-moment-comment-input]')?.focus();
}

async function loadMoreReplies(card, commentName) {
  const state = getState(card);
  const comment = state.comments.find((item) => item.name === commentName);
  if (!comment || !comment.replyHasMore) return;

  const panel = card.querySelector('[data-moment-comments-panel]');
  state.replyLoading.add(commentName);
  setMessage(state, '正在加载更多回复...');
  renderComments(card);

  try {
    const nextPage = Number(comment.replyPage || 1) + 1;
    const url = new URL(`${COMMENT_ENDPOINT}/${encodeURIComponent(comment.name)}/reply`, window.location.origin);
    url.searchParams.set('page', String(nextPage));
    url.searchParams.set('size', String(REPLY_PAGE_SIZE));
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = normalizeReplies(await response.json());
    comment.replies = [...comment.replies, ...result.replies];
    comment.replyPage = result.page;
    comment.replyHasMore = result.hasMore;
    setMessage(state, '');
  } catch {
    setMessage(state, '回复加载失败，请稍后再试', 'error');
  }
  state.replyLoading.delete(commentName);
  renderComments(card);
  panel?.querySelector(`[data-moment-comment="${escapeCssIdent(comment.name)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function commentPayload(state, text) {
  const raw = text.trim();
  return {
    raw,
    content: `<p>${escapeHtml(raw).replace(/\n/g, '<br>')}</p>`,
    allowNotification: true,
    subjectRef: {
      ...SUBJECT_REF,
      name: state.name
    }
  };
}

function replyPayload(text, replyTarget) {
  const raw = text.trim();
  return {
    raw,
    content: `<p>${escapeHtml(raw).replace(/\n/g, '<br>')}</p>`,
    allowNotification: true,
    ...(replyTarget?.quoteReply ? { quoteReply: replyTarget.quoteReply } : {})
  };
}

async function submitComment(card) {
  const state = getState(card);
  const input = card.querySelector('[data-moment-comment-input]');
  const text = input?.value || '';
  if (!state.name || !text.trim() || state.submitting) return;

  const beforeCommentCount = getCount(card, 'comment');
  state.submitting = true;
  setMessage(state, '正在发送...');
  renderComments(card);

  try {
    const replyTarget = state.replyTarget;
    const endpoint = replyTarget
      ? `${COMMENT_ENDPOINT}/${encodeURIComponent(replyTarget.commentName)}/reply`
      : COMMENT_ENDPOINT;
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(replyTarget ? replyPayload(text, replyTarget) : commentPayload(state, text))
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('登录后评论');
      if (response.status === 404) throw new Error('评论暂不可用，请打开详情页评论');
      throw new Error(replyTarget ? '回复发送失败' : '评论发送失败');
    }

    const data = await response.json().catch(() => null);
    const approved = data?.spec?.approved === true;
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    state.replyTarget = null;

    if (approved) {
      await loadComments(card, { force: true });
      if (!replyTarget) {
        card.dataset.commentCount = String(Math.max(getCount(card, 'comment'), beforeCommentCount + 1));
        syncCounts(card);
      }
      setMessage(state, '');
    } else {
      setMessage(state, replyTarget ? '回复已提交，等待审核' : '评论已提交，等待审核');
    }
    state.composerOpen = false;
    setEmojiPanel(card, false);
  } catch (error) {
    setMessage(state, error.message || '发送失败', 'error');
  } finally {
    state.submitting = false;
    renderComments(card);
  }
}

function setReplyTarget(card, button) {
  const state = getState(card);
  const commentNode = button.closest('[data-moment-comment]');
  const commentName = button.dataset.momentReplyTo || commentNode?.dataset?.momentComment || '';
  const author = button.dataset.replyAuthor || commentNode?.dataset?.author || '';
  if (!commentName) return;
  state.replyTarget = {
    commentName,
    quoteReply: button.dataset.quoteReply || '',
    author
  };
  state.composerOpen = true;
  renderComments(card);
  const input = card.querySelector('[data-moment-comment-input]');
  input?.focus();
  requestAnimationFrame(() => input?.setSelectionRange(input.value.length, input.value.length));
}

function clearReplyTarget(card) {
  const state = getState(card);
  state.replyTarget = null;
  renderComments(card);
}

function syncSubmitState(input) {
  const card = getCard(input);
  if (!card) return;
  syncCommentSubmit(card);
}

function initCards(root = document, { autoCommentObserver = null } = {}) {
  getCards(root).forEach((card) => {
    const state = getState(card);
    const panel = card.querySelector('[data-moment-emoji-panel]');
    if (panel && !panel.dataset.ready) {
      panel.dataset.ready = 'true';
      panel.innerHTML = EMOJI_PRESETS.map((emoji) => (
        `<button type="button" class="moment-feed-emoji" data-moment-emoji="${emoji}" aria-label="插入 ${emoji}">${emoji}</button>`
      )).join('');
    }
    if (shouldAutoPreviewComments(card)) {
      state.commentsOpen = true;
      state.composerOpen = false;
      if (!state.commentsLoaded && !state.commentsLoading) {
        if (autoCommentObserver) {
          autoCommentObserver.observe(card);
        } else {
          enqueueAutoCommentPreview(card);
        }
      }
    }
    renderCard(card);
    if (state.isDetail && !state.commentsLoaded && !state.commentsLoading) {
      void loadComments(card);
    } else if (state.isDetail) {
      focusCommentsFromHash(card);
    }
  });
}

export function setupMomentInteractions(root = document) {
  const scope = root && typeof root.querySelector === 'function' ? root : document;
  const appRoot = scope.matches?.('[data-app-root="moments"]')
    ? scope
    : scope.querySelector('[data-app-root="moments"]');
  const container = appRoot?.querySelector('.moment-comments--custom')
    || appRoot?.querySelector('.moments-feed-list')
    || scope.querySelector('.moment-comments--custom')
    || scope.querySelector('.moments-feed-list')
    || document.querySelector('.moments-feed-list')
    || document.querySelector('.moment-comments--custom');
  if (!container) return null;

  if (container._momentsInteractionsCleanup) {
    container._momentsInteractionsCleanup();
  }

  const ownerDocument = container.ownerDocument || document;
  const scrollBody = container.closest('.moments-body');
  const eventHost = appRoot || container;
  const autoCommentObserver = !container.matches('.moment-comments--custom') && 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        autoCommentObserver.unobserve(entry.target);
        enqueueAutoCommentPreview(entry.target);
      });
    }, {
      root: scrollBody || null,
      rootMargin: '520px 0px',
      threshold: 0.01
    })
    : null;
  initCards(container, { autoCommentObserver });
  retainPhotoViewerLifecycle();

  function onClick(event) {
    const target = event.target;
    const mediaThumb = target.closest?.('[data-moment-photo]');
    if (mediaThumb && eventHost.contains(mediaThumb)) {
      event.preventDefault();
      openPhotoViewer(mediaThumb);
      return;
    }

    const card = getCard(target);
    if (!card) {
      closeAllMenus(container);
      return;
    }

    if (target.closest?.('[data-moment-action-toggle]')) {
      event.preventDefault();
      toggleMenu(card, container);
      return;
    }
    if (target.closest?.('[data-moment-upvote]')) {
      event.preventDefault();
      closeMenu(card);
      upvoteMoment(card);
      return;
    }
    if (target.closest?.('[data-moment-comments-toggle]')) {
      event.preventDefault();
      openComments(card, container);
      return;
    }
    const emojiToggle = target.closest?.('[data-moment-emoji-toggle]');
    if (emojiToggle) {
      event.preventDefault();
      const panel = card.querySelector('[data-moment-emoji-panel]');
      setEmojiPanel(card, !!panel?.hidden);
      card.querySelector('[data-moment-comment-input]')?.focus();
      return;
    }
    const emojiButton = target.closest?.('[data-moment-emoji]');
    if (emojiButton) {
      event.preventDefault();
      insertAtCursor(card.querySelector('[data-moment-comment-input]'), emojiButton.dataset.momentEmoji || '');
      setEmojiPanel(card, false);
      return;
    }
    const replyButton = target.closest?.('[data-moment-reply-to]');
    if (replyButton) {
      event.preventDefault();
      setReplyTarget(card, replyButton);
      return;
    }
    if (target.closest?.('[data-moment-reply-cancel]')) {
      event.preventDefault();
      clearReplyTarget(card);
      return;
    }
    const repliesMore = target.closest?.('[data-moment-replies-more]');
    if (repliesMore) {
      event.preventDefault();
      loadMoreReplies(card, repliesMore.dataset.momentRepliesMore || '');
      return;
    }
    const commentsMore = target.closest?.('[data-moment-comments-more]');
    if (commentsMore) {
      event.preventDefault();
      const state = getState(card);
      if (!state.isDetail) {
        const href = `${state.detailUrl}#moment-comments`;
        if (window.pjax?.loadUrl) window.pjax.loadUrl(href);
        else window.location.href = href;
        return;
      }
      loadComments(card, { append: true, page: state.commentsPage + 1 });
    }
  }

  function onInput(event) {
    if (event.target?.matches?.('[data-moment-comment-input]')) {
      syncSubmitState(event.target);
    }
  }

  function onKeydown(event) {
    const mediaThumb = event.target?.closest?.('[data-moment-photo]');
    if (mediaThumb && eventHost.contains(mediaThumb) && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openPhotoViewer(mediaThumb);
      return;
    }

    if (event.key === 'Escape') {
      closeAllMenus(container);
      const card = getCard(event.target);
      if (card) {
        setEmojiPanel(card, false);
        clearReplyTarget(card);
      }
      return;
    }
    const replyTarget = event.target?.closest?.('[data-moment-reply-to]');
    if (replyTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const card = getCard(replyTarget);
      if (card) setReplyTarget(card, replyTarget);
      return;
    }
    if (event.target?.matches?.('[data-moment-comment-input]') && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const card = getCard(event.target);
      if (card) submitComment(card);
    }
  }

  function onSubmit(event) {
    if (!event.target?.matches?.('[data-moment-comment-form]')) return;
    event.preventDefault();
    const card = getCard(event.target);
    if (card) submitComment(card);
  }

  function onDocumentClick(event) {
    if (!container.contains(event.target)) {
      closeAllMenus(container);
      getCards(container).forEach((card) => setEmojiPanel(card, false));
    }
  }

  function onFeedUpdated() {
    initCards(container, { autoCommentObserver });
  }

  function onScroll() {
    closeAllMenus(container);
  }

  eventHost.addEventListener('click', onClick);
  eventHost.addEventListener('keydown', onKeydown);
  container.addEventListener('input', onInput);
  container.addEventListener('submit', onSubmit);
  ownerDocument.addEventListener('click', onDocumentClick);
  window.addEventListener('moments:feed-updated', onFeedUpdated);
  scrollBody?.addEventListener('scroll', onScroll, { passive: true });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    photoViewer?.close();
    getCards(container).forEach((card) => {
      const state = getState(card);
      state.commentsRequestGeneration += 1;
      state.abortController?.abort();
      state.abortController = null;
      state.commentsLoading = false;
    });
    eventHost.removeEventListener('click', onClick);
    eventHost.removeEventListener('keydown', onKeydown);
    container.removeEventListener('input', onInput);
    container.removeEventListener('submit', onSubmit);
    ownerDocument.removeEventListener('click', onDocumentClick);
    window.removeEventListener('moments:feed-updated', onFeedUpdated);
    scrollBody?.removeEventListener('scroll', onScroll);
    autoCommentObserver?.disconnect();
    if (container._momentsInteractionsCleanup === cleanup) {
      container._momentsInteractionsCleanup = null;
    }
    releasePhotoViewerLifecycle();
  };
  container._momentsInteractionsCleanup = cleanup;
  return cleanup;
}
