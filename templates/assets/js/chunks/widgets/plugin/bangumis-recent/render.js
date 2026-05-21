import{n as M,r as k}from"../../halo/author-card/render.js?v=0.9.33&r=4f0fa5405881";var w={wish:"想看",watching:"在看",done:"已看"},v=["watching","wish","done"],N=["anime","drama"];function h(s,a){return`is-${s==="drama"?"drama":"anime"} is-${a||"watching"}`}function q(s){const a=String(s??"").trim().replace(/分$/,"").trim();return!a||a==="0"||a==="0.0"?"":a}function x(s={}){return{typeNum:["1","2"].includes(String(s.typeNum||""))?String(s.typeNum):"",status:["auto","watching","wish","done"].includes(String(s.status||""))?String(s.status||""):"auto"}}function o(s){return Array.isArray(s)?s:Array.isArray(s?.items)?s.items:[]}function B(s){return s==="1"?["anime"]:s==="2"?["drama"]:N}function c(s,a,i){const n=s?.spec||{},e=String(n.title||s?.metadata?.name||"追番记录").trim(),t=Number(n.progress??n.progressPercent??n.currentProgress??0);return{key:s?.metadata?.name||`${i}-${a}-${e}`,title:e,cover:String(n.cover||"").trim(),href:String(n.url||"").trim(),score:q(n.score),totalCount:String(n.totalCount||"").trim(),type:String(n.type||"").trim(),area:String(n.area||"").trim(),description:String(n.des||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim(),progress:Number.isFinite(t)?t:0,status:a,statusLabel:w[a]||"追番",typeKey:i,typeLabel:i==="drama"?"追剧":"追番",toneClass:h(i,a)}}function P(s={},a={},i=4){const n=x(a),e=n.status==="auto"?v:[n.status],t=s.bangumisByStatus||{};for(const r of B(n.typeNum)){const g=t[r]||{};for(const u of e){const l=o(g[u]).map(d=>c(d,u,r)).filter(d=>d.title).slice(0,Math.max(i,1));if(l.length)return{items:l,typeKey:r,status:u,typeLabel:r==="drama"?"追剧":"追番",statusLabel:w[u]||"追番"}}}return{items:[],typeKey:n.typeNum==="2"?"drama":"anime",status:n.status==="auto"?"watching":n.status,typeLabel:n.typeNum==="2"?"追剧":"追番",statusLabel:w[n.status]||"在看"}}function A(s={},a="anime",i=4){const n=s.bangumisByStatus?.[a]||{},e={watching:o(n.watching).map(t=>c(t,"watching",a)).filter(t=>t.title),wish:o(n.wish).map(t=>c(t,"wish",a)).filter(t=>t.title),done:o(n.done).map(t=>c(t,"done",a)).filter(t=>t.title)};return{all:v.flatMap(t=>e[t]).slice(0,Math.max(i,1)),watching:e.watching.slice(0,Math.max(i,1)),wish:e.wish.slice(0,Math.max(i,1))}}function p(s,a,i){return s.cover?`<img class="${i}" src="${a(s.cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">`:`
      <span class="${i} is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
    `}function b({item:s,className:a,mode:i,escapeHtml:n,innerHtml:e}){return!s.href||i==="preview"?`<span class="${a}">${e}</span>`:M({href:n(s.href),className:a,attrs:`aria-label="${n(`打开 ${s.title}`)}"`,innerHtml:e})}function S(s,a,i="打开追番"){return k({href:"/bangumis",app:"bangumis",className:"wg-bangumis-open",disabled:a==="preview",innerHtml:`
      <span>${s(i)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function z(s,a){const i=Number(String(s||"").replace(/[^\d.]+/g,"")),n=i>0?Math.max(0,Math.min(5,Math.round(i/2))):0,e=Array.from({length:5},(t,r)=>`
    <i class="${r<n?"is-filled":""}" aria-hidden="true">${r<n?"★":"☆"}</i>
  `).join("");return`
    <span class="wg-bangumis-stage-stars" aria-label="${a(s?`评分 ${s}`:"暂无评分")}">
      ${e}
    </span>
  `}function f({escapeHtml:s,mode:a,installed:i}){return`
    <div class="wg-bangumis wg-bangumis--empty is-anime is-watching">
      <span class="wg-bangumis-empty-icon">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <strong>${i?"还没有追番记录":"未安装追番插件"}</strong>
      <p>${i?"记录公开追番追剧后会在这里显示。":"安装 Bilibili 追番插件后可添加小组件。"}</p>
      ${i?S(s,a,"去看看"):""}
    </div>
  `}function L(s){return s.status!=="watching"?0:s.progress>0?Math.max(1,Math.min(100,Math.round(s.progress))):36}function $(s){return"追看中"}function E(s){if(!s)return{value:0,label:"暂无进度",state:"idle"};if(s.status==="done")return{value:100,label:"已完成",state:"success"};if(s.status==="wish")return{value:0,label:"待开播",state:"pending"};const a=L(s);return{value:a,label:`进度 ${$(s)}`,state:a>=100?"success":"active"}}function C(s,a,i=!1){const n=L(s);return n?`
    <span class="wg-bangumis-progress" aria-label="${a(`观看进度 ${n}%`)}">
      <span class="wg-bangumis-progress-copy">
        <span>${a(i?$(s):`进度 ${$(s)}`)}</span>
        <b>${a(String(n))}%</b>
      </span>
      <span class="wg-bangumis-progress-track">
        <span class="wg-bangumis-progress-fill" style="width:${n}%"></span>
      </span>
    </span>
  `:`<span class="wg-bangumis-meta-line">${a(s.totalCount||s.type||s.area||s.statusLabel)}</span>`}function T({item:s,escapeHtml:a,mode:i}){return b({item:s,mode:i,escapeHtml:a,className:`wg-bangumis wg-bangumis--small ${s.toneClass}`,innerHtml:`
      ${p(s,a,"wg-bangumis-small-cover")}
      <span class="wg-bangumis-scrim"></span>
      <span class="wg-bangumis-small-type">
        <span class="icon-[lucide--${s.typeKey==="drama"?"tv":"sparkles"}]" aria-hidden="true"></span>
        <span>${a(s.typeLabel)}</span>
      </span>
      <span class="wg-bangumis-small-copy">
        <span class="wg-bangumis-status">${a(s.statusLabel)}</span>
        <strong>${a(s.title)}</strong>
        ${C(s,a,!0)}
      </span>
    `})}function _({items:s,summary:a,counts:i,escapeHtml:n,mode:e}){const t=s[0];return`
    <div class="wg-bangumis wg-bangumis--medium ${h(a.typeKey,a.status)}">
      ${b({item:t,mode:e,escapeHtml:n,className:`wg-bangumis-medium-cover-link ${t.toneClass}`,innerHtml:`
          ${p(t,n,"wg-bangumis-medium-cover")}
        `})}
      <div class="wg-bangumis-medium-copy">
        <div class="wg-bangumis-medium-top">
          <span class="wg-bangumis-status">${n(`${t.statusLabel} · ${t.typeLabel}`)}</span>
          <span class="wg-bangumis-sync">
            <span class="icon-[lucide--refresh-cw]" aria-hidden="true"></span>
            ${n(`${i.watching||0} 在看`)}
          </span>
        </div>
        <div class="wg-bangumis-medium-title">
          <strong>${n(t.title)}</strong>
          <span>${n(t.description||`${t.type||t.area||a.typeLabel} · ${t.totalCount||t.statusLabel}`)}</span>
        </div>
        ${C(t,n)}
      </div>
    </div>
  `}function K(s,a,i){const n=s.totalCount||s.area||s.typeLabel;return b({item:s,mode:i,escapeHtml:a,className:`wg-bangumis-queue-item ${s.toneClass}`,innerHtml:`
      ${p(s,a,"wg-bangumis-queue-cover")}
      <span class="wg-bangumis-queue-copy">
        <span>
          <strong>${a(s.title)}</strong>
          <em>${a(n)}</em>
        </span>
        <span class="wg-bangumis-queue-foot">
          <span class="wg-bangumis-queue-bars" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
          <b>${a(s.statusLabel)}</b>
        </span>
      </span>
      <span class="wg-bangumis-queue-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    `})}function y(s,a,i="待看空槽"){return`
    <span class="wg-bangumis-queue-item is-placeholder" aria-hidden="true">
      <span class="wg-bangumis-queue-cover is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <span class="wg-bangumis-queue-copy">
        <span>
          <strong>${a(i)}</strong>
          <em>Slot ${s}</em>
        </span>
      </span>
    </span>
  `}function m({items:s,emptyLabel:a,escapeHtml:i,mode:n}){if(!s.length)return`
      <section class="wg-bangumis-tab-panel">
        <div class="wg-bangumis-large-empty">
          <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
          <strong>${i(a)}</strong>
        </div>
        <div class="wg-bangumis-queue">
          ${Array.from({length:3},(u,l)=>y(l+1,i,a)).join("")}
        </div>
      </section>
    `;const e=s[0],t=s.slice(1,4),r=E(e),g=[...t.map(u=>K(u,i,n)),...Array.from({length:Math.max(0,3-t.length)},(u,l)=>y(t.length+l+1,i))].join("");return`
    <section class="wg-bangumis-tab-panel">
      ${b({item:e,mode:n,escapeHtml:i,className:`wg-bangumis-stage ${e.toneClass}`,innerHtml:`
          <span class="wg-bangumis-stage-cover-wrap">
            ${p(e,i,"wg-bangumis-stage-cover")}
            <span class="wg-bangumis-stage-corner wg-bangumis-stage-corner--tl"></span>
            <span class="wg-bangumis-stage-corner wg-bangumis-stage-corner--br"></span>
            <span class="wg-bangumis-stage-rec">
              <span>REC</span>
            </span>
            <span class="wg-bangumis-stage-progress is-${r.state}">
              <span class="wg-bangumis-stage-progress-copy">
                <span>${i(r.label)}</span>
                <b>${i(String(r.value))}%</b>
              </span>
              <span class="wg-bangumis-stage-progress-track">
                <span style="width:${r.value}%"></span>
              </span>
            </span>
          </span>
          <span class="wg-bangumis-stage-copy">
            <strong>${i(e.title)}</strong>
            <span class="wg-bangumis-stage-rating">
              ${z(e.score,i)}
              <em>${i(e.score||"暂无评分")}</em>
            </span>
          </span>
        `})}
      <div class="wg-bangumis-queue">
        ${g}
      </div>
    </section>
  `}function j({groups:s,summary:a,counts:i,escapeHtml:n,mode:e}){const t=Math.max((i.watching||0)+(i.wish||0)+(i.done||0),s.all.length),r=`wg-bangumis-tabs-${a.typeKey}-${a.status}`;return`
    <div class="wg-bangumis wg-bangumis--large ${h(a.typeKey,a.status)}">
      <header class="wg-bangumis-console-head">
        <span class="wg-bangumis-console-title">
          <span class="wg-bangumis-console-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>番剧雷达中心</span>
        </span>
        <span class="wg-bangumis-console-version">v1.15.0</span>
      </header>
      <form class="wg-bangumis-tab-form">
        <div class="wg-bangumis-tabs" aria-label="${n("追番状态筛选")}">
          <label class="is-all">
            <input class="wg-bangumis-tab-radio is-all" name="${r}" type="radio" checked>
            <i></i>
            <b>${n(`全部 (${t})`)}</b>
          </label>
          <label class="is-watching">
            <input class="wg-bangumis-tab-radio is-watching" name="${r}" type="radio">
            <i></i>
            <b>${n(`在看 (${i.watching||0})`)}</b>
          </label>
          <label class="is-wish">
            <input class="wg-bangumis-tab-radio is-wish" name="${r}" type="radio">
            <i></i>
            <b>${n(`想看 (${i.wish||0})`)}</b>
          </label>
        </div>
        <div class="wg-bangumis-stage-layout">
          <div class="wg-bangumis-tab-panels">
            ${m({items:s.all,emptyLabel:"还没有追番记录",escapeHtml:n,mode:e})}
            ${m({items:s.watching,emptyLabel:"暂无在看记录",escapeHtml:n,mode:e})}
            ${m({items:s.wish,emptyLabel:"暂无想看记录",escapeHtml:n,mode:e})}
          </div>
        </div>
      </form>
      <footer class="wg-bangumis-console-foot">
        <span>
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          ${n(`共追了 ${t} 部番剧`)}
        </span>
        ${S(n,e,"进入归档")}
      </footer>
    </div>
  `}function I(s,a){const i=s.bangumiStatusCounts||{},n=i[a]||i.anime||{};return{wish:Number(n.wish||0)||0,watching:Number(n.watching||0)||0,done:Number(n.done||0)||0}}function W({sources:s,escapeHtml:a,mode:i},n){if(!s.bangumisAvailable)return f({escapeHtml:a,mode:i,installed:!1});const e=n?.size||"medium",t=e==="large"?4:2,r=P(s,n?.meta||{},t),g=I(s,r.typeKey),u=e==="large"?A(s,r.typeKey,t):null;return r.items.length?e==="small"?T({item:r.items[0],escapeHtml:a,mode:i}):e==="large"?j({groups:u,summary:r,counts:g,escapeHtml:a,mode:i}):_({items:r.items,summary:r,counts:g,escapeHtml:a,mode:i}):f({escapeHtml:a,mode:i,installed:!0})}export{P as n,W as t};
