import{n as N}from"../../halo/author-card/render.js";var P='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';function U({sources:a,escapeHtml:e,mode:h},m){const v=m?.size||"small";if(!a.photosAvailable)return'<div class="desktop-widget-empty">未安装图库插件。</div>';const u=Array.isArray(a.photos)?a.photos:[],w=Array.isArray(a.photoGroups)?a.photoGroups:[],i=m?.meta?.groupName||"",t=i?u.filter(s=>s?.spec?.groupName===i):u;if(!t.length)return'<div class="desktop-widget-empty">还没有可展示的照片。</div>';const b=e(a.photosUrl||"/photos"),$=i&&w.find(s=>s?.metadata?.name===i)||null,p=s=>{if($)return $;const o=s?.spec?.groupName;return o&&w.find(n=>n?.metadata?.name===o)||null},l=s=>{const o=p(s);return e(o?.spec?.displayName||o?.metadata?.name||i||"图库")},d=s=>e((p(s)?.metadata?.annotations?.description||"").trim()),f=s=>(p(s)?.metadata?.annotations?.icon||"").trim()||P,A=s=>e(s?.spec?.url||""),G=s=>e(s?.spec?.displayName||""),r=(s,o)=>{const n=A(s);return n?`<img class="${o}" src="${n}" alt="${G(s)}" loading="lazy" decoding="async" fetchpriority="low">`:`<div class="${o} is-placeholder"></div>`},y=(s,o)=>`
      <div class="${o}">
        <span class="wg-photos-badge-icon">${f(s)}</span>
        <span class="wg-photos-badge-label">${l(s)}</span>
      </div>`;if(v==="small"){const s=t[0],o=d(s),n=l(s),g=t.length;return N({href:b,app:"",className:"wg-photos-sm",disabled:h==="preview",innerHtml:`
        ${r(s,"wg-photos-sm-img")}
        <div class="wg-photos-sm-scrim"></div>
        <div class="wg-photos-sm-top">
          ${y(s,"wg-photos-sm-badge")}
        </div>
        <div class="wg-photos-sm-bottom">
          <strong>${o||n}</strong>
          <span>${g} 张照片</span>
        </div>
      `})}if(v==="medium"){const s=t[0],o=l(s),n=d(s),g=t.length;return N({href:b,app:"",className:"wg-photos-md",disabled:h==="preview",innerHtml:`
        ${r(s,"wg-photos-md-img")}
        <div class="wg-photos-md-scrim"></div>
        ${y(s,"wg-photos-md-badge")}
        <div class="wg-photos-md-bottom">
          <strong class="wg-photos-md-title">${n||o}</strong>
          <span class="wg-photos-md-sub">${g} 张照片</span>
        </div>
      `})}const c=t[0],x=l(c),L=d(c),j=t.length,z=t.slice(1,4),k=Math.max(0,t.length-4),B=z.map(s=>`
    <div class="wg-photos-lg-thumb">${r(s,"wg-photos-lg-thumb-img")}</div>
  `).join(""),C=k>0?`<div class="wg-photos-lg-thumb is-more"><span>+${k}</span></div>`:"";return`
    <div class="wg-photos-lg">
      ${r(c,"wg-photos-lg-bg")}
      <div class="wg-photos-lg-scrim"></div>
      <div class="wg-photos-lg-top">
        <div class="wg-photos-lg-icon-box">${f(c)}</div>
        <span class="wg-photos-lg-kicker">${x}</span>
      </div>
      <div class="wg-photos-lg-bottom">
        <h3 class="wg-photos-lg-title">${L||x}</h3>
        <p class="wg-photos-lg-desc">${j} 张照片</p>
        <div class="wg-photos-lg-thumbs">
          ${B}${C}
        </div>
      </div>
    </div>
  `}export{U as t};
