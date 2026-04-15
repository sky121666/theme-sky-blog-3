import{r as l}from"../../catalog.js";function n({href:s,app:r,className:o="",attrs:a="",innerHtml:t,disabled:i=!1}){return!s||s==="#"?`<span class="${o||""}"${a?" "+a:""}>${t}</span>`:i?`<span class="${o}"${a?" "+a:""}>${t}</span>`:`<a class="${o?`${o} pjax-link`:"pjax-link"}" data-pjax-app="${r}" href="${s}"${a?" "+a:""}>${t}</a>`}function d({sources:s,escapeHtml:r,mode:o}){const a=l(s),t=r(a.permalink||"#"),i=a.avatar?`<img class="wg-author-avatar-img" src="${r(a.avatar)}" alt="${r(a.displayName)}" loading="lazy" decoding="async" fetchpriority="low">`:`<span class="wg-author-avatar-fallback">${r((a.displayName||"A").slice(0,1))}</span>`,e=t;return`
    <div class="wg-author-compact">
      ${n({href:t,app:"explorer-author",className:"wg-author-head",disabled:o==="preview",innerHtml:`
          <div class="wg-author-avatar">
            ${i}
            <div class="wg-author-status-dot"></div>
          </div>
          <div class="wg-author-info">
            <strong class="wg-author-name">${r(a.displayName)}</strong>
            <span class="wg-author-bio">${r(a.summary)}</span>
          </div>
        `})}
      <div class="wg-author-actions">
        ${n({href:e,app:"explorer-author",className:"wg-author-action-btn",attrs:'title="文章"',disabled:o==="preview",innerHtml:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>'})}
        ${n({href:"/moments",app:"moments",className:"wg-author-action-btn",attrs:'title="瞬间"',disabled:o==="preview",innerHtml:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'})}
      </div>
    </div>
  `}export{n,d as t};
