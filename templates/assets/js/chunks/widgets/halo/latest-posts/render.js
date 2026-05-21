import{i as f,n as k}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.32&r=6bf22e1a379f";import{r as c}from"../author-card/render.js?v=0.9.32&r=6bf22e1a379f";function L(e){const s=Number(e||0);if(!Number.isFinite(s)||s<0)return"0";if(s<1e3)return String(Math.round(s));if(s<1e6){const n=s/1e3;return n<10?`${Math.round(n*10)/10}k`:`${Math.round(n)}k`}const i=s/1e6;return i<10?`${Math.round(i*10)/10}m`:`${Math.round(i)}m`}function h(e){const s=e?new Date(e):null;return!s||Number.isNaN(s.getTime())?"":s.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}).replace("/",".")}function N(e){return e==="small"?1:e==="large"?4:3}function C(e,s){const i=String(s||"").trim();return i&&k(e?.categories||[]).find(n=>n.key===i)||null}function M(e,s){return(Array.isArray(e?.spec?.categories)?e.spec.categories:[]).includes(s)?!0:(Array.isArray(e?.categories)?e.categories:[]).some(i=>i?.metadata?.name===s)}function P({sources:e,escapeHtml:s,mode:i},n,T={}){const w=n?.size||"medium",$=n?.meta&&typeof n.meta=="object"?n.meta:{},b=N(w),m=C(e,$.categoryName),y=Array.isArray(e.latestPosts)?e.latestPosts:[],l=(m?y.filter(t=>M(t,m.key)):y).slice(0,b);if(!l.length)return'<div class="desktop-widget-empty">还没有可展示的文章。</div>';let v="";if(w==="small"){const t=l[0],d=s(t?.spec?.title||"未命名文章"),r=s(h(t?.spec?.publishTime)||""),o=f(t?.spec?.cover,e.fallbackCover),g=o?`<img class="wg-news-sm-img" src="${s(o)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-sm-img is-placeholder"></div>';v=c({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-sm",disabled:i==="preview",innerHtml:`
        ${g}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${d}</strong>
          <span>${r}</span>
        </div>
      `})}else if(w==="medium"){const t=l[0],d=s(t?.spec?.title||"未命名文章"),r=f(t?.spec?.cover,e.fallbackCover),o=r?`<img class="wg-news-md-img" src="${s(r)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-news-md-img is-placeholder"></div>',g=l.slice(1).map(a=>{const p=s(a?.spec?.title||"未命名文章"),u=s(h(a?.spec?.publishTime)||"");return c({href:s(a?.status?.permalink||"#"),app:"reader",className:"wg-news-md-row",disabled:i==="preview",innerHtml:`
          <span class="wg-news-md-row-title">${p}</span>
          <span class="wg-news-md-row-date">${u}</span>
        `})}).join("");v=`
      ${c({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-md-cover",disabled:i==="preview",innerHtml:`
          ${o}
          <div class="wg-news-md-cover-scrim"></div>
        `})}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">${s(m?.name||"最新发布")}</span>
          ${c({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-md-title",disabled:i==="preview",innerHtml:d})}
        </div>
        <div class="wg-news-md-list">${g}</div>
      </div>
    `}else{const t=l[0],d=s(t?.spec?.title||"未命名文章"),r=f(t?.spec?.cover,e.fallbackCover),o=r?`<img class="wg-news-lg-cover-img" src="${s(r)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-lg-cover-img is-placeholder"></div>',g=l.slice(1).map(a=>{const p=s(a?.spec?.title||"未命名文章"),u=s(h(a?.spec?.publishTime)||"");return c({href:s(a?.status?.permalink||"#"),app:"reader",className:"wg-news-lg-item",disabled:i==="preview",innerHtml:`
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${p}</span>
          <span class="wg-news-lg-item-date">${u}</span>
        `})}).join("");v=`
      <div class="wg-news-lg-cover">
        ${o}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">${s(m?.name||"最新发布")}</span>
          <strong>${d}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${g}
        ${c({href:s(e.archivesUrl||"/archives"),app:"explorer-archives",className:"wg-news-lg-viewall",disabled:i==="preview",innerHtml:"查看全部文章 →"})}
      </div>
    `}return`<div class="desktop-widget-news-layout is-${w}">${v}</div>`}export{L as n,P as t};
