import{o as p}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.32&r=edae586dea8b";import{r as o}from"../author-card/render.js?v=0.9.32&r=edae586dea8b";var g='<span class="icon-[lucide--folder]" aria-hidden="true"></span>';function m({sources:n,escapeHtml:e,mode:r}){const s=p(n.categories,4);if(!s.length)return'<div class="desktop-widget-empty">当前没有可展示的分类。</div>';const c="/categories",t=s.map(a=>{const i=a.color||"currentColor",l=a.icon||g,d=i!=="currentColor"?` style="color:${e(i)}"`:"";return o({href:e(a.permalink),app:"explorer-categories",className:"wg-cat-item",disabled:r==="preview",innerHtml:`
        <span class="wg-cat-icon"${d}>${l}</span>
        <span class="wg-cat-label">${e(a.name)}</span>
      `})}).join("");return`
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          分类
        </span>
        ${o({href:e(c),app:"explorer-categories",className:"wg-cat-more",disabled:r==="preview",innerHtml:`
            更多分类
            <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
          `})}
      </div>
      <div class="wg-cat-grid">${t}</div>
    </div>`}export{m as t};
