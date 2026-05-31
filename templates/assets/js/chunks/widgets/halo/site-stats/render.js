import{n as a}from"../latest-posts/render.js?v=0.9.38&r=a82436c5c539";function m({sources:d,escapeHtml:t},e){const s=d.siteStats;if(!s)return'<div class="desktop-widget-empty">站点统计当前不可用。</div>';const v='<span class="icon-[lucide--trending-up]" aria-hidden="true"></span>',o='<span class="icon-[lucide--users]" aria-hidden="true"></span>',g='<span class="icon-[lucide--file-text]" aria-hidden="true"></span>',p='<span class="icon-[lucide--message-circle]" aria-hidden="true"></span>',w='<span class="icon-[lucide--chart-column]" aria-hidden="true"></span>';if(e.size==="medium")return`
      <div class="wg-stat-micro">
        <div class="wg-stat-micro-label">
          <div class="wg-stat-pulse-dot"></div> 总访问量
        </div>
        <div class="wg-stat-micro-value glow-text-emerald">${t(a(s.visit??0))}</div>
      </div>
    `;if(e.size==="large"){const l=s.post??0,r=s.comment??0,n=l+r||1,c=l/n,u=r/n,i=251.3;return`
      <div class="wg-stat-ring">
        <div class="wg-stat-ring-title">内容分布</div>
        <div class="wg-stat-ring-chart-wrap">
          <svg viewBox="0 0 100 100" class="wg-stat-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" class="wg-stat-ring-bg-circle" stroke-width="14"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="14" stroke-dasharray="${i}" stroke-dashoffset="${i*(1-c)}" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#f43f5e" stroke-width="14" stroke-dasharray="${i}" stroke-dashoffset="${i*(1-u)}" stroke-linecap="round" style="transform-origin: center; transform: rotate(${360*c}deg);"/>
          </svg>
          <div class="wg-stat-ring-center">
            <span class="wg-stat-ring-total">${t(a(n))}</span>
          </div>
        </div>
        <div class="wg-stat-ring-legend">
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-blue"></span><span>文章</span></div>
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-rose"></span><span>评论</span></div>
        </div>
      </div>
    `}return e.size==="extra-large"?`
      <div class="wg-stat-hero-solo">
        <div class="wg-stat-hero-solo-bg-icon">${w}</div>
        <div class="wg-stat-hero-solo-top">
          <div class="wg-stat-hero-solo-icon">${o}</div>
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
          <div class="wg-stat-hero-icon">${o}</div>
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
  `}export{m as t};
