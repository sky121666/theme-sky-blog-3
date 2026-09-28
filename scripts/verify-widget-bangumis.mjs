import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const mixedSources = {
  ...sources,
  bangumisByStatus: { anime: {
    watching: [bangumi('仅在看数据')],
    wish: [bangumi('仅想看数据')],
    done: [bangumi('仅已看数据')]
  } },
  bangumiStatusCounts: { anime: { watching: 5, wish: 7, done: 9 } }
};
const renderMixed = (status, size = 'large', fixture = mixedSources) => renderWidget(
  { sources: fixture, escapeHtml, mode: 'live' },
  { widget: 'plugin-bangumis.recent', size, meta: { typeNum: '1', status } }
);
for (const [status, expected, unwanted] of [
  ['watching', '仅在看数据', ['仅想看数据', '仅已看数据']],
  ['wish', '仅想看数据', ['仅在看数据', '仅已看数据']],
  ['done', '仅已看数据', ['仅在看数据', '仅想看数据']]
]) {
  const html = renderMixed(status);
  assert.ok(html.includes(expected), `large ${status} keeps its selected data`);
  unwanted.forEach((title) => assert.equal(html.includes(title), false, `large ${status} excludes ${title}`));
  assert.equal((html.match(/type="radio"/g) || []).length, 1, 'an explicit status must not offer unrelated status tabs');
}
assert.match(renderMixed('done'), /已看 \(9\)/, 'filtered count belongs to the selected state');
const automatic = renderMixed('auto');
assert.match(automatic, /全部 \(21\)/);
assert.equal((automatic.match(/type="radio"/g) || []).length, 3, 'auto retains all/watch/wish tabs');
for (const size of ['small', 'medium', 'large']) {
  const html = renderMixed('watching', size);
  assert.match(html, /进度未知/);
  assert.doesNotMatch(html, /36%|观看进度 \d+%|width:\d+%/, 'missing upstream progress must not create a percentage');
}
const progressSources = structuredClone(mixedSources);
progressSources.bangumisByStatus.anime.watching[0].spec.progress = 0;
assert.match(renderMixed('watching', 'medium', progressSources), /观看进度 0%/, 'explicit zero progress remains valid');
progressSources.bangumisByStatus.anime.watching[0].spec.progress = 45;
assert.match(renderMixed('watching', 'large', progressSources), /width:45%/, 'an explicit progress value remains visible');

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

const listTemplate = readFileSync(new URL('../templates/modules/bangumis-app/list.html', import.meta.url), 'utf8');
assert.doesNotMatch(
  listTemplate,
  /\bbangumiFinder\.list\s*\(/,
  'the plugin route model must be enough to render the list without extra upstream Finder requests'
);
assert.match(listTemplate, /data-bangumi-widget-payload/, 'the list exposes the fetched route model for on-demand widgets');
for (const status of [0, 1, 2, 3]) {
  const link = listTemplate.match(new RegExp(`th:href="@\\{/bangumis\\(typeNum=\\$\\{currentType\\},status=${status},size=\\$\\{currentSize\\}\\)\\}"[\\s\\S]*?</a>`))?.[0];
  assert.ok(link, `status ${status} filter remains available`);
  assert.match(link, new RegExp(`data-bangumis-status-count="${status}"`), `status ${status} has a count slot`);
  assert.match(link, /\? totalCount : '—'/, `status ${status} distinguishes a known route total from an unknown count`);
}
const statusExpression = listTemplate.match(/\bstatusLabel=\$\{([^\"]+)\}"/)?.[1];
const followExpression = listTemplate.match(/<span\b[^>]*th:if="\$\{!#strings\.isEmpty\(bangumi\.spec\.follow\)\}"[^>]*th:title="\$\{([^\"]+)\}"/)?.[1];
assert.ok(statusExpression, 'list card status label uses a template expression');
assert.ok(followExpression, 'list follow tooltip uses a template expression');
const evaluateLabel = (expression, currentStatus, isDrama) => Function(
  'currentStatus', 'isDrama', `return (${expression.replaceAll(' or ', ' || ')});`
)(currentStatus, isDrama);
for (const [isDrama, type, allStatus, followTitle] of [
  [false, 'anime', '追番', '追番人数'],
  [true, 'drama', '追剧', '追剧人数']
]) {
  for (const [status, expected] of [[0, allStatus], [1, '想看'], [2, '在看'], [3, '已看']]) {
    for (const value of [status, String(status)]) {
      assert.equal(evaluateLabel(statusExpression, value, isDrama), expected, `${type} status=${value} card label`);
    }
  }
  assert.equal(evaluateLabel(followExpression, 0, isDrama), followTitle, `${type} follow tooltip`);
}

console.log('bangumis widget contract passed');
