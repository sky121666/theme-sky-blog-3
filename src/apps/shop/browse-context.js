import { buildShopBrowseUrl } from './model.js';

export const SHOP_BROWSE_CONTEXT_PREFIX = 'sky_blog3_shop_source:';

export function sanitizeShopBrowseSource(currentUrl, sourceUrl) {
  try {
    const current = new URL(currentUrl);
    const source = new URL(sourceUrl, current);
    if (!['http:', 'https:'].includes(source.protocol) || source.origin !== current.origin
      || source.username || source.password || !/^\/shop(?:\/products)?\/?$/.test(source.pathname)) return null;
    return buildShopBrowseUrl(source.href);
  } catch { return null; }
}

export function getShopProductIdentity(currentUrl, productUrl = currentUrl) {
  try {
    const current = new URL(currentUrl);
    const product = new URL(productUrl, current);
    const match = product.pathname.match(/^\/shop\/(?:product|products)\/([^/]+)\/?$/);
    if (!['http:', 'https:'].includes(product.protocol) || product.origin !== current.origin || product.username || product.password || !match) return null;
    const productId = decodeURIComponent(match[1]);
    if (!productId || /[\s/\\\x00-\x1f]/.test(productId)) return null;
    return { productId, productPath: product.pathname.replace(/\/$/, '') };
  } catch { return null; }
}

export function createShopBrowseContext({ sourceUrl, productUrl, scrollTop, sourceEntryId = '', label = '' }) {
  const href = sanitizeShopBrowseSource(productUrl, sourceUrl);
  const product = getShopProductIdentity(sourceUrl, productUrl);
  if (!href || !product) return null;
  return {
    version: 1, ...product, href,
    scrollTop: Number.isFinite(Number(scrollTop)) && Number(scrollTop) >= 0 ? Number(scrollTop) : 0,
    sourceEntryId: String(sourceEntryId || ''), label: String(label || '').trim().slice(0, 160)
  };
}

function contextStorageKey(productId, detailEntryId = '') {
  const productKey = encodeURIComponent(productId);
  return detailEntryId ? `${SHOP_BROWSE_CONTEXT_PREFIX}entry:${productKey}:${encodeURIComponent(detailEntryId)}` : `${SHOP_BROWSE_CONTEXT_PREFIX}${productKey}`;
}

export function saveShopBrowseContext(storage, record) {
  try {
    if (!record?.productId) return false;
    const detailEntryId = String(record.detailEntryId || '');
    storage.setItem(contextStorageKey(record.productId, detailEntryId), JSON.stringify(record));
    // Only the unbound native candidate is transient. Bound history entries
    // remain available for back/forward traversal for this entire tab session.
    if (detailEntryId) {
      const candidateKey = contextStorageKey(record.productId);
      const candidate = JSON.parse(storage.getItem(candidateKey));
      if (candidate?.productId === record.productId && !candidate.detailEntryId) storage.removeItem?.(candidateKey);
    }
    return true;
  } catch { return false; }
}

function validateSavedContext(saved, productUrl) {
  const product = getShopProductIdentity(productUrl);
  if (!product || saved?.version !== 1 || saved.productId !== product.productId || saved.productPath !== product.productPath) return null;
  const record = createShopBrowseContext({ ...saved, sourceUrl: saved.href, productUrl });
  if (!record || record.href !== saved.href) return null;
  const sourceEntryIds = Array.isArray(saved.sourceEntryIds) ? [...new Set(saved.sourceEntryIds.filter((id) => typeof id === 'string' && id))] : [];
  return { ...record, detailEntryId: String(saved.detailEntryId || ''), ...(sourceEntryIds.length ? { sourceEntryIds } : {}) };
}

export function readShopBrowseContext(storage, productUrl, detailEntryId = '') {
  const product = getShopProductIdentity(productUrl);
  if (!product) return null;
  const expectedEntryId = String(detailEntryId || '');
  try {
    const keys = [...new Set([contextStorageKey(product.productId, expectedEntryId), `${SHOP_BROWSE_CONTEXT_PREFIX}${product.productId}`])];
    for (const key of keys) {
      const record = validateSavedContext(JSON.parse(storage.getItem(key)), productUrl);
      if (record?.detailEntryId === expectedEntryId) return record;
    }
  } catch { return null; }
  return null;
}

export function readShopBrowseSourceContext(storage, sourceUrl, sourceEntryId) {
  const href = sanitizeShopBrowseSource(sourceUrl, sourceUrl);
  if (!href) return null;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(SHOP_BROWSE_CONTEXT_PREFIX)) continue;
      let saved;
      try { saved = JSON.parse(storage.getItem(key)); } catch { continue; }
      const matchesEntry = sourceEntryId && (saved?.sourceEntryId === sourceEntryId || (Array.isArray(saved?.sourceEntryIds) && saved.sourceEntryIds.includes(sourceEntryId)));
      if (!saved || saved.href !== href || (!saved.returnRequested && !matchesEntry)) continue;
      // Validate the enumerated record itself; another entry for this product
      // must never supply its URL, scroll or return marker.
      let record;
      try { record = validateSavedContext(saved, new URL(saved.productPath, sourceUrl).href); } catch { continue; }
      if (!record || ![contextStorageKey(record.productId, record.detailEntryId), `${SHOP_BROWSE_CONTEXT_PREFIX}${record.productId}`].includes(key)) continue;
      if (saved.returnRequested) storage.setItem(key, JSON.stringify(record));
      return record;
    }
  } catch { /* A blocked store leaves native browser scrolling in charge. */ }
  return null;
}
