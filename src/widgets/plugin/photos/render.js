import { buildWidgetPjaxLink } from '../../shared/link.js';

/**
 * Photos Widget Renderer
 *
 * 顶部胶囊 = 固定"图库"分类标识 + annotation icon（若有）
 * 底部     = 分组名（大）+ description 或张数（小）
 * → 两处不重复，参考 macOS Photos 案例排版
 */

/** 默认相册图标（无 annotation icon 时的 fallback） */
const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  const size = widget?.size || 'small';

  if (!sources.photosAvailable) {
    return '<div class="desktop-widget-empty">未安装图库插件。</div>';
  }

  const allPhotos = Array.isArray(sources.photos) ? sources.photos : [];
  const groups = Array.isArray(sources.photoGroups) ? sources.photoGroups : [];

  const groupName = widget?.meta?.groupName || '';
  const photos = groupName
    ? allPhotos.filter((p) => p?.spec?.groupName === groupName)
    : allPhotos;

  if (!photos.length) {
    return '<div class="desktop-widget-empty">还没有可展示的照片。</div>';
  }

  const photosUrl = escapeHtml(sources.photosUrl || '/photos');

  // ─── 分组数据 ─────────────────────────────────────────
  // 提前解析当前 active group，避免每次 getLabel/getDesc/getIcon 重复 find()
  const activeGroup = groupName
    ? (groups.find((g) => g?.metadata?.name === groupName) || null)
    : null;

  const resolveGroup = (photo) => {
    if (activeGroup) return activeGroup;
    const gName = photo?.spec?.groupName;
    return gName ? (groups.find((g) => g?.metadata?.name === gName) || null) : null;
  };

  const getLabel = (photo) => {
    const g = resolveGroup(photo);
    return escapeHtml(g?.spec?.displayName || g?.metadata?.name || groupName || '图库');
  };

  const getDesc = (photo) => {
    const g = resolveGroup(photo);
    // annotation key = formSchema 的 name 字段: 'description'
    return escapeHtml((g?.metadata?.annotations?.['description'] || '').trim());
  };

  /** 取 annotation icon，无则用 fallback */
  const getIcon = (photo) => {
    const g = resolveGroup(photo);
    // annotation key = formSchema 的 name 字段: 'icon'
    return (g?.metadata?.annotations?.['icon'] || '').trim() || FALLBACK_SVG;
  };

  // ─── 工具 ─────────────────────────────────────────────
  const src = (photo) => escapeHtml(photo?.spec?.url || '');
  const alt = (photo) => escapeHtml(photo?.spec?.displayName || '');
  const renderImg = (photo, cls) => {
    const s = src(photo);
    return s
      ? `<img class="${cls}" src="${s}" alt="${alt(photo)}" loading="lazy" decoding="async" fetchpriority="low">`
      : `<div class="${cls} is-placeholder"></div>`;
  };

  /**
   * 顶部胶囊：icon + 分组名（分类标识，非说明）
   * 底部大字用 description
   */
  const topBadge = (photo, cls) => {
    const icon = getIcon(photo);
    const name = getLabel(photo);  // 分组显示名
    return `
      <div class="${cls}">
        <span class="wg-photos-badge-icon">${icon}</span>
        <span class="wg-photos-badge-label">${name}</span>
      </div>`;
  };

  // ══════════════════════════════════════════════════════
  // SMALL (2×2) — 顶部：[icon] 分组名   底部：说明/分组名 + 张数
  // ══════════════════════════════════════════════════════
  if (size === 'small') {
    const photo = photos[0];
    const desc = getDesc(photo);
    const label = getLabel(photo);
    const count = photos.length;

    return buildWidgetPjaxLink({
      href: photosUrl,
      app: '',
      className: 'wg-photos-sm',
      disabled: mode === 'preview',
      innerHtml: `
        ${renderImg(photo, 'wg-photos-sm-img')}
        <div class="wg-photos-sm-scrim"></div>
        <div class="wg-photos-sm-top">
          ${topBadge(photo, 'wg-photos-sm-badge')}
        </div>
        <div class="wg-photos-sm-bottom">
          <strong>${desc || label}</strong>
          <span>${count}\u2009张照片</span>
        </div>
      `
    });
  }

  // ══════════════════════════════════════════════════════
  // MEDIUM (4×2) — 右上：[icon] 分组名   底部：说明(大) + 张数
  // ══════════════════════════════════════════════════════
  if (size === 'medium') {
    const hero = photos[0];
    const label = getLabel(hero);
    const desc = getDesc(hero);
    const count = photos.length;

    return buildWidgetPjaxLink({
      href: photosUrl,
      app: '',
      className: 'wg-photos-md',
      disabled: mode === 'preview',
      innerHtml: `
        ${renderImg(hero, 'wg-photos-md-img')}
        <div class="wg-photos-md-scrim"></div>
        ${topBadge(hero, 'wg-photos-md-badge')}
        <div class="wg-photos-md-bottom">
          <strong class="wg-photos-md-title">${desc || label}</strong>
          <span class="wg-photos-md-sub">${count}\u2009张照片</span>
        </div>
      `
    });
  }

  // ══════════════════════════════════════════════════════
  // LARGE (4×4) — 左上：[icon框] 分组名   底部：说明(大) + 张数 + 缩略行
  // ══════════════════════════════════════════════════════
  const hero = photos[0];
  const label = getLabel(hero);
  const desc = getDesc(hero);
  const count = photos.length;
  const thumbPhotos = photos.slice(1, 4);
  const extraCount = Math.max(0, photos.length - 4);

  const thumbsHtml = thumbPhotos.map((p) => `
    <div class="wg-photos-lg-thumb">${renderImg(p, 'wg-photos-lg-thumb-img')}</div>
  `).join('');

  const moreHtml = extraCount > 0
    ? `<div class="wg-photos-lg-thumb is-more"><span>+${extraCount}</span></div>`
    : '';


  return `
    <div class="wg-photos-lg">
      ${renderImg(hero, 'wg-photos-lg-bg')}
      <div class="wg-photos-lg-scrim"></div>
      <div class="wg-photos-lg-top">
        <div class="wg-photos-lg-icon-box">${getIcon(hero)}</div>
        <span class="wg-photos-lg-kicker">${label}</span>
      </div>
      <div class="wg-photos-lg-bottom">
        <h3 class="wg-photos-lg-title">${desc || label}</h3>
        <p class="wg-photos-lg-desc">${count}\u2009张照片</p>
        <div class="wg-photos-lg-thumbs">
          ${thumbsHtml}${moreHtml}
        </div>
      </div>
    </div>
  `;
}
