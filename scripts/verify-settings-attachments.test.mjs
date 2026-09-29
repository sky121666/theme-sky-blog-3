import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const moduleUrl = new URL('../src/shell/desktop-shell/runtime/desktop/settings-assets/attachment-client.js', import.meta.url);
const client = await import(moduleUrl.href).catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
  throw error;
});
const nativeFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = nativeFetch;
  globalThis.document = originalDocument;
  globalThis.setTimeout = originalSetTimeout;
});

const attachment = (overrides = {}) => ({
  apiVersion: 'storage.halo.run/v1alpha1', kind: 'Attachment',
  metadata: { name: 'image-1' },
  spec: { displayName: '山景.png', mediaType: 'image/png', policyName: 'local', size: 12 },
  status: { permalink: '/upload/mountain.png', thumbnails: { S: '/upload/mountain-small.png' } },
  ...overrides
});
const list = (items, overrides = {}) => ({
  items, page: 1, size: 24, total: items.length, totalPages: items.length ? 1 : 0,
  hasNext: false, hasPrevious: false, first: true, last: true, ...overrides
});
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' }
});
const file = () => new File(['image'], '山景.png', { type: 'image/png' });
const normalized = {
  name: 'image-1', displayName: '山景.png', url: '/upload/mountain.png',
  thumbnailUrl: '/upload/mountain-small.png', mediaType: 'image/png'
};

test('字段 accepts 同时限制官方检索参数和服务端候选结果', async () => {
  globalThis.fetch = async (href) => {
    assert.deepEqual(new URL(href, 'https://site.test').searchParams.getAll('accepts'), ['image/png', 'image/jpeg', 'image/webp']);
    return json(list([attachment(), attachment({ metadata: { name: 'svg' }, spec: { mediaType: 'image/svg+xml' }, status: { permalink: '/image.svg' } })]));
  };
  const result = await client.listAttachments({ accepts: ['image/png', 'image/jpeg', 'image/webp'] });
  assert.equal(result.items.length, 1);
  assert.equal(result.total, 2);
});

test('GIF 仅在目标字段允许时上传', async () => {
  const image = new File(['gif'], 'image.gif', { type: 'image/gif' });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json(attachment({ spec: { mediaType: 'image/gif' }, status: { permalink: '/image.gif' } })); };
  await assert.rejects(() => client.uploadImage(image, { policyName: 'local', accepts: ['image/png'] }), { code: 'invalid-file' });
  assert.equal(calls, 0);
  assert.equal((await client.uploadImage(image, { policyName: 'local', accepts: ['image/gif'] })).url, '/image.gif');
  assert.equal(calls, 1);
});

test('导出附件读取、策略读取和图片上传接口', () => {
  for (const name of ['listAttachments', 'listUploadPolicies', 'uploadImage']) {
    assert.equal(typeof client[name], 'function', `${name} 应可调用`);
  }
});

test('附件检索使用官方 accepts/keyword 分页，并保留服务端总数', async () => {
  globalThis.fetch = async (url, options) => {
    const request = new URL(url, 'https://site.test');
    assert.equal(request.pathname, '/apis/api.console.halo.run/v1alpha1/attachments');
    assert.equal(request.searchParams.get('keyword'), '山景 & 桌面');
    assert.deepEqual(request.searchParams.getAll('accepts'), ['image/*']);
    assert.equal(request.searchParams.get('page'), '2');
    assert.equal(request.searchParams.get('size'), '12');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Accept, 'application/json');
    return json(list([attachment()], { page: 2, size: 12, total: 30, totalPages: 3 }));
  };
  assert.deepEqual(await client.listAttachments({ keyword: '  山景 & 桌面  ', page: 2, size: 12 }), {
    items: [normalized], page: 2, total: 30, totalPages: 3
  });
});

test('附件库忽略非图片、删除中、未就绪和危险URL，坏缩略图回退原图', async () => {
  const unsafe = ['javascript:alert(1)', 'data:image/png;base64,AA', '//outside.test/a.png', '/\\outside.test/a', 'https://u:p@outside.test/a', 'https://safe.test/\nx'];
  globalThis.fetch = async () => json(list([
    attachment({ status: { permalink: 'https://cdn.test/photo.png', thumbnails: { S: 'javascript:alert(1)' } } }),
    attachment({ spec: { mediaType: 'application/pdf' } }),
    attachment({ metadata: { name: 'deleted', deletionTimestamp: '2026-01-01T00:00:00Z' } }),
    attachment({ status: {} }),
    ...unsafe.map((permalink) => attachment({ status: { permalink } }))
  ]));
  const result = await client.listAttachments();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, 'https://cdn.test/photo.png');
  assert.equal(result.items[0].thumbnailUrl, 'https://cdn.test/photo.png');
  assert.equal(result.total, 10);
});

test('非法分页值不能触发 Halo 无分页全量读取', async () => {
  globalThis.fetch = async (url) => {
    const query = new URL(url, 'https://site.test').searchParams;
    assert.equal(query.get('page'), '1');
    assert.equal(query.get('size'), '24');
    return json(list([]));
  };
  await client.listAttachments({ page: 0, size: -2 });
});

test('缺少 ListResult 结构时报错，避免把坏响应显示为空库', async () => {
  globalThis.fetch = async () => json({ data: { items: [] } });
  await assert.rejects(client.listAttachments(), { code: 'invalid-response' });
});

