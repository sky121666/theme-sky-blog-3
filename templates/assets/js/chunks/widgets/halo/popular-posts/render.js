import{i as b}from"../../catalog.js?v=0.9.30";import{n as d}from"../author-card/render.js?v=0.9.30";import{n as g}from"../latest-posts/render.js?v=0.9.30";function M({sources:p,escapeHtml:t,mode:r},k,y={}){const w=y.compact===!0,n=k?.size||"medium";let v=3;n==="small"?v=1:n==="large"&&(v=w?4:5);const i=p.popularPosts.slice(0,v);if(!i.length)return'<div class="desktop-widget-empty">热门文章暂时为空。</div>';const $=Math.max(...i.map(s=>s?.stats?.visit??0),1);let c="";if(n==="small"){const s=i[0],o=t(s?.spec?.title||"未命名文章"),l=s?.stats?.visit??0,a=b(s?.spec?.cover,p.fallbackCover),e=a?`style="background-image:url('${t(a)}')"`:"",h=a?"":" is-no-cover";c=d({href:t(s?.status?.permalink||"#"),app:"reader",className:`wg-hot-sm${h}`,attrs:e,disabled:r==="preview",innerHtml:`
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <span class="icon-[lucide--flame]" aria-hidden="true"></span>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${o}</h3>
          <span class="wg-hot-sm-visits">${t(g(l))} 阅读</span>
        </div>
      `})}else if(n==="medium")c=`
      <div class="wg-hot-md-head">
        <span class="wg-hot-md-icon icon-[lucide--flame]" aria-hidden="true"></span>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${i.map((s,o)=>{const l=t(s?.spec?.title||"未命名文章"),a=s?.stats?.visit??0,e=Math.round(a/$*100);return d({href:t(s?.status?.permalink||"#"),app:"reader",className:"wg-hot-md-row",disabled:r==="preview",innerHtml:`
          <span class="wg-hot-md-rank${o<3?" is-top":""}">${String(o+1).padStart(2,"0")}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${l}</span>
            <div class="wg-hot-md-bar"><span style="width:${e}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${t(g(a))}</span>
        `})}).join("")}</div>
    `;else{const s=i[0],o=t(s?.spec?.title||"未命名文章"),l=b(s?.spec?.cover,p.fallbackCover),a=s?.stats?.visit??0,e=l?`<img class="wg-hot-lg-cover-img" src="${t(l)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-hot-lg-cover-img is-placeholder"></div>',h=i.slice(1).map((m,f)=>{const C=t(m?.spec?.title||"未命名文章"),u=m?.stats?.visit??0,P=Math.round(u/$*100);return d({href:t(m?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-row",disabled:r==="preview",innerHtml:`
          <span class="wg-hot-lg-rank${f<2?" is-top":""}">${String(f+2).padStart(2,"0")}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${C}</span>
            <div class="wg-hot-lg-bar"><span style="width:${P}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${t(g(u))}</span>
        `})}).join("");c=`
      <div class="wg-hot-lg-hero">
        ${d({href:t(s?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-cover",disabled:r==="preview",innerHtml:`
            ${e}
            <div class="wg-hot-lg-cover-scrim"></div>
            <div class="wg-hot-lg-cover-text">
              <span class="wg-hot-lg-badge">
                <span class="icon-[lucide--flame]" aria-hidden="true"></span>
                TOP 1
              </span>
              <strong>${o}</strong>
              <span class="wg-hot-lg-hero-visits">${t(g(a))} 阅读</span>
            </div>
          `})}
      </div>
      <div class="wg-hot-lg-list">${h}</div>
    `}return`<div class="${`wg-hot-wrap wg-hot-wrap--${n}${w?" is-compact":""}`}">${c}</div>`}export{M as t};
