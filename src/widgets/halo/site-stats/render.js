import { formatCompactNumber } from '../../shared/format.js';

export function renderWidget({ sources, escapeHtml }, widget) {
  const stats = sources.siteStats;
  if (!stats) {
    return '<div class="desktop-widget-empty">站点统计当前不可用。</div>';
  }

  const svgTrend = `<span class="icon-[lucide--trending-up]" aria-hidden="true"></span>`;
  const svgUsers = `<span class="icon-[lucide--users]" aria-hidden="true"></span>`;
  const svgPosts = `<span class="icon-[lucide--file-text]" aria-hidden="true"></span>`;
  const svgComments = `<span class="icon-[lucide--message-circle]" aria-hidden="true"></span>`;
  const svgChartBar = `<span class="icon-[lucide--chart-column]" aria-hidden="true"></span>`;

  if (widget.size === 'medium') {
    return `
      <div class="wg-stat-micro">
        <div class="wg-stat-micro-label">
          <div class="wg-stat-pulse-dot"></div> 总访问量
        </div>
        <div class="wg-stat-micro-value glow-text-emerald">${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</div>
      </div>
    `;
  }

  if (widget.size === 'large') {
    const postCount = stats.post ?? 0;
    const commentCount = stats.comment ?? 0;
    const total = postCount + commentCount || 1;
    const postPercent = postCount / total;
    const commentPercent = commentCount / total;
    const circumference = 251.3;
    const postOffset = circumference * (1 - postPercent);
    const commentOffset = circumference * (1 - commentPercent);
    const commentRotation = 360 * postPercent;

    return `
      <div class="wg-stat-ring">
        <div class="wg-stat-ring-title">内容分布</div>
        <div class="wg-stat-ring-chart-wrap">
          <svg viewBox="0 0 100 100" class="wg-stat-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" class="wg-stat-ring-bg-circle" stroke-width="14"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="14" stroke-dasharray="${circumference}" stroke-dashoffset="${postOffset}" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#f43f5e" stroke-width="14" stroke-dasharray="${circumference}" stroke-dashoffset="${commentOffset}" stroke-linecap="round" style="transform-origin: center; transform: rotate(${commentRotation}deg);"/>
          </svg>
          <div class="wg-stat-ring-center">
            <span class="wg-stat-ring-total">${escapeHtml(formatCompactNumber(total))}</span>
          </div>
        </div>
        <div class="wg-stat-ring-legend">
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-blue"></span><span>文章</span></div>
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-rose"></span><span>评论</span></div>
        </div>
      </div>
    `;
  }

  if (widget.size === 'extra-large') {
    return `
      <div class="wg-stat-hero-solo">
        <div class="wg-stat-hero-solo-bg-icon">${svgChartBar}</div>
        <div class="wg-stat-hero-solo-top">
          <div class="wg-stat-hero-solo-icon">${svgUsers}</div>
          <span class="wg-stat-hero-solo-badge">All Time</span>
        </div>
        <div class="wg-stat-hero-solo-bottom">
          <h3>总访问量</h3>
          <div class="wg-stat-hero-solo-value glow-text-emerald">${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="wg-stat-hero-list">
      <div class="wg-stat-hero">
        <div class="wg-stat-hero-bg-icon">${svgTrend}</div>
        <div class="wg-stat-hero-head">
          <div class="wg-stat-hero-icon">${svgUsers}</div>
          <span>总访问量</span>
        </div>
        <div class="wg-stat-hero-value glow-text-emerald">${escapeHtml(formatCompactNumber(stats.visit ?? 0))}</div>
      </div>
      <div class="wg-stat-list">
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-blue">${svgPosts}</span><span>文章总数</span></div>
          <span class="wg-stat-list-value">${escapeHtml(formatCompactNumber(stats.post ?? 0))}</span>
        </div>
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-rose">${svgComments}</span><span>评论互动</span></div>
          <span class="wg-stat-list-value">${escapeHtml(formatCompactNumber(stats.comment ?? 0))}</span>
        </div>
      </div>
    </div>
  `;
}
