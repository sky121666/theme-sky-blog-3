const BLOCKED_EXTENSIONS = ['.svg', '.html', '.htm', '.js', '.exe', '.bat', '.sh', '.php'];

const MEDIA_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  video: ['.mp4', '.webm', '.ogg', '.ogv', '.mov'],
  audio: ['.mp3', '.wav', '.ogg', '.oga', '.aac', '.m4a']
};

const MEDIA_ACCEPTS = {
  image: 'image/jpeg,image/jpg,image/png,image/gif,image/webp',
  video: 'video/mp4,video/webm,video/ogg,video/quicktime',
  audio: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a'
};

const MEDIA_TYPE_MAP = {
  image: 'PHOTO',
  video: 'VIDEO',
  audio: 'AUDIO'
};

const EMOJI_PRESETS = ['😀', '😄', '😂', '🤣', '😊', '😍', '😘', '😎', '🥳', '😭', '🥺', '😅', '👍', '👏', '🙏', '❤️', '🔥', '✨', '🎉', '🤔', '😴', '😋', '😤', '🙈'];

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSafeUrl(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return !!raw && !raw.startsWith('javascript:') && !raw.startsWith('data:');
}

function sanitizeTag(value = '') {
  return String(value || '').replace(/[<>'"&]/g, '').trim();
}

function createMomentName() {
  return 'moment-' + (globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2));
}

// One unacknowledged public create per author and tab. Keep its original payload,
// including its name and timestamp; never reconstruct it from editable controls.
const pendingByAuthor = new Map();
const receiptKey = author => 'theme:moment-publish:pending:' + author;
function savePending(author, payload) {
  try {
    if (payload) sessionStorage.setItem(receiptKey(author), JSON.stringify(payload));
    else sessionStorage.removeItem(receiptKey(author));
    pendingByAuthor.delete(author);
  } catch {
    // A private window can still recover across same-document navigation.
    pendingByAuthor.set(author, payload);
  }
}
function readPending(author) {
  if (pendingByAuthor.has(author)) return pendingByAuthor.get(author);
  try {
    const payload = JSON.parse(sessionStorage.getItem(receiptKey(author)) || 'null');
    if (payload?.apiVersion === 'moment.halo.run/v1alpha1' && payload.kind === 'Moment'
      && payload.spec?.owner === author && typeof payload.spec?.content?.raw === 'string'
      && Array.isArray(payload.spec.tags) && payload.spec.tags.every(tag => typeof tag === 'string')
      && (payload.spec.content.medium === undefined || (Array.isArray(payload.spec.content.medium)
        && payload.spec.content.medium.every(item => item && typeof item.url === 'string' && isSafeUrl(item.url)
          && ['PHOTO', 'VIDEO', 'AUDIO'].includes(item.type))))
      && /^moment-[a-z0-9-]+$/.test(payload.metadata?.name)) return payload;
  } catch { /* Storage may be unavailable. */ }
  return null;
}
function clearPending(payload) {
  const author = payload.spec.owner;
  if (readPending(author)?.metadata.name === payload.metadata.name) savePending(author, null);
}
function samePublishedMoment(result, payload) {
  const medium = value => (value?.spec?.content?.medium || []).map(item => [item.type, item.url]);
  return result?.apiVersion === payload.apiVersion && result?.kind === 'Moment'
    && result.metadata?.name === payload.metadata.name && result.spec?.owner === payload.spec.owner
    && result.spec?.content?.raw === payload.spec.content.raw
    && JSON.stringify(medium(result)) === JSON.stringify(medium(payload))
    && JSON.stringify([...(result.spec.tags || [])].sort()) === JSON.stringify([...payload.spec.tags].sort());
}

function normalizeBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value) !== 'false';
}

async function readJson(response) {
  const type = response.headers.get('content-type') || '';
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(type)) return null;
  return response.json();
}

function readXsrfToken() {
  const match = String(document.cookie || '').match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('操作已取消', 'AbortError');
}

