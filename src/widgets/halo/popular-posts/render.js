import { formatCompactNumber } from '../../shared/format.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';
import { resolveWidgetCover } from '../../shared/data.js';

export function renderWidget({ sources, escapeHtml, mode }, widget, options = {}) {
  const isCompact = options.compact === true;
  const size = widget?.size || 'medium';

  let limit = 3;
  if (size === 'small') limit = 1;
  else if (size === 'large') limit = isCompact ? 4 : 5;

  const posts = sources.popularPosts.slice(0, limit);

  if (!posts.length) {
    return '<div class="desktop-widget-empty">热门文章暂时为空。</div>';
  }

  const maxVisit = Math.max(...posts.map((p) => p?.stats?.visit ?? 0), 1);
  let inner = '';

  if (size === 'small') {
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const visit = post?.stats?.visit ?? 0;
    const cover = resolveWidgetCover(post?.spec?.cover, sources.fallbackCover);
    const coverStyle = cover ? `style="background-image:url('${escapeHtml(cover)}')"` : '';
    const fallbackCls = cover ? '' : ' is-no-cover';

    inner = buildWidgetPjaxLink({
      href: escapeHtml(post?.status?.permalink || '#'),
      app: 'reader',
      className: `wg-hot-sm${fallbackCls}`,
      attrs: coverStyle,
      disabled: mode === 'preview',
      innerHtml: `
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <span class="icon-[lucide--flame]" aria-hidden="true"></span>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${title}</h3>
          <span class="wg-hot-sm-visits">${escapeHtml(formatCompactNumber(visit))} 阅读</span>
        </div>
      `
    });
  } else if (size === 'medium') {
    const rowsHTML = posts.map((post, i) => {
      const t = escapeHtml(post?.spec?.title || '未命名文章');
      const visit = post?.stats?.visit ?? 0;
      const heatPct = Math.round((visit / maxVisit) * 100);
      return buildWidgetPjaxLink({
        href: escapeHtml(post?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-hot-md-row',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-hot-md-rank${i < 3 ? ' is-top' : ''}">${String(i + 1).padStart(2, '0')}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${t}</span>
            <div class="wg-hot-md-bar"><span style="width:${heatPct}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${escapeHtml(formatCompactNumber(visit))}</span>
        `
      });
    }).join('');

    inner = `
      <div class="wg-hot-md-head">
        <span class="wg-hot-md-icon icon-[lucide--flame]" aria-hidden="true"></span>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${rowsHTML}</div>
    `;
  } else {
    const heroPost = posts[0];
    const heroTitle = escapeHtml(heroPost?.spec?.title || '未命名文章');
    const heroCover = resolveWidgetCover(heroPost?.spec?.cover, sources.fallbackCover);
    const heroVisit = heroPost?.stats?.visit ?? 0;
    const coverImg = heroCover
      ? `<img class="wg-hot-lg-cover-img" src="${escapeHtml(heroCover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`
      : '<div class="wg-hot-lg-cover-img is-placeholder"></div>';

    const listHTML = posts.slice(1).map((p, i) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const visit = p?.stats?.visit ?? 0;
      const heatPct = Math.round((visit / maxVisit) * 100);
      return buildWidgetPjaxLink({
        href: escapeHtml(p?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-hot-lg-row',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-hot-lg-rank${i < 2 ? ' is-top' : ''}">${String(i + 2).padStart(2, '0')}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${t}</span>
            <div class="wg-hot-lg-bar"><span style="width:${heatPct}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${escapeHtml(formatCompactNumber(visit))}</span>
        `
      });
    }).join('');

    inner = `
      <div class="wg-hot-lg-hero">
        ${buildWidgetPjaxLink({
          href: escapeHtml(heroPost?.status?.permalink || '#'),
          app: 'reader',
          className: 'wg-hot-lg-cover',
          disabled: mode === 'preview',
          innerHtml: `
            ${coverImg}
            <div class="wg-hot-lg-cover-scrim"></div>
            <div class="wg-hot-lg-cover-text">
              <span class="wg-hot-lg-badge">
                <span class="icon-[lucide--flame]" aria-hidden="true"></span>
                TOP 1
              </span>
              <strong>${heroTitle}</strong>
              <span class="wg-hot-lg-hero-visits">${escapeHtml(formatCompactNumber(heroVisit))} 阅读</span>
            </div>
          `
        })}
      </div>
      <div class="wg-hot-lg-list">${listHTML}</div>
    `;
  }

  const cls = `wg-hot-wrap wg-hot-wrap--${size}${isCompact ? ' is-compact' : ''}`;
  return `<div class="${cls}">${inner}</div>`;
}
