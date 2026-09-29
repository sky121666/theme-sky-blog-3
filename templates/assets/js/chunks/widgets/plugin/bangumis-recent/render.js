import{n as M}from"../../../rolldown-runtime.js?v=0.9.46&r=23cfa5947c18";import{n as x,r as B}from"../../halo/author-card/render.js?v=0.9.46&r=23cfa5947c18";var Q=M({renderWidget:()=>R,resolveBangumiWidgetItems:()=>L}),o={wish:"想看",watching:"在看",done:"已看"},v=["watching","wish","done"],P=["anime","drama"];function h(a,s){return`is-${a==="drama"?"drama":"anime"} is-${s||"watching"}`}function q(a){const s=String(a??"").trim().replace(/分$/,"").trim();return!s||s==="0"||s==="0.0"?"":s}function S(a={}){return{typeNum:["1","2"].includes(String(a.typeNum||""))?String(a.typeNum):"",status:["auto","watching","wish","done"].includes(String(a.status||""))?String(a.status||""):"auto"}}function c(a){return Array.isArray(a)?a:Array.isArray(a?.items)?a.items:[]}function A(a){return a==="1"?["anime"]:a==="2"?["drama"]:P}function p(a,s,i){const n=a?.spec||{},e=String(n.title||a?.metadata?.name||"追番记录").trim(),t=n.progress??n.progressPercent??n.currentProgress,r=t==null||String(t).trim()===""?NaN:Number(t);return{key:a?.metadata?.name||`${i}-${s}-${e}`,title:e,cover:String(n.cover||"").trim(),href:String(n.url||"").trim(),score:q(n.score),totalCount:String(n.totalCount||"").trim(),type:String(n.type||"").trim(),area:String(n.area||"").trim(),description:String(n.des||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim(),progress:Number.isFinite(r)&&r>=0?r:null,status:s,statusLabel:o[s]||"追番",typeKey:i,typeLabel:i==="drama"?"追剧":"追番",toneClass:h(i,s)}}function L(a={},s={},i=4){const n=S(s),e=n.status==="auto"?v:[n.status],t=a.bangumisByStatus||{};for(const r of A(n.typeNum)){const u=t[r]||{};for(const g of e){const l=c(u[g]).map(m=>p(m,g,r)).filter(m=>m.title).slice(0,Math.max(i,1));if(l.length)return{items:l,typeKey:r,status:g,typeLabel:r==="drama"?"追剧":"追番",statusLabel:o[g]||"追番"}}}return{items:[],typeKey:n.typeNum==="2"?"drama":"anime",status:n.status==="auto"?"watching":n.status,typeLabel:n.typeNum==="2"?"追剧":"追番",statusLabel:o[n.status]||"在看"}}function _(a={},s="anime",i=4){const n=a.bangumisByStatus?.[s]||{},e={watching:c(n.watching).map(t=>p(t,"watching",s)).filter(t=>t.title),wish:c(n.wish).map(t=>p(t,"wish",s)).filter(t=>t.title),done:c(n.done).map(t=>p(t,"done",s)).filter(t=>t.title)};return{all:v.flatMap(t=>e[t]).slice(0,Math.max(i,1)),watching:e.watching.slice(0,Math.max(i,1)),wish:e.wish.slice(0,Math.max(i,1))}}function b(a,s,i){return a.cover?`<img class="${i}" src="${s(a.cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">`:`
      <span class="${i} is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
    `}function d({item:a,className:s,mode:i,escapeHtml:n,innerHtml:e}){return!a.href||i==="preview"?`<span class="${s}">${e}</span>`:x({href:n(a.href),className:s,attrs:`aria-label="${n(`打开 ${a.title}`)}"`,innerHtml:e})}function N(a,s,i="打开追番"){return B({href:"/bangumis",app:"bangumis",className:"wg-bangumis-open",disabled:s==="preview",innerHtml:`
      <span>${a(i)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function z(a,s){const i=Number(String(a||"").replace(/[^\d.]+/g,"")),n=i>0?Math.max(0,Math.min(5,Math.round(i/2))):0,e=Array.from({length:5},(t,r)=>`
    <i class="${r<n?"is-filled":""}" aria-hidden="true">${r<n?"★":"☆"}</i>
  `).join("");return`
    <span class="wg-bangumis-stage-stars" aria-label="${s(a?`评分 ${a}`:"暂无评分")}">
      ${e}
    </span>
  `}function f({escapeHtml:a,mode:s,installed:i}){return`
    <div class="wg-bangumis wg-bangumis--empty is-anime is-watching">
      <span class="wg-bangumis-empty-icon">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <strong>${i?"还没有追番记录":"未安装追番插件"}</strong>
      <p>${i?"记录公开追番追剧后会在这里显示。":"安装 Bilibili 追番插件后可添加小组件。"}</p>
      ${i?N(a,s,"去看看"):""}
    </div>
  `}function E(){return'<div class="wg-bangumis wg-bangumis--empty" role="status" aria-live="polite" aria-busy="true"><strong>追番数据加载中</strong><p>正在读取所选类型和状态。</p></div>'}function C(a){return a.status!=="watching"||a.progress===null?null:Math.max(0,Math.min(100,Math.round(a.progress)))}function $(a){return"追看中"}function T(a){if(!a)return{value:0,label:"暂无进度",state:"idle"};if(a.status==="done")return{value:100,label:"已完成",state:"success"};if(a.status==="wish")return{value:null,label:"想看",state:"pending"};const s=C(a);return{value:s,label:s===null?"在看 · 进度未知":`进度 ${$(a)}`,state:s>=100?"success":"active"}}function k(a,s,i=!1){const n=C(a);return n===null?`<span class="wg-bangumis-meta-line">${s(a.status==="watching"?"在看 · 进度未知":a.totalCount||a.type||a.area||a.statusLabel)}</span>`:`
    <span class="wg-bangumis-progress" aria-label="${s(`观看进度 ${n}%`)}">
      <span class="wg-bangumis-progress-copy">
        <span>${s(i?$(a):`进度 ${$(a)}`)}</span>
        <b>${s(String(n))}%</b>
      </span>
      <span class="wg-bangumis-progress-track">
        <span class="wg-bangumis-progress-fill" style="width:${n}%"></span>
      </span>
    </span>
  `}function W({item:a,escapeHtml:s,mode:i}){return d({item:a,mode:i,escapeHtml:s,className:`wg-bangumis wg-bangumis--small ${a.toneClass}`,innerHtml:`
      ${b(a,s,"wg-bangumis-small-cover")}
      <span class="wg-bangumis-scrim"></span>
      <span class="wg-bangumis-small-type">
        <span class="icon-[lucide--${a.typeKey==="drama"?"tv":"sparkles"}]" aria-hidden="true"></span>
        <span>${s(a.typeLabel)}</span>
      </span>
      <span class="wg-bangumis-small-copy">
        <span class="wg-bangumis-status">${s(a.statusLabel)}</span>
        <strong>${s(a.title)}</strong>
        ${k(a,s,!0)}
      </span>
    `})}function j({items:a,summary:s,counts:i,escapeHtml:n,mode:e}){const t=a[0],r=i.watching!==null?"watching":s.status,u=i[r]===null?"数据已同步":`${i[r]} ${o[r]}`;return`
    <div class="wg-bangumis wg-bangumis--medium ${h(s.typeKey,s.status)}">
      ${d({item:t,mode:e,escapeHtml:n,className:`wg-bangumis-medium-cover-link ${t.toneClass}`,innerHtml:`
          ${b(t,n,"wg-bangumis-medium-cover")}
        `})}
      <div class="wg-bangumis-medium-copy">
        <div class="wg-bangumis-medium-top">
          <span class="wg-bangumis-status">${n(`${t.statusLabel} · ${t.typeLabel}`)}</span>
          <span class="wg-bangumis-sync">
            <span class="icon-[lucide--refresh-cw]" aria-hidden="true"></span>
            ${n(u)}
          </span>
        </div>
        <div class="wg-bangumis-medium-title">
          <strong>${n(t.title)}</strong>
          <span>${n(t.description||`${t.type||t.area||s.typeLabel} · ${t.totalCount||t.statusLabel}`)}</span>
        </div>
        ${k(t,n)}
      </div>
    </div>
  `}function F(a,s,i){const n=a.totalCount||a.area||a.typeLabel;return d({item:a,mode:i,escapeHtml:s,className:`wg-bangumis-queue-item ${a.toneClass}`,innerHtml:`
      ${b(a,s,"wg-bangumis-queue-cover")}
      <span class="wg-bangumis-queue-copy">
        <span>
          <strong>${s(a.title)}</strong>
          <em>${s(n)}</em>
        </span>
        <span class="wg-bangumis-queue-foot">
          <span class="wg-bangumis-queue-bars" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
          <b>${s(a.statusLabel)}</b>
        </span>
      </span>
      <span class="wg-bangumis-queue-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    `})}function y(a,s,i="待看空槽"){return`
    <span class="wg-bangumis-queue-item is-placeholder" aria-hidden="true">
      <span class="wg-bangumis-queue-cover is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <span class="wg-bangumis-queue-copy">
        <span>
          <strong>${s(i)}</strong>
          <em>Slot ${a}</em>
        </span>
      </span>
    </span>
  `}function w({items:a,emptyLabel:s,escapeHtml:i,mode:n}){if(!a.length)return`
      <section class="wg-bangumis-tab-panel">
        <div class="wg-bangumis-large-empty">
          <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
          <strong>${i(s)}</strong>
        </div>
        <div class="wg-bangumis-queue">
          ${Array.from({length:3},(g,l)=>y(l+1,i,s)).join("")}
        </div>
      </section>
    `;const e=a[0],t=a.slice(1,4),r=T(e),u=[...t.map(g=>F(g,i,n)),...Array.from({length:Math.max(0,3-t.length)},(g,l)=>y(t.length+l+1,i))].join("");return`
    <section class="wg-bangumis-tab-panel">
      ${d({item:e,mode:n,escapeHtml:i,className:`wg-bangumis-stage ${e.toneClass}`,innerHtml:`
          <span class="wg-bangumis-stage-cover-wrap">
            ${b(e,i,"wg-bangumis-stage-cover")}
            <span class="wg-bangumis-stage-corner wg-bangumis-stage-corner--tl"></span>
            <span class="wg-bangumis-stage-corner wg-bangumis-stage-corner--br"></span>
            <span class="wg-bangumis-stage-rec">
              <span>REC</span>
            </span>
            <span class="wg-bangumis-stage-progress is-${r.state}">
              <span class="wg-bangumis-stage-progress-copy">
                <span>${i(r.label)}</span>
                ${r.value===null?"":`<b>${i(String(r.value))}%</b>`}
              </span>
              ${r.value===null?"":`<span class="wg-bangumis-stage-progress-track">
                <span style="width:${r.value}%"></span>
              </span>`}
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
        ${u}
      </div>
    </section>
  `}function I({groups:a,summary:s,counts:i,selectedStatus:n,escapeHtml:e,mode:t}){const r=n==="auto",u=Math.max(r?(i.watching||0)+(i.wish||0)+(i.done||0):i[n]||0,a.all.length),g=`wg-bangumis-tabs-${s.typeKey}-${s.status}`;return`
    <div class="wg-bangumis wg-bangumis--large ${h(s.typeKey,s.status)}">
      <header class="wg-bangumis-console-head">
        <span class="wg-bangumis-console-title">
          <span class="wg-bangumis-console-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>番剧雷达中心</span>
        </span>
      </header>
      <form class="wg-bangumis-tab-form">
        <div class="wg-bangumis-tabs" aria-label="${e("追番状态筛选")}">
          <label class="is-all">
            <input class="wg-bangumis-tab-radio is-all" name="${g}" type="radio" checked>
            <i></i>
            <b>${e(`${r?"全部":o[n]} (${u})`)}</b>
          </label>
          ${r?`<label class="is-watching">
            <input class="wg-bangumis-tab-radio is-watching" name="${g}" type="radio">
            <i></i>
            <b>${e(`在看 (${i.watching||0})`)}</b>
          </label>`:""}
          ${r?`<label class="is-wish">
            <input class="wg-bangumis-tab-radio is-wish" name="${g}" type="radio">
            <i></i>
            <b>${e(`想看 (${i.wish||0})`)}</b>
          </label>`:""}
        </div>
        <div class="wg-bangumis-stage-layout">
          <div class="wg-bangumis-tab-panels">
            ${w({items:a.all,emptyLabel:"还没有追番记录",escapeHtml:e,mode:t})}
            ${r?w({items:a.watching,emptyLabel:"暂无在看记录",escapeHtml:e,mode:t}):""}
            ${r?w({items:a.wish,emptyLabel:"暂无想看记录",escapeHtml:e,mode:t}):""}
          </div>
        </div>
      </form>
      <footer class="wg-bangumis-console-foot">
        <span>
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          ${e(r?`共追了 ${u} 部番剧`:`${o[n]} ${u} 部${s.typeLabel==="追剧"?"剧集":"番剧"}`)}
        </span>
        ${N(e,t,"进入归档")}
      </footer>
    </div>
  `}function K(a,s){const i=a.bangumiStatusCounts||{},n=i[s]||i.anime||{};return{wish:Number.isFinite(Number(n.wish))&&n.wish!=null?Number(n.wish):null,watching:Number.isFinite(Number(n.watching))&&n.watching!=null?Number(n.watching):null,done:Number.isFinite(Number(n.done))&&n.done!=null?Number(n.done):null}}function R({sources:a,escapeHtml:s,mode:i},n){if(!a.bangumisAvailable)return f({escapeHtml:s,mode:i,installed:!1});if(a.bangumiWidgetDataState!=="ready"&&!Object.keys(a.bangumisByStatus||{}).length)return E();const e=n?.size||"medium",t=e==="large"?4:2,r=S(n?.meta||{}),u=L(a,r,t),g=K(a,u.typeKey),l=e==="large"?r.status==="auto"?_(a,u.typeKey,t):{all:u.items}:null;return u.items.length?e==="small"?W({item:u.items[0],escapeHtml:s,mode:i}):e==="large"?I({groups:l,summary:u,counts:g,selectedStatus:r.status,escapeHtml:s,mode:i}):j({items:u.items,summary:u,counts:g,escapeHtml:s,mode:i}):f({escapeHtml:s,mode:i,installed:!0})}export{Q as t};
