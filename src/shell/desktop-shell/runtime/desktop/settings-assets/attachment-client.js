// Halo v2.26.1: AttachmentEndpoint, SearchRequest, Attachment and Policy APIs.
const CONSOLE_ATTACHMENTS = '/apis/api.console.halo.run/v1alpha1/attachments';
const STORAGE_API = '/apis/storage.halo.run/v1alpha1';
const READ_TIMEOUT = 15_000;
const UPLOAD_TIMEOUT = 60_000;
const DEFAULT_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SUPPORTED_IMAGE_TYPES = new Set([...DEFAULT_UPLOAD_TYPES, 'image/gif', 'image/svg+xml']);

function requestError(message, code, details = {}) {
  return Object.assign(new Error(message), { name: 'AttachmentRequestError', code, ...details });
}

// Include response consumption in the deadline: fetch resolves on headers alone.
async function withDeadline(signal, duration, task) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = globalThis.setTimeout(() => {
    controller.abort(requestError('附件请求超时，请稍后重试', 'timeout'));
  }, duration);
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([task(controller.signal), aborted]);
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

async function requestJson(url, { signal, method = 'GET', body, headers = {}, timeout = READ_TIMEOUT } = {}) {
  return withDeadline(signal, timeout, async (requestSignal) => {
    let response;
    try {
      response = await fetch(url, {
        method, body, signal: requestSignal, credentials: 'same-origin', redirect: 'manual',
        headers: { Accept: 'application/json', ...headers }
      });
    } catch (cause) {
      requestSignal.throwIfAborted();
      throw requestError('附件请求失败，请检查网络连接', 'request-failed', { cause });
    }
    requestSignal.throwIfAborted();
    const status = response.status;
    if (status === 401 || response.redirected || response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
      throw requestError('登录状态已失效，请重新登录后使用附件库', 'unauthorized');
    }
    if (status === 403) {
      throw requestError('当前账号没有读取或上传附件的权限，请检查 Halo 附件权限', 'forbidden');
    }
    if (status === 404) throw requestError('当前 Halo 未提供该附件接口', 'not-found');
    if (!response.ok) throw requestError(`附件请求失败（HTTP ${status}）`, 'request-failed');
    const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw requestError('附件接口返回了登录页面，请重新登录后重试', 'unauthorized');
    }
    if (!contentType.includes('json')) throw requestError('附件接口未返回 JSON', 'invalid-response');
    try {
      const data = await response.json();
      requestSignal.throwIfAborted();
      return data;
    } catch (cause) {
      requestSignal.throwIfAborted();
      throw requestError('附件接口返回了无法解析的 JSON', 'invalid-response', { cause });
    }
  });
}

function safeImageUrl(input) {
  if (typeof input !== 'string') return '';
  const value = input.trim();
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const parsed = new URL(value);
    return parsed.hostname && !parsed.username && !parsed.password ? value : '';
  } catch (_error) {
    return '';
  }
}

function normalizeAttachment(value) {
  const name = typeof value?.metadata?.name === 'string' ? value.metadata.name : '';
  const mediaType = String(value?.spec?.mediaType || '').toLowerCase().split(';')[0].trim();
  const url = safeImageUrl(value?.status?.permalink);
  if (!name || !mediaType.startsWith('image/') || !url || value.metadata.deletionTimestamp) return null;
  return {
    name,
    displayName: typeof value.spec.displayName === 'string' ? value.spec.displayName : name,
    url,
    thumbnailUrl: safeImageUrl(value.status?.thumbnails?.S) || url,
    mediaType
  };
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function normalizeList(data) {
  if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0
    || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.size) || data.size < 1) {
    throw requestError('附件接口返回的分页结构无效', 'invalid-response');
  }
  return { items: data.items, page: data.page, total: data.total, totalPages: Math.ceil(data.total / data.size) };
}

export async function listAttachments({ keyword = '', page = 1, size = 24, signal, accepts = ['image/*'] } = {}) {
  const types = Array.isArray(accepts) ? accepts.filter((type) => type === 'image/*' || SUPPORTED_IMAGE_TYPES.has(type)) : [];
  if (!types.length) throw requestError('未指定可选图片类型', 'invalid-types');
  const query = new URLSearchParams({
    page: String(positiveInteger(page, 1)), size: String(positiveInteger(size, 24, 100)),
    sort: 'metadata.creationTimestamp,desc'
  });
  types.forEach((type) => query.append('accepts', type));
  const search = String(keyword || '').trim();
  if (search) query.set('keyword', search);
  const result = normalizeList(await requestJson(`${CONSOLE_ATTACHMENTS}?${query}`, { signal }));
  return { ...result, items: result.items.map(normalizeAttachment).filter((item) => item && (types.includes('image/*') || types.includes(item.mediaType))) };
}

