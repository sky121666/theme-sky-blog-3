import{n as c}from"../../../rolldown-runtime.js?v=0.9.42&r=0760e925a074";import{n as $,r as w}from"../../halo/author-card/render.js?v=0.9.42&r=0760e925a074";var A=c({renderWidget:()=>S});function f(n,r=""){return String(n||r||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim()}function m(n){const r=n?new Date(n):null;if(!r||Number.isNaN(r.getTime()))return"";const s=i=>String(i).padStart(2,"0");return`${s(r.getMonth()+1)}.${s(r.getDate())}`}function h(n){const r=f(n?.title,n?.summary||"新的友链动态"),s=f(n?.author,n?.linkName||"友链");return{key:n?.id||`${n?.linkName||s||r}`,title:r,description:f(n?.summary,""),author:s,logo:String(n?.authorLogo||"").trim(),href:String(n?.url||"").trim(),authorUrl:String(n?.authorUrl||"").trim(),linkName:String(n?.linkName||"").trim(),time:m(n?.publishedAt)}}function l(n,r,s="wg-friends-avatar"){return n.logo?`
      <span class="${s}">
        <img src="${r(n.logo)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `:`
    <span class="${s} is-fallback">
      <span>${r((n.author||"友").slice(0,1))}</span>
    </span>
  `}function p(n,r,s=0){return n?.logo?`
    <img
      class="wg-friends-bg"
      data-bg-index="${s}"
      src="${r(n.logo)}"
      alt=""
      loading="lazy"
      decoding="async"
      fetchpriority="low"
    >
  `:`<span class="wg-friends-bg is-fallback" data-bg-index="${s}"></span>`}function o({item:n,className:r,escapeHtml:s,mode:i,innerHtml:a}){return!n.href||i==="preview"?`<span class="${r}">${a}</span>`:$({href:s(n.href),className:r,attrs:`aria-label="${s(`打开 ${n.title}`)}"`,innerHtml:a})}function y({item:n,escapeHtml:r,mode:s,index:i}){return o({item:n,escapeHtml:r,mode:s,className:"wg-friends-item",innerHtml:`
      <span class="wg-friends-item-hit" data-bg-index="${i}">
        ${l(n,r,"wg-friends-avatar is-square")}
        <span class="wg-friends-copy">
          <span class="wg-friends-title">${r(n.title)}</span>
          <span class="wg-friends-description">${r(n.description||"打开原文继续阅读")}</span>
        </span>
        ${n.time?`<time>${r(n.time)}</time>`:""}
      </span>
    `})}function b({item:n,escapeHtml:r,mode:s}){return o({item:n,escapeHtml:r,mode:s,className:"wg-friends wg-friends--small",innerHtml:`
      ${p(n,r)}
      <span class="wg-friends-overlay"></span>
      <span class="wg-friends-small-content">
        <span class="wg-friends-small-title">${r(n.title)}</span>
        <span class="wg-friends-small-foot">
          ${n.time?`<time>${r(n.time)}</time>`:"<time>最新</time>"}
          ${l(n,r)}
        </span>
      </span>
    `})}function k({items:n,escapeHtml:r,mode:s}){const i=n[0];return o({item:i,escapeHtml:r,mode:s,className:"wg-friends wg-friends--medium",innerHtml:`
      ${p(i,r)}
      <span class="wg-friends-overlay"></span>
      <span class="wg-friends-copy">
        <span class="wg-friends-medium-main">
          <strong>${r(i.title)}</strong>
          <span>${r(i.description||"分享有价值的内容，连接有趣的灵魂。")}</span>
        </span>
        <span class="wg-friends-medium-foot">
          <span class="wg-friends-author">
            ${l(i,r)}
            <span>
              <b>${r(i.author)}</b>
              <em>${r(i.linkName||"朋友圈动态")}</em>
            </span>
          </span>
          <span class="wg-friends-date">
            ${i.time?`<time>${r(i.time)}</time><em>发布于</em>`:"<time>最新</time>"}
          </span>
        </span>
      </span>
    `})}function v(n,r,s="朋友圈"){return w({href:"/links?view=friends",app:"links",className:"wg-friends-more",attrs:`aria-label="${n("打开朋友圈")}"`,disabled:r==="preview",innerHtml:`
      <span>${n(s)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `})}function u({escapeHtml:n,mode:r,installed:s}){return`
    <div class="wg-friends wg-friends--empty">
      <span class="wg-friends-empty-icon">
        <span class="icon-[lucide--rss]" aria-hidden="true"></span>
      </span>
      <strong>${s?"暂无友链动态":"未安装链接管理插件"}</strong>
      <p>${s?"在 PluginLinks 中启用并公开 RSS 动态后，这里会显示最近更新。":"安装 PluginLinks 2.2.1 后可使用朋友圈小组件。"}</p>
      ${s?v(n,r,"打开"):""}
    </div>
  `}function N({items:n,escapeHtml:r,mode:s}){const i=n[0],a=n.slice(1,4);return`
    <div class="wg-friends wg-friends--large">
      ${n.slice(0,4).map((t,e)=>p(t,r,e)).join("")}
      <span class="wg-friends-overlay"></span>
      ${o({item:i,escapeHtml:r,mode:s,className:"wg-friends-feature",innerHtml:`
          <span class="wg-friends-feature-main">
            <strong>${r(i.title)}</strong>
            <span>${r(i.description||"打开原文继续阅读")}</span>
          </span>
          <span class="wg-friends-feature-copy">
            <span class="wg-friends-author">
              ${l(i,r)}
              <span>
                <b>${r(i.author)}</b>
                <em>${r(i.linkName||"朋友圈动态")}</em>
              </span>
            </span>
            ${i.time?`<time>${r(i.time)}</time>`:""}
          </span>
        `})}
      <span class="wg-friends-divider"></span>
      <span class="wg-friends-list" aria-label="${r("最近朋友圈动态")}">
        ${a.map((t,e)=>y({item:t,escapeHtml:r,mode:s,index:e+1})).join("")}
      </span>
    </div>
  `}function S({sources:n,escapeHtml:r,mode:s},i){if(!n.friendsAvailable)return u({escapeHtml:r,mode:s,installed:!1});const a=i?.size||"medium",t=a==="large"?4:1,e=Array.isArray(n.recentFriends)?n.recentFriends:Array.isArray(n.recentFriends?.items)?n.recentFriends.items:[],d=e.length?e.slice(0,t).map(g=>h(g)).filter(g=>g.title):[];return d.length?a==="large"?N({items:d,escapeHtml:r,mode:s}):a==="small"?b({item:d[0],escapeHtml:r,mode:s}):k({items:d,escapeHtml:r,mode:s}):u({escapeHtml:r,mode:s,installed:!0})}export{A as t};
