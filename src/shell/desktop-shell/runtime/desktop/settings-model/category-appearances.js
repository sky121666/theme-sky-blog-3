export const CATEGORY_ICON_OPTIONS = Object.freeze([
  ['folder', '文件夹'], ['sparkles', '灵感'], ['code', '代码'], ['palette', '设计'],
  ['book-open', '阅读'], ['music', '音乐'], ['gamepad-2', '游戏'], ['camera', '摄影'],
  ['package', '商品'], ['wrench', '工具']
].map(([value, label]) => Object.freeze({ value, label })));

const icons = new Set(CATEGORY_ICON_OPTIONS.map(({ value }) => value));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const categoryId = (value) => {
  const candidate = record(value) ? value.id ?? value.name ?? value.value : value;
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).trim() : '';
};
const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : '';

export function normalizeCategoryAppearances(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter(record).flatMap((item) => {
    const id = categoryId(item.category_id);
    if (id && seen.has(id)) return [];
    if (id) seen.add(id);
    return [{ category_id: id, icon: icons.has(item.icon) ? item.icon : 'folder', color: color(item.color) }];
  });
}

export function validateCategoryAppearances(value) {
  if (!Array.isArray(value)) throw new Error('分类外观必须是列表');
  const seen = new Set();
  for (const item of value) {
    if (!record(item) || (typeof item.category_id !== 'string' && typeof item.category_id !== 'number')
      || !icons.has(item.icon) || (item.color !== '' && !color(item.color))) {
      throw new Error('请选择有效分类、预设图标和六位十六进制颜色');
    }
    const id = categoryId(item.category_id);
    if (id && seen.has(id)) throw new Error('同一分类只能配置一次外观');
    if (id) seen.add(id);
  }
}