test('策略使用标准 API，翻页读取并忽略删除中的策略', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    const request = new URL(url, 'https://site.test');
    assert.equal(request.pathname, '/apis/storage.halo.run/v1alpha1/policies');
    requests.push(request.searchParams.get('page'));
    return json(list(requests.length === 1 ? [
      { metadata: { name: 'local' }, spec: { displayName: '本地存储', templateName: 'local' } },
      { metadata: { name: 'gone', deletionTimestamp: '2026-01-01' }, spec: { displayName: '删除中' } }
    ] : [{ metadata: { name: 'cdn' }, spec: { displayName: '对象存储' } }], {
      page: requests.length, size: 100, total: 101, totalPages: 2, hasNext: requests.length === 1
    }));
  };
  assert.deepEqual(await client.listUploadPolicies(), [
    { name: 'local', displayName: '本地存储' }, { name: 'cdn', displayName: '对象存储' }
  ]);
  assert.deepEqual(requests, ['1', '2']);
});

for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found']]) {
  test(`HTTP ${status} 返回独立附件权限或接口错误`, async () => {
    globalThis.fetch = async () => json({}, status);
    await assert.rejects(client.listAttachments(), { code });
  });
}

for (const response of [
  () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
  () => new Response(null, { status: 302, headers: { Location: '/login' } }),
  () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() })
]) {
  test('HTML 登录页或重定向明确报告登录失效', async () => {
    globalThis.fetch = async () => response();
    await assert.rejects(client.listAttachments(), { code: 'unauthorized' });
  });
}

test('上传使用单次 FormData POST、同源会话和已解码 CSRF header', async () => {
  globalThis.document = { cookie: 'test=1; XSRF-TOKEN=fake%2Btoken' };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/apis/api.console.halo.run/v1alpha1/attachments/upload');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['X-XSRF-TOKEN'], 'fake+token');
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.body.get('policyName'), 'local');
    assert.equal(options.body.get('file').name, '山景.png');
    assert.equal(options.body.get('file').type, 'image/png');
    assert.equal(options.body.has('groupName'), false);
    return json(attachment());
  };
  assert.deepEqual(await client.uploadImage(file(), { policyName: 'local' }), normalized);
  assert.equal(calls, 1);
});

test('不支持的文件类型、空文件和缺少策略在请求前失败', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('不应请求'); };
  for (const type of ['image/svg+xml', 'image/gif', 'text/html', '']) {
    await assert.rejects(client.uploadImage(new File(['x'], 'test.png', { type }), { policyName: 'local' }), { code: 'invalid-file' });
  }
  await assert.rejects(client.uploadImage(new File([], 'empty.png', { type: 'image/png' }), { policyName: 'local' }), { code: 'invalid-file' });
  await assert.rejects(client.uploadImage(file()), { code: 'invalid-policy' });
  assert.equal(calls, 0);
});

test('上传成功但 URL 迟到时只轮询该附件，不重发上传', async () => {
  const calls = [];
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay < 5000 ? 0 : delay, ...args);
  globalThis.fetch = async (url, options) => {
    calls.push([url, options.method]);
    if (options.method === 'POST' || calls.length === 2) return json(attachment({ status: {} }));
    assert.equal(url, '/apis/storage.halo.run/v1alpha1/attachments/image-1');
    return json(attachment());
  };
  assert.deepEqual(await client.uploadImage(file(), { policyName: 'local' }), normalized);
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 1);
  assert.equal(calls.filter(([, method]) => method === 'GET').length, 2);
});

test('URL 持续未就绪时有限结束并保留上传成功信息', async () => {
  let posts = 0;
  let gets = 0;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay < 5000 ? 0 : delay, ...args);
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') posts++; else gets++;
    assert.ok(gets <= 5, '就绪轮询必须有上限');
    return json(attachment({ status: {} }));
  };
  await assert.rejects(client.uploadImage(file(), { policyName: 'local' }), {
    code: 'url-pending', uploaded: true, attachmentName: 'image-1'
  });
  assert.equal(posts, 1);
  assert.ok(gets > 0 && gets <= 5);
});

test('上传后轮询失去权限仍说明附件已上传，避免重复上传', async () => {
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay < 5000 ? 0 : delay, ...args);
  globalThis.fetch = async (_url, options) => options.method === 'POST'
    ? json(attachment({ status: {} })) : json({}, 403);
  await assert.rejects(client.uploadImage(file(), { policyName: 'local' }), {
    code: 'forbidden', uploaded: true, attachmentName: 'image-1'
  });
});

test('上传返回危险 URL 时拒绝选择并保留已上传信息', async () => {
  globalThis.fetch = async () => json(attachment({ status: { permalink: 'javascript:alert(1)' } }));
  await assert.rejects(client.uploadImage(file(), { policyName: 'local' }), {
    code: 'invalid-url', uploaded: true, attachmentName: 'image-1'
  });
});

test('上传网络错误结果未确认，绝不自动重试 POST', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('network disconnected'); };
  await assert.rejects(client.uploadImage(file(), { policyName: 'local' }), { code: 'upload-uncertain' });
  assert.equal(calls, 1);
});

test('已取消的读取在发出请求前结束', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json(list([])); };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.listAttachments({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('取消覆盖响应体读取并丢弃延迟结果', async () => {
  const controller = new AbortController();
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () => { bodyStarted(); return new Promise(() => {}); }
  });
  const pending = client.listAttachments({ signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('请求超时会中止底层 fetch，响应体卡住同样受 deadline 约束', async () => {
  globalThis.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 5, ...args);
  let requestSignal;
  globalThis.fetch = async (_url, { signal }) => {
    requestSignal = signal;
    return {
      ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => new Promise(() => {})
    };
  };
  await assert.rejects(client.listAttachments(), { code: 'timeout' });
  assert.equal(requestSignal.aborted, true);
});

test('上传等待 URL 期间取消后不再轮询', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) originalSetTimeout(() => controller.abort(), 5);
    return json(attachment({ status: {} }));
  };
  await assert.rejects(client.uploadImage(file(), { policyName: 'local', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
