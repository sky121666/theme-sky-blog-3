import{i as S}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.30&r=4cac52e6adeb";import{n as v}from"../author-card/render.js?v=0.9.30&r=4cac52e6adeb";import{n as c}from"../latest-posts/render.js?v=0.9.30&r=4cac52e6adeb";function j(a,s,o,i){const g=Number.parseInt(a,10);return Number.isFinite(g)?Math.min(Math.max(g,o),i):s}function z(a,s){return a==="small"?1:a==="large"?s?4:5:3}function x(a,s=38){const o=a?.status?.excerpt||a?.spec?.excerpt?.raw||"",i=String(o||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();return i?i.length>s?`${i.slice(0,Math.max(s-1,1)).trimEnd()}…`:i:""}function A({sources:a,escapeHtml:s,mode:o},i,g={}){const u=g.compact===!0,h=i?.size||"medium",f=i?.meta&&typeof i.meta=="object"?i.meta:{},P=j(f.limit,z(h,u),1,8),$=f.showSummary===!0,n=(Array.isArray(a.popularPosts)?a.popularPosts:[]).slice(0,P);if(!n.length)return'<div class="desktop-widget-empty">热门文章暂时为空。</div>';const b=Math.max(...n.map(t=>t?.stats?.visit??0),1);let m="";if(h==="small"){const t=n[0],e=s(t?.spec?.title||"未命名文章"),l=t?.stats?.visit??0,r=S(t?.spec?.cover,a.fallbackCover),d=r?`style="background-image:url('${s(r)}')"`:"",p=r?"":" is-no-cover";m=v({href:s(t?.status?.permalink||"#"),app:"reader",className:`wg-hot-sm${p}`,attrs:d,disabled:o==="preview",innerHtml:`
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <span class="icon-[lucide--flame]" aria-hidden="true"></span>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${e}</h3>
          <span class="wg-hot-sm-visits">${s(c(l))} 阅读</span>
        </div>
      `})}else if(h==="medium")m=`
      <div class="wg-hot-md-head">
        <span class="wg-hot-md-icon icon-[lucide--flame]" aria-hidden="true"></span>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${n.map((t,e)=>{const l=s(t?.spec?.title||"未命名文章"),r=t?.stats?.visit??0,d=Math.round(r/b*100),p=s($?x(t)||c(r):c(r));return v({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-hot-md-row",disabled:o==="preview",innerHtml:`
          <span class="wg-hot-md-rank${e<3?" is-top":""}">${String(e+1).padStart(2,"0")}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${l}</span>
            <div class="wg-hot-md-bar"><span style="width:${d}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${p}</span>
        `})}).join("")}</div>
    `;else{const t=n[0],e=s(t?.spec?.title||"未命名文章"),l=S(t?.spec?.cover,a.fallbackCover),r=t?.stats?.visit??0,d=$?s(x(t,48)||`${c(r)} 阅读`):`${s(c(r))} 阅读`,p=l?`<img class="wg-hot-lg-cover-img" src="${s(l)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`:'<div class="wg-hot-lg-cover-img is-placeholder"></div>',C=n.slice(1).map((w,y)=>{const M=s(w?.spec?.title||"未命名文章"),k=w?.stats?.visit??0,N=Math.round(k/b*100);return v({href:s(w?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-row",disabled:o==="preview",innerHtml:`
          <span class="wg-hot-lg-rank${y<2?" is-top":""}">${String(y+2).padStart(2,"0")}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${M}</span>
            <div class="wg-hot-lg-bar"><span style="width:${N}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${s(c(k))}</span>
        `})}).join("");m=`
      <div class="wg-hot-lg-hero">
        ${v({href:s(t?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-cover",disabled:o==="preview",innerHtml:`
            ${p}
            <div class="wg-hot-lg-cover-scrim"></div>
            <div class="wg-hot-lg-cover-text">
              <span class="wg-hot-lg-badge">
                <span class="icon-[lucide--flame]" aria-hidden="true"></span>
                TOP 1
              </span>
              <strong>${e}</strong>
              <span class="wg-hot-lg-hero-visits">${d}</span>
            </div>
          `})}
      </div>
      <div class="wg-hot-lg-list">${C}</div>
    `}return`<div class="${`wg-hot-wrap wg-hot-wrap--${h}${u?" is-compact":""}`}">${m}</div>`}export{A as t};
