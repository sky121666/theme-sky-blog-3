export function renderRecentMomentsWidget({ sources, escapeHtml, normalizeMomentRecord }, widget, options = {}) {
  if (!sources.momentsAvailable) {
    return '<div class="desktop-widget-empty">未安装 Moments 插件。</div>';
  }

  const moments = sources.recentMoments
    .slice(0, widget?.size === 'large' ? 3 : 1)
    .map((moment) => normalizeMomentRecord(moment));
  const isPreview = options.preview === true;

  if (!moments.length) {
    return '<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';
  }

  const compact = widget?.size !== 'large';

  if (compact) {
    const featured = moments[0];
    if (isPreview) {
      return `
        <div class="desktop-widget-preview-skin desktop-widget-preview-skin--moment is-compact">
          <div class="desktop-widget-preview-moment-head">
            <span class="desktop-widget-preview-moment-kicker">瞬间</span>
            <span class="desktop-widget-preview-moment-chip">${escapeHtml(featured.rowBadge)}</span>
          </div>
          <div class="desktop-widget-preview-moment-compact-copy">
            <strong>${escapeHtml(featured.title)}</strong>
            <span>${escapeHtml(featured.summary || featured.listTime)}</span>
            <span>${escapeHtml(featured.listTime)}</span>
          </div>
        </div>
      `;
    }

    return `
      <a class="desktop-widget-moment-live pjax-link is-compact" href="${escapeHtml(featured.permalink)}">
        <span class="desktop-widget-moment-live-kicker">瞬间</span>
        <strong class="desktop-widget-moment-live-title">${escapeHtml(featured.title)}</strong>
        <span class="desktop-widget-moment-live-deck">${escapeHtml(featured.summary || featured.rowBadge)}</span>
        <span class="desktop-widget-moment-live-meta">${escapeHtml(featured.listTime)}</span>
        <span class="desktop-widget-moment-live-foot">${escapeHtml(featured.rowBadge)}</span>
      </a>
    `;
  }

  const [featured, ...rest] = moments;
  const list = rest.slice(0, widget?.size === 'large' ? 2 : 1);
  const featuredMedium = featured?.media?.[0];
  const cover = featuredMedium?.type === 'PHOTO'
    ? `<img class="desktop-widget-moment-cover-image" src="${escapeHtml(featuredMedium.url)}" alt="">`
    : `<div class="desktop-widget-moment-cover-fallback">${escapeHtml(featured.mediaCount > 0 ? `${featured.mediaCount} 项媒体` : featured.summary)}</div>`;

  if (isPreview) {
    const previewCover = featuredMedium?.type === 'PHOTO'
      ? `<img class="desktop-widget-preview-moment-cover-image" src="${escapeHtml(featuredMedium.url)}" alt="">`
      : `<div class="desktop-widget-preview-moment-cover-fallback">${escapeHtml(featured.mediaCount > 0 ? `${featured.mediaCount} 项媒体` : featured.summary)}</div>`;
    return `
      <div class="desktop-widget-preview-skin desktop-widget-preview-skin--moment is-large">
        <div class="desktop-widget-preview-moment-cover">
          ${previewCover}
          ${featured.mediaCount > 0 ? `<span class="desktop-widget-preview-moment-chip is-overlay">${escapeHtml(`${featured.mediaCount} 项媒体`)}</span>` : ''}
        </div>
        <div class="desktop-widget-preview-moment-copy">
          <span class="desktop-widget-preview-moment-kicker">瞬间</span>
          <strong>${escapeHtml(featured.title)}</strong>
          <span class="desktop-widget-preview-moment-summary">${escapeHtml(featured.summary)}</span>
          <span class="desktop-widget-preview-moment-meta">${escapeHtml(`${featured.listTime} · ${featured.rowBadge}`)}</span>
        </div>
        <div class="desktop-widget-preview-moment-list">
          ${list.map((moment) => `
            <span class="desktop-widget-preview-moment-row">
              <span>${escapeHtml(moment.title)}</span>
              <em>${escapeHtml(moment.rowBadge)}</em>
            </span>
          `).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="desktop-widget-moment-diary">
      <a class="desktop-widget-moment-diary-hero pjax-link" href="${escapeHtml(featured.permalink)}">
        <div class="desktop-widget-moment-diary-cover">
          ${cover}
          ${featured.mediaCount > 0 ? `<span class="desktop-widget-moment-cover-badge">${escapeHtml(`${featured.mediaCount} 项媒体`)}</span>` : ''}
        </div>
        <div class="desktop-widget-moment-diary-copy">
          <span class="desktop-widget-moment-diary-kicker">瞬间</span>
          <span class="desktop-widget-moment-diary-title">${escapeHtml(featured.title)}</span>
          <span class="desktop-widget-moment-diary-summary">${escapeHtml(featured.summary)}</span>
          <span class="desktop-widget-moment-diary-meta">${escapeHtml(`${featured.listTime} · ${featured.rowBadge}`)}</span>
        </div>
      </a>
      ${list.length ? `
        <div class="desktop-widget-moment-diary-trail">
          ${list.map((moment) => `
            <a class="desktop-widget-moment-diary-row pjax-link" href="${escapeHtml(moment.permalink)}">
              <span class="desktop-widget-moment-diary-row-copy">
                <span class="desktop-widget-moment-diary-row-title">${escapeHtml(moment.title)}</span>
                <span class="desktop-widget-moment-diary-row-meta">${escapeHtml(moment.listTime)}</span>
              </span>
              <span class="desktop-widget-moment-diary-row-badge">${escapeHtml(moment.rowBadge)}</span>
            </a>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}
