/**
 * widgets/shared/format.js
 * Widget 格式化工具函数。
 */

export function formatCompactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) {
    const k = n / 1000;
    return k < 10 ? `${Math.round(k * 10) / 10}k` : `${Math.round(k)}k`;
  }
  const m = n / 1000000;
  return m < 10 ? `${Math.round(m * 10) / 10}m` : `${Math.round(m)}m`;
}

export function formatWidgetDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  }).replace('/', '.');
}
