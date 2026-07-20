import { buildWidgetPjaxLink } from '../../shared/link.js';
import {
  formatSteamPlaytime,
  isSteamGameUnavailable,
  resolveSteamGameImage
} from '../../../apps/steam/model.js';

function optionEnabled(value, fallback = true) {
  if (value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  return fallback;
}

function pickFirstGame(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (Array.isArray(value?.items)) return value.items[0] || null;
  if (Array.isArray(value?.list)) return value.list[0] || null;
  return null;
}

function collectGames(...values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.list)) return value.list;
    return [];
  }).filter(Boolean);
}

function normalizeGameName(value) {
  return String(value || '').trim().toLowerCase();
}

function extractCurrentGameName(statusText) {
  const text = String(statusText || '').trim();
  if (!text) return '';
  const match = text.match(/(?:正在(?:玩|游玩)|playing)\s*[:：]\s*(.+)$/i);
  return match?.[1]?.trim() || '';
}

function findGameByName(games, name) {
  const target = normalizeGameName(name);
  if (!target) return null;
  return games.find((game) => normalizeGameName(game?.name) === target)
    || games.find((game) => {
      const gameName = normalizeGameName(game?.name);
      return gameName && (gameName.includes(target) || target.includes(gameName));
    });
}

function toDisplayNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? String(num) : '--';
}

function cssUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/["\\\n\r]/g, '');
}

function isOfflineStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || text.includes('离线') || text.includes('offline');
}

function renderAvatar({ avatar, personaName }) {
  if (avatar) {
    return `<img class="wg-steam-avatar-img" src="${avatar}" alt="${personaName}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  return '<span class="wg-steam-avatar-fallback icon-[lucide--user]" aria-hidden="true"></span>';
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  if (!sources.steamAvailable) {
    return '<div class="desktop-widget-empty">未安装 Steam 插件。</div>';
  }

  const meta = widget?.meta || {};
  const showStats = optionEnabled(meta.showStats, true);
  const showRecentGame = optionEnabled(meta.showRecentGame, true);
  const profile = sources.steamProfile || {};
  const stats = sources.steamStats || {};
  const recentGame = pickFirstGame(sources.steamRecentGames);
  const coverGames = collectGames(sources.steamRecentGames, sources.steamOwnedGames);

  const playing = profile.playing === true;
  const personaName = escapeHtml(profile.personaName || 'Steam Player');
  const avatar = escapeHtml(profile.avatarFull || '');
  const level = toDisplayNumber(profile.steamLevel);
  const totalGames = toDisplayNumber(stats.totalGames);
  const recentPlaytime = escapeHtml(formatSteamPlaytime(
    stats.recentPlaytimeFormatted,
    stats.recentPlaytimeMinutes,
    '--'
  ));
  const parsedCurrentGameName = extractCurrentGameName(profile.statusText);
  const currentGameSourceName = profile.currentGameName || parsedCurrentGameName;
  const matchedCurrentGame = findGameByName(coverGames, currentGameSourceName);
  const coverGame = matchedCurrentGame || recentGame || coverGames[0] || null;
  const recentGameName = escapeHtml(recentGame?.name || '');
  const currentGameName = escapeHtml(currentGameSourceName || matchedCurrentGame?.name || '');
  const offline = !playing && isOfflineStatus(profile.statusText);
  const statusText = escapeHtml(playing ? '正在玩' : (profile.statusText || '离线'));
  const activityText = playing
    ? (currentGameName || (profile.statusText && profile.statusText !== '正在玩' ? escapeHtml(profile.statusText) : '') || '正在游戏')
    : '';
  const recentBadge = playing && showRecentGame && recentGameName && recentGameName !== activityText
    ? `<span class="wg-steam-recent-badge">${recentGameName}</span>`
    : '';
  const coverUnavailable = isSteamGameUnavailable(coverGame);
  const bgImage = playing && !coverUnavailable
    ? cssUrl(profile.currentGameImage || resolveSteamGameImage(coverGame))
    : '';
  const coverHtml = bgImage
    ? `<div class="wg-steam-cover" style="--wg-steam-game-bg: url('${escapeHtml(bgImage)}');" aria-hidden="true"></div>`
    : '';
  const stateClass = playing ? 'is-playing' : (offline ? 'is-offline' : 'is-online');

  const statsHtml = showStats ? `
    <div class="wg-steam-stats" aria-label="Steam 统计">
      <span><em>游戏</em><strong title="${escapeHtml(totalGames)}">${escapeHtml(totalGames)}</strong></span>
      <span><em>2周</em><strong title="${recentPlaytime}">${recentPlaytime}</strong></span>
    </div>
  ` : '';

  const steamLink = buildWidgetPjaxLink({
    href: sources.steamUrl || '/steam',
    app: 'steam',
    className: 'wg-steam-open',
    attrs: `aria-label="${escapeHtml('打开 Steam 页面')}"`,
    disabled: mode === 'preview',
    innerHtml: '<span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>'
  });

  return `
    <section class="wg-steam wg-steam--medium ${stateClass}" aria-label="${escapeHtml(widget?.title || 'Steam')}">
      <div class="wg-steam-vignette" aria-hidden="true"></div>
      ${coverHtml}
      <div class="wg-steam-ornament" aria-hidden="true">
        <span class="icon-[lucide--disc-3]"></span>
        <span class="icon-[lucide--gamepad-2]"></span>
      </div>

      <div class="wg-steam-identity">
        <div class="wg-steam-avatar">
          <span class="wg-steam-avatar-ring" aria-hidden="true"></span>
          ${renderAvatar({ avatar, personaName })}
        </div>
        <span class="wg-steam-level">LV.${escapeHtml(level)}</span>
      </div>

      <div class="wg-steam-content">
        <div class="wg-steam-head">
          <div class="wg-steam-titleline">
            <h3>${personaName}</h3>
          </div>
          <span class="wg-steam-status">
            <span class="wg-steam-dot" aria-hidden="true"></span>
            ${statusText}
          </span>
          ${activityText ? `<p>${activityText}</p>` : ''}
          ${recentBadge}
        </div>

        <div class="wg-steam-footer">
          ${statsHtml}
          ${steamLink}
        </div>
      </div>
    </section>
  `;
}
