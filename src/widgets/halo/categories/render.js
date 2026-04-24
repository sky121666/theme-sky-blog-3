import { selectTopCategories } from '../../shared/data.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';

const CATEGORY_FALLBACK_ICON = '<span class="icon-[lucide--folder]" aria-hidden="true"></span>';

export function renderWidget({ sources, escapeHtml, mode }) {
  const categories = selectTopCategories(sources.categories, 4);
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
