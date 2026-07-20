import{n as m}from"../../../rolldown-runtime.js?v=0.9.42&r=fcd9761ed418";import{o as c}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.42&r=fcd9761ed418";import{r as l}from"../author-card/render.js?v=0.9.42&r=fcd9761ed418";var b=m({renderWidget:()=>v}),f='<span class="icon-[lucide--folder]" aria-hidden="true"></span>';function u(r){return Array.isArray(r)?r.map(e=>String(e||"").trim()).filter(Boolean):String(r||"").split(",").map(e=>e.trim()).filter(Boolean)}function h(r,e,t){if(!e.length)return c(r.categories,t);const i=new Set(e),o=new Map(c(r.categories,1e3).map(a=>[a.key,a]));return e.filter(a=>i.has(a)).map(a=>o.get(a)).filter(Boolean).slice(0,Math.max(t||0,1))}function v({sources:r,escapeHtml:e,mode:t},i){const o=h(r,u((i?.meta&&typeof i.meta=="object"?i.meta:{}).categoryNames),4);if(!o.length)return'<div class="desktop-widget-empty">当前没有可展示的分类。</div>';const a="/categories",p=o.map(n=>{const s=n.color||"currentColor",d=n.icon||f,g=s!=="currentColor"?` style="color:${e(s)}"`:"";return l({href:e(n.permalink),app:"explorer-categories",className:"wg-cat-item",disabled:t==="preview",innerHtml:`
        <span class="wg-cat-icon"${g}>${d}</span>
        <span class="wg-cat-label">${e(n.name)}</span>
      `})}).join("");return`
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          分类
        </span>
        ${l({href:e(a),app:"explorer-categories",className:"wg-cat-more",disabled:t==="preview",innerHtml:`
            更多分类
            <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
          `})}
      </div>
      <div class="wg-cat-grid">${p}</div>
    </div>`}export{b as t};
