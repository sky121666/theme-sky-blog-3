import { formatWidgetDate } from '../../shared/format.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';
import { resolveWidgetCover } from '../../shared/data.js';

export function renderWidget({ sources, escapeHtml, mode }, widget, options = {}) {
  const size = widget?.size || 'medium';

  let limit = 3;
  if (size === 'small') limit = 1;
  else if (size === 'large') limit = 4;

  const posts = sources.latestPosts.slice(0, limit);

  if (!posts.length) {
    return '<div class="desktop-widget-empty">还没有可展示的文章。</div>';
  }

  let inner = '';

  if (size === 'small') {
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const date = escapeHtml(formatWidgetDate(post?.spec?.publishTime) || '');
    const cover = resolveWidgetCover(post?.spec?.cover, sources.fallbackCover);
    const coverMedia = cover
      ? `<img class="wg-news-sm-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`
      : '<div class="wg-news-sm-img is-placeholder"></div>';
    inner = buildWidgetPjaxLink({
      href: escapeHtml(post?.status?.permalink || '#'),
      app: 'reader',
      className: 'wg-news-sm',
      disabled: mode === 'preview',
      innerHtml: `
        ${coverMedia}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${title}</strong>
          <span>${date}</span>
        </div>
      `
    });
  } else if (size === 'medium') {
    const post = posts[0];
    const title = escapeHtml(post?.spec?.title || '未命名文章');
    const cover = resolveWidgetCover(post?.spec?.cover, sources.fallbackCover);
    const coverImg = cover
      ? `<img class="wg-news-md-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />`
      : '<div class="wg-news-md-img is-placeholder"></div>';

    const listPosts = posts.slice(1);
    const listHTML = listPosts.map((p) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const d = escapeHtml(formatWidgetDate(p?.spec?.publishTime) || '');
      return buildWidgetPjaxLink({
        href: escapeHtml(p?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-news-md-row',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-news-md-row-title">${t}</span>
          <span class="wg-news-md-row-date">${d}</span>
        `
      });
    }).join('');

    inner = `
      ${buildWidgetPjaxLink({
        href: escapeHtml(post?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-news-md-cover',
        disabled: mode === 'preview',
        innerHtml: `
          ${coverImg}
          <div class="wg-news-md-cover-scrim"></div>
        `
      })}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">最新发布</span>
          ${buildWidgetPjaxLink({
            href: escapeHtml(post?.status?.permalink || '#'),
            app: 'reader',
            className: 'wg-news-md-title',
            disabled: mode === 'preview',
            innerHtml: title
          })}
        </div>
        <div class="wg-news-md-list">${listHTML}</div>
      </div>
    `;
  } else {
    const heroPost = posts[0];
    const heroTitle = escapeHtml(heroPost?.spec?.title || '未命名文章');
    const heroCover = resolveWidgetCover(heroPost?.spec?.cover, sources.fallbackCover);
    const coverImg = heroCover
      ? `<img class="wg-news-lg-cover-img" src="${escapeHtml(heroCover)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`
      : '<div class="wg-news-lg-cover-img is-placeholder"></div>';

    const listPosts = posts.slice(1);
    const listHTML = listPosts.map((p) => {
      const t = escapeHtml(p?.spec?.title || '未命名文章');
      const d = escapeHtml(formatWidgetDate(p?.spec?.publishTime) || '');
      return buildWidgetPjaxLink({
        href: escapeHtml(p?.status?.permalink || '#'),
        app: 'reader',
        className: 'wg-news-lg-item',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${t}</span>
          <span class="wg-news-lg-item-date">${d}</span>
        `
      });
    }).join('');

    inner = `
      <div class="wg-news-lg-cover">
        ${coverImg}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">最新发布</span>
          <strong>${heroTitle}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${listHTML}
        ${buildWidgetPjaxLink({
          href: escapeHtml(sources.archivesUrl || '/archives'),
          app: 'explorer-archives',
          className: 'wg-news-lg-viewall',
          disabled: mode === 'preview',
          innerHtml: '查看全部文章 →'
        })}
      </div>
    `;
  }

  return `<div class="desktop-widget-news-layout is-${size}">${inner}</div>`;
}
