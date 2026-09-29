import{n as B}from"../../../rolldown-runtime.js?v=0.9.46&r=a2293d4f0f2e";import{r as W}from"../../halo/author-card/render.js?v=0.9.46&r=a2293d4f0f2e";function o(t){return String(t??"").trim()}function x(t){const e=t?.delisted;return e===!0||e===1||o(e).toLowerCase()==="true"||o(e)==="1"}function _(t){return!t||x(t)?"":o(t.headerImageUrl)||o(t.realHeaderImage)}function O(t,e,n=""){const s=o(t);if(s)return s;if(e==null||e==="")return n;const a=Number(e);if(!Number.isFinite(a)||a<0)return n;const m=Math.floor(a),c=Math.floor(m/60),r=m%60;return c>0?`${c}h ${r}m`:`${r}m`}var Z=B({renderWidget:()=>Q});function b(t,e=!0){return t===!1||t==="false"?!1:t===!0||t==="true"?!0:e}function j(t){return Array.isArray(t)?t[0]||null:Array.isArray(t?.items)?t.items[0]||null:Array.isArray(t?.list)&&t.list[0]||null}function D(...t){return t.flatMap(e=>Array.isArray(e)?e:Array.isArray(e?.items)?e.items:Array.isArray(e?.list)?e.list:[]).filter(Boolean)}function f(t){return String(t||"").trim().toLowerCase()}function E(t){const e=String(t||"").trim();return e&&e.match(/(?:正在(?:玩|游玩)|playing)\s*[:：]\s*(.+)$/i)?.[1]?.trim()||""}function V(t,e){const n=f(e);return n?t.find(s=>f(s?.name)===n)||t.find(s=>{const a=f(s?.name);return a&&(a.includes(n)||n.includes(a))}):null}function N(t){if(t==null||String(t).trim()==="")return"--";const e=Number(t);return Number.isFinite(e)&&e>=0?String(e):"--"}function q(t){const e=String(t||"").trim();return e?e.replace(/["\\\n\r]/g,""):""}function J(t){const e=String(t||"").trim().toLowerCase();return!e||e.includes("离线")||e.includes("offline")}function K({avatar:t,personaName:e}){return t?`<img class="wg-steam-avatar-img" src="${t}" alt="${e}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span class="wg-steam-avatar-fallback icon-[lucide--user]" aria-hidden="true"></span>'}function Q({sources:t,escapeHtml:e,mode:n},s){if(!t.steamAvailable)return'<div class="desktop-widget-empty">未安装 Steam 插件。</div>';const a=s?.meta||{},m=b(a.showStats,!0),c=b(a.showRecentGame,!0),r=t.steamProfile||{},l=t.steamStats||{},g=j(t.steamRecentGames),p=D(t.steamRecentGames,t.steamOwnedGames),i=r.playing===!0,w=e(r.personaName||"Steam Player"),A=e(r.avatarFull||""),T=N(r.steamLevel),v=N(l.totalGames),y=e(O(l.recentPlaytimeFormatted,l.recentPlaytimeMinutes,"--")),C=E(r.statusText),$=r.currentGameName||C,G=V(p,$),h=G||g||p[0]||null,u=e(g?.name||""),L=e($||G?.name||""),P=!i&&J(r.statusText),F=e(i?"正在玩":r.statusText||"离线"),d=i?L||(r.statusText&&r.statusText!=="正在玩"?e(r.statusText):"")||"正在游戏":"",I=i&&c&&u&&u!==d?`<span class="wg-steam-recent-badge">${u}</span>`:"",M=x(h),S=i&&!M?q(r.currentGameImage||_(h)):"",U=S?`<div class="wg-steam-cover" style="--wg-steam-game-bg: url('${e(S)}');" aria-hidden="true"></div>`:"",k=i?"is-playing":P?"is-offline":"is-online",R=m?`
    <div class="wg-steam-stats" aria-label="Steam 统计">
      <span><em>游戏</em><strong title="${e(v)}">${e(v)}</strong></span>
      <span><em>2周</em><strong title="${y}">${y}</strong></span>
    </div>
  `:"",z=W({href:t.steamUrl||"/steam",app:"steam",className:"wg-steam-open",attrs:`aria-label="${e("打开 Steam 页面")}"`,disabled:n==="preview",innerHtml:'<span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>'});return`
    <section class="wg-steam wg-steam--medium ${k}" aria-label="${e(s?.title||"Steam")}">
      <div class="wg-steam-vignette" aria-hidden="true"></div>
      ${U}
      <div class="wg-steam-ornament" aria-hidden="true">
        <span class="icon-[lucide--disc-3]"></span>
        <span class="icon-[lucide--gamepad-2]"></span>
      </div>

      <div class="wg-steam-identity">
        <div class="wg-steam-avatar">
          <span class="wg-steam-avatar-ring" aria-hidden="true"></span>
          ${K({avatar:A,personaName:w})}
        </div>
        <span class="wg-steam-level">LV.${e(T)}</span>
      </div>

      <div class="wg-steam-content">
        <div class="wg-steam-head">
          <div class="wg-steam-titleline">
            <h3>${w}</h3>
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
