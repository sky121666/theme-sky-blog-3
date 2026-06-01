import{r as l}from"../../halo/author-card/render.js?v=0.9.39&r=c2c2d231580d";function h(s){const n=Number(s||0);return Number.isFinite(n)&&n>0?Math.round(n):0}function f(s={}){const n=s.spec||{},a=s.status||{},o=s.metadata||{},c=String(n.displayName||o.name||"文档项目").trim(),i=String(a.permalink||"").trim(),r=h(a.totalDocs);return{title:c,description:String(n.description||"").trim(),icon:String(n.icon||"").trim(),href:i,totalDocs:r,disabled:r<=0||!i}}function m(s,n,a=""){return n?.icon?`
      <span class="wg-docsme-icon ${a}">
        <img src="${s(n.icon)}" alt="${s(n.title)}" loading="lazy">
      </span>
    `:`
    <span class="wg-docsme-icon ${a} is-fallback" aria-hidden="true">
      <span class="icon-[lucide--book]"></span>
    </span>
  `}function $(s){return`
    <div class="wg-docsme wg-docsme--empty">
      <span class="wg-docsme-icon wg-docsme-icon--error" aria-hidden="true">
        <span class="icon-[lucide--alert-triangle]"></span>
      </span>
      <strong>${s("Docsme 不可用")}</strong>
      <span>${s("需要 Docsme 1.4.0+ 才能展示文档项目。")}</span>
    </div>
  `}function b(s,n,a,o){return l({href:n,app:"docsme",className:`wg-docsme wg-docsme--${o} wg-docsme--empty-projects`,attrs:`aria-label="${s("打开文档中心")}"`,disabled:a==="preview",innerHtml:`
      <span class="wg-docsme-header">
        <span>
          <strong>${s("文档中心")}</strong>
          <em>${s("Documentation")}</em>
        </span>
        <span class="wg-docsme-open" aria-hidden="true">
          <span class="icon-[lucide--arrow-up-right]"></span>
        </span>
      </span>
      <span class="wg-docsme-empty-content">
        <span class="wg-docsme-empty-icon-wrap" aria-hidden="true">
          <span class="icon-[lucide--book-open]"></span>
        </span>
        <span class="wg-docsme-empty-text">${s("暂无可展示的文档项目")}</span>
      </span>
    `})}function g({escapeHtml:s,mode:n},a){const o=a.description?`<span class="wg-docsme-row-desc">${s(a.description)}</span>`:"",c=`
    <span class="wg-docsme-row-indicator" aria-hidden="true"></span>
    ${m(s,a,"wg-docsme-icon--row")}
    <span class="wg-docsme-row-body">
      <strong class="wg-docsme-row-title">${s(a.title)}</strong>
      ${o}
    </span>
    <span class="wg-docsme-row-side">
      <span class="wg-docsme-doc-pill">
        <span class="icon-[lucide--file-text]" aria-hidden="true"></span>
        <span>${a.totalDocs}</span>
      </span>
      <span class="icon-[lucide--chevron-right] wg-docsme-row-arrow" aria-hidden="true"></span>
    </span>
  `;return a.disabled||n==="preview"?`<span class="wg-docsme-row-item is-disabled">${c}</span>`:l({href:s(a.href),app:"docsme",className:"wg-docsme-row-item",attrs:`aria-label="${s(`打开${a.title}`)}"`,innerHtml:c})}function u(s){return`
    <div class="wg-docsme-row-item wg-docsme-row-item--placeholder" aria-hidden="true">
      <span class="icon-[lucide--folder-plus] wg-docsme-placeholder-plus"></span>
      <span>${s("添加项目以展示")}</span>
    </div>
  `}function v(s,n){if(n){const a=s.find(o=>o.title===n);if(a)return a}return s.find(a=>!a.disabled)||s[0]||null}function y(s,n,a,o,c){const{escapeHtml:i,mode:r}=s,e=v(o,n?.meta?.projectTitle||""),t=e&&!e.disabled?i(e.href):a,d=e?.title||"文档中心",p=e?Math.min(100,Math.max(12,e.totalDocs/Math.max(1,c)*100)):0,w=e?`<span class="icon-[lucide--file-text]" aria-hidden="true"></span> ${e.totalDocs} Docs`:"Documentation";return l({href:t,app:"docsme",className:`wg-docsme wg-docsme--small${e?.disabled?" is-disabled":""}`,attrs:`aria-label="${i(`打开${d}`)}"`,disabled:r==="preview"||e?.disabled,innerHtml:`
      <span class="wg-docsme-small-top">
        ${e?m(i,e,"wg-docsme-icon--small"):'<span class="wg-docsme-icon wg-docsme-icon--small"><span class="icon-[lucide--book-open]"></span></span>'}
        <span class="wg-docsme-capsule" aria-hidden="true">
          <span class="icon-[lucide--bookmark]"></span>
        </span>
      </span>
      <span class="wg-docsme-small-copy">
        <strong>${i(d)}</strong>
        <em>${w}</em>
      </span>
      <span class="wg-docsme-small-foot">
        <span class="wg-docsme-progress-track">
          <span class="wg-docsme-progress-bar" style="width: ${p}%"></span>
        </span>
      </span>
    `})}function D(s,n,a,o){const{escapeHtml:c,mode:i}=s,r=a.slice(0,2),e=[];for(r.forEach(t=>{e.push(g(s,t))});e.length<2;)e.push(u(c));return`
    <div class="wg-docsme wg-docsme--medium wg-docsme-list-view">
      <span class="wg-docsme-header">
        <span class="wg-docsme-header-left">
          <span class="wg-docsme-header-icon" aria-hidden="true"><span class="icon-[lucide--book-open]"></span></span>
          <strong>${c("文档中心")}</strong>
          <span class="wg-docsme-header-stats-pill" aria-label="${c(`${a.length}个项目`)}">
            <span class="icon-[lucide--layers]" aria-hidden="true"></span>
            <span>${a.length}</span>
          </span>
        </span>
        ${l({href:n,app:"docsme",className:"wg-docsme-open",attrs:`aria-label="${c("查看全部文档项目")}"`,disabled:i==="preview",innerHtml:'<span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>'})}
      </span>
      <div class="wg-docsme-list-stack">
        ${e.join("")}
      </div>
    </div>
  `}function k(s,n,a,o){const{escapeHtml:c,mode:i}=s,r=a.slice(0,4),e=[];for(r.forEach(t=>{e.push(g(s,t))});e.length<4;)e.push(u(c));return`
    <div class="wg-docsme wg-docsme--large wg-docsme-list-view">
      <span class="wg-docsme-header">
        <span class="wg-docsme-header-left">
          <span class="wg-docsme-header-icon" aria-hidden="true"><span class="icon-[lucide--library]"></span></span>
          <strong>${c("文档中心")}</strong>
        </span>
        ${l({href:n,app:"docsme",className:"wg-docsme-view-all",attrs:`aria-label="${c("查看全部文档项目")}"`,disabled:i==="preview",innerHtml:'查看全部 <span class="icon-[lucide--chevron-right] wg-docsme-view-all-arrow" aria-hidden="true"></span>'})}
      </span>

      <div class="wg-docsme-list-stack">
        ${e.join("")}
      </div>

      <span class="wg-docsme-footer">
        <span><span class="icon-[lucide--layers]" aria-hidden="true"></span> ${a.length} Projects</span>
        <span><span class="icon-[lucide--file-text]" aria-hidden="true"></span> ${o} Docs</span>
      </span>
    </div>
  `}function N(s,n){const{sources:a,escapeHtml:o,mode:c}=s;if(!a.docsmeAvailable)return $(o);const i=n?.size||"medium",r=o(a.docsmeUrl||"/docs"),e=Array.isArray(a.docsmeProjects)?a.docsmeProjects.map(f).filter(d=>d.title):[],t=e.reduce((d,p)=>d+p.totalDocs,0);return e.length?i==="large"?k(s,r,e,t):i==="medium"?D(s,r,e,t):y(s,n,r,e,t):b(o,r,c,i==="large"?"large":i)}export{N as t};
