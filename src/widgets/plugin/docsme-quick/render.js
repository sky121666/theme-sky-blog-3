import { buildWidgetPjaxLink } from '../../shared/link.js';

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
    return buildWidgetPjaxLink({
      href,
      app: 'docsme',
      className: 'wg-docsme wg-docsme--medium',
      attrs: `aria-label="${escapeHtml('打开文档中心')}"`,
      disabled: mode === 'preview',
      innerHtml: `
        <span class="wg-docsme-head">
          <span class="wg-docsme-icon">
            <span class="icon-[lucide--library-big]" aria-hidden="true"></span>
          </span>
          <span class="wg-docsme-kicker">Docsme</span>
        </span>
        <span class="wg-docsme-copy">
          <strong>${escapeHtml('文档中心')}</strong>
          <span>${escapeHtml('项目文档与站点指南。')}</span>
        </span>
      `
    });
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
        <strong>${escapeHtml('文档')}</strong>
        <span>Docsme</span>
      </span>
    `
  });
}
