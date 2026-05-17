import{r as o}from"../../halo/author-card/render.js?v=0.9.30&r=d47ffabb8f0a";function d(a){return`
    <div class="wg-docsme wg-docsme--empty">
      <span class="wg-docsme-icon">
        <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
      </span>
      <strong>${a("文档插件未启用")}</strong>
      <span>${a("安装 Docsme 后可添加文档小组件。")}</span>
    </div>
  `}function p({sources:a,escapeHtml:s,mode:n},i){if(!a.docsmeAvailable)return d(s);const c=i?.size||"small",e=s(a.docsmeUrl||"/docs");return c==="medium"?o({href:e,app:"docsme",className:"wg-docsme wg-docsme--medium",attrs:`aria-label="${s("打开文档中心")}"`,disabled:n==="preview",innerHtml:`
        <span class="wg-docsme-head">
          <span class="wg-docsme-icon">
            <span class="icon-[lucide--library-big]" aria-hidden="true"></span>
          </span>
          <span class="wg-docsme-kicker">Docsme</span>
        </span>
        <span class="wg-docsme-copy">
          <strong>${s("文档中心")}</strong>
          <span>${s("项目文档与站点指南。")}</span>
        </span>
      `}):o({href:e,app:"docsme",className:"wg-docsme wg-docsme--small",attrs:`aria-label="${s("打开文档中心")}"`,disabled:n==="preview",innerHtml:`
      <span class="wg-docsme-icon">
        <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
      </span>
      <span class="wg-docsme-copy">
        <strong>${s("文档")}</strong>
        <span>Docsme</span>
      </span>
    `})}export{p as t};
