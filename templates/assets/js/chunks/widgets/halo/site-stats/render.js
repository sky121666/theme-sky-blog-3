import{n as a}from"../latest-posts/render.js";function k({sources:c,escapeHtml:t},i){const s=c.siteStats;if(!s)return'<div class="desktop-widget-empty">站点统计当前不可用。</div>';const v='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',r='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',g='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',p='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',w='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>';if(i.size==="medium")return`
      <div class="wg-stat-micro">
        <div class="wg-stat-micro-label">
          <div class="wg-stat-pulse-dot"></div> 总访问量
        </div>
        <div class="wg-stat-micro-value glow-text-emerald">${t(a(s.visit??0))}</div>
      </div>
    `;if(i.size==="large"){const n=s.post??0,l=s.comment??0,e=n+l||1,d=n/e,h=l/e,o=251.3;return`
      <div class="wg-stat-ring">
        <div class="wg-stat-ring-title">内容分布</div>
        <div class="wg-stat-ring-chart-wrap">
          <svg viewBox="0 0 100 100" class="wg-stat-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" class="wg-stat-ring-bg-circle" stroke-width="14"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="14" stroke-dasharray="${o}" stroke-dashoffset="${o*(1-d)}" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#f43f5e" stroke-width="14" stroke-dasharray="${o}" stroke-dashoffset="${o*(1-h)}" stroke-linecap="round" style="transform-origin: center; transform: rotate(${360*d}deg);"/>
          </svg>
          <div class="wg-stat-ring-center">
            <span class="wg-stat-ring-total">${t(a(e))}</span>
          </div>
        </div>
        <div class="wg-stat-ring-legend">
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-blue"></span><span>文章</span></div>
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-rose"></span><span>评论</span></div>
        </div>
      </div>
    `}return i.size==="extra-large"?`
      <div class="wg-stat-hero-solo">
        <div class="wg-stat-hero-solo-bg-icon">${w}</div>
        <div class="wg-stat-hero-solo-top">
          <div class="wg-stat-hero-solo-icon">${r}</div>
          <span class="wg-stat-hero-solo-badge">All Time</span>
        </div>
        <div class="wg-stat-hero-solo-bottom">
          <h3>总访问量</h3>
          <div class="wg-stat-hero-solo-value glow-text-emerald">${t(a(s.visit??0))}</div>
        </div>
      </div>
    `:`
    <div class="wg-stat-hero-list">
      <div class="wg-stat-hero">
        <div class="wg-stat-hero-bg-icon">${v}</div>
        <div class="wg-stat-hero-head">
          <div class="wg-stat-hero-icon">${r}</div>
          <span>总访问量</span>
        </div>
        <div class="wg-stat-hero-value glow-text-emerald">${t(a(s.visit??0))}</div>
      </div>
      <div class="wg-stat-list">
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-blue">${g}</span><span>文章总数</span></div>
          <span class="wg-stat-list-value">${t(a(s.post??0))}</span>
        </div>
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-rose">${p}</span><span>评论互动</span></div>
          <span class="wg-stat-list-value">${t(a(s.comment??0))}</span>
        </div>
      </div>
    </div>
  `}export{k as t};
