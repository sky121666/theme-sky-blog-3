import{n as c,r as w}from"../../halo/author-card/render.js?v=0.9.30&r=9b6a6e5b17dd";function l(r,n=""){return String(r||n||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim()}function $(r){const n=r?new Date(r):null;if(!n||Number.isNaN(n.getTime()))return"";const i=s=>String(s).padStart(2,"0");return`${i(n.getMonth()+1)}.${i(n.getDate())}`}function h(r){const n=r?.spec||{},i=l(n.title,n.description||"新的友链动态");return{key:r?.metadata?.name||`${n.linkName||n.author||i}`,title:i,description:l(n.description,""),author:l(n.author,n.linkName||"友链"),logo:String(n.logo||"").trim(),href:String(n.postLink||"").trim(),authorUrl:String(n.authorUrl||"").trim(),linkName:String(n.linkName||"").trim(),time:$(n.pubDate)}}function g(r,n){return r.logo?`
      <span class="wg-friends-avatar">
        <img src="${n(r.logo)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `:`
    <span class="wg-friends-avatar is-fallback">
      <span>${n((r.author||"友").slice(0,1))}</span>
    </span>
  `}function p({item:r,className:n,escapeHtml:i,mode:s,innerHtml:a}){return!r.href||s==="preview"?`<span class="${n}">${a}</span>`:c({href:i(r.href),className:n,attrs:`aria-label="${i(`打开 ${r.title}`)}"`,innerHtml:a})}function u({item:r,escapeHtml:n,mode:i,large:s=!1}){return p({item:r,escapeHtml:n,mode:i,className:s?"wg-friends-item is-large-row":"wg-friends-item",innerHtml:`
      ${g(r,n)}
      <span class="wg-friends-copy">
        <span class="wg-friends-title">${n(r.title)}</span>
        <span class="wg-friends-meta">
          <span>${n(r.author)}</span>
          ${r.time?`<time>${n(r.time)}</time>`:""}
        </span>
      </span>
    `})}function o(r,n){return w({href:"/friends",app:"friends",className:"wg-friends-open",attrs:`aria-label="${r("打开朋友圈")}"`,disabled:n==="preview",innerHtml:`
      <span>打开朋友圈</span>
      <span class="icon-[lucide--arrow-right]" aria-hidden="true"></span>
    `})}function f({escapeHtml:r,mode:n,installed:i}){return`
    <div class="wg-friends wg-friends--empty">
      <span class="wg-friends-empty-icon">
        <span class="icon-[lucide--rss]" aria-hidden="true"></span>
      </span>
      <strong>${i?"暂无友链动态":"未安装朋友圈插件"}</strong>
      <p>${i?"同步 RSS 后会在这里显示最近更新。":"安装 plugin-friends 后可添加朋友圈小组件。"}</p>
      ${i?o(r,n):""}
    </div>
  `}function m({items:r,escapeHtml:n,mode:i}){return`
    <div class="wg-friends wg-friends--medium">
      <span class="wg-friends-head">
        <span class="wg-friends-mark"><span class="icon-[lucide--rss]" aria-hidden="true"></span></span>
        <span class="wg-friends-heading">
          <strong>朋友圈</strong>
          <span>最新友链动态</span>
        </span>
      </span>
      <span class="wg-friends-list">
        ${r.slice(0,3).map(s=>u({item:s,escapeHtml:n,mode:i})).join("")}
      </span>
      ${o(n,i)}
    </div>
  `}function k({items:r,escapeHtml:n,mode:i}){const s=r[0],a=r.slice(1,5);return`
    <div class="wg-friends wg-friends--large">
      ${p({item:s,escapeHtml:n,mode:i,className:"wg-friends-feature",innerHtml:`
          ${g(s,n)}
          <span class="wg-friends-feature-copy">
            <span class="wg-friends-feature-kicker">${n(s.author)}${s.time?` · ${n(s.time)}`:""}</span>
            <strong>${n(s.title)}</strong>
            <span>${n(s.description||"打开原文继续阅读")}</span>
          </span>
        `})}
      <span class="wg-friends-list">
        ${a.map(e=>u({item:e,escapeHtml:n,mode:i,large:!0})).join("")}
      </span>
      ${o(n,i)}
    </div>
  `}function y({sources:r,escapeHtml:n,mode:i},s){if(!r.friendsAvailable)return f({escapeHtml:n,mode:i,installed:!1});const a=s?.size||"medium",e=a==="large"?5:3,t=Array.isArray(r.recentFriends)?r.recentFriends.slice(0,e).map(d=>h(d)).filter(d=>d.title):[];return t.length?a==="large"?k({items:t,escapeHtml:n,mode:i}):m({items:t,escapeHtml:n,mode:i}):f({escapeHtml:n,mode:i,installed:!0})}export{y as t};
