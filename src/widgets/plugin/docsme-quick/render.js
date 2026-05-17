import { buildWidgetPjaxLink } from '../../shared/link.js';

function renderOpenButton({ href, escapeHtml, mode, className = 'wg-docsme-open' }) {
  return buildWidgetPjaxLink({
    href,
    app: 'docsme',
    className,
    attrs: `aria-label="${escapeHtml('打开文档中心')}"`,
    disabled: mode === 'preview',
    innerHtml: `
      <span>打开文档</span>
      <span class="icon-[lucide--arrow-right]" aria-hidden="true"></span>
    `
  });
}

function renderUnavailable(escapeHtml) {
  return `
    <div class="wg-docsme wg-docsme--empty">
      <span class="wg-docsme-icon">
        <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
      </span>
      <strong>${escapeHtml('文档插件未启用')}</strong>
      <span>${escapeHtml('安装 Docsme 后可添加文档小组件。')}</span>
    </div>
  `;
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  if (!sources.docsmeAvailable) {
    return renderUnavailable(escapeHtml);
  }

  const size = widget?.size || 'small';
  const href = escapeHtml(sources.docsmeUrl || '/docs');

  if (size === 'medium') {
    return `
      <div class="wg-docsme wg-docsme--medium">
        <span class="wg-docsme-topline">
          <span class="wg-docsme-icon">
            <span class="icon-[lucide--library-big]" aria-hidden="true"></span>
          </span>
          <span class="wg-docsme-badge">Docsme</span>
        </span>
        <span class="wg-docsme-copy">
          <strong>${escapeHtml('文档中心')}</strong>
          <span>${escapeHtml('打开项目大厅，继续阅读站点文档。')}</span>
        </span>
        ${renderOpenButton({ href, escapeHtml, mode })}
      </div>
    `;
  }

  return buildWidgetPjaxLink({
    href,
    app: 'docsme',
    className: 'wg-docsme wg-docsme--small',
    attrs: `aria-label="${escapeHtml('打开文档中心')}"`,
    disabled: mode === 'preview',
    innerHtml: `
      <span class="wg-docsme-icon">
        <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
      </span>
      <span class="wg-docsme-copy">
        <strong>${escapeHtml('文档中心')}</strong>
        <span>Docsme</span>
      </span>
    `
  });
}
