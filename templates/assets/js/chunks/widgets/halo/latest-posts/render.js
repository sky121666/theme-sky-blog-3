import{n as k}from"../../../rolldown-runtime.js?v=0.9.46&r=e66d1a843400";import{i as f,n as N}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.46&r=e66d1a843400";import{r as c}from"../author-card/render.js?v=0.9.46&r=e66d1a843400";function P(e){const s=Number(e||0);if(!Number.isFinite(s)||s<0)return"0";if(s<1e3)return String(Math.round(s));if(s<1e6){const n=s/1e3;return n<10?`${Math.round(n*10)/10}k`:`${Math.round(n)}k`}const i=s/1e6;return i<10?`${Math.round(i*10)/10}m`:`${Math.round(i)}m`}function y(e){const s=e?new Date(e):null;return!s||Number.isNaN(s.getTime())?"":s.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}).replace("/",".")}var W=k({renderWidget:()=>T});function C(e){return e==="small"?1:e==="large"?4:3}function M(e,s){const i=String(s||"").trim();return i&&N(e?.categories||[]).find(n=>n.key===i)||null}function T({sources:e,escapeHtml:s,mode:i},n,x={}){const m=n?.size||"medium",$=n?.meta&&typeof n.meta=="object"?n.meta:{},b=C(m),l=String($.categoryName||"").trim(),h=M(e,l);if(l){const t=e.latestPostsCategory;if(t?.name!==l||t.status==="loading")return'<div class="desktop-widget-empty" role="status" aria-busy="true">正在读取分类文章…</div>';if(t.status!=="ready")return'<div class="desktop-widget-empty" role="status">分类文章暂时无法加载，请刷新页面后重试。</div>'}const o=(Array.isArray(e.latestPosts)?e.latestPosts:[]).slice(0,b);if(!o.length)return l?'<div class="desktop-widget-empty">该分类还没有可展示的文章。</div>':'<div class="desktop-widget-empty">还没有可展示的文章。</div>';let v="";if(m==="small"){const t=o[0],g=s(t?.spec?.title||"未命名文章"),r=s(y(t?.spec?.publishTime)||""),d=f(t?.spec?.cover,e.fallbackCover),w=d?`<img class="wg-news-sm-img" src="${s(d)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-sm-img is-placeholder"></div>';v=c({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-sm",disabled:i==="preview",innerHtml:`
        ${w}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${g}</strong>
          <span>${r}</span>
        </div>
      `})}else if(m==="medium"){const t=o[0],g=s(t?.spec?.title||"未命名文章"),r=f(t?.spec?.cover,e.fallbackCover),d=r?`<img class="wg-news-md-img" src="${s(r)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-news-md-img is-placeholder"></div>',w=o.slice(1).map(a=>{const p=s(a?.spec?.title||"未命名文章"),u=s(y(a?.spec?.publishTime)||"");return c({href:s(a?.status?.permalink||"#"),app:"reader",className:"wg-news-md-row",disabled:i==="preview",innerHtml:`
          <span class="wg-news-md-row-title">${p}</span>
          <span class="wg-news-md-row-date">${u}</span>
        `})}).join("");v=`
      ${c({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-md-cover",disabled:i==="preview",innerHtml:`
          ${d}
          <div class="wg-news-md-cover-scrim"></div>
        `})}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">${s(h?.name||(l?"分类文章":"最新发布"))}</span>
          ${c({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-md-title",disabled:i==="preview",innerHtml:g})}
        </div>
        <div class="wg-news-md-list">${w}</div>
      </div>
    `}else{const t=o[0],g=s(t?.spec?.title||"未命名文章"),r=f(t?.spec?.cover,e.fallbackCover),d=r?`<img class="wg-news-lg-cover-img" src="${s(r)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-lg-cover-img is-placeholder"></div>',w=o.slice(1).map(a=>{const p=s(a?.spec?.title||"未命名文章"),u=s(y(a?.spec?.publishTime)||"");return c({href:s(a?.status?.permalink||"#"),app:"reader",className:"wg-news-lg-item",disabled:i==="preview",innerHtml:`
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${p}</span>
          <span class="wg-news-lg-item-date">${u}</span>
        `})}).join("");v=`
      <div class="wg-news-lg-cover">
        ${d}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">${s(h?.name||(l?"分类文章":"最新发布"))}</span>
          <strong>${g}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${w}
        ${c({href:s(e.archivesUrl||"/archives"),app:"explorer-archives",className:"wg-news-lg-viewall",disabled:i==="preview",innerHtml:"查看全部文章 →"})}
      </div>
    `}return`<div class="desktop-widget-news-layout is-${m}">${v}</div>`}export{P as n,W as t};
