import{a as l,c as d,i as a}from"../apps/reader/post-outline.js";function p(e,i="full"){const t=e?new Date(e):null;if(!t||Number.isNaN(t.getTime()))return i==="list"?"--.-- --:--":"未知时间";const r=o=>String(o).padStart(2,"0");return i==="list"?`${r(t.getMonth()+1)}.${r(t.getDate())} ${r(t.getHours())}:${r(t.getMinutes())}`:`${t.getFullYear()}.${r(t.getMonth()+1)}.${r(t.getDate())} ${r(t.getHours())}:${r(t.getMinutes())}`}function w(e){const i=e?.metadata?.name||"",t=e?.spec?.content||{},r=Array.isArray(t.medium)?t.medium:[],o=Array.isArray(e?.spec?.tags)?e.spec.tags:[];let s=l(t.html||"")||l(t.raw||"");if(s&&o.length>0){for(const h of o)s=s.replace(new RegExp(`#${h.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`,"g"),"");s=s.replace(/\s+/g," ").trim()}const n=r.length,c=s?d(s,36):n>0?"图片瞬间":"瞬间记录",u=s?d(s,88):n>0?"打开预览查看媒体内容":"打开预览查看完整内容";return{key:i,title:c||"瞬间记录",summary:u||"打开预览查看完整内容",listTime:p(e?.spec?.releaseTime,"list"),fullTime:p(e?.spec?.releaseTime,"full"),media:r,mediaCount:n,rowBadge:n>0?`${n} 项媒体`:"文本",mediaLabel:n>0?`${n} 项媒体`:"纯文本",interactions:`${e?.stats?.upvote??0} 赞 · ${e?.stats?.totalComment??0} 评论`,tags:o,html:t.html||(s?`<p>${a(s)}</p>`:""),permalink:i?`/moments/${encodeURIComponent(i)}`:"/moments"}}function m(e){const i=e?.type||"",t=a(e?.url||"");return i==="PHOTO"?`<div class="author-moment-preview-tile is-photo"><img src="${t}" alt=""></div>`:i==="VIDEO"?`<div class="author-moment-preview-tile is-video"><video src="${t}" preload="metadata" controls playsinline></video></div>`:i==="AUDIO"?'<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>音频</span></div></div>':'<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>文章卡片</span></div></div>'}function g(e){return`
    <a class="author-moment-row pjax-link"
       data-pjax-app="moments"
       data-author-moment-option
       data-moment-key="${a(e.key)}"
       data-moment-title="${a(e.title)}"
       href="${a(e.permalink)}">
      <div class="author-moment-row-main">
        <span class="author-moment-row-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M5 5.5H15C16.1046 5.5 17 6.39543 17 7.5V12.5C17 13.6046 16.1046 14.5 15 14.5H5C3.89543 14.5 3 13.6046 3 12.5V7.5C3 6.39543 3.89543 5.5 5 5.5Z" stroke="currentColor" stroke-width="1.15"></path>
            <path d="M6.25 11.75L8.25 9.75L10 11.5L12.75 8.75" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="6.75" cy="7.9" r="0.9" fill="currentColor"></circle>
          </svg>
        </span>
        <span class="author-moment-row-copy">
          <span class="author-moment-row-title">${a(e.title)}</span>
          <span class="author-moment-row-summary">${a(e.summary)}</span>
        </span>
      </div>
      <span class="author-moment-row-meta">
        <span class="author-moment-row-date">${a(e.listTime)}</span>
        <span class="author-moment-row-badge">${a(e.rowBadge)}</span>
      </span>
    </a>
  `}function $(e,i){const t=e.mediaCount>0?`<div class="author-moment-preview-media">${e.media.map(o=>m(o)).join("")}</div>`:"",r=e.tags.length>0?`
      <div>
        <dt>标签</dt>
        <dd>
          <span class="author-inline-chip-list">
            ${e.tags.map(o=>`<span class="author-inline-chip">${a(o)}</span>`).join("")}
          </span>
        </dd>
      </div>
    `:"";return`
    <article class="author-preview-panel tag-preview-panel author-preview-panel--moment"
             data-author-moment-panel
             data-moment-key="${a(e.key)}">
      <header class="author-preview-header tag-preview-header">
        <div class="author-preview-icon tag-preview-icon author-preview-icon--moment">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7.25 5.75H16.75C18.1307 5.75 19.25 6.86929 19.25 8.25V15.75C19.25 17.1307 18.1307 18.25 16.75 18.25H7.25C5.86929 18.25 4.75 17.1307 4.75 15.75V8.25C4.75 6.86929 5.86929 5.75 7.25 5.75Z" stroke="currentColor" stroke-width="1.25"></path>
            <path d="M8 14.25L10.5 11.75L12.75 14L15.75 11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="9" cy="9.25" r="1" fill="currentColor"></circle>
          </svg>
        </div>
        <div class="author-preview-heading tag-preview-heading">
          <h2 class="author-preview-title tag-preview-title">${a(e.title)}</h2>
          <p class="author-preview-path tag-preview-path">${a(`${i||"作者"} / ${e.fullTime}`)}</p>
        </div>
      </header>

      ${t}

      <dl class="author-preview-meta tag-preview-meta">
        <div>
          <dt>发布时间</dt>
          <dd>${a(e.fullTime)}</dd>
        </div>
        <div>
          <dt>互动</dt>
          <dd>${a(e.interactions)}</dd>
        </div>
        <div>
          <dt>内容类型</dt>
          <dd>${a(e.mediaLabel)}</dd>
        </div>
        ${r}
      </dl>

      ${e.html?`<div class="author-moment-preview-body">${e.html}</div>`:""}

      <a class="author-preview-action tag-preview-action pjax-link" data-pjax-app="moments" href="${a(e.permalink)}">打开瞬间</a>
    </article>
  `}export{$ as n,g as r,w as t};
