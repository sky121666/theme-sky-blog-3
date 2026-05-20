import { selectTopCategories } from '../../shared/data.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';

const CATEGORY_FALLBACK_ICON = '<span class="icon-[lucide--folder]" aria-hidden="true"></span>';

function normalizeCategoryNames(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectConfiguredCategories(sources, names, limit) {
  if (!names.length) return selectTopCategories(sources.categories, limit);

  const selected = new Set(names);
  const byName = new Map(selectTopCategories(sources.categories, 1000).map((category) => [category.key, category]));
  return names
    .filter((name) => selected.has(name))
    .map((name) => byName.get(name))
    .filter(Boolean)
    .slice(0, Math.max(limit || 0, 1));
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
  const categoryNames = normalizeCategoryNames(meta.categoryNames);
  const categories = selectConfiguredCategories(sources, categoryNames, 4);
  if (!categories.length) {
    return '<div class="desktop-widget-empty">当前没有可展示的分类。</div>';
  }

  const categoriesUrl = '/categories';

  const items = categories.map((cat) => {
    const color = cat.color || 'currentColor';
    const iconSvg = cat.icon || CATEGORY_FALLBACK_ICON;
    const colorStyle = color !== 'currentColor' ? ` style="color:${escapeHtml(color)}"` : '';
    return buildWidgetPjaxLink({
      href: escapeHtml(cat.permalink),
      app: 'explorer-categories',
      className: 'wg-cat-item',
      disabled: mode === 'preview',
      innerHtml: `
        <span class="wg-cat-icon"${colorStyle}>${iconSvg}</span>
        <span class="wg-cat-label">${escapeHtml(cat.name)}</span>
      `
    });
  }).join('');

  return `
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          分类
        </span>
        ${buildWidgetPjaxLink({
          href: escapeHtml(categoriesUrl),
          app: 'explorer-categories',
          className: 'wg-cat-more',
          disabled: mode === 'preview',
          innerHtml: `
            更多分类
            <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
          `
        })}
      </div>
      <div class="wg-cat-grid">${items}</div>
    </div>`;
}
