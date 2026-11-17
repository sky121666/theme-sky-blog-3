const THUMBNAIL_WIDTH_MAP = {
  XL: 1600,
  L: 1200,
  M: 800,
  S: 400
};
export function getThumbnailUrl(url, size) {
  const { origin } = location;
  const width = THUMBNAIL_WIDTH_MAP[size];
  if (!width) {
    return url;
  }
  let parsed;
  try { parsed = new URL(url, `${origin}/`); } catch { /* Retain the remote thumbnail fallback for malformed URLs. */ }
  if (parsed?.origin === origin && (url.startsWith('/') || /^https?:/.test(url))) {
    parsed.searchParams.set('width', String(width));
    return url.startsWith('/') && !url.startsWith('//')
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.href;
  }
  return `/apis/api.storage.halo.run/v1alpha1/thumbnails/-/via-uri?uri=${encodeURIComponent(
    url
  )}&width=${width}`;
}
