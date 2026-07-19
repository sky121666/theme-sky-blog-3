import{n as I}from"../../../rolldown-runtime.js?v=0.9.41&r=437dcc5bcb14";import{r as U}from"../../halo/author-card/render.js?v=0.9.41&r=437dcc5bcb14";var J=I({renderWidget:()=>M});function G(e,t=!0){return e===!1||e==="false"?!1:e===!0||e==="true"?!0:t}function W(e){return Array.isArray(e)?e[0]||null:Array.isArray(e?.items)?e.items[0]||null:Array.isArray(e?.list)&&e.list[0]||null}function _(...e){return e.flatMap(t=>Array.isArray(t)?t:Array.isArray(t?.items)?t.items:Array.isArray(t?.list)?t.list:[]).filter(Boolean)}function o(e){return String(e||"").trim().toLowerCase()}function z(e){const t=String(e||"").trim();return t&&t.match(/(?:正在(?:玩|游玩)|playing)\s*[:：]\s*(.+)$/i)?.[1]?.trim()||""}function O(e,t){const s=o(t);return s?e.find(n=>o(n?.name)===s)||e.find(n=>{const r=o(n?.name);return r&&(r.includes(s)||s.includes(r))}):null}function $(e){const t=Number(e||0);return Number.isFinite(t)&&t>0?String(t):"--"}function j(e){const t=String(e||"").trim();return t?t.replace(/["\\\n\r]/g,""):""}function D(e){const t=String(e||"").trim().toLowerCase();return!t||t.includes("离线")||t.includes("offline")}function E({avatar:e,personaName:t}){return e?`<img class="wg-steam-avatar-img" src="${e}" alt="${t}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span class="wg-steam-avatar-fallback icon-[lucide--user]" aria-hidden="true"></span>'}function M({sources:e,escapeHtml:t,mode:s},n){if(!e.steamAvailable)return'<div class="desktop-widget-empty">未安装 Steam 插件。</div>';const r=n?.meta||{},h=G(r.showStats,!0),x=G(r.showRecentGame,!0),a=e.steamProfile||{},l=e.steamStats||{},d=W(e.steamRecentGames),u=_(e.steamRecentGames,e.steamOwnedGames),i=a.playing===!0,g=t(a.personaName||"Steam Player"),A=t(a.avatarFull||""),N=$(a.steamLevel),f=$(l.totalGames),p=t(l.recentPlaytimeFormatted||"--"),S=z(a.statusText),w=a.currentGameName||S,y=O(u,w),b=y||d||u[0]||null,m=t(d?.name||""),T=t(w||y?.name||""),C=!i&&D(a.statusText),L=t(i?"正在玩":a.statusText||"离线"),c=i?T||(a.statusText&&a.statusText!=="正在玩"?t(a.statusText):"")||"正在游戏":"",k=i&&x&&m&&m!==c?`<span class="wg-steam-recent-badge">${m}</span>`:"",v=i?j(a.currentGameImage||b?.headerImageUrl||""):"",P=v?`<div class="wg-steam-cover" style="--wg-steam-game-bg: url('${t(v)}');" aria-hidden="true"></div>`:"",F=i?"is-playing":C?"is-offline":"is-online",R=h?`
    <div class="wg-steam-stats" aria-label="Steam 统计">
      <span><em>游戏</em><strong title="${t(f)}">${t(f)}</strong></span>
      <span><em>2周</em><strong title="${p}">${p}</strong></span>
    </div>
  `:"",B=U({href:e.steamUrl||"/steam",app:"steam",className:"wg-steam-open",attrs:`aria-label="${t("打开 Steam 页面")}"`,disabled:s==="preview",innerHtml:'<span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>'});return`
    <section class="wg-steam wg-steam--medium ${F}" aria-label="${t(n?.title||"Steam")}">
      <div class="wg-steam-vignette" aria-hidden="true"></div>
      ${P}
      <div class="wg-steam-ornament" aria-hidden="true">
        <span class="icon-[lucide--disc-3]"></span>
        <span class="icon-[lucide--gamepad-2]"></span>
      </div>

      <div class="wg-steam-identity">
        <div class="wg-steam-avatar">
          <span class="wg-steam-avatar-ring" aria-hidden="true"></span>
          ${E({avatar:A,personaName:g})}
        </div>
        <span class="wg-steam-level">LV.${t(N)}</span>
      </div>

      <div class="wg-steam-content">
        <div class="wg-steam-head">
          <div class="wg-steam-titleline">
            <h3>${g}</h3>
          </div>
          <span class="wg-steam-status">
            <span class="wg-steam-dot" aria-hidden="true"></span>
            ${L}
          </span>
          ${c?`<p>${c}</p>`:""}
          ${k}
        </div>

        <div class="wg-steam-footer">
          ${R}
          ${B}
        </div>
      </div>
    </section>
  `}export{J as t};
