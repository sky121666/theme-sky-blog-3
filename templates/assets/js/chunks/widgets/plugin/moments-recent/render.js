import{r as b}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.30&r=5a21dbbef33f";import{n as u}from"../../halo/author-card/render.js?v=0.9.30&r=5a21dbbef33f";function M(s,a,i,n){const t=Number.parseInt(s,10);return Number.isFinite(t)?Math.min(Math.max(t,i),n):a}function w(s,a,i){if(!i||!s.mediaCount)return"";const n=s.media[0];return n?.type==="PHOTO"&&n.url?`
      <span class="wg-moment-social-media">
        <img src="${a(n.url)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        ${s.mediaCount>1?`<b>+${s.mediaCount-1}</b>`:""}
      </span>
    `:`
    <span class="wg-moment-social-media is-placeholder">
      <span class="icon-[lucide--image]" aria-hidden="true"></span>
      ${s.mediaCount>1?`<b>+${s.mediaCount-1}</b>`:""}
    </span>
  `}function N({sources:s,escapeHtml:a,normalizeMomentRecord:i,mode:n},t){if(!s.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const p=t?.meta&&typeof t.meta=="object"?t.meta:{},h=M(p.limit,1,1,3),d=p.showMedia!==!1,o=s.recentMoments.slice(0,h).map(r=>i(r));if(!o.length)return'<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';const m=b(s);if(o.length>1){const r=o.map((l,v)=>{const y=((s.recentMoments[v]||{}).stats||{}).upvote??0;return u({href:a(l.permalink),app:"moments",className:"wg-moment-social-item",disabled:n==="preview",innerHtml:`
          <span class="wg-moment-social-item-copy">
            <span class="wg-moment-social-item-title">${a(l.summary)}</span>
            <span class="wg-moment-social-item-meta">${a(l.listTime)} · ${a(String(y))} 赞</span>
          </span>
          ${w(l,a,d)}
        `})}).join("");return`
      <div class="wg-moment-social wg-moment-social--stack">
        <span class="wg-moment-social-header">
          <span class="wg-moment-social-avatar">
            <img src="${a(m.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
          </span>
          <span class="wg-moment-social-info">
            <span class="wg-moment-social-name">${a(m.displayName||"作者")}</span>
            <span class="wg-moment-social-time">最新 ${o.length} 条瞬间</span>
          </span>
        </span>
        <span class="wg-moment-social-stack-list">${r}</span>
      </div>
    `}const e=o[0],g=e.tags.length>0?e.tags[0]:"",c=s.recentMoments[0]?.stats||{},f=c.upvote??0,$=c.approvedComment??c.totalComment??0;return u({href:a(e.permalink),app:"moments",className:"wg-moment-social",disabled:n==="preview",innerHtml:`
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${a(m.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        </span>
        <span class="wg-moment-social-info">
          <span class="wg-moment-social-name">${a(m.displayName||"作者")}</span>
          <span class="wg-moment-social-time">${a(e.listTime)}</span>
        </span>
        ${g?`<span class="wg-moment-social-tag">#${a(g)}</span>`:""}
      </span>
      <span class="wg-moment-social-content">${a(e.summary)}</span>
      ${w(e,a,d)}
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart"><span class="icon-[lucide--heart]" aria-hidden="true"></span><b>${f}</b></span>
        <span class="wg-moment-social-stat is-chat"><span class="icon-[lucide--message-circle]" aria-hidden="true"></span><b>${$}</b></span>
      </span>
    `})}export{N as t};
