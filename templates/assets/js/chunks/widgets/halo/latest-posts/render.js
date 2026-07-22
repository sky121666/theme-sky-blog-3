import{n as k}from"../../../rolldown-runtime.js?v=0.9.42&r=f73e4f2178bf";import{i as f,n as N}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.42&r=f73e4f2178bf";import{r as c}from"../author-card/render.js?v=0.9.42&r=f73e4f2178bf";function W(s){const e=Number(s||0);if(!Number.isFinite(e)||e<0)return"0";if(e<1e3)return String(Math.round(e));if(e<1e6){const r=e/1e3;return r<10?`${Math.round(r*10)/10}k`:`${Math.round(r)}k`}const i=e/1e6;return i<10?`${Math.round(i*10)/10}m`:`${Math.round(i)}m`}function h(s){const e=s?new Date(s):null;return!e||Number.isNaN(e.getTime())?"":e.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}).replace("/",".")}var j=k({renderWidget:()=>A});function C(s){return s==="small"?1:s==="large"?4:3}function M(s,e){const i=String(e||"").trim();return i&&N(s?.categories||[]).find(r=>r.key===i)||null}function T(s,e){return(Array.isArray(s?.spec?.categories)?s.spec.categories:[]).includes(e)?!0:(Array.isArray(s?.categories)?s.categories:[]).some(i=>i?.metadata?.name===e)}function A({sources:s,escapeHtml:e,mode:i},r,x={}){const w=r?.size||"medium",$=r?.meta&&typeof r.meta=="object"?r.meta:{},b=C(w),m=M(s,$.categoryName),y=Array.isArray(s.latestPosts)?s.latestPosts:[],l=(m?y.filter(t=>T(t,m.key)):y).slice(0,b);if(!l.length)return'<div class="desktop-widget-empty">还没有可展示的文章。</div>';let v="";if(w==="small"){const t=l[0],d=e(t?.spec?.title||"未命名文章"),n=e(h(t?.spec?.publishTime)||""),o=f(t?.spec?.cover,s.fallbackCover),g=o?`<img class="wg-news-sm-img" src="${e(o)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-sm-img is-placeholder"></div>';v=c({href:e(t?.status?.permalink||"#"),app:"reader",className:"wg-news-sm",disabled:i==="preview",innerHtml:`
        ${g}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${d}</strong>
          <span>${n}</span>
        </div>
      `})}else if(w==="medium"){const t=l[0],d=e(t?.spec?.title||"未命名文章"),n=f(t?.spec?.cover,s.fallbackCover),o=n?`<img class="wg-news-md-img" src="${e(n)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-news-md-img is-placeholder"></div>',g=l.slice(1).map(a=>{const p=e(a?.spec?.title||"未命名文章"),u=e(h(a?.spec?.publishTime)||"");return c({href:e(a?.status?.permalink||"#"),app:"reader",className:"wg-news-md-row",disabled:i==="preview",innerHtml:`
          <span class="wg-news-md-row-title">${p}</span>
          <span class="wg-news-md-row-date">${u}</span>
        `})}).join("");v=`
      ${c({href:e(t?.status?.permalink||"#"),app:"reader",className:"wg-news-md-cover",disabled:i==="preview",innerHtml:`
          ${o}
          <div class="wg-news-md-cover-scrim"></div>
        `})}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">${e(m?.name||"最新发布")}</span>
          ${c({href:e(t?.status?.permalink||"#"),app:"reader",className:"wg-news-md-title",disabled:i==="preview",innerHtml:d})}
        </div>
        <div class="wg-news-md-list">${g}</div>
      </div>
    `}else{const t=l[0],d=e(t?.spec?.title||"未命名文章"),n=f(t?.spec?.cover,s.fallbackCover),o=n?`<img class="wg-news-lg-cover-img" src="${e(n)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-lg-cover-img is-placeholder"></div>',g=l.slice(1).map(a=>{const p=e(a?.spec?.title||"未命名文章"),u=e(h(a?.spec?.publishTime)||"");return c({href:e(a?.status?.permalink||"#"),app:"reader",className:"wg-news-lg-item",disabled:i==="preview",innerHtml:`
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${p}</span>
          <span class="wg-news-lg-item-date">${u}</span>
        `})}).join("");v=`
      <div class="wg-news-lg-cover">
        ${o}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">${e(m?.name||"最新发布")}</span>
          <strong>${d}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${g}
        ${c({href:e(s.archivesUrl||"/archives"),app:"explorer-archives",className:"wg-news-lg-viewall",disabled:i==="preview",innerHtml:"查看全部文章 →"})}
      </div>
    `}return`<div class="desktop-widget-news-layout is-${w}">${v}</div>`}export{W as n,j as t};
