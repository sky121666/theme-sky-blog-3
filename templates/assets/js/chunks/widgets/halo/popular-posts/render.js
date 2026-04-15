import{i as b}from"../../catalog.js";import{n as d}from"../author-card/render.js";import{n as g}from"../latest-posts/render.js";function P({sources:v,escapeHtml:t,mode:c},k,C={}){const m=C.compact===!0,r=k?.size||"medium";let h=3;r==="small"?h=1:r==="large"&&(h=m?4:5);const a=v.popularPosts.slice(0,h);if(!a.length)return'<div class="desktop-widget-empty">热门文章暂时为空。</div>';const $=Math.max(...a.map(s=>s?.stats?.visit??0),1);let n="";if(r==="small"){const s=a[0],o=t(s?.spec?.title||"未命名文章"),l=s?.stats?.visit??0,i=b(s?.spec?.cover,v.fallbackCover),e=i?`style="background-image:url('${t(i)}')"`:"",p=i?"":" is-no-cover";n=d({href:t(s?.status?.permalink||"#"),app:"reader",className:`wg-hot-sm${p}`,attrs:e,disabled:c==="preview",innerHtml:`
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${o}</h3>
          <span class="wg-hot-sm-visits">${t(g(l))} 阅读</span>
        </div>
      `})}else if(r==="medium")n=`
      <div class="wg-hot-md-head">
        <svg class="wg-hot-md-icon" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${a.map((s,o)=>{const l=t(s?.spec?.title||"未命名文章"),i=s?.stats?.visit??0,e=Math.round(i/$*100);return d({href:t(s?.status?.permalink||"#"),app:"reader",className:"wg-hot-md-row",disabled:c==="preview",innerHtml:`
          <span class="wg-hot-md-rank${o<3?" is-top":""}">${String(o+1).padStart(2,"0")}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${l}</span>
            <div class="wg-hot-md-bar"><span style="width:${e}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${t(g(i))}</span>
        `})}).join("")}</div>
    `;else{const s=a[0],o=t(s?.spec?.title||"未命名文章"),l=b(s?.spec?.cover,v.fallbackCover),i=s?.stats?.visit??0,e=l?`<img class="wg-hot-lg-cover-img" src="${t(l)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-hot-lg-cover-img is-placeholder"></div>',p=a.slice(1).map((w,f)=>{const M=t(w?.spec?.title||"未命名文章"),u=w?.stats?.visit??0,z=Math.round(u/$*100);return d({href:t(w?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-row",disabled:c==="preview",innerHtml:`
          <span class="wg-hot-lg-rank${f<2?" is-top":""}">${String(f+2).padStart(2,"0")}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${M}</span>
            <div class="wg-hot-lg-bar"><span style="width:${z}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${t(g(u))}</span>
        `})}).join("");n=`
      <div class="wg-hot-lg-hero">
        ${d({href:t(s?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-cover",disabled:c==="preview",innerHtml:`
            ${e}
            <div class="wg-hot-lg-cover-scrim"></div>
            <div class="wg-hot-lg-cover-text">
              <span class="wg-hot-lg-badge">
                <svg viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
                TOP 1
              </span>
              <strong>${o}</strong>
              <span class="wg-hot-lg-hero-visits">${t(g(i))} 阅读</span>
            </div>
          `})}
      </div>
      <div class="wg-hot-lg-list">${p}</div>
    `}return`<div class="${`wg-hot-wrap wg-hot-wrap--${r}${m?" is-compact":""}`}">${n}</div>`}export{P as t};
