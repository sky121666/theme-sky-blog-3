import { resolveDesktopAuthorProfile } from '../../shared/data.js';
import { buildWidgetPjaxLink } from '../../shared/link.js';
import { resolveIdentityPresence } from '../../shared/presence.js';

function compactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '0';
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

function buildAvatar(author, escapeHtml, className = 'wg-identity-avatar') {
  if (author.avatar) {
    return `
      <span class="${className}">
        <img src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.displayName)}" loading="lazy" decoding="async" fetchpriority="low">
      </span>
    `;
  }

  return `
    <span class="${className} is-fallback">
      <span>${escapeHtml((author.displayName || 'A').slice(0, 1))}</span>
    </span>
  `;
}

function normalizePresence(presence, author) {
  if (presence.type !== 'default') return presence;
  return {
    ...presence,
    title: author.displayName || '站点作者',
    subtitle: author.summary || '',
    href: author.permalink || '#',
    cover: author.avatar || ''
  };
}

function actionAttrs(label) {
  return `title="${label}" aria-label="${label}"`;
}

function renderQuickActions({ sources, author, escapeHtml, mode }) {
  const latestPost = Array.isArray(sources.latestPosts) ? sources.latestPosts[0] : null;
  const actions = [
    {
      label: '作者',
      icon: 'icon-[lucide--user]',
      href: author.permalink || '#',
      app: 'explorer-author'
    }
  ];

  if (sources.momentsAvailable) {
    actions.push({
      label: '瞬间',
      icon: 'icon-[lucide--clock]',
      href: '/moments',
      app: 'moments'
    });
  }

  if (sources.steamAvailable) {
    actions.push({
      label: 'Steam',
      icon: 'icon-[lucide--gamepad-2]',
      href: '/steam',
      app: 'steam'
    });
  }

  if (sources.photosAvailable) {
    actions.push({
      label: '图库',
      icon: 'icon-[lucide--image]',
      href: sources.photosUrl || '/photos',
      app: 'photos'
    });
  }

  if (latestPost?.status?.permalink) {
    actions.push({
      label: '文章',
      icon: 'icon-[lucide--file-text]',
      href: latestPost.status.permalink,
      app: 'reader'
    });
  }

  return actions.slice(0, 3).map((action) => buildWidgetPjaxLink({
    href: escapeHtml(action.href),
    app: action.app,
    className: 'wg-identity-action',
    attrs: actionAttrs(escapeHtml(action.label)),
    disabled: mode === 'preview',
    innerHtml: `<span class="${action.icon}" aria-hidden="true"></span>`
  })).join('');
}

function renderCover(presence, author, escapeHtml) {
  const cover = presence.cover || author.avatar || '';
  if (!cover) {
    return '<span class="wg-identity-hero-placeholder"><span class="icon-[lucide--sparkles]" aria-hidden="true"></span></span>';
  }
  return `<img class="wg-identity-hero-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`;
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  const size = widget?.size || 'medium';
  const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
  const author = resolveDesktopAuthorProfile(sources);
  const presence = normalizePresence(resolveIdentityPresence(sources, meta), author);
  const avatar = buildAvatar(author, escapeHtml);
  const title = escapeHtml(presence.title || author.displayName || '站点作者');
  const subtitle = escapeHtml(presence.subtitle || author.summary || '');
  const label = escapeHtml(presence.label || '站点作者');
  const href = escapeHtml(presence.href || author.permalink || '#');
  const app = presence.app || 'explorer-author';
  const quickActions = renderQuickActions({ sources, author, escapeHtml, mode });

  if (size === 'small') {
    return `
      <div class="wg-identity is-small" data-presence-type="${escapeHtml(presence.type)}" data-presence-accent="${escapeHtml(presence.accent)}">
        ${buildWidgetPjaxLink({
          href,
          app,
          className: 'wg-identity-small-link',
          disabled: mode === 'preview',
          innerHtml: `
            ${avatar}
            <span class="wg-identity-small-copy">
              <strong>${escapeHtml(author.displayName || '站点作者')}</strong>
              <span>${label}</span>
            </span>
          `
        })}
      </div>
    `;
  }

  const metrics = [
    { label: '文章', value: compactNumber(author.posts) },
    { label: '访问', value: compactNumber(author.visits) },
    {
      label: sources.steamAvailable ? '游戏' : '瞬间',
      value: compactNumber(sources.steamAvailable ? sources.steamStats?.totalGames : author.moments)
    }
  ];

  if (size === 'large') {
    return `
      <div class="wg-identity is-large" data-presence-type="${escapeHtml(presence.type)}" data-presence-accent="${escapeHtml(presence.accent)}">
        ${buildWidgetPjaxLink({
          href,
          app,
          className: 'wg-identity-hero',
          disabled: mode === 'preview',
          innerHtml: `
            ${renderCover(presence, author, escapeHtml)}
            <span class="wg-identity-hero-scrim"></span>
            <span class="wg-identity-presence-pill">${label}</span>
            <span class="wg-identity-hero-copy">
              <strong>${title}</strong>
              <span>${subtitle}</span>
            </span>
          `
        })}
        <div class="wg-identity-profile-row">
          ${avatar}
          <span class="wg-identity-profile-copy">
            <strong>${escapeHtml(author.displayName || '站点作者')}</strong>
            <span>${escapeHtml(author.summary || '')}</span>
          </span>
        </div>
        <div class="wg-identity-metrics">
          ${metrics.map((metric) => `
            <span class="wg-identity-metric">
              <b>${escapeHtml(metric.value)}</b>
              <small>${escapeHtml(metric.label)}</small>
            </span>
          `).join('')}
        </div>
        <div class="wg-identity-actions">${quickActions}</div>
      </div>
    `;
  }

  return `
    <div class="wg-identity is-medium" data-presence-type="${escapeHtml(presence.type)}" data-presence-accent="${escapeHtml(presence.accent)}">
      <div class="wg-identity-profile-row">
        ${avatar}
        <span class="wg-identity-profile-copy">
          <strong>${escapeHtml(author.displayName || '站点作者')}</strong>
          <span>${escapeHtml(author.summary || '')}</span>
        </span>
      </div>
      ${buildWidgetPjaxLink({
        href,
        app,
        className: 'wg-identity-presence',
        disabled: mode === 'preview',
        innerHtml: `
          <span class="wg-identity-presence-pill">${label}</span>
          <strong>${title}</strong>
          <span>${subtitle}</span>
        `
      })}
      <div class="wg-identity-actions">${quickActions}</div>
    </div>
  `;
}
