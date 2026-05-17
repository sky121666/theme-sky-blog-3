import{r as i}from"../../halo/author-card/render.js?v=0.9.30&r=9b6a6e5b17dd";function d({href:n,escapeHtml:s,mode:a,className:e="wg-docsme-open"}){return i({href:n,app:"docsme",className:e,attrs:`aria-label="${s("打开文档中心")}"`,disabled:a==="preview",innerHtml:`
      <span>打开文档</span>
      <span class="icon-[lucide--arrow-right]" aria-hidden="true"></span>
    `})}function c(n){return`
    <div class="wg-docsme wg-docsme--empty">
      <span class="wg-docsme-icon">
        <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
      </span>
      <strong>${n("文档插件未启用")}</strong>
      <span>${n("安装 Docsme 后可添加文档小组件。")}</span>
    </div>
  `}function l({sources:n,escapeHtml:s,mode:a},e){if(!n.docsmeAvailable)return c(s);const r=e?.size||"small",o=s(n.docsmeUrl||"/docs");return r==="medium"?`
      <div class="wg-docsme wg-docsme--medium">
        <span class="wg-docsme-topline">
          <span class="wg-docsme-icon">
            <span class="icon-[lucide--library-big]" aria-hidden="true"></span>
          </span>
          <span class="wg-docsme-badge">Docsme</span>
        </span>
        <span class="wg-docsme-copy">
          <strong>${s("文档中心")}</strong>
          <span>${s("打开项目大厅，继续阅读站点文档。")}</span>
        </span>
        ${d({href:o,escapeHtml:s,mode:a})}
      </div>
    `:i({href:o,app:"docsme",className:"wg-docsme wg-docsme--small",attrs:`aria-label="${s("打开文档中心")}"`,disabled:a==="preview",innerHtml:`
      <span class="wg-docsme-icon">
        <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
      </span>
      <span class="wg-docsme-copy">
        <strong>${s("文档中心")}</strong>
        <span>Docsme</span>
      </span>
    `})}export{l as t};