function abortableDelay(duration, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, duration);
    function onAbort() {
      window.clearTimeout(timer);
      reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException('操作已取消', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createTimedSignal(parentSignal, timeout = 30000) {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason instanceof Error
      ? parentSignal.reason
      : new DOMException('操作已取消', 'AbortError'));
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException('请求超时', 'TimeoutError'));
  }, timeout);
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  };
}

async function resolveCurrentUser(endpoint, signal) {
  throwIfAborted(signal);
  const response = await fetch(new URL(endpoint, window.location.origin), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  });

  if (response.status === 401 || response.status === 403 || response.redirected) {
    throw new Error('请先登录后再发布');
  }
  if (!response.ok) {
    throw new Error('无法识别当前登录用户');
  }

  const data = await readJson(response);
  const name = data?.user?.metadata?.name || data?.metadata?.name || '';
  const displayName = data?.user?.spec?.displayName || data?.spec?.displayName || name;
  if (!name || name === 'anonymousUser') {
    throw new Error('请先登录后再发布');
  }

  return { name, displayName };
}

function fileExtension(file) {
  const name = file?.name || '';
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

function fileCategory(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';

  const ext = fileExtension(file);
  return Object.entries(MEDIA_EXTENSIONS).find(([, extensions]) => extensions.includes(ext))?.[0] || '';
}

function validateFile(file, enabled) {
  if (!file || !(file instanceof File)) {
    return { valid: false, error: '无效文件' };
  }

  const ext = fileExtension(file);
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: '禁止上传该类型文件' };
  }

  const category = fileCategory(file);
  if (!category || !MEDIA_EXTENSIONS[category]?.includes(ext)) {
    return { valid: false, error: '仅支持图片、GIF、视频或音频文件' };
  }

  if (!enabled[category]) {
    return { valid: false, error: '该媒体类型未启用' };
  }

  return { valid: true, category };
}

async function uploadFile(file, category, endpoint, signal, onAttachmentCreated = null) {
  throwIfAborted(signal);
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(new URL(endpoint, window.location.origin), {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
    signal
  });

  if (!response.ok) {
    if (response.status === 413) throw new Error('文件太大');
    if (response.status === 401 || response.status === 403) throw new Error('无权限上传');
    throw new Error('上传失败');
  }

  const attachment = await response.json();
  const attachmentName = String(attachment?.metadata?.name || '');
  if (attachmentName) onAttachmentCreated?.(attachmentName);
  let url = attachment?.status?.permalink || attachment?.spec?.permalink || '';

  if (!url && attachmentName) {
    for (let index = 0; index < 5; index += 1) {
      await abortableDelay(450, signal);
      const check = await fetch(`/api/v1alpha1/attachments/${encodeURIComponent(attachmentName)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal
      });
      if (check.ok) {
        const updated = await readJson(check);
        url = updated?.status?.permalink || updated?.spec?.permalink || '';
        if (url) break;
      }
    }
  }

  if (!isSafeUrl(url)) {
    throw new Error('未获取到有效文件地址');
  }

  return {
    type: MEDIA_TYPE_MAP[category],
    url,
    originType: file.type,
    fileName: file.name,
    attachmentName
  };
}

async function deleteDraftAttachment(name) {
  if (!name) return true;
  const headers = { Accept: 'application/json' };
  const token = readXsrfToken();
  if (token) headers['X-XSRF-TOKEN'] = token;
  const timed = createTimedSignal(null, 10000);
  try {
    const response = await fetch(`/apis/storage.halo.run/v1alpha1/attachments/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers,
      signal: timed.signal
    });
    return response.ok || response.status === 404;
  } finally {
    timed.cleanup();
  }
}

function mediaPreviewHtml(media, index) {
  const remove = `<button type="button" class="moments-publish-remove" data-moments-publish-remove="${index}" aria-label="移除媒体"><span class="icon-[lucide--x]" aria-hidden="true"></span></button>`;
  if (media.type === 'PHOTO') {
    return `<figure class="moments-publish-media"><img src="${escapeHtml(media.url)}" alt="" loading="lazy" decoding="async">${remove}</figure>`;
  }
  if (media.type === 'VIDEO') {
    return `<figure class="moments-publish-media is-video"><video src="${escapeHtml(media.url)}" preload="metadata"></video><span class="icon-[lucide--play]" aria-hidden="true"></span>${remove}</figure>`;
  }
  return `<figure class="moments-publish-media is-audio"><span class="icon-[lucide--music]" aria-hidden="true"></span><figcaption>${escapeHtml(media.fileName || '音频')}</figcaption>${remove}</figure>`;
}

