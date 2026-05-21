import { buildWidgetExternalLink, buildWidgetPjaxLink } from '../../shared/link.js';

const STATUS_LABELS = {
  wish: '想看',
  watching: '在看',
  done: '已看'
};

const STATUS_ORDER = ['watching', 'wish', 'done'];
const TYPE_KEYS = ['anime', 'drama'];

function normalizeMeta(meta = {}) {
  const typeNum = ['1', '2'].includes(String(meta.typeNum || '')) ? String(meta.typeNum) : '';
  const status = ['auto', 'watching', 'wish', 'done'].includes(String(meta.status || ''))
    ? String(meta.status || '')
    : 'auto';
  return { typeNum, status };
}

function normalizePageItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function typeKeysForMeta(typeNum) {
  if (typeNum === '1') return ['anime'];
  if (typeNum === '2') return ['drama'];
  return TYPE_KEYS;
}

function normalizeBangumi(item, status, typeKey) {
  const spec = item?.spec || {};
  const title = String(spec.title || item?.metadata?.name || '追番记录').trim();
  return {
    key: item?.metadata?.name || `${typeKey}-${status}-${title}`,
    title,
    cover: String(spec.cover || '').trim(),
    href: String(spec.url || '').trim(),
    score: spec.score ?? '',
    totalCount: String(spec.totalCount || '').trim(),
    type: String(spec.type || '').trim(),
    area: String(spec.area || '').trim(),
    description: String(spec.des || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    status,
    statusLabel: STATUS_LABELS[status] || '追番',
    typeKey,
    typeLabel: typeKey === 'drama' ? '追剧' : '追番'
  };
}

export function resolveBangumiWidgetItems(sources = {}, meta = {}, limit = 4) {
  const normalized = normalizeMeta(meta);
  const statusKeys = normalized.status === 'auto' ? STATUS_ORDER : [normalized.status];
  const byStatus = sources.bangumisByStatus || {};

  for (const typeKey of typeKeysForMeta(normalized.typeNum)) {
    const typeBucket = byStatus[typeKey] || {};
    for (const status of statusKeys) {
      const items = normalizePageItems(typeBucket[status])
        .map((item) => normalizeBangumi(item, status, typeKey))
        .filter((item) => item.title)
        .slice(0, Math.max(limit, 1));
      if (items.length) {
        return {
          items,
          typeKey,
          status,
          typeLabel: typeKey === 'drama' ? '追剧' : '追番',
          statusLabel: STATUS_LABELS[status] || '追番'
        };
      }
    }
  }

  return {
    items: [],
    typeKey: normalized.typeNum === '2' ? 'drama' : 'anime',
    status: normalized.status === 'auto' ? 'watching' : normalized.status,
    typeLabel: normalized.typeNum === '2' ? '追剧' : '追番',
    statusLabel: STATUS_LABELS[normalized.status] || '在看'
  };
}

function renderCover(item, escapeHtml, className) {
  if (!item.cover) {
    return `
      <span class="${className} is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
    `;
  }
  return `<img class="${className}" src="${escapeHtml(item.cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">`;
}

function renderBangumiLink({ item, className, mode, escapeHtml, innerHtml }) {
  if (!item.href || mode === 'preview') {
    return `<span class="${className}">${innerHtml}</span>`;
  }
  return buildWidgetExternalLink({
    href: escapeHtml(item.href),
    className,
    attrs: `aria-label="${escapeHtml(`打开 ${item.title}`)}"`,
    innerHtml
  });
}

function renderOpenBangumisLink(escapeHtml, mode, label = '打开追番') {
  return buildWidgetPjaxLink({
    href: '/bangumis',
    app: 'bangumis',
    className: 'wg-bangumis-open',
    disabled: mode === 'preview',
    innerHtml: `
      <span>${escapeHtml(label)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `
  });
}

function renderEmpty({ escapeHtml, mode, installed }) {
  return `
    <div class="wg-bangumis wg-bangumis--empty">
      <span class="wg-bangumis-empty-icon">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <strong>${installed ? '还没有追番记录' : '未安装追番插件'}</strong>
      <p>${installed ? '记录公开追番追剧后会在这里显示。' : '安装 Bilibili 追番插件后可添加小组件。'}</p>
      ${installed ? renderOpenBangumisLink(escapeHtml, mode, '去看看') : ''}
    </div>
  `;
}

function renderSmall({ item, escapeHtml, mode }) {
  return renderBangumiLink({
    item,
    mode,
    escapeHtml,
    className: 'wg-bangumis wg-bangumis--small',
    innerHtml: `
      ${renderCover(item, escapeHtml, 'wg-bangumis-small-cover')}
      <span class="wg-bangumis-scrim"></span>
      <span class="wg-bangumis-small-copy">
        <span class="wg-bangumis-status is-${item.status}">${escapeHtml(item.statusLabel)}</span>
        <strong>${escapeHtml(item.title)}</strong>
      </span>
    `
  });
}

function renderMedium({ items, summary, counts, escapeHtml, mode }) {
  const featured = items[0];
  const rest = items.slice(1, 2);
  return `
    <div class="wg-bangumis wg-bangumis--medium">
      <div class="wg-bangumis-meter">
        <span class="wg-bangumis-kicker">${escapeHtml(summary.typeLabel)}</span>
        <strong>${escapeHtml(summary.statusLabel)}</strong>
        <span>${escapeHtml(`${counts.watching || 0} 在看 · ${counts.wish || 0} 想看 · ${counts.done || 0} 已看`)}</span>
      </div>
      ${renderBangumiLink({
        item: featured,
        mode,
        escapeHtml,
        className: 'wg-bangumis-feature',
        innerHtml: `
          ${renderCover(featured, escapeHtml, 'wg-bangumis-feature-cover')}
          <span class="wg-bangumis-feature-copy">
            <span class="wg-bangumis-status is-${featured.status}">${escapeHtml(featured.statusLabel)}</span>
            <strong>${escapeHtml(featured.title)}</strong>
            <span>${escapeHtml(featured.totalCount || featured.type || featured.area || '打开继续查看')}</span>
          </span>
        `
      })}
      ${rest.map((item) => renderBangumiLink({
        item,
        mode,
        escapeHtml,
        className: 'wg-bangumis-row',
        innerHtml: `
          ${renderCover(item, escapeHtml, 'wg-bangumis-row-cover')}
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            <em>${escapeHtml(item.statusLabel)}</em>
          </span>
        `
      })).join('')}
    </div>
  `;
}

function renderLarge({ items, summary, counts, escapeHtml, mode }) {
  return `
    <div class="wg-bangumis wg-bangumis--large">
      <header class="wg-bangumis-head">
        <span>
          <em>${escapeHtml(summary.typeLabel)}</em>
          <strong>${escapeHtml(summary.statusLabel)}</strong>
        </span>
        ${renderOpenBangumisLink(escapeHtml, mode, '全部')}
      </header>
      <div class="wg-bangumis-segments" aria-label="${escapeHtml('追番状态统计')}">
        <span><b>${escapeHtml(String(counts.watching || 0))}</b><em>在看</em></span>
        <span><b>${escapeHtml(String(counts.wish || 0))}</b><em>想看</em></span>
        <span><b>${escapeHtml(String(counts.done || 0))}</b><em>已看</em></span>
      </div>
      <div class="wg-bangumis-grid">
        ${items.slice(0, 4).map((item) => renderBangumiLink({
          item,
          mode,
          escapeHtml,
          className: 'wg-bangumis-tile',
          innerHtml: `
            ${renderCover(item, escapeHtml, 'wg-bangumis-tile-cover')}
            <span class="wg-bangumis-tile-copy">
              <strong>${escapeHtml(item.title)}</strong>
              <em>${escapeHtml(item.score ? `${item.score} 分` : item.statusLabel)}</em>
            </span>
          `
        })).join('')}
      </div>
    </div>
  `;
}

function resolveCounts(sources, typeKey) {
  const counts = sources.bangumiStatusCounts || {};
  const bucket = counts[typeKey] || counts.anime || {};
  return {
    wish: Number(bucket.wish || 0) || 0,
    watching: Number(bucket.watching || 0) || 0,
    done: Number(bucket.done || 0) || 0
  };
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  if (!sources.bangumisAvailable) {
    return renderEmpty({ escapeHtml, mode, installed: false });
  }

  const size = widget?.size || 'medium';
  const limit = size === 'large' ? 4 : 2;
  const summary = resolveBangumiWidgetItems(sources, widget?.meta || {}, limit);
  const counts = resolveCounts(sources, summary.typeKey);

  if (!summary.items.length) {
    return renderEmpty({ escapeHtml, mode, installed: true });
  }

  if (size === 'small') {
    return renderSmall({ item: summary.items[0], escapeHtml, mode });
  }

  if (size === 'large') {
    return renderLarge({ items: summary.items, summary, counts, escapeHtml, mode });
  }

  return renderMedium({ items: summary.items, summary, counts, escapeHtml, mode });
}
