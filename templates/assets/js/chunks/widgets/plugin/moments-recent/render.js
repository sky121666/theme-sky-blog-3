import{r as d}from"../../catalog.js?v=0.9.30&r=627cb5bcc317";import{n as g}from"../../halo/author-card/render.js?v=0.9.30&r=627cb5bcc317";function h({sources:n,escapeHtml:s,normalizeMomentRecord:m,mode:c}){if(!n.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const e=n.recentMoments.slice(0,1).map(r=>m(r));if(!e.length)return'<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';const a=e[0],o=d(n),i=a.tags.length>0?a.tags[0]:"",t=n.recentMoments[0]?.stats||{},l=t.upvote??0,p=t.approvedComment??t.totalComment??0;return g({href:s(a.permalink),app:"moments",className:"wg-moment-social",disabled:c==="preview",innerHtml:`
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${s(o.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        </span>
        <span class="wg-moment-social-info">
          <span class="wg-moment-social-name">${s(o.displayName||"作者")}</span>
          <span class="wg-moment-social-time">${s(a.listTime)}</span>
        </span>
        ${i?`<span class="wg-moment-social-tag">#${s(i)}</span>`:""}
      </span>
      <span class="wg-moment-social-content">${s(a.summary)}</span>
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart"><span class="icon-[lucide--heart]" aria-hidden="true"></span><b>${l}</b></span>
        <span class="wg-moment-social-stat is-chat"><span class="icon-[lucide--message-circle]" aria-hidden="true"></span><b>${p}</b></span>
      </span>
    `})}export{h as t};
