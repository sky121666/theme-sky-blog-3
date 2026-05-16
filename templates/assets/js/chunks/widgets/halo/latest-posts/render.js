import{i as p}from"../../catalog.js?v=0.9.30&r=0b401cdc9b1d";import{n as l}from"../author-card/render.js?v=0.9.30&r=0b401cdc9b1d";function y(i){const s=Number(i||0);if(!Number.isFinite(s)||s<0)return"0";if(s<1e3)return String(Math.round(s));if(s<1e6){const c=s/1e3;return c<10?`${Math.round(c*10)/10}k`:`${Math.round(c)}k`}const n=s/1e6;return n<10?`${Math.round(n*10)/10}m`:`${Math.round(n)}m`}function u(i){const s=i?new Date(i):null;return!s||Number.isNaN(s.getTime())?"":s.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}).replace("/",".")}function N({sources:i,escapeHtml:s,mode:n},c,$={}){const d=c?.size||"medium";let v=3;d==="small"?v=1:d==="large"&&(v=4);const r=i.latestPosts.slice(0,v);if(!r.length)return'<div class="desktop-widget-empty">还没有可展示的文章。</div>';let m="";if(d==="small"){const e=r[0],o=s(e?.spec?.title||"未命名文章"),a=s(u(e?.spec?.publishTime)||""),t=p(e?.spec?.cover,i.fallbackCover),w=t?`<img class="wg-news-sm-img" src="${s(t)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-sm-img is-placeholder"></div>';m=l({href:s(e?.status?.permalink||"#"),app:"reader",className:"wg-news-sm",disabled:n==="preview",innerHtml:`
        ${w}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${o}</strong>
          <span>${a}</span>
        </div>
      `})}else if(d==="medium"){const e=r[0],o=s(e?.spec?.title||"未命名文章"),a=p(e?.spec?.cover,i.fallbackCover),t=a?`<img class="wg-news-md-img" src="${s(a)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-news-md-img is-placeholder"></div>',w=r.slice(1).map(g=>{const h=s(g?.spec?.title||"未命名文章"),f=s(u(g?.spec?.publishTime)||"");return l({href:s(g?.status?.permalink||"#"),app:"reader",className:"wg-news-md-row",disabled:n==="preview",innerHtml:`
          <span class="wg-news-md-row-title">${h}</span>
          <span class="wg-news-md-row-date">${f}</span>
        `})}).join("");m=`
      ${l({href:s(e?.status?.permalink||"#"),app:"reader",className:"wg-news-md-cover",disabled:n==="preview",innerHtml:`
          ${t}
          <div class="wg-news-md-cover-scrim"></div>
        `})}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">最新发布</span>
          ${l({href:s(e?.status?.permalink||"#"),app:"reader",className:"wg-news-md-title",disabled:n==="preview",innerHtml:o})}
        </div>
        <div class="wg-news-md-list">${w}</div>
      </div>
    `}else{const e=r[0],o=s(e?.spec?.title||"未命名文章"),a=p(e?.spec?.cover,i.fallbackCover);m=`
      <div class="wg-news-lg-cover">
        ${a?`<img class="wg-news-lg-cover-img" src="${s(a)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="wg-news-lg-cover-img is-placeholder"></div>'}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">最新发布</span>
          <strong>${o}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${r.slice(1).map(t=>{const w=s(t?.spec?.title||"未命名文章"),g=s(u(t?.spec?.publishTime)||"");return l({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-news-lg-item",disabled:n==="preview",innerHtml:`
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${w}</span>
          <span class="wg-news-lg-item-date">${g}</span>
        `})}).join("")}
        ${l({href:s(i.archivesUrl||"/archives"),app:"explorer-archives",className:"wg-news-lg-viewall",disabled:n==="preview",innerHtml:"查看全部文章 →"})}
      </div>
    `}return`<div class="desktop-widget-news-layout is-${d}">${m}</div>`}export{y as n,N as t};