function renderMedia(preview, media) {
  if (!preview) return;
  preview.hidden = media.length === 0;
  preview.dataset.count = String(media.length);
  preview.innerHTML = media.map(mediaPreviewHtml).join('');
}

function renderTags(container, tags) {
  if (!container) return;
  container.hidden = tags.length === 0;
  container.innerHTML = tags.map((tag, index) => (
    `<button type="button" class="moments-publish-tag" data-moments-publish-tag-remove="${index}">#${escapeHtml(tag)}<span aria-hidden="true">×</span></button>`
  )).join('');
}

function publishPayload({ owner, content, tags, media }) {
  const raw = content.trim();
  const safeTags = tags.map(sanitizeTag).filter(Boolean).slice(0, 10);
  const safeMedia = media.filter((item) => item && isSafeUrl(item.url) && ['PHOTO', 'VIDEO', 'AUDIO'].includes(item.type));
  const now = new Date().toISOString();
  const payload = {
    apiVersion: 'moment.halo.run/v1alpha1',
    kind: 'Moment',
    metadata: {
      name: createMomentName(),
      labels: { 'moment.halo.run/visible': 'PUBLIC' }
    },
    spec: {
      approved: true,
      approvedTime: now,
      content: {
        raw,
        html: escapeHtml(raw).replace(/\n/g, '<br>')
      },
      owner,
      visible: 'PUBLIC',
      releaseTime: now,
      tags: safeTags
    }
  };

  if (safeMedia.length > 0) {
    payload.spec.content.medium = safeMedia.map((item) => ({
      type: item.type,
      url: item.url,
      originType: item.originType
    }));
  }

  return payload;
}

async function publishRequest(endpoint, payload, signal, { check = false } = {}) {
  const url = new URL(endpoint, window.location.origin);
  if (check) url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(payload.metadata.name);
  const timed = createTimedSignal(signal, check ? 15000 : 30000);
  try {
    const response = await fetch(url, {
      method: check ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: check ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(!check && { body: JSON.stringify(payload) }), signal: timed.signal
    });
    // A login page, a redirect, a different resource and a conflict are not receipts.
    if (response.redirected || (response.url && new URL(response.url).href !== url.href)) return 'unknown';
    if (check && response.status === 404) {
      const problem = await readJson(response);
      return problem?.status === 404 || problem?.reason === 'NotFound' ? 'absent' : 'unknown';
    }
    if (!check && response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) {
      const problem = await readJson(response);
      if (!problem || problem.status !== response.status) return 'unknown';
      const error = new Error([401, 403].includes(response.status) ? '无权限发布' : response.status === 400 ? '发布数据格式错误' : '发布被拒绝，请检查后重试');
      error.definiteRejection = true;
      throw error;
    }
    if (check ? response.status !== 200 : ![200, 201].includes(response.status)) return 'unknown';
    return samePublishedMoment(await readJson(response), payload) ? 'published' : 'unknown';
  } finally { timed.cleanup(); }
}

