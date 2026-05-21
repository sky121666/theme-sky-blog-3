import assert from 'node:assert/strict';
import { renderWidget, resolveBangumiWidgetItems } from '../src/widgets/plugin/bangumis-recent/render.js';
import { buildWidgetCatalog } from '../src/widgets/catalog.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function bangumi(title, overrides = {}) {
  return {
    metadata: { name: title.toLowerCase().replace(/\s+/g, '-') },
    spec: {
      title,
      cover: overrides.cover ?? '',
      url: overrides.url ?? `https://example.com/${encodeURIComponent(title)}`,
      score: overrides.score ?? '',
      totalCount: overrides.totalCount ?? '',
      type: overrides.type ?? '',
      area: overrides.area ?? '',
      des: overrides.des ?? ''
    }
  };
}

const sources = {
  bangumisAvailable: true,
  bangumisByStatus: {
    anime: {
      wish: [bangumi('想看番剧')],
      watching: [],
      done: [bangumi('已看番剧')]
    },
    drama: {
      wish: [],
      watching: [bangumi('在看剧集', { cover: 'https://example.com/cover.jpg' })],
      done: []
    }
  },
  bangumiStatusCounts: {
    anime: { wish: 1, watching: 0, done: 1 },
    drama: { wish: 0, watching: 1, done: 0 }
  }
};

const autoAnime = resolveBangumiWidgetItems(sources, { typeNum: '1', status: 'auto' }, 4);
assert.equal(autoAnime.status, 'wish', 'auto falls back from watching to wish for anime');
assert.equal(autoAnime.items[0].title, '想看番剧', 'auto anime returns wish item');

const drama = resolveBangumiWidgetItems(sources, { typeNum: '2', status: 'watching' }, 4);
assert.equal(drama.typeKey, 'drama', 'typeNum=2 only reads drama source');
assert.equal(drama.items[0].title, '在看剧集', 'drama watching item selected');

const done = resolveBangumiWidgetItems(sources, { typeNum: '1', status: 'done' }, 4);
assert.equal(done.items[0].title, '已看番剧', 'explicit done status selected');

const previewHtml = renderWidget(
  { sources, escapeHtml, mode: 'preview' },
  { widget: 'plugin-bangumis.recent', size: 'small', meta: { typeNum: '2', status: 'watching' } }
);
assert.ok(!previewHtml.includes('<a '), 'preview mode does not render clickable external links');
assert.ok(!previewHtml.includes('src=""'), 'missing cover never renders empty img src');

const liveHtml = renderWidget(
  { sources, escapeHtml, mode: 'live' },
  { widget: 'plugin-bangumis.recent', size: 'medium', meta: { typeNum: '2', status: 'watching' } }
);
assert.ok(liveHtml.includes('target="_blank"'), 'live item link opens as external link');
assert.ok(liveHtml.includes('在看剧集'), 'live html includes selected item');

const unavailableCatalog = buildWidgetCatalog({ bangumisAvailable: false });
assert.ok(
  unavailableCatalog.every((entry) => entry.widget !== 'plugin-bangumis.recent'),
  'bangumis widget hidden when plugin is unavailable'
);

const availableCatalog = buildWidgetCatalog({ bangumisAvailable: true });
assert.ok(
  availableCatalog.some((entry) => entry.widget === 'plugin-bangumis.recent'),
  'bangumis widget visible when plugin is available'
);

console.log('bangumis widget contract passed');
