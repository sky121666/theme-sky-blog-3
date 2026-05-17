import{r as v}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.30&r=88cce8206473";import{n as f}from"../../halo/author-card/render.js?v=0.9.30&r=88cce8206473";function h(n,a,e,t){const s=Number.parseInt(n,10);return Number.isFinite(s)?Math.min(Math.max(s,e),t):a}function d(n,a,e){if(!e||!n.mediaCount)return"";const t=n.media[0],s=n.mediaCount>1?`<b>+${n.mediaCount-1}</b>`:"";return t?.type==="PHOTO"&&t.url?`
      <span class="wg-moment-social-media">
        <img src="${a(t.url)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        ${s}
      </span>
    `:`
    <span class="wg-moment-social-media is-placeholder">
      <span class="${t?.type==="VIDEO"?"icon-[lucide--video]":t?.type==="AUDIO"?"icon-[lucide--music-2]":"icon-[lucide--image]"}" aria-hidden="true"></span>
      ${s}
    </span>
  `}function p(n){const a=n?.stats||{};return{upvote:Number(a.upvote??0)||0}}function w(n,a,e="wg-moment-social-stat"){return`
    <span class="${e} is-heart" aria-label="${a(`${n} 个赞`)}">
      <span class="icon-[lucide--heart]" aria-hidden="true"></span>
      <b>${a(String(n))}</b>
    </span>
  `}function M(n){return f({href:"/moments",app:"moments",className:"desktop-widget-empty wg-moment-social-empty",disabled:n==="preview",innerHtml:`
      <strong>还没有瞬间</strong>
      <span>打开瞬间记录最近动态</span>
    `})}function $(n,a,e){return`
    <span class="wg-moment-social-header">
      <span class="wg-moment-social-avatar">
        <img src="${a(n.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
      <span class="wg-moment-social-info">
        <span class="wg-moment-social-name">${a(n.displayName||"作者")}</span>
        <span class="wg-moment-social-time">${a(e||"最新瞬间")}</span>
      </span>
    </span>
  `}function g({moment:n,app:a="moments",className:e,mode:t,escapeHtml:s,innerHtml:o}){return f({href:s(n?.permalink||"/moments"),app:a,className:e,disabled:t==="preview",innerHtml:o})}function b({moment:n,original:a,author:e,showMedia:t,escapeHtml:s,mode:o}){const{upvote:i}=p(a);return g({moment:n,escapeHtml:s,mode:o,className:"wg-moment-social wg-moment-social--small",innerHtml:`
      ${$(e,s,n.listTime)}
      <span class="wg-moment-social-content">${s(n.summary)}</span>
      <span class="wg-moment-social-footer">
        ${w(i,s)}
        ${t&&n.mediaCount?`<span class="wg-moment-social-media-count">${s(n.rowBadge)}</span>`:""}
      </span>
    `})}function N({moment:n,original:a,author:e,showMedia:t,escapeHtml:s,mode:o}){const{upvote:i}=p(a),m=n.tags.length>0?n.tags[0]:"";return g({moment:n,escapeHtml:s,mode:o,className:"wg-moment-social wg-moment-social--medium",innerHtml:`
      ${$(e,s,n.listTime)}
      <span class="wg-moment-social-content">${s(n.summary)}</span>
      ${d(n,s,t)}
      <span class="wg-moment-social-bar">
        ${m?`<span class="wg-moment-social-tag">#${s(m)}</span>`:"<span></span>"}
        ${w(i,s)}
      </span>
    `})}function k({moments:n,originals:a,author:e,showMedia:t,escapeHtml:s,mode:o}){const i=n[0],{upvote:m}=p(a[0]),c=n.slice(1,3).map((r,l)=>{const u=p(a[l+1]);return g({moment:r,escapeHtml:s,mode:o,className:"wg-moment-social-item",innerHtml:`
        ${d(r,s,t)}
        <span class="wg-moment-social-item-copy">
          <span class="wg-moment-social-item-title">${s(r.summary)}</span>
          <span class="wg-moment-social-item-meta">${s(r.listTime)} · ${s(String(u.upvote))} 赞</span>
        </span>
      `})}).join("");return`
    <div class="wg-moment-social wg-moment-social--large">
      ${g({moment:i,escapeHtml:s,mode:o,className:"wg-moment-social-feature",innerHtml:`
          ${d(i,s,t)}
          <span class="wg-moment-social-feature-copy">
            ${$(e,s,i.listTime)}
            <span class="wg-moment-social-content">${s(i.summary)}</span>
            <span class="wg-moment-social-footer">${w(m,s)}</span>
          </span>
        `})}
      ${c?`<span class="wg-moment-social-stack-list">${c}</span>`:""}
    </div>
  `}function z({sources:n,escapeHtml:a,normalizeMomentRecord:e,mode:t},s){if(!n.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const o=s?.meta&&typeof s.meta=="object"?s.meta:{},i=s?.size||"medium",m=i==="large"?h(o.limit,3,1,3):1,c=o.showMedia!==!1,r=n.recentMoments.slice(0,m),l=r.map(y=>e(y));if(!l.length)return M(t);const u=v(n);return i==="small"?b({moment:l[0],original:r[0],author:u,showMedia:c,escapeHtml:a,mode:t}):i==="large"?k({moments:l,originals:r,author:u,showMedia:c,escapeHtml:a,mode:t}):N({moment:l[0],original:r[0],author:u,showMedia:c,escapeHtml:a,mode:t})}export{z as t};
