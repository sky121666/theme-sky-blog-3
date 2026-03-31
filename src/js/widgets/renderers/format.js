/**
 * widgets/renderers/format.js
 * 格式化工具函数（纯函数，无副作用）
 */

/**
 * 数字紧凑格式：< 1000 原样显示，>= 1k 转换为 k，>= 1m 转换为 m
 */
export function formatCompactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) {
    const k = n / 1000;
    return k < 10 ? `${Math.round(k * 10) / 10}k`
      : `${Math.round(k)}k`;
  }
  const m = n / 1000000;
  return m < 10 ? `${Math.round(m * 10) / 10}m`
    : `${Math.round(m)}m`;
}

/**
 * 日期格式化：输出 MM.DD 格式
 */
export function formatWidgetDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  }).replace('/', '.');
}
