import{i as $,n as x}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.30&r=d5811a492783";import{r as l}from"../author-card/render.js?v=0.9.30&r=d5811a492783";function F(s){const e=Number(s||0);if(!Number.isFinite(e)||e<0)return"0";if(e<1e3)return String(Math.round(e));if(e<1e6){const r=e/1e3;return r<10?`${Math.round(r*10)/10}k`:`${Math.round(r)}k`}const t=e/1e6;return t<10?`${Math.round(t*10)/10}m`:`${Math.round(t)}m`}function b(s){const e=s?new Date(s):null;return!e||Number.isNaN(e.getTime())?"":e.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}).replace("/",".")}function T(s,e,t,r){const u=Number.parseInt(s,10);return Number.isFinite(u)?Math.min(Math.max(u,t),r):e}function z(s){return s==="small"?1:s==="large"?4:3}function M(s,e=34){const t=s?.status?.excerpt||s?.spec?.excerpt?.raw||"",r=String(t||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();return r?r.length>e?`${r.slice(0,Math.max(e-1,1)).trimEnd()}…`:r:""}function S(s,e){const t=String(e||"").trim();return t&&x(s?.categories||[]).find(r=>r.key===t)||null}function A(s,e){return(Array.isArray(s?.spec?.categories)?s.spec.categories:[]).includes(e)?!0:(Array.isArray(s?.categories)?s.categories:[]).some(t=>t?.metadata?.name===e)}function I({sources:s,escapeHtml:e,mode:t},r,u={}){const w=r?.size||"medium",f=r?.meta&&typeof r.meta=="object"?r.meta:{},C=T(f.limit,z(w),1,8),k=f.showSummary===!0,v=S(s,f.categoryName),N=Array.isArray(s.latestPosts)?s.latestPosts:[],o=(v?N.filter(i=>A(i,v.key)):N).slice(0,C);if(!o.length)return'<div class="desktop-widget-empty">还没有可展示的文章。</div>';let p="";if(w==="small"){const i=o[0],d=e(i?.spec?.title||"未命名文章"),a=e(b(i?.spec?.publishTime)||""),c=$(i?.spec?.cover,s.fallbackCover),g=c?`<img class="wg-news-sm-img" src="${e(c)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-sm-img is-placeholder"></div>';p=l({href:e(i?.status?.permalink||"#"),app:"reader",className:"wg-news-sm",disabled:t==="preview",innerHtml:`
        ${g}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${d}</strong>
          <span>${a}</span>
        </div>
      `})}else if(w==="medium"){const i=o[0],d=e(i?.spec?.title||"未命名文章"),a=$(i?.spec?.cover,s.fallbackCover),c=a?`<img class="wg-news-md-img" src="${e(a)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-news-md-img is-placeholder"></div>',g=o.slice(1).map(n=>{const h=e(n?.spec?.title||"未命名文章"),m=e(b(n?.spec?.publishTime)||""),y=k?e(M(n)||m):m;return l({href:e(n?.status?.permalink||"#"),app:"reader",className:"wg-news-md-row",disabled:t==="preview",innerHtml:`
          <span class="wg-news-md-row-title">${h}</span>
          <span class="wg-news-md-row-date">${y}</span>
        `})}).join("");p=`
      ${l({href:e(i?.status?.permalink||"#"),app:"reader",className:"wg-news-md-cover",disabled:t==="preview",innerHtml:`
          ${c}
          <div class="wg-news-md-cover-scrim"></div>
        `})}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">${e(v?.name||"最新发布")}</span>
          ${l({href:e(i?.status?.permalink||"#"),app:"reader",className:"wg-news-md-title",disabled:t==="preview",innerHtml:d})}
        </div>
        <div class="wg-news-md-list">${g}</div>
      </div>
    `}else{const i=o[0],d=e(i?.spec?.title||"未命名文章"),a=$(i?.spec?.cover,s.fallbackCover),c=a?`<img class="wg-news-lg-cover-img" src="${e(a)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-lg-cover-img is-placeholder"></div>',g=o.slice(1).map(n=>{const h=e(n?.spec?.title||"未命名文章"),m=e(b(n?.spec?.publishTime)||""),y=k?e(M(n,40)||m):m;return l({href:e(n?.status?.permalink||"#"),app:"reader",className:"wg-news-lg-item",disabled:t==="preview",innerHtml:`
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${h}</span>
          <span class="wg-news-lg-item-date">${y}</span>
        `})}).join("");p=`
      <div class="wg-news-lg-cover">
        ${c}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">${e(v?.name||"最新发布")}</span>
          <strong>${d}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${g}
        ${l({href:e(s.archivesUrl||"/archives"),app:"explorer-archives",className:"wg-news-lg-viewall",disabled:t==="preview",innerHtml:"查看全部文章 →"})}
      </div>
    `}return`<div class="desktop-widget-news-layout is-${w}">${p}</div>`}export{F as n,I as t};
