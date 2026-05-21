import{r as k}from"../../halo/author-card/render.js?v=0.9.32&r=6bf22e1a379f";var C='<span class="icon-[lucide--image]" aria-hidden="true"></span>';function U({sources:n,escapeHtml:i,mode:m},h){const u=h?.size||"small";if(!n.photosAvailable)return'<div class="desktop-widget-empty">未安装图库插件。</div>';const v=Array.isArray(n.photos)?n.photos:[],w=Array.isArray(n.photoGroups)?n.photoGroups:[],e=h?.meta?.groupName||"",t=e?v.filter(s=>s?.spec?.groupName===e):v;if(!t.length)return'<div class="desktop-widget-empty">该相册暂无照片。</div>';const b=i(n.photosUrl||"/photos"),$=e&&w.find(s=>s?.metadata?.name===e)||null,d=s=>{if($)return $;const o=s?.spec?.groupName;return o&&w.find(a=>a?.metadata?.name===o)||null},l=s=>{const o=d(s);return i(o?.spec?.displayName||o?.metadata?.name||e||"图库")},r=s=>i((d(s)?.metadata?.annotations?.description||"").trim()),f=s=>(d(s)?.metadata?.annotations?.icon||"").trim()||C,x=s=>i(s?.spec?.url||""),G=s=>i(s?.spec?.displayName||""),c=(s,o)=>{const a=x(s);return a?`<img class="${o}" src="${a}" alt="${G(s)}" loading="lazy" decoding="async" fetchpriority="low">`:`<div class="${o} is-placeholder"></div>`},y=(s,o)=>`
      <div class="${o}">
        <span class="wg-photos-badge-icon">${f(s)}</span>
        <span class="wg-photos-badge-label">${l(s)}</span>
      </div>`;if(u==="small"){const s=t[0],o=r(s),a=l(s),g=t.length;return k({href:b,app:"",className:"wg-photos-sm",disabled:m==="preview",innerHtml:`
        ${c(s,"wg-photos-sm-img")}
        <div class="wg-photos-sm-scrim"></div>
        <div class="wg-photos-sm-top">
          ${y(s,"wg-photos-sm-badge")}
        </div>
        <div class="wg-photos-sm-bottom">
          <strong>${o||a}</strong>
          <span>${g} 张照片</span>
        </div>
      `})}if(u==="medium"){const s=t[0],o=l(s),a=r(s),g=t.length;return k({href:b,app:"",className:"wg-photos-md",disabled:m==="preview",innerHtml:`
        ${c(s,"wg-photos-md-img")}
        <div class="wg-photos-md-scrim"></div>
        ${y(s,"wg-photos-md-badge")}
        <div class="wg-photos-md-bottom">
          <strong class="wg-photos-md-title">${a||o}</strong>
          <span class="wg-photos-md-sub">${g} 张照片</span>
        </div>
      `})}const p=t[0],N=l(p),L=r(p),z=t.length,P=t.slice(1,4),A=Math.max(0,t.length-4),j=P.map(s=>`
    <div class="wg-photos-lg-thumb">${c(s,"wg-photos-lg-thumb-img")}</div>
  `).join(""),B=A>0?`<div class="wg-photos-lg-thumb is-more"><span>+${A}</span></div>`:"";return`
    <div class="wg-photos-lg">
      ${c(p,"wg-photos-lg-bg")}
      <div class="wg-photos-lg-scrim"></div>
      <div class="wg-photos-lg-top">
        <div class="wg-photos-lg-icon-box">${f(p)}</div>
        <span class="wg-photos-lg-kicker">${N}</span>
      </div>
      <div class="wg-photos-lg-bottom">
        <h3 class="wg-photos-lg-title">${L||N}</h3>
        <p class="wg-photos-lg-desc">${z} 张照片</p>
        <div class="wg-photos-lg-thumbs">
          ${j}${B}
        </div>
      </div>
    </div>
  `}export{U as t};