export async function listUploadPolicies({ signal } = {}) {
  return withDeadline(signal, READ_TIMEOUT, async (requestSignal) => {
    const policies = new Map();
    for (let page = 1; page <= 20; page++) {
      const query = new URLSearchParams({ page: String(page), size: '100', sort: 'metadata.name,asc' });
      const result = normalizeList(await requestJson(`${STORAGE_API}/policies?${query}`, { signal: requestSignal }));
      for (const policy of result.items) {
        const name = policy?.metadata?.name;
        if (typeof name === 'string' && name && !policy.metadata.deletionTimestamp) {
          policies.set(name, { name, displayName: typeof policy.spec?.displayName === 'string' ? policy.spec.displayName : name });
        }
      }
      if (result.page >= result.totalPages) return [...policies.values()];
    }
    throw requestError('存储策略数量超出读取范围，请使用 Halo 控制台管理', 'too-many-policies');
  });
}

// Kept local so opening the picker does not eagerly import the config writer.
function readCsrfCookie() {
  const item = String(globalThis.document?.cookie || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith('XSRF-TOKEN='));
  try {
    return item ? decodeURIComponent(item.slice('XSRF-TOKEN='.length)) : '';
  } catch (_error) {
    return '';
  }
}

function waitForPoll(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, 500);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function uploadedResult(value) {
  if (value?.status?.permalink && !safeImageUrl(value.status.permalink)) {
    throw requestError('附件已上传，但返回了不安全的图片地址，请在附件库中检查', 'invalid-url');
  }
  return normalizeAttachment(value);
}

export async function uploadImage(file, { policyName, signal, accepts = DEFAULT_UPLOAD_TYPES } = {}) {
  signal?.throwIfAborted();
  if (!(file instanceof Blob) || typeof file.name !== 'string' || file.size <= 0 || !SUPPORTED_IMAGE_TYPES.has(file.type) || !accepts.includes(file.type)) {
    throw requestError('请选择此设置支持的非空图片文件', 'invalid-file');
  }
  const policy = typeof policyName === 'string' ? policyName.trim() : '';
  if (!policy) throw requestError('请先选择上传存储策略', 'invalid-policy');
  const body = new FormData();
  body.append('file', file);
  body.append('policyName', policy);
  const csrfToken = readCsrfCookie();
  let uploaded;
  try {
    uploaded = await requestJson(`${CONSOLE_ATTACHMENTS}/upload`, {
      method: 'POST', body, signal, timeout: UPLOAD_TIMEOUT,
      headers: csrfToken ? { 'X-XSRF-TOKEN': csrfToken } : {}
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (['request-failed', 'timeout', 'invalid-response'].includes(error.code)) {
      throw requestError('上传结果尚未确认，请先刷新附件库检查，避免重复上传', 'upload-uncertain', { cause: error });
    }
    throw error;
  }
  const name = uploaded?.metadata?.name;
  if (typeof name !== 'string' || !name) {
    throw requestError('上传已返回成功，但附件信息不完整，请刷新附件库检查，避免重复上传', 'upload-uncertain');
  }
  try {
    const ready = uploadedResult(uploaded);
    if (ready) return ready;
    return await withDeadline(signal, READ_TIMEOUT, async (pollSignal) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await waitForPoll(pollSignal);
        const value = await requestJson(`${STORAGE_API}/attachments/${encodeURIComponent(name)}`, { signal: pollSignal });
        const resolved = uploadedResult(value);
        if (resolved) return resolved;
      }
      throw requestError('附件已上传，图片地址尚未就绪，请稍后刷新附件库选择，无需重复上传', 'url-pending');
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    error.uploaded = true;
    error.attachmentName = name;
    if (!['url-pending', 'invalid-url'].includes(error.code)) {
      error.message = `附件已上传，但暂时无法取得图片地址：${error.message}。请刷新附件库检查，无需重复上传`;
    }
    throw error;
  }
}
