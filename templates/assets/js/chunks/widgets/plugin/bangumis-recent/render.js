import{n as k}from"../../../rolldown-runtime.js?v=0.9.43&r=844cad006582";import{n as N,r as x}from"../../halo/author-card/render.js?v=0.9.43&r=844cad006582";var Q=k({renderWidget:()=>R,resolveBangumiWidgetItems:()=>S}),w={wish:"想看",watching:"在看",done:"已看"},v=["watching","wish","done"],q=["anime","drama"];function h(s,a){return`is-${s==="drama"?"drama":"anime"} is-${a||"watching"}`}function B(s){const a=String(s??"").trim().replace(/分$/,"").trim();return!a||a==="0"||a==="0.0"?"":a}function A(s={}){return{typeNum:["1","2"].includes(String(s.typeNum||""))?String(s.typeNum):"",status:["auto","watching","wish","done"].includes(String(s.status||""))?String(s.status||""):"auto"}}function o(s){return Array.isArray(s)?s:Array.isArray(s?.items)?s.items:[]}function P(s){return s==="1"?["anime"]:s==="2"?["drama"]:q}function c(s,a,i){const n=s?.spec||{},t=String(n.title||s?.metadata?.name||"追番记录").trim(),e=Number(n.progress??n.progressPercent??n.currentProgress??0);return{key:s?.metadata?.name||`${i}-${a}-${t}`,title:t,cover:String(n.cover||"").trim(),href:String(n.url||"").trim(),score:B(n.score),totalCount:String(n.totalCount||"").trim(),type:String(n.type||"").trim(),area:String(n.area||"").trim(),description:String(n.des||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim(),progress:Number.isFinite(e)?e:0,status:a,statusLabel:w[a]||"追番",typeKey:i,typeLabel:i==="drama"?"追剧":"追番",toneClass:h(i,a)}}function S(s={},a={},i=4){const n=A(a),t=n.status==="auto"?v:[n.status],e=s.bangumisByStatus||{};for(const r of P(n.typeNum)){const g=e[r]||{};for(const u of t){const l=o(g[u]).map(d=>c(d,u,r)).filter(d=>d.title).slice(0,Math.max(i,1));if(l.length)return{items:l,typeKey:r,status:u,typeLabel:r==="drama"?"追剧":"追番",statusLabel:w[u]||"追番"}}}return{items:[],typeKey:n.typeNum==="2"?"drama":"anime",status:n.status==="auto"?"watching":n.status,typeLabel:n.typeNum==="2"?"追剧":"追番",statusLabel:w[n.status]||"在看"}}function _(s={},a="anime",i=4){const n=s.bangumisByStatus?.[a]||{},t={watching:o(n.watching).map(e=>c(e,"watching",a)).filter(e=>e.title),wish:o(n.wish).map(e=>c(e,"wish",a)).filter(e=>e.title),done:o(n.done).map(e=>c(e,"done",a)).filter(e=>e.title)};return{all:v.flatMap(e=>t[e]).slice(0,Math.max(i,1)),watching:t.watching.slice(0,Math.max(i,1)),wish:t.wish.slice(0,Math.max(i,1))}}function p(s,a,i){return s.cover?`<img class="${i}" src="${a(s.cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">`:`
      <span class="${i} is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
    `}function b({item:s,className:a,mode:i,escapeHtml:n,innerHtml:t}){return!s.href||i==="preview"?`<span class="${a}">${t}</span>`:N({href:n(s.href),className:a,attrs:`aria-label="${n(`打开 ${s.title}`)}"`,innerHtml:t})}function L(s,a,i="打开追番"){return x({href:"/bangumis",app:"bangumis",className:"wg-bangumis-open",disabled:a==="preview",innerHtml:`
      <span>${s(i)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function z(s,a){const i=Number(String(s||"").replace(/[^\d.]+/g,"")),n=i>0?Math.max(0,Math.min(5,Math.round(i/2))):0,t=Array.from({length:5},(e,r)=>`
    <i class="${r<n?"is-filled":""}" aria-hidden="true">${r<n?"★":"☆"}</i>
  `).join("");return`
    <span class="wg-bangumis-stage-stars" aria-label="${a(s?`评分 ${s}`:"暂无评分")}">
      ${t}
    </span>
  `}function f({escapeHtml:s,mode:a,installed:i}){return`
    <div class="wg-bangumis wg-bangumis--empty is-anime is-watching">
      <span class="wg-bangumis-empty-icon">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <strong>${i?"还没有追番记录":"未安装追番插件"}</strong>
      <p>${i?"记录公开追番追剧后会在这里显示。":"安装 Bilibili 追番插件后可添加小组件。"}</p>
      ${i?L(s,a,"去看看"):""}
    </div>
  `}function C(s){return s.status!=="watching"?0:s.progress>0?Math.max(1,Math.min(100,Math.round(s.progress))):36}function $(s){return"追看中"}function E(s){if(!s)return{value:0,label:"暂无进度",state:"idle"};if(s.status==="done")return{value:100,label:"已完成",state:"success"};if(s.status==="wish")return{value:0,label:"待开播",state:"pending"};const a=C(s);return{value:a,label:`进度 ${$(s)}`,state:a>=100?"success":"active"}}function M(s,a,i=!1){const n=C(s);return n?`
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
        ${M(s,a,!0)}
      </span>
    `})}function W({items:s,summary:a,counts:i,escapeHtml:n,mode:t}){const e=s[0];return`
    <div class="wg-bangumis wg-bangumis--medium ${h(a.typeKey,a.status)}">
      ${b({item:e,mode:t,escapeHtml:n,className:`wg-bangumis-medium-cover-link ${e.toneClass}`,innerHtml:`
          ${p(e,n,"wg-bangumis-medium-cover")}
        `})}
      <div class="wg-bangumis-medium-copy">
        <div class="wg-bangumis-medium-top">
          <span class="wg-bangumis-status">${n(`${e.statusLabel} · ${e.typeLabel}`)}</span>
          <span class="wg-bangumis-sync">
            <span class="icon-[lucide--refresh-cw]" aria-hidden="true"></span>
            ${n(`${i.watching||0} 在看`)}
          </span>
        </div>
        <div class="wg-bangumis-medium-title">
          <strong>${n(e.title)}</strong>
          <span>${n(e.description||`${e.type||e.area||a.typeLabel} · ${e.totalCount||e.statusLabel}`)}</span>
        </div>
        ${M(e,n)}
      </div>
    </div>
  `}function I(s,a,i){const n=s.totalCount||s.area||s.typeLabel;return b({item:s,mode:i,escapeHtml:a,className:`wg-bangumis-queue-item ${s.toneClass}`,innerHtml:`
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
    `;const t=s[0],e=s.slice(1,4),r=E(t),g=[...e.map(u=>I(u,i,n)),...Array.from({length:Math.max(0,3-e.length)},(u,l)=>y(e.length+l+1,i))].join("");return`
    <section class="wg-bangumis-tab-panel">
      ${b({item:t,mode:n,escapeHtml:i,className:`wg-bangumis-stage ${t.toneClass}`,innerHtml:`
          <span class="wg-bangumis-stage-cover-wrap">
            ${p(t,i,"wg-bangumis-stage-cover")}
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
            <strong>${i(t.title)}</strong>
            <span class="wg-bangumis-stage-rating">
              ${z(t.score,i)}
              <em>${i(t.score||"暂无评分")}</em>
            </span>
          </span>
        `})}
      <div class="wg-bangumis-queue">
        ${g}
      </div>
    </section>
  `}function K({groups:s,summary:a,counts:i,escapeHtml:n,mode:t}){const e=Math.max((i.watching||0)+(i.wish||0)+(i.done||0),s.all.length),r=`wg-bangumis-tabs-${a.typeKey}-${a.status}`;return`
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
            <b>${n(`全部 (${e})`)}</b>
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
            ${m({items:s.all,emptyLabel:"还没有追番记录",escapeHtml:n,mode:t})}
            ${m({items:s.watching,emptyLabel:"暂无在看记录",escapeHtml:n,mode:t})}
            ${m({items:s.wish,emptyLabel:"暂无想看记录",escapeHtml:n,mode:t})}
          </div>
        </div>
      </form>
      <footer class="wg-bangumis-console-foot">
        <span>
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          ${n(`共追了 ${e} 部番剧`)}
        </span>
        ${L(n,t,"进入归档")}
      </footer>
    </div>
  `}function j(s,a){const i=s.bangumiStatusCounts||{},n=i[a]||i.anime||{};return{wish:Number(n.wish||0)||0,watching:Number(n.watching||0)||0,done:Number(n.done||0)||0}}function R({sources:s,escapeHtml:a,mode:i},n){if(!s.bangumisAvailable)return f({escapeHtml:a,mode:i,installed:!1});const t=n?.size||"medium",e=t==="large"?4:2,r=S(s,n?.meta||{},e),g=j(s,r.typeKey),u=t==="large"?_(s,r.typeKey,e):null;return r.items.length?t==="small"?T({item:r.items[0],escapeHtml:a,mode:i}):t==="large"?K({groups:u,summary:r,counts:g,escapeHtml:a,mode:i}):W({items:r.items,summary:r,counts:g,escapeHtml:a,mode:i}):f({escapeHtml:a,mode:i,installed:!0})}export{Q as t};
