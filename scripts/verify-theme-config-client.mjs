import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHeaders(values = {}) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    get(name) {
      return normalized.get(String(name || '').toLowerCase()) || null;
    }
  };
}

function createResponse(body, {
  status = 200,
  redirected = false,
  contentType = 'application/json',
  etag = ''
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    headers: createHeaders({
      ...(contentType ? { 'content-type': contentType } : {}),
      ...(etag ? { etag } : {})
    }),
    async json() {
      return clone(body);
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

setGlobal('document', { cookie: 'XSRF-TOKEN=test-token' });
setGlobal('location', { origin: 'https://example.test' });
setGlobal('navigator', {});

const clientUrl = pathToFileURL(path.join(
  root,
  'src/shell/desktop-shell/runtime/shared/theme-config-client.js'
));
const client = await import(`${clientUrl.href}?contract=${Date.now()}`);

try {
  let config = { appearance: { accent: 'blue' }, desktop: { layout: 'old' } };
  let revision = 1;
  const callOrder = [];
  const putHeaders = [];
  setGlobal('fetch', async (_url, options = {}) => {
    const method = options.method || 'GET';
    callOrder.push(method);
    if (method === 'PUT') {
      putHeaders.push(options.headers);
      config = JSON.parse(options.body);
      revision += 1;
      await Promise.resolve();
      return createResponse(config, { etag: `\"rev-${revision}\"` });
    }
    return createResponse(config, { etag: `\"rev-${revision}\"` });
  });

  await Promise.all([
    client.mutateThemeConfig('/theme/config', (current) => ({
      ...current,
      appearance: { accent: 'purple' }
    })),
    client.mutateThemeConfig('/theme/config', (current) => ({
      ...current,
      desktop: { layout: 'new' }
    }))
  ]);

  assert.deepEqual(
    config,
    { appearance: { accent: 'purple' }, desktop: { layout: 'new' } },
    '同一端点的并发写入必须串行读取最新配置后合并'
  );
  assert.deepEqual(callOrder, ['GET', 'PUT', 'GET', 'PUT'], '配置写入必须按 GET/PUT 队列串行执行');
  assert.equal(putHeaders[0]['If-Match'], '"rev-1"', '服务端提供 ETag 时必须发送 If-Match');
  assert.equal(putHeaders[0]['X-XSRF-TOKEN'], 'test-token', '配置写入必须携带 Halo CSRF 令牌');

  let lockRequests = 0;
  setGlobal('navigator', {
    locks: {
      request(_name, options, task) {
        lockRequests += 1;
        assert.equal(options.mode, 'exclusive');
        return task();
      }
    }
  });
  await client.mutateThemeConfig('/theme/locked', (current) => ({ ...current, locked: true }));
  assert.equal(lockRequests, 1, '支持 Web Locks 时必须取得跨标签页独占锁');

  let redirectStep = 0;
  setGlobal('navigator', {});
  setGlobal('fetch', async () => {
    redirectStep += 1;
    if (redirectStep === 1) return createResponse({ value: 1 });
    return createResponse('<html>login</html>', {
      redirected: true,
      contentType: 'text/html'
    });
  });
  await assert.rejects(
    client.mutateThemeConfig('/theme/redirect', (current) => ({ ...current, value: 2 })),
    (error) => error?.code === 'unauthorized',
    '登录重定向后的 200 HTML 不得被当作保存成功'
  );

  let htmlStep = 0;
  setGlobal('fetch', async () => {
    htmlStep += 1;
    if (htmlStep === 1) return createResponse({ value: 1 });
    return createResponse('<html>unexpected</html>', { contentType: 'text/html' });
  });
  await assert.rejects(
    client.mutateThemeConfig('/theme/html', (current) => ({ ...current, value: 2 })),
    (error) => error?.code === 'invalid-response',
    '非 JSON 成功响应不得清空前端脏状态'
  );

  setGlobal('fetch', async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  await assert.rejects(
    client.readThemeConfig('/theme/timeout', { timeoutMs: 5 }),
    (error) => error?.code === 'timeout',
    '主题配置请求必须在截止时间后中断'
  );

  console.log('theme config client contract passed');
} finally {
  restoreGlobal('fetch', originalFetch);
  restoreGlobal('navigator', originalNavigator);
  restoreGlobal('document', originalDocument);
  restoreGlobal('location', originalLocation);
}
