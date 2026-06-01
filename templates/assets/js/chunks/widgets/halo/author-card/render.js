import{r as c}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.40&r=0c2cb8283bf4";function e({href:s,app:r,className:t="",attrs:a="",innerHtml:i,disabled:n=!1}){return!s||s==="#"?`<span class="${t||""}"${a?" "+a:""}>${i}</span>`:n?`<span class="${t}"${a?" "+a:""}>${i}</span>`:`<a class="${t?`${t} pjax-link`:"pjax-link"}" data-pjax-app="${r}" href="${s}"${a?" "+a:""}>${i}</a>`}function p({href:s,className:r="",attrs:t="",innerHtml:a}){return`<a class="${r}" href="${s}" target="_blank" rel="noopener noreferrer"${t?" "+t:""}>${a}</a>`}function h({sources:s,escapeHtml:r,mode:t}){const a=c(s),i=r(a.permalink||"#"),n=a.authenticated?"auth":"explorer-author",o=a.avatar?`<img class="wg-author-avatar-img" src="${r(a.avatar)}" alt="${r(a.displayName)}" loading="lazy" decoding="async" fetchpriority="low">`:`<span class="wg-author-avatar-fallback">${r((a.displayName||"A").slice(0,1))}</span>`,l=i,u=a.authenticated?"auth":"explorer-author";return`
    <div class="wg-author-compact" data-author-authenticated="${a.authenticated?"true":"false"}">
      ${e({href:i,app:n,className:"wg-author-head",disabled:t==="preview",innerHtml:`
          <div class="wg-author-avatar">
            ${o}
            <div class="wg-author-status-dot"></div>
          </div>
          <div class="wg-author-info">
            <strong class="wg-author-name">${r(a.displayName)}</strong>
            <span class="wg-author-bio">${r(a.summary)}</span>
          </div>
        `})}
      <div class="wg-author-actions">
        ${e({href:l,app:u,className:"wg-author-action-btn",attrs:a.authenticated?'title="个人中心"':'title="文章"',disabled:t==="preview",innerHtml:'<span class="icon-[lucide--file-text]" aria-hidden="true"></span>'})}
        ${e({href:"/moments",app:"moments",className:"wg-author-action-btn",attrs:'title="瞬间"',disabled:t==="preview",innerHtml:'<span class="icon-[lucide--clock]" aria-hidden="true"></span>'})}
      </div>
    </div>
  `}export{p as n,e as r,h as t};
