import{n as B}from"../../../rolldown-runtime.js?v=0.9.42&r=9ec9cbc92640";import{r as W}from"../../halo/author-card/render.js?v=0.9.42&r=9ec9cbc92640";function o(e){return String(e??"").trim()}function x(e){const t=e?.delisted;return t===!0||t===1||o(t).toLowerCase()==="true"||o(t)==="1"}function _(e){return!e||x(e)?"":o(e.headerImageUrl)||o(e.realHeaderImage)}function O(e,t,n=""){const s=o(e);if(s)return s;if(t==null||t==="")return n;const r=Number(t);if(!Number.isFinite(r)||r<0)return n;const m=Math.floor(r),c=Math.floor(m/60),a=m%60;return c>0?`${c}h ${a}m`:`${a}m`}var Z=B({renderWidget:()=>Q});function b(e,t=!0){return e===!1||e==="false"?!1:e===!0||e==="true"?!0:t}function j(e){return Array.isArray(e)?e[0]||null:Array.isArray(e?.items)?e.items[0]||null:Array.isArray(e?.list)&&e.list[0]||null}function D(...e){return e.flatMap(t=>Array.isArray(t)?t:Array.isArray(t?.items)?t.items:Array.isArray(t?.list)?t.list:[]).filter(Boolean)}function f(e){return String(e||"").trim().toLowerCase()}function E(e){const t=String(e||"").trim();return t&&t.match(/(?:正在(?:玩|游玩)|playing)\s*[:：]\s*(.+)$/i)?.[1]?.trim()||""}function V(e,t){const n=f(t);return n?e.find(s=>f(s?.name)===n)||e.find(s=>{const r=f(s?.name);return r&&(r.includes(n)||n.includes(r))}):null}function N(e){const t=Number(e||0);return Number.isFinite(t)&&t>0?String(t):"--"}function q(e){const t=String(e||"").trim();return t?t.replace(/["\\\n\r]/g,""):""}function J(e){const t=String(e||"").trim().toLowerCase();return!t||t.includes("离线")||t.includes("offline")}function K({avatar:e,personaName:t}){return e?`<img class="wg-steam-avatar-img" src="${e}" alt="${t}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span class="wg-steam-avatar-fallback icon-[lucide--user]" aria-hidden="true"></span>'}function Q({sources:e,escapeHtml:t,mode:n},s){if(!e.steamAvailable)return'<div class="desktop-widget-empty">未安装 Steam 插件。</div>';const r=s?.meta||{},m=b(r.showStats,!0),c=b(r.showRecentGame,!0),a=e.steamProfile||{},l=e.steamStats||{},g=j(e.steamRecentGames),p=D(e.steamRecentGames,e.steamOwnedGames),i=a.playing===!0,v=t(a.personaName||"Steam Player"),A=t(a.avatarFull||""),T=N(a.steamLevel),w=N(l.totalGames),y=t(O(l.recentPlaytimeFormatted,l.recentPlaytimeMinutes,"--")),C=E(a.statusText),$=a.currentGameName||C,G=V(p,$),h=G||g||p[0]||null,u=t(g?.name||""),L=t($||G?.name||""),P=!i&&J(a.statusText),F=t(i?"正在玩":a.statusText||"离线"),d=i?L||(a.statusText&&a.statusText!=="正在玩"?t(a.statusText):"")||"正在游戏":"",I=i&&c&&u&&u!==d?`<span class="wg-steam-recent-badge">${u}</span>`:"",M=x(h),S=i&&!M?q(a.currentGameImage||_(h)):"",U=S?`<div class="wg-steam-cover" style="--wg-steam-game-bg: url('${t(S)}');" aria-hidden="true"></div>`:"",k=i?"is-playing":P?"is-offline":"is-online",R=m?`
    <div class="wg-steam-stats" aria-label="Steam 统计">
      <span><em>游戏</em><strong title="${t(w)}">${t(w)}</strong></span>
      <span><em>2周</em><strong title="${y}">${y}</strong></span>
    </div>
  `:"",z=W({href:e.steamUrl||"/steam",app:"steam",className:"wg-steam-open",attrs:`aria-label="${t("打开 Steam 页面")}"`,disabled:n==="preview",innerHtml:'<span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>'});return`
    <section class="wg-steam wg-steam--medium ${k}" aria-label="${t(s?.title||"Steam")}">
      <div class="wg-steam-vignette" aria-hidden="true"></div>
      ${U}
      <div class="wg-steam-ornament" aria-hidden="true">
        <span class="icon-[lucide--disc-3]"></span>
        <span class="icon-[lucide--gamepad-2]"></span>
      </div>

      <div class="wg-steam-identity">
        <div class="wg-steam-avatar">
          <span class="wg-steam-avatar-ring" aria-hidden="true"></span>
          ${K({avatar:A,personaName:v})}
        </div>
        <span class="wg-steam-level">LV.${t(T)}</span>
      </div>

      <div class="wg-steam-content">
        <div class="wg-steam-head">
          <div class="wg-steam-titleline">
            <h3>${v}</h3>
          </div>
          <span class="wg-steam-status">
            <span class="wg-steam-dot" aria-hidden="true"></span>
            ${F}
          </span>
          ${d?`<p>${d}</p>`:""}
          ${I}
        </div>

        <div class="wg-steam-footer">
          ${R}
          ${z}
        </div>
      </div>
    </section>
  `}export{Z as t};
