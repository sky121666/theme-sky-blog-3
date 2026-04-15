import{r as p}from"../../catalog.js";import{n as g}from"../../halo/author-card/render.js";function v({sources:t,escapeHtml:s,normalizeMomentRecord:i,mode:l}){if(!t.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const n=t.recentMoments.slice(0,1).map(c=>i(c));if(!n.length)return'<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';const a=n[0],o=p(t),e=a.tags.length>0?a.tags[0]:"",m=t.recentMoments[0]?.stats?.upvote??0,r=t.recentMoments[0]?.stats?.totalComment??0;return g({href:s(a.permalink),app:"moments",className:"wg-moment-social",disabled:l==="preview",innerHtml:`
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${s(o.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        </span>
        <span class="wg-moment-social-info">
          <span class="wg-moment-social-name">${s(o.displayName||"作者")}</span>
          <span class="wg-moment-social-time">${s(a.listTime)}</span>
        </span>
        ${e?`<span class="wg-moment-social-tag">#${s(e)}</span>`:""}
      </span>
      <span class="wg-moment-social-content">${s(a.summary)}</span>
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><b>${m}</b></span>
        <span class="wg-moment-social-stat is-chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><b>${r}</b></span>
      </span>
    `})}export{v as t};
