import{a as l,c as d,i as t}from"../apps/reader/post-outline.js?v=0.9.30&r=a79b23b81832";function p(e,r="full"){const a=e?new Date(e):null;if(!a||Number.isNaN(a.getTime()))return r==="list"?"--.-- --:--":"未知时间";const i=n=>String(n).padStart(2,"0");return r==="list"?`${i(a.getMonth()+1)}.${i(a.getDate())} ${i(a.getHours())}:${i(a.getMinutes())}`:`${a.getFullYear()}.${i(a.getMonth()+1)}.${i(a.getDate())} ${i(a.getHours())}:${i(a.getMinutes())}`}function w(e){const r=e?.metadata?.name||"",a=e?.spec?.content||{},i=Array.isArray(a.medium)?a.medium:[],n=Array.isArray(e?.spec?.tags)?e.spec.tags:[];let s=l(a.html||"")||l(a.raw||"");if(s&&n.length>0){for(const u of n)s=s.replace(new RegExp(`#${u.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`,"g"),"");s=s.replace(/\s+/g," ").trim()}const o=i.length,c=s?d(s,36):o>0?"图片瞬间":"瞬间记录",m=s?d(s,88):o>0?"打开预览查看媒体内容":"打开预览查看完整内容";return{key:r,title:c||"瞬间记录",summary:m||"打开预览查看完整内容",listTime:p(e?.spec?.releaseTime,"list"),fullTime:p(e?.spec?.releaseTime,"full"),media:i,mediaCount:o,rowBadge:o>0?`${o} 项媒体`:"文本",mediaLabel:o>0?`${o} 项媒体`:"纯文本",interactions:`${e?.stats?.upvote??0} 赞 · ${e?.stats?.totalComment??0} 评论`,tags:n,html:a.html||(s?`<p>${t(s)}</p>`:""),permalink:r?`/moments/${encodeURIComponent(r)}`:"/moments"}}function h(e){const r=e?.type||"",a=t(e?.url||"");return r==="PHOTO"?`<div class="author-moment-preview-tile is-photo"><img src="${a}" alt=""></div>`:r==="VIDEO"?`<div class="author-moment-preview-tile is-video"><video src="${a}" preload="metadata" controls playsinline></video></div>`:r==="AUDIO"?'<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>音频</span></div></div>':'<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>文章卡片</span></div></div>'}function $(e){return`
    <a class="author-moment-row pjax-link"
       data-pjax-app="moments"
       data-author-moment-option
       data-moment-key="${t(e.key)}"
       data-moment-title="${t(e.title)}"
       href="${t(e.permalink)}">
      <div class="author-moment-row-main">
        <span class="author-moment-row-icon" aria-hidden="true">
          <span class="icon-[lucide--image]" aria-hidden="true"></span>
        </span>
        <span class="author-moment-row-copy">
          <span class="author-moment-row-title">${t(e.title)}</span>
          <span class="author-moment-row-summary">${t(e.summary)}</span>
        </span>
      </div>
      <span class="author-moment-row-meta">
        <span class="author-moment-row-date">${t(e.listTime)}</span>
        <span class="author-moment-row-badge">${t(e.rowBadge)}</span>
      </span>
    </a>
  `}function g(e,r){const a=e.mediaCount>0?`<div class="author-moment-preview-media">${e.media.map(n=>h(n)).join("")}</div>`:"",i=e.tags.length>0?`
      <div>
        <dt>标签</dt>
        <dd>
          <span class="author-inline-chip-list">
            ${e.tags.map(n=>`<span class="author-inline-chip">${t(n)}</span>`).join("")}
          </span>
        </dd>
      </div>
    `:"";return`
    <article class="author-preview-panel tag-preview-panel author-preview-panel--moment"
             data-author-moment-panel
             data-moment-key="${t(e.key)}">
      <header class="author-preview-header tag-preview-header">
        <div class="author-preview-icon tag-preview-icon author-preview-icon--moment">
          <span class="icon-[lucide--image]" aria-hidden="true"></span>
        </div>
        <div class="author-preview-heading tag-preview-heading">
          <h2 class="author-preview-title tag-preview-title">${t(e.title)}</h2>
          <p class="author-preview-path tag-preview-path">${t(`${r||"作者"} / ${e.fullTime}`)}</p>
        </div>
      </header>

      ${a}

      <dl class="author-preview-meta tag-preview-meta">
        <div>
          <dt>发布时间</dt>
          <dd>${t(e.fullTime)}</dd>
        </div>
        <div>
          <dt>互动</dt>
          <dd>${t(e.interactions)}</dd>
        </div>
        <div>
          <dt>内容类型</dt>
          <dd>${t(e.mediaLabel)}</dd>
        </div>
        ${i}
      </dl>

      ${e.html?`<div class="author-moment-preview-body">${e.html}</div>`:""}

      <a class="author-preview-action tag-preview-action pjax-link" data-pjax-app="moments" href="${t(e.permalink)}">打开瞬间</a>
    </article>
  `}export{g as n,$ as r,w as t};
