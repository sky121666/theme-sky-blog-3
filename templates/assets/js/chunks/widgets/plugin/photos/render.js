import{n as I}from"../../../rolldown-runtime.js?v=0.9.42&r=021098ac32a6";import{r as C}from"../../halo/author-card/render.js?v=0.9.42&r=021098ac32a6";var S=I({renderWidget:()=>U}),M='<span class="icon-[lucide--image]" aria-hidden="true"></span>';function U({sources:e,escapeHtml:i,mode:v},w){const b=w?.size||"small";if(!e.photosAvailable)return'<div class="desktop-widget-empty">未安装图库插件。</div>';const $=Array.isArray(e.photos)?e.photos:[],f=Array.isArray(e.photoGroups)?e.photoGroups:[],a=w?.meta?.groupName||"",r=a&&f.find(s=>s?.metadata?.name===a)||null,y=Array.isArray(r?.photos)?r.photos:[],P=a?$.filter(s=>s?.spec?.groupName===a):[],n=a?y.length?y:P:$,g=Number(r?.status?.photoCount),l=a&&Number.isFinite(g)&&g>=0?Math.max(g,n.length):n.length;if(!n.length)return'<div class="desktop-widget-empty">该相册暂无照片。</div>';const N=i(e.photosUrl||"/photos"),m=s=>{if(r)return r;const o=s?.spec?.groupName;return o&&f.find(t=>t?.metadata?.name===o)||null},p=s=>{const o=m(s);return i(o?.spec?.displayName||o?.metadata?.name||a||"图库")},h=s=>i((m(s)?.metadata?.annotations?.description||"").trim()),A=s=>(m(s)?.metadata?.annotations?.icon||"").trim()||M,L=s=>i(s?.spec?.url||""),_=s=>i(s?.spec?.displayName||""),c=(s,o)=>{const t=L(s);return t?`<img class="${o}" src="${t}" alt="${_(s)}" loading="lazy" decoding="async" fetchpriority="low">`:`<div class="${o} is-placeholder"></div>`},x=(s,o)=>`
      <div class="${o}">
        <span class="wg-photos-badge-icon">${A(s)}</span>
        <span class="wg-photos-badge-label">${p(s)}</span>
      </div>`;if(b==="small"){const s=n[0],o=h(s),t=p(s),u=l;return C({href:N,app:"",className:"wg-photos-sm",disabled:v==="preview",innerHtml:`
        ${c(s,"wg-photos-sm-img")}
        <div class="wg-photos-sm-scrim"></div>
        <div class="wg-photos-sm-top">
          ${x(s,"wg-photos-sm-badge")}
        </div>
        <div class="wg-photos-sm-bottom">
          <strong>${o||t}</strong>
          <span>${u} 张照片</span>
        </div>
      `})}if(b==="medium"){const s=n[0],o=p(s),t=h(s),u=l;return C({href:N,app:"",className:"wg-photos-md",disabled:v==="preview",innerHtml:`
        ${c(s,"wg-photos-md-img")}
        <div class="wg-photos-md-scrim"></div>
        ${x(s,"wg-photos-md-badge")}
        <div class="wg-photos-md-bottom">
          <strong class="wg-photos-md-title">${t||o}</strong>
          <span class="wg-photos-md-sub">${u} 张照片</span>
        </div>
      `})}const d=n[0],G=p(d),z=h(d),W=l,j=n.slice(1,4),k=Math.max(0,l-4),B=j.map(s=>`
    <div class="wg-photos-lg-thumb">${c(s,"wg-photos-lg-thumb-img")}</div>
  `).join(""),F=k>0?`<div class="wg-photos-lg-thumb is-more"><span>+${k}</span></div>`:"";return`
    <div class="wg-photos-lg">
      ${c(d,"wg-photos-lg-bg")}
      <div class="wg-photos-lg-scrim"></div>
      <div class="wg-photos-lg-top">
        <div class="wg-photos-lg-icon-box">${A(d)}</div>
        <span class="wg-photos-lg-kicker">${G}</span>
      </div>
      <div class="wg-photos-lg-bottom">
        <h3 class="wg-photos-lg-title">${z||G}</h3>
        <p class="wg-photos-lg-desc">${W} 张照片</p>
        <div class="wg-photos-lg-thumbs">
          ${B}${F}
        </div>
      </div>
    </div>
  `}export{S as t};
