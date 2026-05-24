import assert from 'node:assert/strict';
import { buildWidgetCatalog } from '../src/widgets/catalog.js';
import { renderWidget } from '../src/widgets/plugin/steam-summary/render.js';

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
