import { selectDailyRandomTags } from '../../shared/data.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';

function seededRand(str, salt = 0) {
  let h = salt;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return ((h & 0x7fffffff) % 1000) / 1000;
}

const BG_POSITIONS = [
  { top: '12%', left: '8%' },
  { top: '72%', left: '80%' },
  { top: '38%', left: '12%' },
  { top: '18%', left: '75%' },
  { top: '65%', left: '18%' },
  { top: '45%', left: '82%' },
  { top: '82%', left: '40%' },
];

export function renderWidget({ sources, escapeHtml, mode }, widget, options = {}) {
  const isCompact = options.compact === true;
  const size = widget?.size || 'medium';

  if (size === 'small') {
    const tags = selectDailyRandomTags(sources.randomTags, 8);
    if (!tags.length) {
      return '<div class="desktop-widget-empty">无标签</div>';
    }

    const itemsHTML = tags.map((tag, i) => {
      const pos = BG_POSITIONS[i % BG_POSITIONS.length];
      const style = Object.entries(pos).map(([k, v]) => `${k}:${v}`).join(';');
      const tagColor = tag.color || '#A1A1AA';
      const cls = i === 0 ? 'wg-tag-focus-item is-focus' : 'wg-tag-focus-item';
      return buildWidgetPjaxLink({
        href: escapeHtml(tag.permalink),
        app: 'explorer-tags',
        className: cls,
        attrs: `style="${style};--tag-color:${escapeHtml(tagColor)}"`,
        disabled: mode === 'preview',
        innerHtml: escapeHtml(tag.name)
      });
    }).join('');

    return `<div class="wg-tag-focus-stage" data-tag-focus>${itemsHTML}</div>`;
  }

  const limit = size === 'large' ? (isCompact ? 24 : 30) : (isCompact ? 24 : 30);
  const tags = selectDailyRandomTags(sources.randomTags, limit);
  if (!tags.length) {
    return '<div class="desktop-widget-empty">当前没有可展示的标签。</div>';
  }

  const buildChip = (tag, index, extraClass = '') => {
    const tagColor = tag.color || '#A1A1AA';
    const rot = ((seededRand(tag.name, 1) - 0.5) * 5).toFixed(1);
    const tx = ((seededRand(tag.name, 2) - 0.5) * 3.2).toFixed(1);
    const ty = ((seededRand(tag.name, 3) - 0.5) * 3.2).toFixed(1);
    const tone = index % 4;
    const chip = buildWidgetPjaxLink({
      href: escapeHtml(tag.permalink),
      app: 'explorer-tags',
      className: `wg-tag-chip ${extraClass} tone-${tone}`,
      attrs: `title="${escapeHtml(tag.name)}" style="--tag-color:${escapeHtml(tagColor)};--j-rot:${rot}deg;--j-tx:${tx}px;--j-ty:${ty}px;"`,
      disabled: mode === 'preview',
      innerHtml: escapeHtml(tag.name)
    });
    if (size === 'medium') {
      return `<span class="wg-tag-chip-slot">${chip}</span>`;
    }
    return chip;
  };

  let content = '';
  if (size === 'large') {
    const featured = tags[0];
    const rest = tags.slice(1);
    const featuredMarkup = featured ? buildWidgetPjaxLink({
      href: escapeHtml(featured.permalink),
      app: 'explorer-tags',
      className: 'wg-tag-feature',
      attrs: `style="--tag-color:${escapeHtml(featured.color || '#A1A1AA')}"`,
      disabled: mode === 'preview',
      innerHtml: `
        <span class="wg-tag-feature-kicker">探索</span>
        <strong>${escapeHtml(featured.name)}</strong>
      `
    }) : '';

    const chipsMarkup = rest.map((tag, index) => buildChip(tag, index)).join('');
    content = `
      <div class="wg-tag-wall-shell is-large${isCompact ? ' is-compact' : ''}">
        ${featuredMarkup}
        <div class="wg-tag-wall is-large${isCompact ? ' is-compact' : ''}">${chipsMarkup}</div>
      </div>
    `;
  } else {
    const chipsMarkup = tags.map((tag, index) => buildChip(tag, index)).join('');
    content = `<div class="wg-tag-wall is-medium${isCompact ? ' is-compact' : ''}">${chipsMarkup}</div>`;
  }

  return content;
}

if (typeof document !== 'undefined') {
  setInterval(() => {
    document.querySelectorAll('[data-tag-focus]').forEach((stage) => {
      const items = stage.querySelectorAll('.wg-tag-focus-item');
      if (items.length < 2) return;

      let focusIdx = -1;
      items.forEach((el, i) => {
        if (el.classList.contains('is-focus')) focusIdx = i;
      });

      const nextIdx = (focusIdx + 1) % items.length;
      items.forEach((el, i) => {
        el.classList.toggle('is-focus', i === nextIdx);
      });
    });
  }, 4000);
}
