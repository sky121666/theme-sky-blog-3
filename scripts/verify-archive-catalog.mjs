import assert from 'node:assert/strict';
import { createArchiveCatalogLoader, buildArchiveCatalog } from '../src/apps/explorer/archives/catalog.js';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { href: 'https://theme.test/archives' } }
});

function post(name, year, month) {
  return { metadata: { name, labels: {
    'content.halo.run/archive-year': year,
    'content.halo.run/archive-month': month
  } } };
}

function response(items, { page, size, total = items.length } = {}) {
  return {
    ok: true, status: 200, redirected: false,
    headers: { get: () => 'application/json' },
    async json() {
      return { page, size, total, totalPages: Math.ceil(total / size), hasNext: page < Math.ceil(total / size), items };
    }
  };
}

function server(posts, requests, { onRequest } = {}) {
  return async (href, { signal }) => {
    const url = new URL(href);
    const page = Number(url.searchParams.get('page'));
    const size = Number(url.searchParams.get('size'));
    const selector = url.searchParams.getAll('labelSelector');
    assert.ok(url.searchParams.getAll('fieldSelector').includes('status.hideFromList!=true'), '应与 Halo archives 排除隐藏分类的规则一致');
    assert.ok(size > 0 && size <= 100, '每次响应必须有界');
    requests.push({ href, page, size, signal });
    await onRequest?.(requests.at(-1));
    const filtered = posts.filter((item) => selector.every((expression) => {
      const [key, value] = expression.split('=');
      return item.metadata.labels[key] === value;
    })).slice().sort((a, b) => {
      const key = (item) => `${item.metadata.labels['content.halo.run/archive-year']}-${item.metadata.labels['content.halo.run/archive-month']}-${item.metadata.name}`;
      return key(b).localeCompare(key(a));
    });
    if (url.searchParams.get('sort') === 'spec.publishTime,asc') filtered.reverse();
    return response(filtered.slice((page - 1) * size, page * size), { page, size, total: filtered.length });
  };
}

