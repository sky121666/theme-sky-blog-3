import { buildWidgetExternalLink, buildWidgetPjaxLink } from '../../shared/link.js';

const STATUS_LABELS = {
  wish: '想看',
  watching: '在看',
  done: '已看'
};

const STATUS_ORDER = ['watching', 'wish', 'done'];
const TYPE_KEYS = ['anime', 'drama'];

function bangumiToneClass(typeKey, status) {
  return `is-${typeKey === 'drama' ? 'drama' : 'anime'} is-${status || 'watching'}`;
}

function normalizeScore(value) {
  const score = String(value ?? '').trim().replace(/分$/, '').trim();
  if (!score || score === '0' || score === '0.0') return '';
  return score;
}

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
  const explicitProgress = Number(spec.progress ?? spec.progressPercent ?? spec.currentProgress ?? 0);
  return {
    key: item?.metadata?.name || `${typeKey}-${status}-${title}`,
    title,
    cover: String(spec.cover || '').trim(),
    href: String(spec.url || '').trim(),
    score: normalizeScore(spec.score),
    totalCount: String(spec.totalCount || '').trim(),
    type: String(spec.type || '').trim(),
    area: String(spec.area || '').trim(),
    description: String(spec.des || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    progress: Number.isFinite(explicitProgress) ? explicitProgress : 0,
    status,
    statusLabel: STATUS_LABELS[status] || '追番',
    typeKey,
    typeLabel: typeKey === 'drama' ? '追剧' : '追番',
    toneClass: bangumiToneClass(typeKey, status)
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

function collectBangumiItemsByStatus(sources = {}, typeKey = 'anime', limit = 4) {
  const typeBucket = sources.bangumisByStatus?.[typeKey] || {};
  const byStatus = {
    watching: normalizePageItems(typeBucket.watching)
      .map((item) => normalizeBangumi(item, 'watching', typeKey))
      .filter((item) => item.title),
    wish: normalizePageItems(typeBucket.wish)
      .map((item) => normalizeBangumi(item, 'wish', typeKey))
      .filter((item) => item.title),
    done: normalizePageItems(typeBucket.done)
      .map((item) => normalizeBangumi(item, 'done', typeKey))
      .filter((item) => item.title)
  };
  const all = STATUS_ORDER.flatMap((status) => byStatus[status]).slice(0, Math.max(limit, 1));
  return {
    all,
    watching: byStatus.watching.slice(0, Math.max(limit, 1)),
    wish: byStatus.wish.slice(0, Math.max(limit, 1))
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

function renderRatingStars(score, escapeHtml) {
  const numericScore = Number(String(score || '').replace(/[^\d.]+/g, ''));
  const filledCount = numericScore > 0 ? Math.max(0, Math.min(5, Math.round(numericScore / 2))) : 0;
  const stars = Array.from({ length: 5 }, (_, index) => `
    <i class="${index < filledCount ? 'is-filled' : ''}" aria-hidden="true">${index < filledCount ? '★' : '☆'}</i>
  `).join('');

  return `
    <span class="wg-bangumis-stage-stars" aria-label="${escapeHtml(score ? `评分 ${score}` : '暂无评分')}">
      ${stars}
    </span>
  `;
}

function renderEmpty({ escapeHtml, mode, installed }) {
  return `
    <div class="wg-bangumis wg-bangumis--empty is-anime is-watching">
      <span class="wg-bangumis-empty-icon">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <strong>${installed ? '还没有追番记录' : '未安装追番插件'}</strong>
      <p>${installed ? '记录公开追番追剧后会在这里显示。' : '安装 Bilibili 追番插件后可添加小组件。'}</p>
      ${installed ? renderOpenBangumisLink(escapeHtml, mode, '去看看') : ''}
    </div>
  `;
}

function episodeProgress(item) {
  if (item.status !== 'watching') return 0;
  if (item.progress > 0) return Math.max(1, Math.min(100, Math.round(item.progress)));
  return 36;
}

function readableProgressCount(item) {
  return '追看中';
}

function stageProgress(item) {
  if (!item) return { value: 0, label: '暂无进度', state: 'idle' };
  if (item.status === 'done') {
    return { value: 100, label: '已完成', state: 'success' };
  }
  if (item.status === 'wish') {
    return { value: 0, label: '待开播', state: 'pending' };
  }

  const progress = episodeProgress(item);
  return {
    value: progress,
    label: `进度 ${readableProgressCount(item)}`,
    state: progress >= 100 ? 'success' : 'active'
  };
}

function renderProgress(item, escapeHtml, compact = false) {
  const progress = episodeProgress(item);
  if (!progress) {
    return `<span class="wg-bangumis-meta-line">${escapeHtml(item.totalCount || item.type || item.area || item.statusLabel)}</span>`;
  }

  return `
    <span class="wg-bangumis-progress" aria-label="${escapeHtml(`观看进度 ${progress}%`)}">
      <span class="wg-bangumis-progress-copy">
        <span>${escapeHtml(compact ? readableProgressCount(item) : `进度 ${readableProgressCount(item)}`)}</span>
        <b>${escapeHtml(String(progress))}%</b>
      </span>
      <span class="wg-bangumis-progress-track">
        <span class="wg-bangumis-progress-fill" style="width:${progress}%"></span>
      </span>
    </span>
  `;
}

function renderSmall({ item, escapeHtml, mode }) {
  return renderBangumiLink({
    item,
    mode,
    escapeHtml,
    className: `wg-bangumis wg-bangumis--small ${item.toneClass}`,
    innerHtml: `
      ${renderCover(item, escapeHtml, 'wg-bangumis-small-cover')}
      <span class="wg-bangumis-scrim"></span>
      <span class="wg-bangumis-small-type">
        <span class="icon-[lucide--${item.typeKey === 'drama' ? 'tv' : 'sparkles'}]" aria-hidden="true"></span>
        <span>${escapeHtml(item.typeLabel)}</span>
      </span>
      <span class="wg-bangumis-small-copy">
        <span class="wg-bangumis-status">${escapeHtml(item.statusLabel)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        ${renderProgress(item, escapeHtml, true)}
      </span>
    `
  });
}

function renderMedium({ items, summary, counts, escapeHtml, mode }) {
  const featured = items[0];
  return `
    <div class="wg-bangumis wg-bangumis--medium ${bangumiToneClass(summary.typeKey, summary.status)}">
      ${renderBangumiLink({
        item: featured,
        mode,
        escapeHtml,
        className: `wg-bangumis-medium-cover-link ${featured.toneClass}`,
        innerHtml: `
          ${renderCover(featured, escapeHtml, 'wg-bangumis-medium-cover')}
        `
      })}
      <div class="wg-bangumis-medium-copy">
        <div class="wg-bangumis-medium-top">
          <span class="wg-bangumis-status">${escapeHtml(`${featured.statusLabel} · ${featured.typeLabel}`)}</span>
          <span class="wg-bangumis-sync">
            <span class="icon-[lucide--refresh-cw]" aria-hidden="true"></span>
            ${escapeHtml(`${counts.watching || 0} 在看`)}
          </span>
        </div>
        <div class="wg-bangumis-medium-title">
          <strong>${escapeHtml(featured.title)}</strong>
          <span>${escapeHtml(featured.description || `${featured.type || featured.area || summary.typeLabel} · ${featured.totalCount || featured.statusLabel}`)}</span>
        </div>
        ${renderProgress(featured, escapeHtml)}
      </div>
    </div>
  `;
}

function renderLargeQueueItem(item, escapeHtml, mode) {
  const episodeText = item.totalCount || item.area || item.typeLabel;
  return renderBangumiLink({
    item,
    mode,
    escapeHtml,
    className: `wg-bangumis-queue-item ${item.toneClass}`,
    innerHtml: `
      ${renderCover(item, escapeHtml, 'wg-bangumis-queue-cover')}
      <span class="wg-bangumis-queue-copy">
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <em>${escapeHtml(episodeText)}</em>
        </span>
        <span class="wg-bangumis-queue-foot">
          <span class="wg-bangumis-queue-bars" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
          <b>${escapeHtml(item.statusLabel)}</b>
        </span>
      </span>
      <span class="wg-bangumis-queue-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    `
  });
}

function renderLargeQueuePlaceholder(index, escapeHtml, label = '待看空槽') {
  return `
    <span class="wg-bangumis-queue-item is-placeholder" aria-hidden="true">
      <span class="wg-bangumis-queue-cover is-placeholder">
        <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
      </span>
      <span class="wg-bangumis-queue-copy">
        <span>
          <strong>${escapeHtml(label)}</strong>
          <em>Slot ${index}</em>
        </span>
      </span>
    </span>
  `;
}

function renderLargePanel({ items, emptyLabel, escapeHtml, mode }) {
  if (!items.length) {
    return `
      <section class="wg-bangumis-tab-panel">
        <div class="wg-bangumis-large-empty">
          <span class="icon-[lucide--tv-minimal]" aria-hidden="true"></span>
          <strong>${escapeHtml(emptyLabel)}</strong>
        </div>
        <div class="wg-bangumis-queue">
          ${Array.from({ length: 3 }, (_, index) => renderLargeQueuePlaceholder(index + 1, escapeHtml, emptyLabel)).join('')}
        </div>
      </section>
    `;
  }

  const featured = items[0];
  const queue = items.slice(1, 4);
  const progress = stageProgress(featured);
  const queueHtml = [
    ...queue.map((item) => renderLargeQueueItem(item, escapeHtml, mode)),
    ...Array.from({ length: Math.max(0, 3 - queue.length) }, (_, index) => renderLargeQueuePlaceholder(queue.length + index + 1, escapeHtml))
  ].join('');

  return `
    <section class="wg-bangumis-tab-panel">
      ${renderBangumiLink({
        item: featured,
        mode,
        escapeHtml,
        className: `wg-bangumis-stage ${featured.toneClass}`,
        innerHtml: `
          <span class="wg-bangumis-stage-cover-wrap">
            ${renderCover(featured, escapeHtml, 'wg-bangumis-stage-cover')}
            <span class="wg-bangumis-stage-corner wg-bangumis-stage-corner--tl"></span>
            <span class="wg-bangumis-stage-corner wg-bangumis-stage-corner--br"></span>
            <span class="wg-bangumis-stage-rec">
              <span>REC</span>
            </span>
            <span class="wg-bangumis-stage-progress is-${progress.state}">
              <span class="wg-bangumis-stage-progress-copy">
                <span>${escapeHtml(progress.label)}</span>
                <b>${escapeHtml(String(progress.value))}%</b>
              </span>
              <span class="wg-bangumis-stage-progress-track">
                <span style="width:${progress.value}%"></span>
              </span>
            </span>
          </span>
          <span class="wg-bangumis-stage-copy">
            <strong>${escapeHtml(featured.title)}</strong>
            <span class="wg-bangumis-stage-rating">
              ${renderRatingStars(featured.score, escapeHtml)}
              <em>${escapeHtml(featured.score || '暂无评分')}</em>
            </span>
          </span>
        `
      })}
      <div class="wg-bangumis-queue">
        ${queueHtml}
      </div>
    </section>
  `;
}

function renderLarge({ groups, summary, counts, escapeHtml, mode }) {
  const total = Math.max((counts.watching || 0) + (counts.wish || 0) + (counts.done || 0), groups.all.length);
  const radioName = `wg-bangumis-tabs-${summary.typeKey}-${summary.status}`;

  return `
    <div class="wg-bangumis wg-bangumis--large ${bangumiToneClass(summary.typeKey, summary.status)}">
      <header class="wg-bangumis-console-head">
        <span class="wg-bangumis-console-title">
          <span class="wg-bangumis-console-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>番剧雷达中心</span>
        </span>
        <span class="wg-bangumis-console-version">v1.15.0</span>
      </header>
      <form class="wg-bangumis-tab-form">
        <div class="wg-bangumis-tabs" aria-label="${escapeHtml('追番状态筛选')}">
          <label class="is-all">
            <input class="wg-bangumis-tab-radio is-all" name="${radioName}" type="radio" checked>
            <i></i>
            <b>${escapeHtml(`全部 (${total})`)}</b>
          </label>
          <label class="is-watching">
            <input class="wg-bangumis-tab-radio is-watching" name="${radioName}" type="radio">
            <i></i>
            <b>${escapeHtml(`在看 (${counts.watching || 0})`)}</b>
          </label>
          <label class="is-wish">
            <input class="wg-bangumis-tab-radio is-wish" name="${radioName}" type="radio">
            <i></i>
            <b>${escapeHtml(`想看 (${counts.wish || 0})`)}</b>
          </label>
        </div>
        <div class="wg-bangumis-stage-layout">
          <div class="wg-bangumis-tab-panels">
            ${renderLargePanel({ items: groups.all, emptyLabel: '还没有追番记录', escapeHtml, mode })}
            ${renderLargePanel({ items: groups.watching, emptyLabel: '暂无在看记录', escapeHtml, mode })}
            ${renderLargePanel({ items: groups.wish, emptyLabel: '暂无想看记录', escapeHtml, mode })}
          </div>
        </div>
      </form>
      <footer class="wg-bangumis-console-foot">
        <span>
          <span class="icon-[lucide--book-open]" aria-hidden="true"></span>
          ${escapeHtml(`共追了 ${total} 部番剧`)}
        </span>
        ${renderOpenBangumisLink(escapeHtml, mode, '进入归档')}
      </footer>
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
  const largeGroups = size === 'large'
    ? collectBangumiItemsByStatus(sources, summary.typeKey, limit)
    : null;

  if (!summary.items.length) {
    return renderEmpty({ escapeHtml, mode, installed: true });
  }

  if (size === 'small') {
    return renderSmall({ item: summary.items[0], escapeHtml, mode });
  }

  if (size === 'large') {
    return renderLarge({ groups: largeGroups, summary, counts, escapeHtml, mode });
  }

  return renderMedium({ items: summary.items, summary, counts, escapeHtml, mode });
}
