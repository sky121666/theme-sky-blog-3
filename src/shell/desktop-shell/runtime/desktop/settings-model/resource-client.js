// Halo 2.26.1 /v3/api-docs: core Menu/Category/Tag/Post/SinglePage ListResult APIs.
const ENDPOINTS = Object.freeze({
  menus: '/api/v1alpha1/menus',
  categories: '/apis/content.halo.run/v1alpha1/categories',
  tags: '/apis/content.halo.run/v1alpha1/tags',
  posts: '/apis/content.halo.run/v1alpha1/posts',
  singlepages: '/apis/content.halo.run/v1alpha1/singlepages'
});

export async function listSettingResources(kind, { page = 1, size = 50, signal } = {}) {
  if (!Object.hasOwn(ENDPOINTS, kind)) throw new Error('不支持的设置资源');
  const number = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
  const query = new URLSearchParams({ page: String(number(page, 1, 10000)), size: String(number(size, 50, 100)), sort: 'metadata.name,asc' });
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${ENDPOINTS[kind]}?${query}`, {
    method: 'GET', credentials: 'same-origin', redirect: 'manual', signal: requestSignal,
    headers: { Accept: 'application/json' }
  });
  if (response.status === 403) throw new Error('当前账号没有读取这些资源的权限。');
  if (response.status === 401 || response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('登录已失效，请重新登录后重试。');
  if (!response.ok) throw new Error(`资源加载失败（HTTP ${response.status}），请重试。`);
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('资源接口未返回有效数据，请检查登录状态。');
  const data = await response.json();
  requestSignal.throwIfAborted();
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.size) || data.size < 1) throw new Error('资源接口返回了无效的分页数据。');
  const items = data.items.filter((item) => item?.metadata?.name && !item.metadata.deletionTimestamp).map((item) => ({
    name: item.metadata.name,
    label: String(item.spec?.displayName || item.spec?.title || item.metadata.name),
    permalink: typeof item.status?.permalink === 'string' ? item.status.permalink : '',
    disabled: kind !== 'menus' && (!item.status?.permalink || item.spec?.deleted === true || (['posts', 'singlepages'].includes(kind) && item.spec?.publish !== true))
  }));
  return { items, page: data.page, total: data.total, hasNext: data.page * data.size < data.total };
}