export function setupMomentPublish(root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  const dialogs = Array.from(scope.querySelectorAll('[data-moments-publish-dialog]'));
  if (!dialogs.length && scope !== document) {
    dialogs.push(...document.querySelectorAll('[data-moments-publish-dialog]'));
  }

  const cleanups = [];
  dialogs.forEach((dialog) => {
    if (dialog._momentsPublishCleanup) {
      dialog._momentsPublishCleanup();
    }

    const portalHost = dialog.closest?.('.moments-window') || dialog.closest?.('[data-window-frame]') || dialog.parentElement;
    if (portalHost && dialog.parentElement !== portalHost) {
      portalHost.appendChild(dialog);
    }

    const openButtons = Array.from((portalHost || document).querySelectorAll('[data-moments-publish-open]'));
    const form = dialog.querySelector('[data-moments-publish-form]');
    const closeButton = dialog.querySelector('[data-moments-publish-close]');
    const textarea = dialog.querySelector('[data-moments-publish-content]');
    const counter = dialog.querySelector('[data-moments-publish-count]');
    const status = dialog.querySelector('[data-moments-publish-status]');
    const account = dialog.querySelector('[data-moments-publish-account]');
    const preview = dialog.querySelector('[data-moments-publish-preview]');
    const fileInput = dialog.querySelector('[data-moments-publish-file]');
    const submit = dialog.querySelector('[data-moments-publish-submit]');
    const newDraft = dialog.querySelector('[data-moments-publish-new]');
    const tagRow = dialog.querySelector('[data-moments-publish-tag-row]');
    const tagInput = dialog.querySelector('[data-moments-publish-tag-input]');
    const tagAdd = dialog.querySelector('[data-moments-publish-tag-add]');
    const tagToggle = dialog.querySelector('[data-moments-publish-tag-toggle]');
    const tagList = dialog.querySelector('[data-moments-publish-tags]');
    const emojiToggle = dialog.querySelector('[data-moments-publish-emoji-toggle]');
    const emojiPanel = dialog.querySelector('[data-moments-publish-emoji-panel]');
    const mediaButtons = Array.from(dialog.querySelectorAll('[data-moments-publish-media]'));
    const enabled = {
      image: normalizeBool(dialog.dataset.imageEnabled, true),
      video: normalizeBool(dialog.dataset.videoEnabled, true),
      audio: normalizeBool(dialog.dataset.audioEnabled, true)
    };
    const endpoints = {
      user: dialog.dataset.userEndpoint || '/apis/api.console.halo.run/v1alpha1/users/-',
      upload: dialog.dataset.uploadEndpoint || '/apis/uc.api.storage.halo.run/v1alpha1/attachments/-/upload',
      moment: dialog.dataset.momentEndpoint || '/apis/moment.halo.run/v1alpha1/moments'
    };

    let currentUser = null;
    let pendingPublish = null;
    let mayRetryOriginal = false;
    let media = [];
    let tags = [];
    let uploadCategory = 'image';
    let isBusy = false;
    let disposed = false;
    let operationGeneration = 0;
    let activeOperation = null;
    let redirectTimer = null;
    let closingAfterSuccess = false;
    let closeHandled = false;
    let returnFocus = null;
    const stagedAttachmentNames = new Set();
    const deletingAttachmentNames = new Set();
    const lifecycleController = new AbortController();

    function abortActiveOperation() {
      operationGeneration += 1;
      activeOperation?.controller.abort(new DOMException('操作已取消', 'AbortError'));
      activeOperation = null;
    }

    function beginOperation(type) {
      abortActiveOperation();
      const operation = {
        type,
        generation: operationGeneration,
        controller: new AbortController()
      };
      activeOperation = operation;
      return operation;
    }

    function isCurrentOperation(operation) {
      return !disposed
        && dialog.isConnected
        && activeOperation === operation
        && operation.generation === operationGeneration
        && !operation.controller.signal.aborted;
    }

    function finishOperation(operation) {
      if (activeOperation === operation) activeOperation = null;
    }

    function setStatus(message = '', tone = '') {
      if (!status) return;
      status.textContent = message;
      status.dataset.tone = tone;
    }

    function updateSubmitState() {
      if (submit) submit.disabled = isBusy || (!pendingPublish && !textarea?.value.trim() && media.length === 0);
    }

    function setBusy(busy, label = '发表') {
      isBusy = busy;
      const frozen = Boolean(pendingPublish);
      form?.setAttribute('aria-busy', String(busy));
      if (textarea) textarea.readOnly = frozen || busy;
      if (submit) submit.textContent = busy ? label : frozen ? (mayRetryOriginal ? '重试原稿' : '核对发布结果') : '发表';
      if (closeButton) closeButton.textContent = frozen ? '关闭' : '取消';
      if (newDraft) { newDraft.hidden = !frozen || busy; newDraft.disabled = busy; }
      if (frozen) {
        if (tagRow) tagRow.hidden = true;
        if (emojiPanel) emojiPanel.hidden = true;
        tagToggle?.setAttribute('aria-expanded', 'false');
        emojiToggle?.setAttribute('aria-expanded', 'false');
      }
      for (const control of [fileInput, tagInput, tagAdd, tagToggle, emojiToggle, ...mediaButtons,
        ...dialog.querySelectorAll('[data-moments-publish-remove], [data-moments-publish-tag-remove], [data-moments-publish-emoji]')]) {
        if (control) control.disabled = frozen || busy;
      }
      updateSubmitState();
    }

    function displayPending(payload) {
      pendingPublish = payload;
      mayRetryOriginal = false;
      if (textarea) textarea.value = payload.spec.content.raw;
      tags = [...payload.spec.tags];
      media = [...(payload.spec.content.medium || [])];
      renderTags(tagList, tags);
      renderMedia(preview, media);
      updateCounter();
      setBusy(false);
      setStatus('发布结果待确认。请先核对；关闭窗口会保留原稿和附件。', 'error');
    }

    function startSeparateDraft() {
      if (isBusy || !pendingPublish || !window.confirm('上一条瞬间可能已经发表。结束核对、保留其附件，并另写一条空白新稿？')) return;
      clearPending(pendingPublish);
      pendingPublish = null;
      mayRetryOriginal = false;
      reset();
      setBusy(false);
      textarea?.focus();
    }

    function updateCounter() {
      if (!counter || !textarea) return;
      counter.textContent = `${textarea.value.length}/1000`;
      counter.dataset.over = textarea.value.length > 1000 ? 'true' : 'false';
      updateSubmitState();
    }

    function reset() {
      media = [];
      tags = [];
      if (textarea) textarea.value = '';
      if (fileInput) fileInput.value = '';
      if (tagInput) tagInput.value = '';
      if (tagRow) tagRow.hidden = true;
      if (emojiPanel) emojiPanel.hidden = true;
      tagToggle?.setAttribute('aria-expanded', 'false');
      emojiToggle?.setAttribute('aria-expanded', 'false');
      renderMedia(preview, media);
      renderTags(tagList, tags);
      setStatus('');
      updateCounter();
      updateSubmitState();
    }

    async function cleanupDraftAttachment(name, { report = false } = {}) {
      if (!name || !stagedAttachmentNames.has(name) || deletingAttachmentNames.has(name)) return true;
      deletingAttachmentNames.add(name);
      try {
        const deleted = await deleteDraftAttachment(name);
        if (deleted) stagedAttachmentNames.delete(name);
        if (!deleted && report && dialog.open) {
          setStatus('媒体已从草稿移除，但附件清理失败，请到附件库检查。', 'error');
        }
        return deleted;
      } catch (_error) {
        if (report && dialog.open) {
          setStatus('媒体已从草稿移除，但附件清理失败，请到附件库检查。', 'error');
        }
        return false;
      } finally {
        deletingAttachmentNames.delete(name);
      }
    }

    function cleanupAllDraftAttachments() {
      return Promise.allSettled(
        Array.from(stagedAttachmentNames, (name) => cleanupDraftAttachment(name))
      );
    }

    async function ensureUser(signal = lifecycleController.signal) {
      throwIfAborted(signal);
      if (currentUser) return currentUser;
      const user = await resolveCurrentUser(endpoints.user, signal);
      throwIfAborted(signal);
      if (disposed) throw new DOMException('组件已销毁', 'AbortError');
      currentUser = user;
      if (account) account.textContent = `发布为 ${user.displayName || user.name}`;
      return user;
    }

    async function syncPublishVisibility() {
      openButtons.forEach((button) => {
        button.hidden = true;
      });
      try {
        await ensureUser(lifecycleController.signal);
        if (disposed) return;
        openButtons.forEach((button) => {
          button.hidden = false;
        });
      } catch {
        if (disposed) return;
        openButtons.forEach((button) => {
          button.hidden = true;
        });
      }
    }

    async function openDialog(event) {
      event?.preventDefault();
      returnFocus = event?.currentTarget || document.activeElement;
      try {
        setStatus('正在检查登录状态...');
        const user = await ensureUser(lifecycleController.signal);
        if (disposed || dialog.open) return;
        if (redirectTimer !== null) { window.clearTimeout(redirectTimer); redirectTimer = null; }
        closeHandled = false;
        const saved = readPending(user.name);
        if (saved) displayPending(saved); else { setBusy(false); setStatus(''); }
        if (typeof dialog.show === 'function') dialog.show();
        else dialog.setAttribute('open', '');
        requestAnimationFrame(() => { if (!disposed && dialog.open) (pendingPublish ? submit : textarea)?.focus(); });
      } catch (error) {
        if (disposed || error?.name === 'AbortError') return;
        closeHandled = false;
        setStatus(error.message || '无法打开发布窗口', 'error');
        if (typeof dialog.show === 'function') dialog.show();
        else dialog.setAttribute('open', '');
      }
    }

    function closeDialog({ afterSuccess = false } = {}) {
      closingAfterSuccess = afterSuccess;
      if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      // Native close is queued. Detach the request and protect its media now,
      // before a late completion or another open can reuse this editor.
      onDialogClose();
    }

    function onCloseButton(event) {
      event?.preventDefault();
      closeDialog();
    }

    function onDialogClose() {
      // A native close event can arrive after another interaction, or even
      // after this non-modal dialog has been opened again.
      if (dialog.open || closeHandled) return;
      closeHandled = true;
      const focusTarget = returnFocus;
      returnFocus = null;
      const ownerDocument = dialog.ownerDocument;
      const activeElement = ownerDocument.activeElement;
      const ownsFocus = !activeElement || activeElement === ownerDocument.body
        || activeElement === ownerDocument.documentElement
        || activeElement === focusTarget || dialog.contains(activeElement);
      const completedSuccessfully = closingAfterSuccess;
      closingAfterSuccess = false;
      if (!completedSuccessfully) {
        abortActiveOperation();
        void cleanupAllDraftAttachments();
      } else {
        stagedAttachmentNames.clear();
      }
      pendingPublish = null;
      mayRetryOriginal = false;
      reset();
      setBusy(false);
      if (!disposed && ownsFocus && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    }

    function onDialogKeydown(event) {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      event.stopPropagation();
      if (emojiPanel && !emojiPanel.hidden) {
        emojiPanel.hidden = true;
        emojiToggle?.setAttribute('aria-expanded', 'false');
        emojiToggle?.focus({ preventScroll: true });
      } else if (tagRow && !tagRow.hidden) {
        tagRow.hidden = true;
        tagToggle?.setAttribute('aria-expanded', 'false');
        tagToggle?.focus({ preventScroll: true });
      } else closeDialog();
    }

    function chooseMedia(event) {
      const category = event.currentTarget?.dataset?.momentsPublishMedia || 'image';
      uploadCategory = category;
      if (!fileInput) return;
      fileInput.accept = MEDIA_ACCEPTS[category] || MEDIA_ACCEPTS.image;
      fileInput.click();
    }

    async function onFileChange(event) {
      const files = Array.from(event.target.files || []);
      if (!files.length || pendingPublish || isBusy) return;
      const operation = beginOperation('upload');
      setBusy(true, '上传中...');
      setStatus('正在上传媒体...');
      const errors = [];
      for (const file of files) {
        const validation = validateFile(file, enabled);
        if (!validation.valid) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }
        try {
          const uploaded = await uploadFile(
            file,
            validation.category || uploadCategory,
            endpoints.upload,
            operation.controller.signal,
            (attachmentName) => stagedAttachmentNames.add(attachmentName)
          );
          if (!isCurrentOperation(operation)) return;
          media.push(uploaded);
        } catch (error) {
          if (error?.name === 'AbortError' || !isCurrentOperation(operation)) return;
          errors.push(`${file.name}: ${error.message}`);
        }
      }
      if (!isCurrentOperation(operation)) return;
      finishOperation(operation);
      renderMedia(preview, media);
      updateSubmitState();
      setStatus(errors.length ? `部分文件上传失败：${errors.join('；')}` : '', errors.length ? 'error' : '');
      setBusy(false);
      event.target.value = '';
    }

    function addTag() {
      const value = sanitizeTag(tagInput?.value || '');
      if (!value) return;
      if (tags.length >= 10) {
        setStatus('最多添加 10 个标签', 'error');
        return;
      }
      if (!tags.includes(value)) {
        tags.push(value);
      }
      if (tagInput) tagInput.value = '';
      renderTags(tagList, tags);
      setStatus('');
    }

    function onDialogClick(event) {
      if (pendingPublish || isBusy) return;
      const emojiButton = event.target.closest?.('[data-moments-publish-emoji]');
      if (emojiButton) {
        insertEmoji(emojiButton.dataset.momentsPublishEmoji || '');
        return;
      }
      const removeMedia = event.target.closest?.('[data-moments-publish-remove]');
      if (removeMedia) {
        const [removed] = media.splice(Number(removeMedia.dataset.momentsPublishRemove), 1);
        if (removed?.attachmentName) {
          void cleanupDraftAttachment(removed.attachmentName, { report: true });
        }
        renderMedia(preview, media);
        updateSubmitState();
        return;
      }
      const removeTag = event.target.closest?.('[data-moments-publish-tag-remove]');
      if (removeTag) {
        tags.splice(Number(removeTag.dataset.momentsPublishTagRemove), 1);
        renderTags(tagList, tags);
      }
    }

    function onTagToggle() {
      if (!tagRow) return;
      tagRow.hidden = !tagRow.hidden;
      tagToggle?.setAttribute('aria-expanded', String(!tagRow.hidden));
      if (!tagRow.hidden) {
        if (emojiPanel) emojiPanel.hidden = true;
        emojiToggle?.setAttribute('aria-expanded', 'false');
        tagInput?.focus();
      }
    }

    function onEmojiToggle() {
      if (!emojiPanel) return;
      emojiPanel.hidden = !emojiPanel.hidden;
      emojiToggle?.setAttribute('aria-expanded', String(!emojiPanel.hidden));
      if (!emojiPanel.hidden) {
        if (tagRow) tagRow.hidden = true;
        tagToggle?.setAttribute('aria-expanded', 'false');
        textarea?.focus();
      }
    }

    function insertEmoji(emoji) {
      if (!emoji || !textarea) return;
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      textarea.value = `${textarea.value.slice(0, start)}${emoji}${textarea.value.slice(end)}`;
      const cursor = start + emoji.length;
      textarea.setSelectionRange(cursor, cursor);
      textarea.focus();
      updateCounter();
    }

    function onTagInputKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTag();
      }
    }

    async function onSubmit(event) {
      event.preventDefault();
      if (isBusy) return;
      const content = textarea?.value || '';
      if (!pendingPublish && !content.trim() && media.length === 0) {
        setStatus('请输入内容或上传媒体', 'error');
        return;
      }

      const previous = pendingPublish;
      const check = Boolean(previous && !mayRetryOriginal);
      const operation = beginOperation(check ? 'verify' : 'publish');
      let firstAttemptMedia = [];
      try {
        setBusy(true, check ? '核对中…' : '发布中...');
        setStatus(check ? '正在核对这条瞬间…' : '正在发布...');
        const user = await ensureUser(operation.controller.signal);
        if (!isCurrentOperation(operation)) return;
        const payload = previous || publishPayload({ owner: user.name, content, tags, media });
        if (!previous) {
          // From dispatch onwards these files may be referenced by a public
          // moment, even if cancel, disposal or a gateway interrupts the reply.
          firstAttemptMedia = media.map(item => item.attachmentName).filter(name => stagedAttachmentNames.has(name));
          firstAttemptMedia.forEach(name => stagedAttachmentNames.delete(name));
          savePending(user.name, payload);
        }
        pendingPublish = payload;
        mayRetryOriginal = false;
        setBusy(true, check ? '核对中…' : '发布中...');
        const result = await publishRequest(endpoints.moment, payload, operation.controller.signal, { check });
        if (!isCurrentOperation(operation)) return;
        if (result !== 'published') {
          mayRetryOriginal = result === 'absent';
          setStatus(mayRetryOriginal ? '尚未查到这条瞬间。可以重试原稿，使用同一资源名。'
            : '发布结果待确认。请核对后再操作，原稿和附件已保留。', 'error');
          return;
        }
        clearPending(payload);
        pendingPublish = null;
        finishOperation(operation);
        stagedAttachmentNames.clear();
        setStatus('发布成功，正在刷新列表...');
        reset();
        closeDialog({ afterSuccess: true });
        redirectTimer = window.setTimeout(() => {
          redirectTimer = null;
          if (disposed || lifecycleController.signal.aborted) return;
          if (window.pjax?.loadUrl) {
            window.pjax.loadUrl('/moments');
          } else {
            window.location.href = '/moments';
          }
        }, 250);
      } catch (error) {
        if (!isCurrentOperation(operation)) return;
        if (error?.definiteRejection && !previous && pendingPublish) {
          clearPending(pendingPublish);
          pendingPublish = null;
          firstAttemptMedia.forEach(name => stagedAttachmentNames.add(name));
        }
        setStatus(pendingPublish ? '发布结果待确认。请核对后再操作，原稿和附件已保留。' : error.message || '发布失败', 'error');
      } finally {
        if (isCurrentOperation(operation)) {
          finishOperation(operation);
          setBusy(false);
          if (dialog.open && dialog.ownerDocument.activeElement === dialog.ownerDocument.body) {
            (pendingPublish ? submit : textarea)?.focus({ preventScroll: true });
          }
        }
      }
    }

    openButtons.forEach((button) => button.addEventListener('click', openDialog));
    closeButton?.addEventListener('click', onCloseButton);
    newDraft?.addEventListener('click', startSeparateDraft);
    textarea?.addEventListener('input', updateCounter);
    fileInput?.addEventListener('change', onFileChange);
    form?.addEventListener('submit', onSubmit);
    mediaButtons.forEach((button) => button.addEventListener('click', chooseMedia));
    tagToggle?.addEventListener('click', onTagToggle);
    emojiToggle?.addEventListener('click', onEmojiToggle);
    tagAdd?.addEventListener('click', addTag);
    tagInput?.addEventListener('keydown', onTagInputKeydown);
    dialog.addEventListener('click', onDialogClick);
    dialog.addEventListener('keydown', onDialogKeydown);
    dialog.addEventListener('close', onDialogClose);
    if (emojiPanel) {
      emojiPanel.innerHTML = EMOJI_PRESETS.map((emoji) => (
        `<button type="button" class="moments-publish-emoji" data-moments-publish-emoji="${emoji}" aria-label="插入 ${emoji}">${emoji}</button>`
      )).join('');
    }
    updateCounter();
    syncPublishVisibility();

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      disposed = true;
      lifecycleController.abort(new DOMException('组件已销毁', 'AbortError'));
      abortActiveOperation();
      void cleanupAllDraftAttachments();
      if (redirectTimer !== null) {
        window.clearTimeout(redirectTimer);
        redirectTimer = null;
      }
      closingAfterSuccess = false;
      if (dialog.open) closeDialog();
      openButtons.forEach((button) => button.removeEventListener('click', openDialog));
      closeButton?.removeEventListener('click', onCloseButton);
      newDraft?.removeEventListener('click', startSeparateDraft);
      textarea?.removeEventListener('input', updateCounter);
      fileInput?.removeEventListener('change', onFileChange);
      form?.removeEventListener('submit', onSubmit);
      mediaButtons.forEach((button) => button.removeEventListener('click', chooseMedia));
      tagToggle?.removeEventListener('click', onTagToggle);
      emojiToggle?.removeEventListener('click', onEmojiToggle);
      tagAdd?.removeEventListener('click', addTag);
      tagInput?.removeEventListener('keydown', onTagInputKeydown);
      dialog.removeEventListener('click', onDialogClick);
      dialog.removeEventListener('keydown', onDialogKeydown);
      dialog.removeEventListener('close', onDialogClose);
      if (dialog._momentsPublishCleanup === cleanup) {
        dialog._momentsPublishCleanup = null;
      }
    };

    dialog._momentsPublishCleanup = cleanup;
    cleanups.push(cleanup);
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