const url = 'https://theme.test/apis/api.content.halo.run/v1alpha1/posts';
const makeLoader = (fetchImpl, options = {}) => createArchiveCatalogLoader({ fetchImpl, storage: () => null, ...options });
let assertions = 0;
try {
  const dense = Array.from({ length: 5000 }, (_, index) => post(`p${index}`, '2026', index < 2500 ? '09' : '08'));
  const denseRequests = [];
  const denseLoader = makeLoader(server(dense, denseRequests));
  assert.deepEqual(await denseLoader(url), [
    { year: '2026', months: [{ month: '09', count: 2500 }, { month: '08', count: 2500 }] }
  ]);
  assert.equal(denseRequests.length, 4, '5000 篇密集归档应使用首批/最早边界+2次年月总数，避免50页全文元数据');
  assert.deepEqual(denseRequests.map((request) => request.size), [100, 1, 1, 1]);
  await denseLoader(url);
  assert.equal(denseRequests.length, 4, '同 URL 成功缓存必须复用');
  assertions += 3;

  const sparse = Array.from({ length: 301 }, (_, index) => post(`s${index}`, String(1700 + index), '01'));
  const sparseRequests = [];
  assert.deepEqual(await makeLoader(server(sparse, sparseRequests))(url), buildArchiveCatalog(sparse));
  assert.equal(sparseRequests.filter((request) => request.size === 100).length, 4, '跨度大时分页请求量应随实际文章数变化，不能枚举全部空月份');
  assert.equal(sparseRequests.length, 5, '稀疏模式仅允许一次最早边界探测额外请求');
  assertions += 3;

  const emptyRequests = [];
  const emptyLoader = makeLoader(server([], emptyRequests));
  assert.deepEqual(await emptyLoader(url), []);
  assert.deepEqual(await emptyLoader(url), []);
  assert.equal(emptyRequests.length, 1, '空目录也必须缓存，不能重复请求或报错');
  assert.deepEqual(await makeLoader(async () => ({
    ok: true, json: async () => ({ page: 0, size: 0, total: 0, totalPages: 1, hasNext: false, items: [] })
  }))(url), [], '必须兼容 Halo ListResult.emptyResult()');
  assertions += 4;

  const small = [post('only', '2026', '09')];
  const ttlRequests = [];
  let now = 1000;
  const ttlLoader = makeLoader(server(small, ttlRequests), { now: () => now });
  await ttlLoader(url);
  now += 300001;
  await ttlLoader(url);
  await ttlLoader(`${url}?labelSelector=example%3Dvalue`);
  assert.equal(ttlRequests.length, 3, '过期和不同 URL/筛选不可复用旧统计');
  await ttlLoader(url, { scope: 'owner-a' });
  await ttlLoader(url, { scope: 'owner-b' });
  assert.equal(ttlRequests.length, 5, '作者本人非公开文章计数不能跨登录主体复用');
  assertions += 2;

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sharedRequests = [];
  const sharedLoader = makeLoader(server(small, sharedRequests, { onRequest: () => gate }));
  const first = new AbortController();
  const second = new AbortController();
  const firstPending = sharedLoader(url, { signal: first.signal });
  const secondPending = sharedLoader(url, { signal: second.signal });
  first.abort();
  await assert.rejects(firstPending, { name: 'AbortError' });
  assert.equal(sharedRequests.length, 1, '并发消费者共享一个公开查询');
  assert.equal(sharedRequests[0].signal.aborted, false, '一个消费者离开不能取消其他消费者');
  release();
  assert.deepEqual(await secondPending, buildArchiveCatalog(small));
  assertions += 4;

  let abortedSignal;
  const cancelled = makeLoader((_url, options) => {
    abortedSignal = options.signal;
    return new Promise(() => {});
  });
  const cancelledController = new AbortController();
  const cancelledPending = cancelled(url, { signal: cancelledController.signal });
  cancelledController.abort();
  await assert.rejects(cancelledPending, { name: 'AbortError' });
  assert.equal(abortedSignal.aborted, true, '最后消费者销毁必须取消共享网络任务');
  assertions += 2;

  const stalled = makeLoader(async () => ({
    ok: true, headers: { get: () => 'application/json' }, json: () => new Promise(() => {})
  }), { timeoutMs: 5 });
  await assert.rejects(stalled(url), { name: 'TimeoutError' }, '收到 headers 后 body 挂住也必须超时');
  assertions += 1;

  let fail = true;
  let attempts = 0;
  const retry = makeLoader(async (href, options) => {
    attempts += 1;
    if (fail) return { ok: false, status: 503 };
    return server(small, [])(href, options);
  });
  await assert.rejects(retry(url), /503/);
  fail = false;
  assert.deepEqual(await retry(url), buildArchiveCatalog(small));
  assert.equal(attempts, 2, '失败不可缓存，下一次必须能重试');
  assertions += 3;

  for (const corrupt of [
    (data) => ({ ...data, totalPages: 99 }),
    (data) => ({ ...data, hasNext: true }),
    (data) => ({ ...data, items: [] }),
    (data) => ({ ...data, total: '1' })
  ]) {
    await assert.rejects(makeLoader(async () => {
      const value = response(small, { page: 1, size: 100, total: 1 });
      const data = await value.json();
      return { ...value, json: async () => corrupt(data) };
    })(url), /归档目录分页/, '不一致的元数据必须失败，不能缓存部分总数');
    assertions += 1;
  }

  const duplicatePosts = Array.from({ length: 101 }, (_, index) => post(`d${index === 100 ? 0 : index}`, '2026', '09'));
  await assert.rejects(makeLoader(server(duplicatePosts, []))(url), /重复或缺失/);
  await assert.rejects(makeLoader(server([small[0], small[0]], []))(url), /重复或缺失/, '单页重复也不能被标为完整计数');
  assertions += 2;

  let monthlyRequests = 0;
  await assert.rejects(makeLoader(async (href, options) => {
    const value = await server(dense, [])(href, options);
    const data = await value.json();
    if (new URL(href).searchParams.has('labelSelector')) {
      monthlyRequests += 1;
      data.total += 1;
      data.totalPages += 1;
    }
    return { ...value, json: async () => data };
  })(url), /计数在加载期间发生变化/);
  assert.equal(monthlyRequests, 2);
  assertions += 2;
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
}
console.log(`归档聚合行为通过：${assertions} 项断言（准确计数/有界载荷/共享/取消/缓存/超时/异常响应）`);
