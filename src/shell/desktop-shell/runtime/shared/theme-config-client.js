const DEFAULT_THEME_CONFIG_TIMEOUT = 15_000;
const mutationQueues = new Map();

function responseContentType(response) {
  return String(response?.headers?.get?.('content-type') || '').toLowerCase();
}

function isJsonResponse(response) {
  return responseContentType(response).includes('json');
}

function createRequestError(message, {
  code = 'request-failed',
  response = null,
  cause = null
} = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'ThemeConfigRequestError';
  error.code = code;
  error.response = response;
  return error;
}

function resolveResponseError(response, fallback) {
  if (response?.redirected || [401, 403].includes(response?.status)) {
    return createRequestError('当前登录状态已失效，或账号没有管理主题配置的权限', {
      code: 'unauthorized',
      response
    });
  }
  if ([409, 412].includes(response?.status)) {
    return createRequestError('主题配置已被其他窗口修改，请重新读取后再保存', {
      code: 'conflict',
      response
    });
  }
  if (response?.status === 404) {
    return createRequestError('当前 Halo 版本未提供主题配置接口', {
      code: 'not-found',
      response
    });
  }
  return createRequestError(`${fallback}（HTTP ${response?.status || 0}）`, {
    response
  });
}

function createTimedSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const duration = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_THEME_CONFIG_TIMEOUT;
  let timedOut = false;

  const abortFromParent = () => {
    const reason = parentSignal?.reason
      || new DOMException('Theme config request aborted', 'AbortError');
    controller.abort(reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
  }

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Theme config request timed out', 'TimeoutError'));
  }, duration);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      globalThis.clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
    }
  };
}

// Keep the deadline and parent cancellation alive until the response body has
// been consumed. fetch() alone settles as soon as response headers arrive.
async function fetchWithTimeout(url, options, timeoutMs, consume) {
  const timed = createTimedSignal(options.signal, timeoutMs);
  let onAbort;
  try {
    timed.signal.throwIfAborted();
    const aborted = new Promise((_resolve, reject) => {
      onAbort = () => reject(timed.signal.reason);
      timed.signal.addEventListener('abort', onAbort, { once: true });
    });
    const request = (async () => {
      const response = await fetch(url, { ...options, signal: timed.signal });
      timed.signal.throwIfAborted();
      return consume(response, timed.signal);
    })();
    return await Promise.race([request, aborted]);
  } catch (error) {
    if (timed.didTimeout()) {
      throw createRequestError(options.method === 'PUT'
        ? '保存请求超时，结果尚未确认，请重新读取配置后再保存'
        : '主题配置请求超时，请检查网络后重试', {
        code: 'timeout',
        cause: error
      });
    }
    throw error;
  } finally {
    if (onAbort) timed.signal.removeEventListener('abort', onAbort);
    timed.cleanup();
  }
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) {
    throw createRequestError('主题配置接口地址为空', { code: 'invalid-endpoint' });
  }
  return value;
}

function lockNameForEndpoint(endpoint) {
  try {
    const base = globalThis.location?.origin || 'http://theme.local';
    const url = new URL(endpoint, base);
    return `theme-config:${url.origin}${url.pathname}`;
  } catch (_error) {
    return `theme-config:${endpoint}`;
  }
}

async function withCrossTabLock(endpoint, task, signal) {
  signal?.throwIfAborted();
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') {
    return task();
  }
  return locks.request(lockNameForEndpoint(endpoint), {
    mode: 'exclusive',
    ...(signal ? { signal } : {})
  }, task);
}

function enqueueMutation(endpoint, task, signal) {
  const previous = mutationQueues.get(endpoint) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => withCrossTabLock(endpoint, task, signal));
  const tail = current.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (mutationQueues.get(endpoint) === tail) {
      mutationQueues.delete(endpoint);
    }
  });
  mutationQueues.set(endpoint, tail);
  return current;
}

function validateReadResponse(response) {
  if (!response?.ok || response.redirected) {
    throw resolveResponseError(response, '读取主题配置失败');
  }
  if (!isJsonResponse(response)) {
    throw createRequestError('主题配置接口没有返回 JSON', {
      code: 'invalid-response',
      response
    });
  }
}

function validateWriteResponse(response) {
  if (!response?.ok || response.redirected) {
    throw resolveResponseError(response, '保存主题配置失败');
  }
  if (response.status !== 204 && !isJsonResponse(response)) {
    throw createRequestError('保存接口返回了非 JSON 内容，无法确认配置已经写入', {
      code: 'invalid-response',
      response
    });
  }
}

export function readCookie(name) {
  const prefix = `${name}=`;
  const item = String(globalThis.document?.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

export async function readThemeConfig(endpoint, {
  signal = null,
  timeoutMs = DEFAULT_THEME_CONFIG_TIMEOUT
} = {}) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  return fetchWithTimeout(normalizedEndpoint, {
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    },
    signal
  }, timeoutMs, async (response, timedSignal) => {
    validateReadResponse(response);
    try {
      const config = await response.json();
      timedSignal.throwIfAborted();
      return { config, response };
    } catch (error) {
      if (timedSignal.aborted) throw timedSignal.reason;
      throw createRequestError('主题配置接口返回了无法解析的 JSON', {
        code: 'invalid-response', response, cause: error
      });
    }
  });
}

export async function mutateThemeConfig(endpoint, mutate, {
  signal = null,
  timeoutMs = DEFAULT_THEME_CONFIG_TIMEOUT,
  csrfToken = readCookie('XSRF-TOKEN')
} = {}) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (typeof mutate !== 'function') {
    throw createRequestError('主题配置写入缺少合并函数', { code: 'invalid-mutation' });
  }

  return enqueueMutation(normalizedEndpoint, async () => {
    const { config: currentConfig, response: readResponse } = await readThemeConfig(normalizedEndpoint, {
      signal,
      timeoutMs
    });
    const nextConfig = await mutate(currentConfig);
    if (!nextConfig || typeof nextConfig !== 'object') {
      throw createRequestError('主题配置合并结果无效', { code: 'invalid-mutation' });
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (csrfToken) {
      headers['X-XSRF-TOKEN'] = csrfToken;
    }
    const etag = readResponse.headers?.get?.('etag');
    if (etag) {
      headers['If-Match'] = etag;
    }

    return fetchWithTimeout(normalizedEndpoint, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(nextConfig),
      signal
    }, timeoutMs, async (response, timedSignal) => {
      validateWriteResponse(response);

      let responsePayload = null;
      if (response.status !== 204) {
        try {
          responsePayload = await response.json();
        } catch (error) {
          if (timedSignal.aborted) throw timedSignal.reason;
          throw createRequestError('保存接口返回了无法解析的 JSON，无法确认配置已经写入', {
            code: 'invalid-response', response, cause: error
          });
        }
      }
      timedSignal.throwIfAborted();

      return {
        previousConfig: currentConfig,
        config: nextConfig,
        requestedConfig: nextConfig,
        responsePayload,
        response
      };
    });
  }, signal);
}

export { DEFAULT_THEME_CONFIG_TIMEOUT };
