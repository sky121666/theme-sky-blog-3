import{n as u}from"../../../rolldown-runtime.js?v=0.9.41&r=6ae7c93a07bf";import{r as p}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.41&r=6ae7c93a07bf";function i({href:e,app:r,className:t="",attrs:a="",innerHtml:s,disabled:n=!1}){return!e||e==="#"?`<span class="${t||""}"${a?" "+a:""}>${s}</span>`:n?`<span class="${t}"${a?" "+a:""}>${s}</span>`:`<a class="${t?`${t} pjax-link`:"pjax-link"}" data-pjax-app="${r}" href="${e}"${a?" "+a:""}>${s}</a>`}function g({href:e,className:r="",attrs:t="",innerHtml:a}){return`<a class="${r}" href="${e}" target="_blank" rel="noopener noreferrer"${t?" "+t:""}>${a}</a>`}var v=u({renderWidget:()=>c});function c({sources:e,escapeHtml:r,mode:t}){const a=p(e),s=r(a.permalink||"#"),n=a.authenticated?"auth":"explorer-author",o=a.avatar?`<img class="wg-author-avatar-img" src="${r(a.avatar)}" alt="${r(a.displayName)}" loading="lazy" decoding="async" fetchpriority="low">`:`<span class="wg-author-avatar-fallback">${r((a.displayName||"A").slice(0,1))}</span>`,l=s,d=a.authenticated?"auth":"explorer-author";return`
    <div class="wg-author-compact" data-author-authenticated="${a.authenticated?"true":"false"}">
      ${i({href:s,app:n,className:"wg-author-head",disabled:t==="preview",innerHtml:`
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
        ${i({href:l,app:d,className:"wg-author-action-btn",attrs:a.authenticated?'title="个人中心"':'title="文章"',disabled:t==="preview",innerHtml:'<span class="icon-[lucide--file-text]" aria-hidden="true"></span>'})}
        ${i({href:"/moments",app:"moments",className:"wg-author-action-btn",attrs:'title="瞬间"',disabled:t==="preview",innerHtml:'<span class="icon-[lucide--clock]" aria-hidden="true"></span>'})}
      </div>
    </div>
  `}export{g as n,i as r,v as t};
