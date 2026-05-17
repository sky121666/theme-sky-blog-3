import { buildWidgetExternalLink, buildWidgetPjaxLink } from '../../shared/link.js';

function stripText(value, fallback = '') {
  return String(value || fallback || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function formatFriendTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (segment) => String(segment).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function normalizeFriendPost(item) {
  const spec = item?.spec || {};
  const title = stripText(spec.title, spec.description || '新的友链动态');
  return {
    key: item?.metadata?.name || `${spec.linkName || spec.author || title}`,
    title,
    description: stripText(spec.description, ''),
    author: stripText(spec.author, spec.linkName || '友链'),
    logo: String(spec.logo || '').trim(),
    href: String(spec.postLink || '').trim(),
    authorUrl: String(spec.authorUrl || '').trim(),
    linkName: String(spec.linkName || '').trim(),
    time: formatFriendTime(spec.pubDate)
  };
}

function renderAvatar(item, escapeHtml) {
  if (item.logo) {
    return `
      <span class="wg-friends-avatar">
        <img src="${escapeHtml(item.logo)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `;
  }

  return `
    <span class="wg-friends-avatar is-fallback">
      <span>${escapeHtml((item.author || '友').slice(0, 1))}</span>
    </span>
  `;
}

function renderFriendPostLink({ item, className, escapeHtml, mode, innerHtml }) {
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

function renderFriendItem({ item, escapeHtml, mode, large = false }) {
  return renderFriendPostLink({
    item,
    escapeHtml,
    mode,
    className: large ? 'wg-friends-item is-large-row' : 'wg-friends-item',
    innerHtml: `
      ${renderAvatar(item, escapeHtml)}
      <span class="wg-friends-copy">
        <span class="wg-friends-title">${escapeHtml(item.title)}</span>
        <span class="wg-friends-meta">
          <span>${escapeHtml(item.author)}</span>
          ${item.time ? `<time>${escapeHtml(item.time)}</time>` : ''}
        </span>
      </span>
    `
  });
}

function renderOpenFriendsLink(escapeHtml, mode, label = '查看') {
  return buildWidgetPjaxLink({
    href: '/friends',
    app: 'friends',
    className: 'wg-friends-more',
    attrs: `aria-label="${escapeHtml('打开朋友圈')}"`,
    disabled: mode === 'preview',
    innerHtml: `
      <span>${escapeHtml(label)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `
  });
}

function renderFriendHeader({ items, escapeHtml, mode }) {
  const count = items.length;
  return `
    <span class="wg-friends-head">
      <span class="wg-friends-heading">
        <strong>朋友圈</strong>
        <span>${escapeHtml(count ? `${count} 条最近动态` : '最新友链动态')}</span>
      </span>
      ${renderOpenFriendsLink(escapeHtml, mode)}
    </span>
  `;
}

function renderEmpty({ escapeHtml, mode, installed }) {
  return `
    <div class="wg-friends wg-friends--empty">
      <span class="wg-friends-empty-icon">
        <span class="icon-[lucide--rss]" aria-hidden="true"></span>
      </span>
      <strong>${installed ? '暂无友链动态' : '未安装朋友圈插件'}</strong>
      <p>${installed ? '同步 RSS 后会在这里显示最近更新。' : '安装 plugin-friends 后可添加朋友圈小组件。'}</p>
      ${installed ? renderOpenFriendsLink(escapeHtml, mode, '打开') : ''}
    </div>
  `;
}

function renderMedium({ items, escapeHtml, mode }) {
  return `
    <div class="wg-friends wg-friends--medium">
      ${renderFriendHeader({ items, escapeHtml, mode })}
      <span class="wg-friends-list">
        ${items.slice(0, 2).map((item) => renderFriendItem({ item, escapeHtml, mode })).join('')}
      </span>
    </div>
  `;
}

function renderLarge({ items, escapeHtml, mode }) {
  const featured = items[0];
  const rest = items.slice(1, 3);

  return `
    <div class="wg-friends wg-friends--large">
      ${renderFriendHeader({ items, escapeHtml, mode })}
      ${renderFriendPostLink({
        item: featured,
        escapeHtml,
        mode,
        className: 'wg-friends-feature',
        innerHtml: `
          ${renderAvatar(featured, escapeHtml)}
          <span class="wg-friends-feature-copy">
            <span class="wg-friends-feature-kicker">${escapeHtml(featured.author)}${featured.time ? ` · ${escapeHtml(featured.time)}` : ''}</span>
            <strong>${escapeHtml(featured.title)}</strong>
            <span>${escapeHtml(featured.description || '打开原文继续阅读')}</span>
          </span>
        `
      })}
      <span class="wg-friends-list">
        ${rest.map((item) => renderFriendItem({ item, escapeHtml, mode, large: true })).join('')}
      </span>
    </div>
  `;
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  if (!sources.friendsAvailable) {
    return renderEmpty({ escapeHtml, mode, installed: false });
  }

  const size = widget?.size || 'medium';
  const limit = size === 'large' ? 3 : 2;
  const items = Array.isArray(sources.recentFriends)
    ? sources.recentFriends.slice(0, limit).map((item) => normalizeFriendPost(item)).filter((item) => item.title)
    : [];

  if (!items.length) {
    return renderEmpty({ escapeHtml, mode, installed: true });
  }

  if (size === 'large') {
    return renderLarge({ items, escapeHtml, mode });
  }

  return renderMedium({ items, escapeHtml, mode });
}
