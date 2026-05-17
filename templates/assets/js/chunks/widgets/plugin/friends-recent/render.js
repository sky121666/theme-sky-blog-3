import{n as $,r as w}from"../../halo/author-card/render.js?v=0.9.30&r=a79b23b81832";function o(r,n=""){return String(r||n||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim()}function h(r){const n=r?new Date(r):null;if(!n||Number.isNaN(n.getTime()))return"";const i=s=>String(s).padStart(2,"0");return`${i(n.getMonth()+1)}.${i(n.getDate())}`}function k(r){const n=r?.spec||{},i=o(n.title,n.description||"新的友链动态");return{key:r?.metadata?.name||`${n.linkName||n.author||i}`,title:i,description:o(n.description,""),author:o(n.author,n.linkName||"友链"),logo:String(n.logo||"").trim(),href:String(n.postLink||"").trim(),authorUrl:String(n.authorUrl||"").trim(),linkName:String(n.linkName||"").trim(),time:h(n.pubDate)}}function g(r,n){return r.logo?`
      <span class="wg-friends-avatar">
        <img src="${n(r.logo)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `:`
    <span class="wg-friends-avatar is-fallback">
      <span>${n((r.author||"友").slice(0,1))}</span>
    </span>
  `}function l({item:r,className:n,escapeHtml:i,mode:s,innerHtml:e}){return!r.href||s==="preview"?`<span class="${n}">${e}</span>`:$({href:i(r.href),className:n,attrs:`aria-label="${i(`打开 ${r.title}`)}"`,innerHtml:e})}function u({item:r,escapeHtml:n,mode:i,large:s=!1}){return l({item:r,escapeHtml:n,mode:i,className:s?"wg-friends-item is-large-row":"wg-friends-item",innerHtml:`
      ${g(r,n)}
      <span class="wg-friends-copy">
        <span class="wg-friends-title">${n(r.title)}</span>
        <span class="wg-friends-meta">
          <span>${n(r.author)}</span>
          ${r.time?`<time>${n(r.time)}</time>`:""}
        </span>
      </span>
    `})}function p(r,n,i="查看"){return w({href:"/friends",app:"friends",className:"wg-friends-more",attrs:`aria-label="${r("打开朋友圈")}"`,disabled:n==="preview",innerHtml:`
      <span>${r(i)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function c({items:r,escapeHtml:n,mode:i}){const s=r.length;return`
    <span class="wg-friends-head">
      <span class="wg-friends-heading">
        <strong>朋友圈</strong>
        <span>${n(s?`${s} 条最近动态`:"最新友链动态")}</span>
      </span>
      ${p(n,i)}
    </span>
  `}function f({escapeHtml:r,mode:n,installed:i}){return`
    <div class="wg-friends wg-friends--empty">
      <span class="wg-friends-empty-icon">
        <span class="icon-[lucide--rss]" aria-hidden="true"></span>
      </span>
      <strong>${i?"暂无友链动态":"未安装朋友圈插件"}</strong>
      <p>${i?"同步 RSS 后会在这里显示最近更新。":"安装 plugin-friends 后可添加朋友圈小组件。"}</p>
      ${i?p(r,n,"打开"):""}
    </div>
  `}function v({items:r,escapeHtml:n,mode:i}){return`
    <div class="wg-friends wg-friends--medium">
      ${c({items:r,escapeHtml:n,mode:i})}
      <span class="wg-friends-list">
        ${r.slice(0,2).map(s=>u({item:s,escapeHtml:n,mode:i})).join("")}
      </span>
    </div>
  `}function m({items:r,escapeHtml:n,mode:i}){const s=r[0],e=r.slice(1,3);return`
    <div class="wg-friends wg-friends--large">
      ${c({items:r,escapeHtml:n,mode:i})}
      ${l({item:s,escapeHtml:n,mode:i,className:"wg-friends-feature",innerHtml:`
          ${g(s,n)}
          <span class="wg-friends-feature-copy">
            <span class="wg-friends-feature-kicker">${n(s.author)}${s.time?` · ${n(s.time)}`:""}</span>
            <strong>${n(s.title)}</strong>
            <span>${n(s.description||"打开原文继续阅读")}</span>
          </span>
        `})}
      <span class="wg-friends-list">
        ${e.map(a=>u({item:a,escapeHtml:n,mode:i,large:!0})).join("")}
      </span>
    </div>
  `}function b({sources:r,escapeHtml:n,mode:i},s){if(!r.friendsAvailable)return f({escapeHtml:n,mode:i,installed:!1});const e=s?.size||"medium",a=e==="large"?3:2,t=Array.isArray(r.recentFriends)?r.recentFriends.slice(0,a).map(d=>k(d)).filter(d=>d.title):[];return t.length?e==="large"?m({items:t,escapeHtml:n,mode:i}):v({items:t,escapeHtml:n,mode:i}):f({escapeHtml:n,mode:i,installed:!0})}export{b as t};
