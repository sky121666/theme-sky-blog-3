// Halo 2.26.1 /v3/api-docs: core ListResult APIs and the Commerce category tree.
const ENDPOINTS = Object.freeze({
  menus: '/api/v1alpha1/menus',
  categories: '/apis/content.halo.run/v1alpha1/categories',
  tags: '/apis/content.halo.run/v1alpha1/tags',
  posts: '/apis/content.halo.run/v1alpha1/posts',
  singlepages: '/apis/content.halo.run/v1alpha1/singlepages',
  shopCategories: '/apis/console.api.ecommerce.halo.run/v1alpha1/product-categories',
  shopProducts: '/apis/console.api.ecommerce.halo.run/v1alpha1/products'
});

function shopCategoryOptions(data) {
  const items = [];
  const visit = (nodes, ancestors = []) => {
    if (!Array.isArray(nodes)) throw new Error('资源接口返回了无效的商城分类数据。');
    for (const node of nodes) {
      if (!node || !['string', 'number'].includes(typeof node.id) || !String(node.id).trim() || typeof node.name !== 'string' || !node.name.trim()) throw new Error('资源接口返回了无效的商城分类数据。');
      const labels = [...ancestors, node.name];
      items.push({ name: String(node.id), label: labels.join(' / '), disabled: false });
      if (node.children != null) visit(node.children, labels);
    }
  };
  visit(data);
  return { items, page: 1, total: items.length, hasNext: false };
}

export async function listSettingResources(kind, { page = 1, size = 50, signal } = {}) {
  if (!Object.hasOwn(ENDPOINTS, kind)) throw new Error('不支持的设置资源');
  const number = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
  const query = new URLSearchParams({ page: String(number(page, 1, 10000)), size: String(number(size, 50, 100)), sort: 'metadata.name,asc' });
  if (kind === 'shopProducts') { query.set('sort', 'id,asc'); query.set('statuses', 'PUBLISHED'); }
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const href = kind === 'shopCategories' ? ENDPOINTS[kind] : `${ENDPOINTS[kind]}?${query}`;
  const response = await fetch(href, {
    method: 'GET', credentials: 'same-origin', redirect: 'manual', signal: requestSignal,
    headers: { Accept: 'application/json' }
  });
  if (response.status === 403) throw new Error('当前账号没有读取这些资源的权限。');
  if (response.status === 401 || response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('登录已失效，请重新登录后重试。');
  if (!response.ok) throw new Error(`资源加载失败（HTTP ${response.status}），请重试。`);
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('资源接口未返回有效数据，请检查登录状态。');
  const data = await response.json();
  requestSignal.throwIfAborted();
  if (kind === 'shopCategories') return shopCategoryOptions(data);
  if (kind === 'shopProducts') {
    if (!Array.isArray(data?.content) || !Number.isSafeInteger(data.totalElements) || data.totalElements < 0 || !Number.isSafeInteger(data.number) || data.number < 0 || !Number.isSafeInteger(data.size) || data.size < 1) throw new Error('资源接口返回了无效的商城商品分页数据。');
    const items = data.content.map((item) => {
      if (!item || !['string', 'number'].includes(typeof item.id) || !String(item.id).trim() || typeof item.title !== 'string' || !item.title.trim()) throw new Error('资源接口返回了无效的商城商品数据。');
      return { name: String(item.id), label: item.title, disabled: item.status !== 'PUBLISHED' };
    });
    return { items, page: data.number + 1, total: data.totalElements, hasNext: (data.number + 1) * data.size < data.totalElements };
  }
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.size) || data.size < 1) throw new Error('资源接口返回了无效的分页数据。');
  const items = data.items.filter((item) => item?.metadata?.name && !item.metadata.deletionTimestamp).map((item) => ({
    name: item.metadata.name,
    label: String(item.spec?.displayName || item.spec?.title || item.metadata.name),
    permalink: typeof item.status?.permalink === 'string' ? item.status.permalink : '',
    disabled: kind !== 'menus' && (!item.status?.permalink || item.spec?.deleted === true || (['posts', 'singlepages'].includes(kind) && item.spec?.publish !== true))
  }));
  return { items, page: data.page, total: data.total, hasNext: data.page * data.size < data.total };
}
