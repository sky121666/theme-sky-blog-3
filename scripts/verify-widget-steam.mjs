import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWidgetCatalog } from '../src/widgets/catalog.js';
import { renderWidget } from '../src/widgets/plugin/steam-summary/render.js';
import { normalizeDesktopWidgetSources } from '../src/shell/desktop-shell/runtime/widgets/protocol.js';

const layoutSource = fs.readFileSync(new URL('../templates/modules/shell/layout.html', import.meta.url), 'utf8');
const widgetProtocolSource = fs.readFileSync(new URL('../templates/modules/shell/desktop-widgets.html', import.meta.url), 'utf8');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function render(sources, meta = {}, mode = 'live') {
  return renderWidget({ sources, escapeHtml, mode }, {
    widget: 'plugin-steam.summary',
    size: 'medium',
    title: 'Steam',
    meta
  });
}

const recentGame = {
  name: 'Cyberpunk 2077',
  headerImageUrl: 'https://cdn.example.test/cyberpunk.jpg'
};
const ownedGame = {
  name: 'Warframe',
  headerImageUrl: 'https://cdn.example.test/warframe.jpg'
};

assert.equal(
  buildWidgetCatalog({ steamAvailable: false }).some((entry) => entry.widget === 'plugin-steam.summary'),
  false,
  'Steam widget should be hidden when plugin is unavailable'
);

assert.equal(
  buildWidgetCatalog({ steamAvailable: true }).some((entry) => entry.widget === 'plugin-steam.summary' && entry.size === 'medium'),
  true,
  'Steam widget should be available as medium size when plugin is installed'
);

const offlineHtml = render({
  steamAvailable: true,
  steamProfile: { playing: false, statusText: '离线', personaName: 'Sky' },
  steamStats: { totalGames: 124, recentPlaytimeFormatted: '18.6h' },
  steamRecentGames: [recentGame]
});

assert.equal(offlineHtml.includes('正在玩'), false, 'recent games must not infer playing state');
assert.equal(offlineHtml.includes('Cyberpunk 2077'), false, 'offline widget should not show a game title when not playing');
assert.equal(offlineHtml.includes('is-offline'), true, 'offline widget should expose offline state class');
assert.equal(offlineHtml.includes('wg-steam-cover'), false, 'offline widget should keep Steam decorative background');

const onlineHtml = render({
  steamAvailable: true,
  steamProfile: { playing: false, statusText: '在线', personaName: 'Sky' },
  steamStats: { totalGames: 124, recentPlaytimeFormatted: '1 小时 25 分钟' },
  steamRecentGames: [recentGame]
});

assert.equal(onlineHtml.includes('正在玩'), false, 'online state must not infer playing state');
assert.equal(onlineHtml.includes('is-online'), true, 'online widget should expose online state class');
assert.equal(onlineHtml.includes('wg-steam-cover'), false, 'online widget should keep Steam decorative background when not playing');
assert.equal(onlineHtml.includes('Cyberpunk 2077'), false, 'online widget should not show a game title when not playing');
assert.equal(onlineHtml.includes('<p>Steam</p>'), false, 'online widget should not render a redundant Steam activity line');
assert.equal(onlineHtml.includes('1 小时 25 分钟'), true, 'recent playtime should be displayed as returned by the data source');
assert.equal(onlineHtml.includes('title="1 小时 25 分钟"'), true, 'overflowing recent playtime should keep the full value in title');

const playingHtml = render({
  steamAvailable: true,
  steamProfile: { playing: true, statusText: '正在游玩: Warframe', personaName: 'Sky', profileUrl: 'https://steamcommunity.com/id/sky' },
  steamStats: { totalGames: 124, recentPlaytimeFormatted: '18.6h' },
  steamRecentGames: [],
  steamOwnedGames: [ownedGame]
});

assert.equal(playingHtml.includes('正在玩'), true, 'playing widget should show playing label');
assert.equal(playingHtml.includes('Warframe'), true, 'playing widget should derive current game name from status text');
assert.equal(playingHtml.includes('wg-steam-cover'), true, 'playing widget may use current/recent game image as visual background');
assert.equal(playingHtml.includes('warframe.jpg'), true, 'playing widget should match cover from owned games when recent games are empty');
assert.match(playingHtml, /data-pjax-app="steam"/, 'Steam widget should keep an internal PJAX entry');

const realHeaderHtml = render({
  steamAvailable: true,
  steamProfile: { playing: true, statusText: '正在游玩: Half-Life', personaName: 'Sky' },
  steamStats: { totalGames: 124, recentPlaytimeMinutes: 125 },
  steamRecentGames: [{
    name: 'Half-Life',
    headerImageUrl: null,
    realHeaderImage: 'https://cdn.example.test/half-life-real.jpg'
  }]
});

assert.equal(realHeaderHtml.includes('half-life-real.jpg'), true, 'Steam 1.0.0 realHeaderImage should backfill an empty headerImageUrl');
assert.equal(realHeaderHtml.includes('2h 5m'), true, 'raw recent playtime should backfill a missing formatted value');
assert.match(layoutSource, /widgetsSteamStats\.recentPlaytimeMinutes/, 'SSR should read Steam 1.0.0 raw recent playtime minutes');
assert.match(widgetProtocolSource, /"recentPlaytimeMinutes":\s*\[\[\$\{steamStatsRecentPlaytimeMinutes\}\]\]/, 'widget protocol should serialize raw recent playtime minutes');
assert.equal(
  normalizeDesktopWidgetSources({ steamStats: { recentPlaytimeMinutes: '125' } }).steamStats.recentPlaytimeMinutes,
  125,
  'desktop protocol should retain raw recent playtime minutes'
);

const delistedHtml = render({
  steamAvailable: true,
  steamProfile: {
    playing: true,
    statusText: '正在游玩: Removed Game',
    personaName: 'Sky',
    currentGameImage: 'https://cdn.example.test/removed-current.jpg'
  },
  steamStats: { totalGames: 124, recentPlaytimeFormatted: '18.6h' },
  steamRecentGames: [{
    name: 'Removed Game',
    headerImageUrl: 'https://cdn.example.test/removed.jpg',
    realHeaderImage: 'https://cdn.example.test/removed-real.jpg',
    delisted: true
  }]
});

assert.equal(delistedHtml.includes('wg-steam-cover'), false, 'delisted games should not render a stale store cover in the widget');
assert.equal(delistedHtml.includes('removed-current.jpg'), false, 'delisted current game image should be suppressed');

const noRecentHtml = render({
  steamAvailable: true,
  steamProfile: { playing: false, statusText: '离线', personaName: 'Sky' },
  steamStats: { totalGames: 124, recentPlaytimeFormatted: '18.6h' },
  steamRecentGames: [recentGame]
}, { showRecentGame: false });

assert.equal(noRecentHtml.includes('Cyberpunk 2077'), false, 'showRecentGame=false should hide recent game title');

const noStatsHtml = render({
  steamAvailable: true,
  steamProfile: { playing: false, statusText: '离线', personaName: 'Sky' },
  steamStats: { totalGames: 124, recentPlaytimeFormatted: '18.6h' },
  steamRecentGames: []
}, { showStats: false });

assert.equal(noStatsHtml.includes('124'), false, 'showStats=false should hide total games');
assert.equal(noStatsHtml.includes('18.6h'), false, 'showStats=false should hide recent playtime');

console.log('verify-widget-steam passed');
