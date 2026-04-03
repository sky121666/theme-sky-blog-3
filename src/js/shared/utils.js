/**
 * 零依赖的通用工具函数
 */

export function extractTextPreview(value) {
  if (!value) return '';

  if (typeof window !== 'undefined' && value.includes('<')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(value, 'text/html');
    return doc.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

export function truncateText(value, maxLength) {
  const normalized = extractTextPreview(value);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

export function toPositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function sortByDistance(values, target) {
  return [...values].sort((left, right) => Math.abs(left - target) - Math.abs(right - target));
}
