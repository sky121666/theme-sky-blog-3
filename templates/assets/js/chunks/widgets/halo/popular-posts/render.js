import{n as P}from"../../../rolldown-runtime.js?v=0.9.43&r=daa8e9e9872c";import{i as $}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.43&r=daa8e9e9872c";import{r as p}from"../author-card/render.js?v=0.9.43&r=daa8e9e9872c";import{n as v}from"../latest-posts/render.js?v=0.9.43&r=daa8e9e9872c";var A=P({renderWidget:()=>N});function S(i,s){return i==="small"?1:i==="large"?s?4:5:3}function N({sources:i,escapeHtml:s,mode:c},b,k={}){const m=k.compact===!0,d=b?.size||"medium",y=S(d,m),o=(Array.isArray(i.popularPosts)?i.popularPosts:[]).slice(0,y);if(!o.length)return'<div class="desktop-widget-empty">热门文章暂时为空。</div>';const w=Math.max(...o.map(t=>t?.stats?.visit??0),1);let g="";if(d==="small"){const t=o[0],r=s(t?.spec?.title||"未命名文章"),n=t?.stats?.visit??0,a=$(t?.spec?.cover,i.fallbackCover),e=a?`style="background-image:url('${s(a)}')"`:"",l=a?"":" is-no-cover";g=p({href:s(t?.status?.permalink||"#"),app:"reader",className:`wg-hot-sm${l}`,attrs:e,disabled:c==="preview",innerHtml:`
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <span class="icon-[lucide--flame]" aria-hidden="true"></span>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${r}</h3>
          <span class="wg-hot-sm-visits">${s(v(n))} 阅读</span>
        </div>
      `})}else if(d==="medium")g=`
      <div class="wg-hot-md-head">
        <span class="wg-hot-md-icon icon-[lucide--flame]" aria-hidden="true"></span>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${o.map((t,r)=>{const n=s(t?.spec?.title||"未命名文章"),a=t?.stats?.visit??0,e=Math.round(a/w*100),l=s(v(a));return p({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-hot-md-row",disabled:c==="preview",innerHtml:`
          <span class="wg-hot-md-rank${r<3?" is-top":""}">${String(r+1).padStart(2,"0")}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${n}</span>
            <div class="wg-hot-md-bar"><span style="width:${e}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${l}</span>
        `})}).join("")}</div>
    `;else{const t=o[0],r=s(t?.spec?.title||"未命名文章"),n=$(t?.spec?.cover,i.fallbackCover),a=`${s(v(t?.stats?.visit??0))} 阅读`,e=n?`<img class="wg-hot-lg-cover-img" src="${s(n)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-hot-lg-cover-img is-placeholder"></div>',l=o.slice(1).map((h,u)=>{const x=s(h?.spec?.title||"未命名文章"),f=h?.stats?.visit??0,C=Math.round(f/w*100);return p({href:s(h?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-row",disabled:c==="preview",innerHtml:`
          <span class="wg-hot-lg-rank${u<2?" is-top":""}">${String(u+2).padStart(2,"0")}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${x}</span>
            <div class="wg-hot-lg-bar"><span style="width:${C}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${s(v(f))}</span>
        `})}).join("");g=`
      <div class="wg-hot-lg-hero">
        ${p({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-cover",disabled:c==="preview",innerHtml:`
            ${e}
            <div class="wg-hot-lg-cover-scrim"></div>
            <div class="wg-hot-lg-cover-text">
              <span class="wg-hot-lg-badge">
                <span class="icon-[lucide--flame]" aria-hidden="true"></span>
                TOP 1
              </span>
              <strong>${r}</strong>
              <span class="wg-hot-lg-hero-visits">${a}</span>
            </div>
          `})}
      </div>
      <div class="wg-hot-lg-list">${l}</div>
    `}return`<div class="${`wg-hot-wrap wg-hot-wrap--${d}${m?" is-compact":""}`}">${g}</div>`}export{A as t};
