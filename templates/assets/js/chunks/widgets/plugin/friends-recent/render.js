import{n as c,r as u}from"../../halo/author-card/render.js?v=0.9.34&r=ab3e4d1adbb1";function g(r,n=""){return String(r||n||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim()}function $(r){const n=r?new Date(r):null;if(!n||Number.isNaN(n.getTime()))return"";const s=i=>String(i).padStart(2,"0");return`${s(n.getMonth()+1)}.${s(n.getDate())}`}function w(r){const n=r?.spec||{},s=g(n.title,n.description||"新的友链动态"),i=g(n.author,n.linkName||"友链");return{key:r?.metadata?.name||`${n.linkName||i||s}`,title:s,description:g(n.description,""),author:i,logo:String(n.logo||"").trim(),href:String(n.postLink||"").trim(),authorUrl:String(n.authorUrl||"").trim(),linkName:String(n.linkName||"").trim(),time:$(n.pubDate)}}function d(r,n,s="wg-friends-avatar"){return r.logo?`
      <span class="${s}">
        <img src="${n(r.logo)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `:`
    <span class="${s} is-fallback">
      <span>${n((r.author||"友").slice(0,1))}</span>
    </span>
  `}function f(r,n,s=0){return r?.logo?`
    <img
      class="wg-friends-bg"
      data-bg-index="${s}"
      src="${n(r.logo)}"
      alt=""
      loading="lazy"
      decoding="async"
      fetchpriority="low"
    >
  `:`<span class="wg-friends-bg is-fallback" data-bg-index="${s}"></span>`}function l({item:r,className:n,escapeHtml:s,mode:i,innerHtml:a}){return!r.href||i==="preview"?`<span class="${n}">${a}</span>`:c({href:s(r.href),className:n,attrs:`aria-label="${s(`打开 ${r.title}`)}"`,innerHtml:a})}function m({item:r,escapeHtml:n,mode:s,index:i}){return l({item:r,escapeHtml:n,mode:s,className:"wg-friends-item",innerHtml:`
      <span class="wg-friends-item-hit" data-bg-index="${i}">
        ${d(r,n,"wg-friends-avatar is-square")}
        <span class="wg-friends-copy">
          <span class="wg-friends-title">${n(r.title)}</span>
          <span class="wg-friends-description">${n(r.description||"打开原文继续阅读")}</span>
        </span>
        ${r.time?`<time>${n(r.time)}</time>`:""}
      </span>
    `})}function h({item:r,escapeHtml:n,mode:s}){return l({item:r,escapeHtml:n,mode:s,className:"wg-friends wg-friends--small",innerHtml:`
      ${f(r,n)}
      <span class="wg-friends-overlay"></span>
      <span class="wg-friends-small-content">
        <span class="wg-friends-small-title">${n(r.title)}</span>
        <span class="wg-friends-small-foot">
          ${r.time?`<time>${n(r.time)}</time>`:"<time>最新</time>"}
          ${d(r,n)}
        </span>
      </span>
    `})}function b({items:r,escapeHtml:n,mode:s}){const i=r[0];return l({item:i,escapeHtml:n,mode:s,className:"wg-friends wg-friends--medium",innerHtml:`
      ${f(i,n)}
      <span class="wg-friends-overlay"></span>
      <span class="wg-friends-copy">
        <span class="wg-friends-medium-main">
          <strong>${n(i.title)}</strong>
          <span>${n(i.description||"分享有价值的内容，连接有趣的灵魂。")}</span>
        </span>
        <span class="wg-friends-medium-foot">
          <span class="wg-friends-author">
            ${d(i,n)}
            <span>
              <b>${n(i.author)}</b>
              <em>${n(i.linkName||"朋友圈动态")}</em>
            </span>
          </span>
          <span class="wg-friends-date">
            ${i.time?`<time>${n(i.time)}</time><em>发布于</em>`:"<time>最新</time>"}
          </span>
        </span>
      </span>
    `})}function y(r,n,s="朋友圈"){return u({href:"/friends",app:"friends",className:"wg-friends-more",attrs:`aria-label="${r("打开朋友圈")}"`,disabled:n==="preview",innerHtml:`
      <span>${r(s)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function p({escapeHtml:r,mode:n,installed:s}){return`
    <div class="wg-friends wg-friends--empty">
      <span class="wg-friends-empty-icon">
        <span class="icon-[lucide--rss]" aria-hidden="true"></span>
      </span>
      <strong>${s?"暂无友链动态":"未安装朋友圈插件"}</strong>
      <p>${s?"同步 RSS 后会在这里显示最近更新。":"安装 plugin-friends 后可添加朋友圈小组件。"}</p>
      ${s?y(r,n,"打开"):""}
    </div>
  `}function k({items:r,escapeHtml:n,mode:s}){const i=r[0],a=r.slice(1,4);return`
    <div class="wg-friends wg-friends--large">
      ${r.slice(0,4).map((t,e)=>f(t,n,e)).join("")}
      <span class="wg-friends-overlay"></span>
      ${l({item:i,escapeHtml:n,mode:s,className:"wg-friends-feature",innerHtml:`
          <span class="wg-friends-feature-main">
            <strong>${n(i.title)}</strong>
            <span>${n(i.description||"打开原文继续阅读")}</span>
          </span>
          <span class="wg-friends-feature-copy">
            <span class="wg-friends-author">
              ${d(i,n)}
              <span>
                <b>${n(i.author)}</b>
                <em>${n(i.linkName||"朋友圈动态")}</em>
              </span>
            </span>
            ${i.time?`<time>${n(i.time)}</time>`:""}
          </span>
        `})}
      <span class="wg-friends-divider"></span>
      <span class="wg-friends-list" aria-label="${n("最近朋友圈动态")}">
        ${a.map((t,e)=>m({item:t,escapeHtml:n,mode:s,index:e+1})).join("")}
      </span>
    </div>
  `}function N({sources:r,escapeHtml:n,mode:s},i){if(!r.friendsAvailable)return p({escapeHtml:n,mode:s,installed:!1});const a=i?.size||"medium",t=a==="large"?4:1,e=Array.isArray(r.recentFriends)?r.recentFriends.slice(0,t).map(o=>w(o)).filter(o=>o.title):[];return e.length?a==="large"?k({items:e,escapeHtml:n,mode:s}):a==="small"?h({item:e[0],escapeHtml:n,mode:s}):b({items:e,escapeHtml:n,mode:s}):p({escapeHtml:n,mode:s,installed:!0})}export{N as t};
