import{r as l}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.35&r=918c6d97eee1";function e({href:i,app:s,className:r="",attrs:a="",innerHtml:n,disabled:t=!1}){return!i||i==="#"?`<span class="${r||""}"${a?" "+a:""}>${n}</span>`:t?`<span class="${r}"${a?" "+a:""}>${n}</span>`:`<a class="${r?`${r} pjax-link`:"pjax-link"}" data-pjax-app="${s}" href="${i}"${a?" "+a:""}>${n}</a>`}function p({href:i,className:s="",attrs:r="",innerHtml:a}){return`<a class="${s}" href="${i}" target="_blank" rel="noopener noreferrer"${r?" "+r:""}>${a}</a>`}function c({sources:i,escapeHtml:s,mode:r}){const a=l(i),n=s(a.permalink||"#"),t=a.avatar?`<img class="wg-author-avatar-img" src="${s(a.avatar)}" alt="${s(a.displayName)}" loading="lazy" decoding="async" fetchpriority="low">`:`<span class="wg-author-avatar-fallback">${s((a.displayName||"A").slice(0,1))}</span>`,o=n;return`
    <div class="wg-author-compact">
      ${e({href:n,app:"explorer-author",className:"wg-author-head",disabled:r==="preview",innerHtml:`
          <div class="wg-author-avatar">
            ${t}
            <div class="wg-author-status-dot"></div>
          </div>
          <div class="wg-author-info">
            <strong class="wg-author-name">${s(a.displayName)}</strong>
            <span class="wg-author-bio">${s(a.summary)}</span>
          </div>
        `})}
      <div class="wg-author-actions">
        ${e({href:o,app:"explorer-author",className:"wg-author-action-btn",attrs:'title="文章"',disabled:r==="preview",innerHtml:'<span class="icon-[lucide--file-text]" aria-hidden="true"></span>'})}
        ${e({href:"/moments",app:"moments",className:"wg-author-action-btn",attrs:'title="瞬间"',disabled:r==="preview",innerHtml:'<span class="icon-[lucide--clock]" aria-hidden="true"></span>'})}
      </div>
    </div>
  `}export{p as n,e as r,c as t};
