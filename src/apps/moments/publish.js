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
  return `moment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value) !== 'false';
}

async function readJson(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  return response.json();
}

async function resolveCurrentUser(endpoint) {
  const response = await fetch(new URL(endpoint, window.location.origin), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
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

async function uploadFile(file, category, endpoint) {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(new URL(endpoint, window.location.origin), {
    method: 'POST',
    credentials: 'same-origin',
    body: form
  });

  if (!response.ok) {
    if (response.status === 413) throw new Error('文件太大');
    if (response.status === 401 || response.status === 403) throw new Error('无权限上传');
    throw new Error('上传失败');
  }

  const attachment = await response.json();
  let url = attachment?.status?.permalink || attachment?.spec?.permalink || '';

  if (!url && attachment?.metadata?.name) {
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      const check = await fetch(`/api/v1alpha1/attachments/${encodeURIComponent(attachment.metadata.name)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
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
    fileName: file.name
  };
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

async function publishMoment({ endpoint, owner, content, tags, media }) {
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

  const response = await fetch(new URL(endpoint, window.location.origin), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout?.(30000)
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('无权限发布');
    if (response.status === 400) throw new Error('发布数据格式错误');
    throw new Error('发布失败，请稍后重试');
  }
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

    const openButtons = Array.from(document.querySelectorAll('[data-moments-publish-open]'));
    const form = dialog.querySelector('[data-moments-publish-form]');
    const closeButton = dialog.querySelector('[data-moments-publish-close]');
    const textarea = dialog.querySelector('[data-moments-publish-content]');
    const counter = dialog.querySelector('[data-moments-publish-count]');
    const status = dialog.querySelector('[data-moments-publish-status]');
    const account = dialog.querySelector('[data-moments-publish-account]');
    const preview = dialog.querySelector('[data-moments-publish-preview]');
    const fileInput = dialog.querySelector('[data-moments-publish-file]');
    const submit = dialog.querySelector('[data-moments-publish-submit]');
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
    let media = [];
    let tags = [];
    let uploadCategory = 'image';
    let isBusy = false;
    let disposed = false;

    function setStatus(message = '', tone = '') {
      if (!status) return;
      status.textContent = message;
      status.dataset.tone = tone;
    }

    function updateSubmitState() {
      if (submit) {
        submit.disabled = isBusy || (!textarea?.value.trim() && media.length === 0);
      }
    }

    function setBusy(busy, label = '发表') {
      isBusy = busy;
      if (submit) {
        submit.textContent = busy ? label : '发表';
      }
      updateSubmitState();
      mediaButtons.forEach((button) => {
        button.disabled = busy;
      });
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
      if (tagInput) tagInput.value = '';
      if (tagRow) tagRow.hidden = true;
      if (emojiPanel) emojiPanel.hidden = true;
      renderMedia(preview, media);
      renderTags(tagList, tags);
      setStatus('');
      updateCounter();
      updateSubmitState();
    }

    async function ensureUser() {
      if (currentUser) return currentUser;
      const user = await resolveCurrentUser(endpoints.user);
      currentUser = user;
      if (account) account.textContent = `发布为 ${user.displayName || user.name}`;
      return user;
    }

    async function syncPublishVisibility() {
      openButtons.forEach((button) => {
        button.hidden = true;
      });
      try {
        await ensureUser();
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
      try {
        setStatus('正在检查登录状态...');
        await ensureUser();
        setStatus('');
        if (typeof dialog.show === 'function') dialog.show();
        else dialog.setAttribute('open', '');
        requestAnimationFrame(() => textarea?.focus());
      } catch (error) {
        setStatus(error.message || '无法打开发布窗口', 'error');
        if (typeof dialog.show === 'function') dialog.show();
        else dialog.setAttribute('open', '');
      }
    }

    function closeDialog() {
      dialog.close?.();
      dialog.removeAttribute('open');
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
      if (!files.length) return;
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
          media.push(await uploadFile(file, validation.category || uploadCategory, endpoints.upload));
        } catch (error) {
          errors.push(`${file.name}: ${error.message}`);
        }
      }
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
      const emojiButton = event.target.closest?.('[data-moments-publish-emoji]');
      if (emojiButton) {
        insertEmoji(emojiButton.dataset.momentsPublishEmoji || '');
        return;
      }
      const removeMedia = event.target.closest?.('[data-moments-publish-remove]');
      if (removeMedia) {
        media.splice(Number(removeMedia.dataset.momentsPublishRemove), 1);
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
      if (tagRow) tagRow.hidden = !tagRow.hidden;
      if (!tagRow?.hidden) tagInput?.focus();
    }

    function onEmojiToggle() {
      if (!emojiPanel) return;
      emojiPanel.hidden = !emojiPanel.hidden;
      if (!emojiPanel.hidden) textarea?.focus();
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
      const content = textarea?.value || '';
      if (!content.trim() && media.length === 0) {
        setStatus('请输入内容或上传媒体', 'error');
        return;
      }

      try {
        setBusy(true, '发布中...');
        setStatus('正在发布...');
        const user = await ensureUser();
        await publishMoment({
          endpoint: endpoints.moment,
          owner: user.name,
          content,
          tags,
          media
        });
        setStatus('发布成功，正在刷新列表...');
        reset();
        closeDialog();
        setTimeout(() => {
          if (window.pjax?.loadUrl) {
            window.pjax.loadUrl('/moments');
          } else {
            window.location.href = '/moments';
          }
        }, 250);
      } catch (error) {
        setStatus(error.message || '发布失败', 'error');
      } finally {
        setBusy(false);
      }
    }

    openButtons.forEach((button) => button.addEventListener('click', openDialog));
    closeButton?.addEventListener('click', closeDialog);
    textarea?.addEventListener('input', updateCounter);
    fileInput?.addEventListener('change', onFileChange);
    form?.addEventListener('submit', onSubmit);
    mediaButtons.forEach((button) => button.addEventListener('click', chooseMedia));
    tagToggle?.addEventListener('click', onTagToggle);
    emojiToggle?.addEventListener('click', onEmojiToggle);
    tagAdd?.addEventListener('click', addTag);
    tagInput?.addEventListener('keydown', onTagInputKeydown);
    dialog.addEventListener('click', onDialogClick);
    dialog.addEventListener('close', reset);
    if (emojiPanel) {
      emojiPanel.innerHTML = EMOJI_PRESETS.map((emoji) => (
        `<button type="button" class="moments-publish-emoji" data-moments-publish-emoji="${emoji}" aria-label="插入 ${emoji}">${emoji}</button>`
      )).join('');
    }
    updateCounter();
    syncPublishVisibility();

    const cleanup = () => {
      disposed = true;
      openButtons.forEach((button) => button.removeEventListener('click', openDialog));
      closeButton?.removeEventListener('click', closeDialog);
      textarea?.removeEventListener('input', updateCounter);
      fileInput?.removeEventListener('change', onFileChange);
      form?.removeEventListener('submit', onSubmit);
      mediaButtons.forEach((button) => button.removeEventListener('click', chooseMedia));
      tagToggle?.removeEventListener('click', onTagToggle);
      emojiToggle?.removeEventListener('click', onEmojiToggle);
      tagAdd?.removeEventListener('click', addTag);
      tagInput?.removeEventListener('keydown', onTagInputKeydown);
      dialog.removeEventListener('click', onDialogClick);
      dialog.removeEventListener('close', reset);
      dialog._momentsPublishCleanup = null;
    };

    dialog._momentsPublishCleanup = cleanup;
    cleanups.push(cleanup);
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
