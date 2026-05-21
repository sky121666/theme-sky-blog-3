import{n as w,r as $}from"../../halo/author-card/render.js?v=0.9.32&r=56716c520d50";var m={wish:"想看",watching:"在看",done:"已看"},f=["watching","wish","done"],y=["anime","drama"];function h(s={}){return{typeNum:["1","2"].includes(String(s.typeNum||""))?String(s.typeNum):"",status:["auto","watching","wish","done"].includes(String(s.status||""))?String(s.status||""):"auto"}}function v(s){return Array.isArray(s)?s:Array.isArray(s?.items)?s.items:[]}function S(s){return s==="1"?["anime"]:s==="2"?["drama"]:y}function L(s,t,a){const n=s?.spec||{},i=String(n.title||s?.metadata?.name||"追番记录").trim();return{key:s?.metadata?.name||`${a}-${t}-${i}`,title:i,cover:String(n.cover||"").trim(),href:String(n.url||"").trim(),score:n.score??"",totalCount:String(n.totalCount||"").trim(),type:String(n.type||"").trim(),area:String(n.area||"").trim(),description:String(n.des||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim(),status:t,statusLabel:m[t]||"追番",typeKey:a,typeLabel:a==="drama"?"追剧":"追番"}}function N(s={},t={},a=4){const n=h(t),i=n.status==="auto"?f:[n.status],r=s.bangumisByStatus||{};for(const e of S(n.typeNum)){const u=r[e]||{};for(const g of i){const b=v(u[g]).map(c=>L(c,g,e)).filter(c=>c.title).slice(0,Math.max(a,1));if(b.length)return{items:b,typeKey:e,status:g,typeLabel:e==="drama"?"追剧":"追番",statusLabel:m[g]||"追番"}}}return{items:[],typeKey:n.typeNum==="2"?"drama":"anime",status:n.status==="auto"?"watching":n.status,typeLabel:n.typeNum==="2"?"追剧":"追番",statusLabel:m[n.status]||"在看"}}function o(s,t,a){return s.cover?`<img class="${a}" src="${t(s.cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">`:`
      <span class="${a} is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
    `}function l({item:s,className:t,mode:a,escapeHtml:n,innerHtml:i}){return!s.href||a==="preview"?`<span class="${t}">${i}</span>`:w({href:n(s.href),className:t,attrs:`aria-label="${n(`打开 ${s.title}`)}"`,innerHtml:i})}function p(s,t,a="打开追番"){return $({href:"/bangumis",app:"bangumis",className:"wg-bangumis-open",disabled:t==="preview",innerHtml:`
      <span>${s(a)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function d({escapeHtml:s,mode:t,installed:a}){return`
    <div class="wg-bangumis wg-bangumis--empty">
      <span class="wg-bangumis-empty-icon">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <strong>${a?"还没有追番记录":"未安装追番插件"}</strong>
      <p>${a?"记录公开追番追剧后会在这里显示。":"安装 Bilibili 追番插件后可添加小组件。"}</p>
      ${a?p(s,t,"去看看"):""}
    </div>
  `}function k({item:s,escapeHtml:t,mode:a}){return l({item:s,mode:a,escapeHtml:t,className:"wg-bangumis wg-bangumis--small",innerHtml:`
      ${o(s,t,"wg-bangumis-small-cover")}
      <span class="wg-bangumis-scrim"></span>
      <span class="wg-bangumis-small-copy">
        <span class="wg-bangumis-status is-${s.status}">${t(s.statusLabel)}</span>
        <strong>${t(s.title)}</strong>
      </span>
    `})}function A({items:s,summary:t,counts:a,escapeHtml:n,mode:i}){const r=s[0],e=s.slice(1,2);return`
    <div class="wg-bangumis wg-bangumis--medium">
      <div class="wg-bangumis-meter">
        <span class="wg-bangumis-kicker">${n(t.typeLabel)}</span>
        <strong>${n(t.statusLabel)}</strong>
        <span>${n(`${a.watching||0} 在看 · ${a.wish||0} 想看 · ${a.done||0} 已看`)}</span>
      </div>
      ${l({item:r,mode:i,escapeHtml:n,className:"wg-bangumis-feature",innerHtml:`
          ${o(r,n,"wg-bangumis-feature-cover")}
          <span class="wg-bangumis-feature-copy">
            <span class="wg-bangumis-status is-${r.status}">${n(r.statusLabel)}</span>
            <strong>${n(r.title)}</strong>
            <span>${n(r.totalCount||r.type||r.area||"打开继续查看")}</span>
          </span>
        `})}
      ${e.map(u=>l({item:u,mode:i,escapeHtml:n,className:"wg-bangumis-row",innerHtml:`
          ${o(u,n,"wg-bangumis-row-cover")}
          <span>
            <strong>${n(u.title)}</strong>
            <em>${n(u.statusLabel)}</em>
          </span>
        `})).join("")}
    </div>
  `}function B({items:s,summary:t,counts:a,escapeHtml:n,mode:i}){return`
    <div class="wg-bangumis wg-bangumis--large">
      <header class="wg-bangumis-head">
        <span>
          <em>${n(t.typeLabel)}</em>
          <strong>${n(t.statusLabel)}</strong>
        </span>
        ${p(n,i,"全部")}
      </header>
      <div class="wg-bangumis-segments" aria-label="${n("追番状态统计")}">
        <span><b>${n(String(a.watching||0))}</b><em>在看</em></span>
        <span><b>${n(String(a.wish||0))}</b><em>想看</em></span>
        <span><b>${n(String(a.done||0))}</b><em>已看</em></span>
      </div>
      <div class="wg-bangumis-grid">
        ${s.slice(0,4).map(r=>l({item:r,mode:i,escapeHtml:n,className:"wg-bangumis-tile",innerHtml:`
            ${o(r,n,"wg-bangumis-tile-cover")}
            <span class="wg-bangumis-tile-copy">
              <strong>${n(r.title)}</strong>
              <em>${n(r.score?`${r.score} 分`:r.statusLabel)}</em>
            </span>
          `})).join("")}
      </div>
    </div>
  `}function z(s,t){const a=s.bangumiStatusCounts||{},n=a[t]||a.anime||{};return{wish:Number(n.wish||0)||0,watching:Number(n.watching||0)||0,done:Number(n.done||0)||0}}function E({sources:s,escapeHtml:t,mode:a},n){if(!s.bangumisAvailable)return d({escapeHtml:t,mode:a,installed:!1});const i=n?.size||"medium",r=i==="large"?4:2,e=N(s,n?.meta||{},r),u=z(s,e.typeKey);return e.items.length?i==="small"?k({item:e.items[0],escapeHtml:t,mode:a}):i==="large"?B({items:e.items,summary:e,counts:u,escapeHtml:t,mode:a}):A({items:e.items,summary:e,counts:u,escapeHtml:t,mode:a}):d({escapeHtml:t,mode:a,installed:!0})}export{N as n,E as t};
