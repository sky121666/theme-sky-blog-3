import{n as m}from"../../../rolldown-runtime.js?v=0.9.42&r=26ba3ad578b5";import{o as c}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.42&r=26ba3ad578b5";import{r as l}from"../author-card/render.js?v=0.9.42&r=26ba3ad578b5";var A=m({renderWidget:()=>_}),f='<span class="icon-[lucide--folder]" aria-hidden="true"></span>',u="/categories";function v(){const e=globalThis.window?.__SKY_THEME_ROUTES__?.categoriesUri;return typeof e=="string"&&e.trim()?e.trim():u}function h(e){return Array.isArray(e)?e.map(r=>String(r||"").trim()).filter(Boolean):String(e||"").split(",").map(r=>r.trim()).filter(Boolean)}function w(e,r,a){if(!r.length)return c(e.categories,a);const i=new Set(r),o=new Map(c(e.categories,1e3).map(t=>[t.key,t]));return r.filter(t=>i.has(t)).map(t=>o.get(t)).filter(Boolean).slice(0,Math.max(a||0,1))}function _({sources:e,escapeHtml:r,mode:a},i){const o=w(e,h((i?.meta&&typeof i.meta=="object"?i.meta:{}).categoryNames),4);if(!o.length)return'<div class="desktop-widget-empty">当前没有可展示的分类。</div>';const t=v(),p=o.map(n=>{const s=n.color||"currentColor",d=n.icon||f,g=s!=="currentColor"?` style="color:${r(s)}"`:"";return l({href:r(n.permalink),app:"explorer-categories",className:"wg-cat-item",disabled:a==="preview",innerHtml:`
        <span class="wg-cat-icon"${g}>${d}</span>
        <span class="wg-cat-label">${r(n.name)}</span>
      `})}).join("");return`
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          分类
        </span>
        ${l({href:r(t),app:"explorer-categories",className:"wg-cat-more",disabled:a==="preview",innerHtml:`
            更多分类
            <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
          `})}
      </div>
      <div class="wg-cat-grid">${p}</div>
    </div>`}export{A as t};
