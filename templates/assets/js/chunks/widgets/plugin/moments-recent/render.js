import{r as h}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.37&r=61d9b73f6fae";import{r as g}from"../../halo/author-card/render.js?v=0.9.37&r=61d9b73f6fae";function l(n,s){if(!n.mediaCount)return"";const e=n.media[0],a=typeof e?.type=="string"?e.type:e?.type?.name||"",o=n.mediaCount>1?`<b>+${n.mediaCount-1}</b>`:"";return a==="PHOTO"&&e.url?`
      <span class="wg-moment-social-media">
        <img src="${s(e.url)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
        ${o}
      </span>
    `:`
    <span class="wg-moment-social-media is-placeholder">
      <span class="${a==="VIDEO"?"icon-[lucide--video]":a==="AUDIO"?"icon-[lucide--music-2]":"icon-[lucide--image]"}" aria-hidden="true"></span>
      <em>${s(a==="VIDEO"?"视频":a==="AUDIO"?"音频":"内容")}</em>
      ${o}
    </span>
  `}function c(n){const s=n?.stats||{},e=Number(s.totalComment??0)||0,a=Number(s.approvedComment??e)||0;return{upvote:Number(s.upvote??0)||0,comment:a}}function d({value:n,icon:s,label:e,className:a},o){return`
    <span class="${a}" aria-label="${o(`${n} ${e}`)}">
      <span class="${s}" aria-hidden="true"></span>
      <b>${o(String(n))}</b>
    </span>
  `}function p(n,s){return`
    <span class="wg-moment-social-stats">
      ${d({value:n.upvote,icon:"icon-[lucide--heart]",label:"个赞",className:"wg-moment-social-stat is-heart"},s)}
      ${d({value:n.comment,icon:"icon-[lucide--message-circle]",label:"条评论",className:"wg-moment-social-stat is-comment"},s)}
    </span>
  `}function v(n,s){const e=n?.owner||{};return{displayName:e.displayName||s.displayName||"作者",avatar:e.avatar||s.avatar||"/logo"}}function y(n){return g({href:"/moments",app:"moments",className:"desktop-widget-empty wg-moment-social-empty",disabled:n==="preview",innerHtml:`
      <strong>还没有瞬间</strong>
      <span>打开瞬间记录最近动态</span>
    `})}function w(n,s,e){return`
    <span class="wg-moment-social-header">
      <span class="wg-moment-social-avatar">
        <img src="${s(n.avatar||"/logo")}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
      <span class="wg-moment-social-info">
        <span class="wg-moment-social-name">${s(n.displayName||"作者")}</span>
        <span class="wg-moment-social-time">${s(e||"最新瞬间")}</span>
      </span>
    </span>
  `}function M(n,s){return`<span class="wg-moment-social-time-pill">${s(n||"最新")}</span>`}function u({moment:n,app:s="moments",className:e,mode:a,escapeHtml:o,innerHtml:t}){return g({href:o(n?.permalink||"/moments"),app:s,className:e,disabled:a==="preview",innerHtml:t})}function b({moment:n,original:s,author:e,escapeHtml:a,mode:o}){const t=c(s),i=n.mediaCount>0;return u({moment:n,escapeHtml:a,mode:o,className:`wg-moment-social wg-moment-social--small${i?" has-cover":""}`,innerHtml:`
      ${i?l(n,a):""}
      <span class="wg-moment-social-overlay">
        <span class="wg-moment-social-topline">
          <span class="wg-moment-social-avatar">
            <img src="${a(e.avatar)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
          </span>
          ${M(n.listTime,a)}
        </span>
        <span class="wg-moment-social-content">${a(n.summary)}</span>
        <span class="wg-moment-social-footer">
          ${p(t,a)}
          ${!i&&n.mediaCount?`<span class="wg-moment-social-media-count">${a(n.rowBadge)}</span>`:""}
        </span>
      </span>
    `})}function N({moment:n,original:s,author:e,escapeHtml:a,mode:o}){const t=c(s),i=n.tags.length>0?n.tags[0]:"",r=l(n,a);return u({moment:n,escapeHtml:a,mode:o,className:`wg-moment-social wg-moment-social--medium${r?" has-media":""}`,innerHtml:`
      <span class="wg-moment-social-copy">
        ${w(e,a,n.listTime)}
        <span class="wg-moment-social-content">${a(n.summary)}</span>
        <span class="wg-moment-social-bar">
          ${i?`<span class="wg-moment-social-tag">#${a(i)}</span>`:"<span></span>"}
          ${p(t,a)}
        </span>
      </span>
      ${r}
    `})}function C({moments:n,originals:s,author:e,escapeHtml:a,mode:o}){const t=n[0],i=c(s[0]);return`
    <div class="wg-moment-social wg-moment-social--large">
      ${u({moment:t,escapeHtml:a,mode:o,className:`wg-moment-social-feature${t.mediaCount?" has-media":""}`,innerHtml:`
          <span class="wg-moment-social-feature-head">
            ${w(e,a,t.fullTime)}
            <span class="wg-moment-social-more" aria-hidden="true">
              <span class="icon-[lucide--more-horizontal]" aria-hidden="true"></span>
            </span>
          </span>
          <span class="wg-moment-social-content">${a(t.summary)}</span>
          ${l(t,a)}
          <span class="wg-moment-social-feature-copy">
            ${t.tags.length>0?`<span class="wg-moment-social-tag">#${a(t.tags[0])}</span>`:"<span></span>"}
            <span class="wg-moment-social-footer">${p(i,a)}</span>
          </span>
        `})}
    </div>
  `}function O({sources:n,escapeHtml:s,normalizeMomentRecord:e,mode:a},o){if(!n.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const t=o?.size||"medium",i=n.recentMoments.slice(0,1),r=i.map(f=>e(f));if(!r.length)return y(a);const $=h(n),m=v(i[0],$);return t==="small"?b({moment:r[0],original:i[0],author:m,escapeHtml:s,mode:a}):t==="large"?C({moments:r,originals:i,author:m,escapeHtml:s,mode:a}):N({moment:r[0],original:i[0],author:m,escapeHtml:s,mode:a})}export{O as t};
