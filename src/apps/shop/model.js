const SORT_VALUES = new Set(['minPrice,asc', 'minPrice,desc', 'title,asc']);
const FILTER_KEYS = ['keyword', 'categoryId', 'sort', 'view'];

export function buildShopBrowseUrl(currentUrl, changes = {}) {
  const current = new URL(currentUrl);
  if (!['http:', 'https:'].includes(current.protocol)) throw new TypeError('Invalid shop URL');
  const result = new URL('/shop/products', current.origin);
  let view = Object.hasOwn(changes, 'view') ? String(changes.view ?? '').trim() : current.searchParams.get('view');
  if (view === 'explore') return result.href;
  if (view === 'categories' && !Object.hasOwn(changes, 'view') && ['keyword', 'categoryId', 'sort'].some((key) => Object.hasOwn(changes, key))) view = 'all';
  if (view === 'categories') {
    result.searchParams.set('view', view);
    return result.href;
  }
  for (const key of FILTER_KEYS) {
    const raw = key === 'view' ? view : (Object.hasOwn(changes, key) ? changes[key] : current.searchParams.get(key));
    const value = raw == null ? '' : String(raw).trim();
    if (!value || (key === 'sort' && !SORT_VALUES.has(value)) || (key === 'view' && value !== 'all')) continue;
    result.searchParams.set(key, value);
  }
  const filtersChanged = FILTER_KEYS.some((key) => Object.hasOwn(changes, key));
  const page = Number(filtersChanged ? 1 : (changes.page ?? current.searchParams.get('page')));
  if (Number.isInteger(page) && page > 1) result.searchParams.set('page', String(page));
  return result.href;
}

export function isShopDescriptionVisible(value) {
  if (value == null || value === '') return true;
  return ![false, 0, 'false', '0', 'off'].includes(typeof value === 'string' ? value.trim().toLowerCase() : value);
}
