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

function normalizeLinkFeedPost(item) {
  const title = stripText(item?.title, item?.summary || '新的友链动态');
  const author = stripText(item?.author, item?.linkName || '友链');
  return {
    key: item?.id || `${item?.linkName || author || title}`,
    title,
    description: stripText(item?.summary, ''),
    author,
    logo: String(item?.authorLogo || '').trim(),
    href: String(item?.url || '').trim(),
    authorUrl: String(item?.authorUrl || '').trim(),
    linkName: String(item?.linkName || '').trim(),
    time: formatFriendTime(item?.publishedAt)
  };
}

function renderAvatar(item, escapeHtml, className = 'wg-friends-avatar') {
  if (item.logo) {
    return `
      <span class="${className}">
        <img src="${escapeHtml(item.logo)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `;
  }

  return `
    <span class="${className} is-fallback">
      <span>${escapeHtml((item.author || '友').slice(0, 1))}</span>
    </span>
  `;
}

function renderBackground(item, escapeHtml, index = 0) {
  if (!item?.logo) {
    return `<span class="wg-friends-bg is-fallback" data-bg-index="${index}"></span>`;
  }

  return `
    <img
      class="wg-friends-bg"
      data-bg-index="${index}"
      src="${escapeHtml(item.logo)}"
      alt=""
      loading="lazy"
      decoding="async"
      fetchpriority="low"
    >
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

function renderFriendItem({ item, escapeHtml, mode, index }) {
  return renderFriendPostLink({
    item,
    escapeHtml,
    mode,
    className: 'wg-friends-item',
    innerHtml: `
      <span class="wg-friends-item-hit" data-bg-index="${index}">
        ${renderAvatar(item, escapeHtml, 'wg-friends-avatar is-square')}
        <span class="wg-friends-copy">
          <span class="wg-friends-title">${escapeHtml(item.title)}</span>
          <span class="wg-friends-description">${escapeHtml(item.description || '打开原文继续阅读')}</span>
        </span>
        ${item.time ? `<time>${escapeHtml(item.time)}</time>` : ''}
      </span>
    `
  });
}

function renderSmall({ item, escapeHtml, mode }) {
  return renderFriendPostLink({
    item,
    escapeHtml,
    mode,
    className: 'wg-friends wg-friends--small',
    innerHtml: `
      ${renderBackground(item, escapeHtml)}
      <span class="wg-friends-overlay"></span>
      <span class="wg-friends-small-content">
        <span class="wg-friends-small-title">${escapeHtml(item.title)}</span>
        <span class="wg-friends-small-foot">
          ${item.time ? `<time>${escapeHtml(item.time)}</time>` : '<time>最新</time>'}
          ${renderAvatar(item, escapeHtml)}
        </span>
      </span>
    `
  });
}

function renderMedium({ items, escapeHtml, mode }) {
  const item = items[0];
  return renderFriendPostLink({
    item,
    escapeHtml,
    mode,
    className: 'wg-friends wg-friends--medium',
    innerHtml: `
      ${renderBackground(item, escapeHtml)}
      <span class="wg-friends-overlay"></span>
      <span class="wg-friends-copy">
        <span class="wg-friends-medium-main">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.description || '分享有价值的内容，连接有趣的灵魂。')}</span>
        </span>
        <span class="wg-friends-medium-foot">
          <span class="wg-friends-author">
            ${renderAvatar(item, escapeHtml)}
            <span>
              <b>${escapeHtml(item.author)}</b>
              <em>${escapeHtml(item.linkName || '朋友圈动态')}</em>
            </span>
          </span>
          <span class="wg-friends-date">
            ${item.time ? `<time>${escapeHtml(item.time)}</time><em>发布于</em>` : '<time>最新</time>'}
          </span>
        </span>
      </span>
    `
  });
}

function renderOpenFriendsLink(escapeHtml, mode, label = '朋友圈') {
  return buildWidgetPjaxLink({
    href: '/links?view=friends',
    app: 'links',
    className: 'wg-friends-more',
    attrs: `aria-label="${escapeHtml('打开朋友圈')}"`,
    disabled: mode === 'preview',
    innerHtml: `
      <span>${escapeHtml(label)}</span>
      <span class="icon-[lucide--chevron-right]" aria-hidden="true"></span>
    `
  });
}

function renderEmpty({ escapeHtml, mode, installed }) {
  return `
    <div class="wg-friends wg-friends--empty">
      <span class="wg-friends-empty-icon">
        <span class="icon-[lucide--rss]" aria-hidden="true"></span>
      </span>
      <strong>${installed ? '暂无友链动态' : '未安装链接管理插件'}</strong>
      <p>${installed ? '在 PluginLinks 中启用并公开 RSS 动态后，这里会显示最近更新。' : '安装 PluginLinks 2.2.1 后可使用朋友圈小组件。'}</p>
      ${installed ? renderOpenFriendsLink(escapeHtml, mode, '打开') : ''}
    </div>
  `;
}

function renderLarge({ items, escapeHtml, mode }) {
  const featured = items[0];
  const rest = items.slice(1, 4);

  return `
    <div class="wg-friends wg-friends--large">
      ${items.slice(0, 4).map((item, index) => renderBackground(item, escapeHtml, index)).join('')}
      <span class="wg-friends-overlay"></span>
      ${renderFriendPostLink({
        item: featured,
        escapeHtml,
        mode,
        className: 'wg-friends-feature',
        innerHtml: `
          <span class="wg-friends-feature-main">
            <strong>${escapeHtml(featured.title)}</strong>
            <span>${escapeHtml(featured.description || '打开原文继续阅读')}</span>
          </span>
          <span class="wg-friends-feature-copy">
            <span class="wg-friends-author">
              ${renderAvatar(featured, escapeHtml)}
              <span>
                <b>${escapeHtml(featured.author)}</b>
                <em>${escapeHtml(featured.linkName || '朋友圈动态')}</em>
              </span>
            </span>
            ${featured.time ? `<time>${escapeHtml(featured.time)}</time>` : ''}
          </span>
        `
      })}
      <span class="wg-friends-divider"></span>
      <span class="wg-friends-list" aria-label="${escapeHtml('最近朋友圈动态')}">
        ${rest.map((item, index) => renderFriendItem({ item, escapeHtml, mode, index: index + 1 })).join('')}
      </span>
    </div>
  `;
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  if (!sources.friendsAvailable) {
    return renderEmpty({ escapeHtml, mode, installed: false });
  }

  const size = widget?.size || 'medium';
  const limit = size === 'large' ? 4 : 1;
  const sourceItems = Array.isArray(sources.recentFriends)
    ? sources.recentFriends
    : Array.isArray(sources.recentFriends?.items)
      ? sources.recentFriends.items
      : [];
  const items = sourceItems.length
    ? sourceItems.slice(0, limit).map((item) => normalizeLinkFeedPost(item)).filter((item) => item.title)
    : [];

  if (!items.length) {
    return renderEmpty({ escapeHtml, mode, installed: true });
  }

  if (size === 'large') {
    return renderLarge({ items, escapeHtml, mode });
  }

  if (size === 'small') {
    return renderSmall({ item: items[0], escapeHtml, mode });
  }

  return renderMedium({ items, escapeHtml, mode });
}
