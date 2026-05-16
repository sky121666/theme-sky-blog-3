import{r as l}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.30&r=eba23ce07db9";function o({href:t,app:s,className:r="",attrs:a="",innerHtml:i,disabled:n=!1}){return!t||t==="#"?`<span class="${r||""}"${a?" "+a:""}>${i}</span>`:n?`<span class="${r}"${a?" "+a:""}>${i}</span>`:`<a class="${r?`${r} pjax-link`:"pjax-link"}" data-pjax-app="${s}" href="${t}"${a?" "+a:""}>${i}</a>`}function d({sources:t,escapeHtml:s,mode:r}){const a=l(t),i=s(a.permalink||"#"),n=a.avatar?`<img class="wg-author-avatar-img" src="${s(a.avatar)}" alt="${s(a.displayName)}" loading="lazy" decoding="async" fetchpriority="low">`:`<span class="wg-author-avatar-fallback">${s((a.displayName||"A").slice(0,1))}</span>`,e=i;return`
    <div class="wg-author-compact">
      ${o({href:i,app:"explorer-author",className:"wg-author-head",disabled:r==="preview",innerHtml:`
          <div class="wg-author-avatar">
            ${n}
            <div class="wg-author-status-dot"></div>
          </div>
          <div class="wg-author-info">
            <strong class="wg-author-name">${s(a.displayName)}</strong>
            <span class="wg-author-bio">${s(a.summary)}</span>
          </div>
        `})}
      <div class="wg-author-actions">
        ${o({href:e,app:"explorer-author",className:"wg-author-action-btn",attrs:'title="文章"',disabled:r==="preview",innerHtml:'<span class="icon-[lucide--file-text]" aria-hidden="true"></span>'})}
        ${o({href:"/moments",app:"moments",className:"wg-author-action-btn",attrs:'title="瞬间"',disabled:r==="preview",innerHtml:'<span class="icon-[lucide--clock]" aria-hidden="true"></span>'})}
      </div>
    </div>
  `}export{o as n,d as t};
