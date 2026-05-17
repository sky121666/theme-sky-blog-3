import{r as N}from"../../../shell-runtime/runtime/desktop/surface/edit-mode.js?v=0.9.30&r=9b6a6e5b17dd";import{r as c}from"../author-card/render.js?v=0.9.30&r=9b6a6e5b17dd";var k={showSteam:!0,showMoments:!0,showPosts:!0,showPhotos:!0};function p(t,e){return t?.[e]!==!1}function v(t){if(typeof t=="number"&&Number.isFinite(t))return t<1e12?t*1e3:t;const e=Date.parse(t||"");return Number.isFinite(e)?e:0}function $(t,e,n){return t>0&&t<=e&&e-t<=n}function w(t,e=""){return String(t||e||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim()}function P(t={},e={},n=Date.now()){const i={...k,...e};if(p(i,"showSteam")&&t.steamAvailable&&t.steamProfile?.playing===!0){const l=t.steamProfile||{};return{type:"steam-playing",label:l.statusText||"正在游戏",title:l.currentGameName||l.personaName||"Steam",subtitle:l.currentGameName?l.personaName||"":"当前在线",href:"/steam",app:"steam",cover:l.avatarFull||"",accent:"steam"}}const r=Array.isArray(t.recentMoments)?t.recentMoments[0]:null,o=v(r?.metadata?.creationTimestamp||r?.spec?.releaseTime||r?.status?.lastModifyTime);if(p(i,"showMoments")&&t.momentsAvailable&&$(o,n,2880*60*1e3)){const l=r?.metadata?.name||"";return{type:"moment-recent",label:"刚刚更新瞬间",title:w(r?.spec?.content||r?.spec?.raw,"新的瞬间"),subtitle:"48 小时内",href:r?.status?.permalink||(l?`/moments/${l}`:"/moments"),app:"moments",cover:"",accent:"moments"}}const a=Array.isArray(t.latestPosts)?t.latestPosts[0]:null,s=v(a?.metadata?.creationTimestamp||a?.spec?.publishTime||a?.status?.lastModifyTime);return p(i,"showPosts")&&$(s,n,10080*60*1e3)?{type:"post-recent",label:"最近写了文章",title:w(a?.spec?.title,"最新文章"),subtitle:"7 天内",href:a?.status?.permalink||"#",app:"reader",cover:a?.spec?.cover||"",accent:"posts"}:p(i,"showPhotos")&&t.photosAvailable&&(t.photoGroups?.length||t.photos?.length)?{type:"photos-active",label:"最近整理图库",title:"图库",subtitle:"照片入口",href:t.photosUrl||"/photos",app:"photos",cover:t.photoGroups?.[0]?.spec?.cover||t.photos?.[0]?.spec?.url||"",accent:"photos"}:{type:"default",label:"站点作者",title:"",subtitle:"",href:"#",app:"explorer-author",cover:"",accent:"default"}}function y(t){const e=Number(t||0);return!Number.isFinite(e)||e<=0?"0":e>=1e4?`${(e/1e4).toFixed(e>=1e5?0:1)}w`:e>=1e3?`${(e/1e3).toFixed(e>=1e4?0:1)}k`:String(Math.round(e))}function T(t,e,n="wg-identity-avatar"){return t.avatar?`
      <span class="${n}">
        <img src="${e(t.avatar)}" alt="${e(t.displayName)}" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `:`
    <span class="${n} is-fallback">
      <span>${e((t.displayName||"A").slice(0,1))}</span>
    </span>
  `}function x(t,e){return t.type!=="default"?t:{...t,title:e.displayName||"站点作者",subtitle:e.summary||"",href:e.permalink||"#",cover:e.avatar||""}}function M(t){return`title="${t}" aria-label="${t}"`}function F({sources:t,author:e,escapeHtml:n,mode:i}){const r=Array.isArray(t.latestPosts)?t.latestPosts[0]:null,o=[{label:"作者",icon:"icon-[lucide--user]",href:e.permalink||"#",app:"explorer-author"}];return t.momentsAvailable&&o.push({label:"瞬间",icon:"icon-[lucide--clock]",href:"/moments",app:"moments"}),t.steamAvailable&&o.push({label:"Steam",icon:"icon-[lucide--gamepad-2]",href:"/steam",app:"steam"}),t.photosAvailable&&o.push({label:"图库",icon:"icon-[lucide--image]",href:t.photosUrl||"/photos",app:"photos"}),r?.status?.permalink&&o.push({label:"文章",icon:"icon-[lucide--file-text]",href:r.status.permalink,app:"reader"}),o.slice(0,3).map(a=>c({href:n(a.href),app:a.app,className:"wg-identity-action",attrs:M(n(a.label)),disabled:i==="preview",innerHtml:`<span class="${a.icon}" aria-hidden="true"></span>`})).join("")}function S(t,e,n){const i=t.cover||e.avatar||"";return i?`<img class="wg-identity-hero-img" src="${n(i)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`:'<span class="wg-identity-hero-placeholder"><span class="icon-[lucide--sparkles]" aria-hidden="true"></span></span>'}function j({sources:t,escapeHtml:e,mode:n},i){const r=i?.size||"medium",o=i?.meta&&typeof i.meta=="object"?i.meta:{},a=N(t),s=x(P(t,o),a),l=T(a,e),f=e(s.title||a.displayName||"站点作者"),h=e(s.subtitle||a.summary||""),m=e(s.label||"站点作者"),d=e(s.href||a.permalink||"#"),u=s.app||"explorer-author",b=F({sources:t,author:a,escapeHtml:e,mode:n});if(r==="small")return`
      <div class="wg-identity is-small" data-presence-type="${e(s.type)}" data-presence-accent="${e(s.accent)}">
        ${c({href:d,app:u,className:"wg-identity-small-link",disabled:n==="preview",innerHtml:`
            ${l}
            <span class="wg-identity-small-copy">
              <strong>${e(a.displayName||"站点作者")}</strong>
              <span>${m}</span>
            </span>
          `})}
      </div>
    `;const A=[{label:"文章",value:y(a.posts)},{label:"访问",value:y(a.visits)},{label:t.steamAvailable?"游戏":"瞬间",value:y(t.steamAvailable?t.steamStats?.totalGames:a.moments)}];return r==="large"?`
      <div class="wg-identity is-large" data-presence-type="${e(s.type)}" data-presence-accent="${e(s.accent)}">
        ${c({href:d,app:u,className:"wg-identity-hero",disabled:n==="preview",innerHtml:`
            ${S(s,a,e)}
            <span class="wg-identity-hero-scrim"></span>
            <span class="wg-identity-presence-pill">${m}</span>
            <span class="wg-identity-hero-copy">
              <strong>${f}</strong>
              <span>${h}</span>
            </span>
          `})}
        <div class="wg-identity-profile-row">
          ${l}
          <span class="wg-identity-profile-copy">
            <strong>${e(a.displayName||"站点作者")}</strong>
            <span>${e(a.summary||"")}</span>
          </span>
        </div>
        <div class="wg-identity-metrics">
          ${A.map(g=>`
            <span class="wg-identity-metric">
              <b>${e(g.value)}</b>
              <small>${e(g.label)}</small>
            </span>
          `).join("")}
        </div>
        <div class="wg-identity-actions">${b}</div>
      </div>
    `:`
    <div class="wg-identity is-medium" data-presence-type="${e(s.type)}" data-presence-accent="${e(s.accent)}">
      <div class="wg-identity-profile-row">
        ${l}
        <span class="wg-identity-profile-copy">
          <strong>${e(a.displayName||"站点作者")}</strong>
          <span>${e(a.summary||"")}</span>
        </span>
      </div>
      ${c({href:d,app:u,className:"wg-identity-presence",disabled:n==="preview",innerHtml:`
          <span class="wg-identity-presence-pill">${m}</span>
          <strong>${f}</strong>
          <span>${h}</span>
        `})}
      <div class="wg-identity-actions">${b}</div>
    </div>
  `}export{j as t};
