/**
 * widgets/renderers/shared.js
 * 通用渲染工具（仅供渲染器内部使用）
 */

export function renderUnsupportedWidget(escapeHtml, widget) {
  return `
    <div class="desktop-widget-empty">
      <strong>${escapeHtml(widget.title)}</strong>
      <span>当前组件已注册，但前端渲染器还没有接入。</span>
    </div>
  `;
}
