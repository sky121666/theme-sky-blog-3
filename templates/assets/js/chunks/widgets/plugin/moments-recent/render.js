import{r as p}from"../../catalog.js?v=0.9.30";import{n as d}from"../../halo/author-card/render.js?v=0.9.30";function h({sources:s,escapeHtml:a,normalizeMomentRecord:i,mode:m}){if(!s.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const n=s.recentMoments.slice(0,1).map(r=>i(r));if(!n.length)return'<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';const t=n[0],e=p(s),o=t.tags.length>0?t.tags[0]:"",l=s.recentMoments[0]?.stats?.upvote??0,c=s.recentMoments[0]?.stats?.totalComment??0;return d({href:a(t.permalink),app:"moments",className:"wg-moment-social",disabled:m==="preview",innerHtml:`
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${a(e.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        </span>
        <span class="wg-moment-social-info">
          <span class="wg-moment-social-name">${a(e.displayName||"作者")}</span>
          <span class="wg-moment-social-time">${a(t.listTime)}</span>
        </span>
        ${o?`<span class="wg-moment-social-tag">#${a(o)}</span>`:""}
      </span>
      <span class="wg-moment-social-content">${a(t.summary)}</span>
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart"><span class="icon-[lucide--heart]" aria-hidden="true"></span><b>${l}</b></span>
        <span class="wg-moment-social-stat is-chat"><span class="icon-[lucide--message-circle]" aria-hidden="true"></span><b>${c}</b></span>
      </span>
    `})}export{h as t};
