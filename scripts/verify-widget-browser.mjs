import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { collectBrowserRuntimeErrors, runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { computedTextContrast } from './lib/widget-contrast.mjs';
import { parseDesktopWidgetProtocolFromResponse } from '../src/shell/desktop-shell/runtime/widgets/protocol.js';

const output = path.resolve(process.env.WIDGET_AUDIT_OUTPUT || 'output/widget-audit');
const root = process.cwd();
await fs.mkdir(output, { recursive: true });
const base = process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090';
const buildContext = await readLiveBuildContext(base);
const expectedRevision = process.env.WIDGET_EXPECTED_REVISION || buildContext.build.revision;
assert.ok(expectedRevision, 'WIDGET_EXPECTED_REVISION is required; do not test an intermediate build');
const report = { buildContext, fixture: true, site: base, recordedAt: new Date().toISOString(), expectedRevision,
  boundary: 'Isolated browser document, not the actual desktop. No widget/configuration/content is saved.',
  checks: [], cases: [], errors: [], blockedWrites: [], failedRequests: [], substitutedExternalImages: [] };
const absolute = (href) => new URL(href, base).href;
const get = async (href) => {
  const response = await fetch(absolute(href), { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true, `${href}: HTTP ${response.status}`);
  return response;
};
const manifest = await (await get('/themes/theme-sky-blog-3/assets/asset-manifest.json')).json();
assert.equal(manifest.__meta.revision, expectedRevision);
const localManifest = JSON.parse(await fs.readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
assert.equal(localManifest.__meta.revision, expectedRevision);
report.build = manifest.__meta;
report.sourceFingerprint = buildContext.sourceFingerprint;
const homeHtml = await (await get('/')).text();
assert.ok(homeHtml.includes('/themes/theme-sky-blog-3/'), 'active home must belong to theme3');
const home = parseDesktopWidgetProtocolFromResponse(homeHtml);
assert.equal(home?.isHome, true);
assert.equal(home?.sources.hydrated, true);
report.homeProtocol = { hydrated: home.sources.hydrated, instances: home.instances.map(({ widget, size }) => ({ widget, size })),
  availability: Object.fromEntries(Object.entries(home.sources).filter(([name]) => name.endsWith('Available'))) };
report.sourceHashes = {};
for (const file of ['src/widgets/plugin/douban-showcase/runtime.js', 'src/shared/moments.js']) {
  report.sourceHashes[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
}

const definitions = [
  { key: 'bangumis', id: 'plugin-bangumis.recent', folder: 'bangumis-recent', available: 'bangumisAvailable', sample: 'bangumisByStatus', size: 'large' },
  { key: 'docsme', id: 'plugin-docsme.quick', folder: 'docsme-quick', available: 'docsmeAvailable', sample: 'docsmeProjects', size: 'medium' },
  { key: 'photos', id: 'plugin-photos.gallery', folder: 'photos', available: 'photosAvailable', sample: 'photos', size: 'medium' },
  { key: 'moments', id: 'plugin-moments.recent', folder: 'moments-recent', available: 'momentsAvailable', sample: 'recentMoments', size: 'medium' },
  { key: 'links', id: 'plugin-links.feed', folder: 'links-feed', available: 'friendsAvailable', sample: 'recentFriends', size: 'medium' },
  { key: 'douban', id: 'plugin-douban.showcase', folder: 'douban-showcase', available: 'doubanAvailable', size: 'large' },
  { key: 'steam', id: 'plugin-steam.summary', folder: 'steam-summary', available: 'steamAvailable', sample: 'steamProfile', size: 'medium' }
];
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#405b78"/><circle cx="300" cy="270" r="130" fill="#a6c8cd"/><text x="300" y="530" font-family="sans-serif" font-size="45" text-anchor="middle" fill="white">FIXTURE</text></svg>');
const bangumi = (name) => ({ metadata: { name }, spec: { title: name, cover: svg, url: 'https://example.test/bangumi', totalCount: '12集', score: '8.6' } });
const photo = { metadata: { name: 'fixture-photo' }, spec: { displayName: 'Fixture 照片', groupName: 'fixture-group', url: svg } };
const fixtures = {
  hydrated: true,
  bangumisAvailable: true,
  bangumisByStatus: { anime: { watching: [bangumi('Fixture 在看')], wish: [bangumi('Fixture 想看')], done: [bangumi('Fixture 已看')] } },
  bangumiStatusCounts: { anime: { watching: 1, wish: 1, done: 1 } },
  docsmeAvailable: true, docsmeUrl: '/docs', docsmeProjects: [{ metadata: { name: 'fixture-doc' }, spec: { displayName: 'Fixture 文档', description: '隔离样本，没有创建站点内容' }, status: { totalDocs: 2, permalink: '/docs' } }],
  photosAvailable: true, photosUrl: '/photos', photos: [photo], photoGroups: [{ metadata: { name: 'fixture-group', annotations: {} }, spec: { displayName: 'Fixture 相册' }, status: { photoCount: 1 }, photos: [photo] }],
  momentsAvailable: true, recentMoments: [{ metadata: { name: 'fixture-moment' }, spec: { releaseTime: '2026-09-26T10:00:00Z', content: { html: '<p>Fixture 动态，媒体与文字摘要。</p>', medium: [{ type: 'PHOTO', url: svg }] }, tags: ['Fixture'] }, owner: { displayName: 'Fixture 作者', avatar: svg }, status: { permalink: '/moments' }, stats: { upvote: 2, approvedComment: 0 } }],
  friendsAvailable: true, recentFriends: [{ id: 'fixture-feed', title: 'Fixture 友链更新', summary: '仅用于浏览器渲染验收', author: 'Fixture 友邻', authorLogo: svg, url: 'https://example.test/feed', publishedAt: '2026-09-26T10:00:00Z' }],
  doubanAvailable: true, doubanUrl: '/douban', doubanApiBase: '/__widget_data__/douban',
  steamAvailable: true, steamUrl: '/steam', steamProfile: { personaName: 'Fixture 玩家', steamLevel: 0, avatarFull: svg, playing: false, statusText: '在线' }, steamStats: { totalGames: 0, recentPlaytimeMinutes: 0 }, steamRecentGames: [], steamOwnedGames: []
};
const doubanItems = [{ name: 'Fixture 电影一', poster: svg, score: '8.5', favesScore: 5, favesStatus: 'done', genres: ['剧情'] }, { name: 'Fixture 电影二', poster: svg, score: '7.9', favesScore: 4, favesStatus: 'done', genres: ['喜剧'] }];
const css = manifest['shell-core'].css.map((href) => `<link rel="stylesheet" href="${href}?${manifest.__meta.query}">`).join('');
const documentHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${css}<style>
html,body{height:auto!important;min-height:100%;overflow:auto!important}body{display:block!important;margin:0;padding:24px;background:#e9edf2;color:#17212e;font:14px system-ui}
h1{font-size:24px;margin:0 0 12px}p{margin:0 0 20px}.fixture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;align-items:start}
.fixture-case{min-width:0}.fixture-label{font:12px system-ui;margin-bottom:8px;color:#35495e}.desktop-widget-card{position:relative!important;inset:auto!important;width:100%!important;transform:none!important;pointer-events:auto!important;height:200px!important}.desktop-widget-card.is-large{height:390px!important}.desktop-widget-body{width:100%;height:100%;min-height:0}.fixture-case .desktop-widget-empty{color:#24364b}
</style></head><body data-debug="false"><h1>隔离小组件验收 · 非实际首页</h1><p id="subtitle">使用当前构建样式/渲染器；样本来源逐卡标注。未保存站点配置。</p><main class="fixture-grid" id="cards"></main></body></html>`;
let runtime;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), url: request.url() });
      return route.abort('blockedbyclient');
    }
    const url = new URL(request.url());
    if (request.resourceType() === 'image' && url.hostname === 'douban.img.yyds.pink') {
      // The isolated widget fixture verifies current API text and interaction.
      // Its external poster host is reported separately by the real-page audit.
      report.substitutedExternalImages.push(url.href);
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    }
    if (url.origin === new URL(base).origin && url.pathname === '/__widget_fixture__') return route.fulfill({ contentType: 'text/html', body: documentHtml });
    if (url.origin === new URL(base).origin && url.pathname.startsWith('/__widget_source__/')) {
      const file = path.resolve(root, url.pathname.slice('/__widget_source__/'.length));
      if (!file.startsWith(`${root}/src/`) || !file.endsWith('.js')) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(file, 'utf8') });
    }
    if (url.origin === new URL(base).origin && url.pathname.startsWith('/__widget_data__/douban')) {
      const payload = url.pathname.endsWith('/-/types') ? [{ key: 'movie', doubanCount: 2 }]
        : { items: url.searchParams.get('status') === 'mark' ? [] : doubanItems, total: url.searchParams.get('status') === 'mark' ? 0 : 2 };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
    }
    return route.continue();
  });
  const page = await context.newPage();
  runtime = collectBrowserRuntimeErrors(page);
  await page.goto(absolute('/__widget_fixture__'));
  await page.evaluate(async ({ definitions, query }) => {
    const renderers = {};
    for (const definition of definitions) {
      const imported = await import(`/themes/theme-sky-blog-3/assets/js/chunks/widgets/plugin/${definition.folder}/render.js?${query}`);
      const module = typeof imported.renderWidget === 'function' ? imported : Object.values(imported).find((value) => typeof value?.renderWidget === 'function');
      if (!module) throw new Error(`Built renderWidget export not found: ${definition.id}`);
      renderers[definition.key] = module.renderWidget;
    }
    const { normalizeMomentRecord } = await import('/__widget_source__/src/shared/moments.js');
    const { enhanceDoubanShowcaseWidgets } = await import('/__widget_source__/src/widgets/plugin/douban-showcase/runtime.js');
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    window.widgetFixture = {
      clear() { document.querySelectorAll('[data-douban-showcase]').forEach((node) => node.__doubanShowcaseCleanup?.()); document.querySelector('#cards').innerHTML = ''; },
      render(definition, sources, origin, meta = {}, suffix = '') {
        const article = document.createElement('article');
        article.className = 'fixture-case';
        article.id = `case-${definition.key}${suffix}`;
        const html = renderers[definition.key]({ sources, escapeHtml, normalizeMomentRecord, mode: 'live' }, { widget: definition.id, size: definition.size, meta });
        article.innerHTML = `<div class="fixture-label">${escapeHtml(definition.id)} / ${definition.size} · ${escapeHtml(origin)}</div><div class="desktop-widget-card is-${definition.size} widget--${definition.id.replace(/[^a-z0-9]+/g, '-')}" data-widget-appearance="${definition.key === 'steam' ? 'dark' : 'follow'}"><div class="desktop-widget-body">${html}</div></div>`;
        document.querySelector('#cards').append(article);
        enhanceDoubanShowcaseWidgets(article);
      }
    };
  }, { definitions, query: manifest.__meta.query });

  // Preserve the anonymous homepage protocol exactly; availability flags may be query-gated.
  await page.evaluate(({ definitions, sources }) => { for (const definition of definitions) window.widgetFixture.render(definition, sources, '原始首页SSR协议'); }, { definitions, sources: home.sources });
  if (home.sources.doubanAvailable) {
    await page.waitForFunction(() => document.querySelector('#case-douban [data-douban-showcase]')?.dataset.doubanHydrated === 'true');
    const realDouban = page.locator('#case-douban');
    const realThumbs = realDouban.locator('[data-douban-index]');
    const labels = await realThumbs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    report.realDouban = { api: home.sources.doubanApiBase, railCount: labels.length, labels, source: 'current live public API in isolated host' };
    if (labels.length >= 2) {
      await realThumbs.nth(1).click();
      assert.equal(await realDouban.locator('[data-douban-title]').innerText(), labels[1]);
      await realThumbs.nth(0).focus();
      await page.keyboard.press('Enter');
      assert.equal(await realDouban.locator('[data-douban-title]').innerText(), labels[0]);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      assert.equal(await realDouban.locator('[data-douban-title]').innerText(), labels[1]);
      report.realDouban.keyboardAndClick = 'passed';
      await realDouban.screenshot({ path: path.join(output, 'widget-douban-real-api-keyboard.png') });
      report.checks.push('Live Douban API data in isolated host: pointer click and keyboard selection passed');
    }
  }
  await page.screenshot({ path: path.join(output, 'widgets-original-home-protocol.png'), fullPage: true });
  report.originalHomeCards = await page.locator('.fixture-case').evaluateAll((cards) => cards.map((card) => ({ id: card.id, text: card.innerText })));
  await page.evaluate(() => window.widgetFixture.clear());
  for (const definition of definitions) {
    const value = definition.sample && home.sources[definition.sample];
    const hasReal = home.sources[definition.available] === true && (definition.key === 'bangumis'
      ? Object.values(value || {}).some((bucket) => Object.values(bucket || {}).some((items) => Array.isArray(items) && items.length > 0))
      : Array.isArray(value) ? value.length > 0 : value && JSON.stringify(value) !== '{}');
    const sources = hasReal ? home.sources : { ...fixtures };
    const origin = hasReal ? '真实首页SSR数据' : '受控fixture（不是站点内容）';
    report.cases.push({ key: definition.key, widget: definition.id, size: definition.size, dataOrigin: origin });
    await page.evaluate(({ definition, sources, origin }) => window.widgetFixture.render(definition, sources, origin), { definition, sources, origin });
  }
  await page.waitForFunction(() => document.querySelector('#case-douban [data-douban-showcase]')?.dataset.doubanHydrated === 'true');
  const cards = await page.locator('.fixture-case').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.id, text: node.innerText, width: node.getBoundingClientRect().width,
    anchors: [...node.querySelectorAll('a')].map((anchor) => ({ href: anchor.getAttribute('href'), app: anchor.dataset.pjaxApp, target: anchor.target, rel: anchor.rel }))
  })));
  for (const card of cards) {
    assert.ok(card.text.trim().length > 20, `${card.id}: expected text content missing`);
    assert.ok(card.anchors.length > 0, `${card.id}: representative size must expose a route link`);
    for (const anchor of card.anchors) {
      assert.ok(anchor.href && !/^(?:#|javascript:)/i.test(anchor.href));
      if (anchor.target === '_blank') assert.ok(anchor.rel.includes('noopener'));
    }
  }
  report.populated = cards;
  await page.screenshot({ path: path.join(output, 'widgets-populated-desktop.png'), fullPage: true });
  report.checks.push('7 representative widgets contain text and valid route links; not an accessibility audit');

  const bangumiDefinition = definitions.find(({ key }) => key === 'bangumis');
  await page.evaluate(({ definition, fixtures }) => window.widgetFixture.render(definition, fixtures, '状态隔离fixture', { typeNum: '1', status: 'done' }, '-done'), { definition: bangumiDefinition, fixtures });
  const filtered = page.locator('#case-bangumis-done');
  assert.equal(await filtered.getByText('Fixture 在看', { exact: true }).count(), 0);
  assert.equal(await filtered.getByText('Fixture 想看', { exact: true }).count(), 0);
  assert.ok(await filtered.getByText('Fixture 已看', { exact: true }).count() > 0);
  assert.equal(await filtered.locator('input[type=radio]').count(), 1);
  await filtered.screenshot({ path: path.join(output, 'widget-bangumi-done.png') });
  const progressText = await page.locator('#case-bangumis').innerText();
  assert.match(progressText, /进度未知/);
  assert.doesNotMatch(progressText, /36%/);
  report.checks.push('Bangumi done filter excludes watching/wish; missing progress is neutral unknown');

  const douban = page.locator('#case-douban');
  const thumbnails = douban.locator('[data-douban-index]');
  assert.equal(await thumbnails.count(), 2);
  await thumbnails.nth(1).click();
  assert.equal(await douban.locator('[data-douban-title]').innerText(), 'Fixture 电影二');
  await thumbnails.nth(0).focus();
  await page.keyboard.press('Enter');
  assert.equal(await douban.locator('[data-douban-title]').innerText(), 'Fixture 电影一');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  assert.equal(await douban.locator('[data-douban-title]').innerText(), 'Fixture 电影二');
  await douban.screenshot({ path: path.join(output, 'widget-douban-keyboard.png') });
  report.checks.push('Douban pointer click, focused Enter and Tab+Space select the expected item');

  const steamDefinition = definitions.find(({ key }) => key === 'steam');
  await page.evaluate(({ definition, fixtures }) => window.widgetFixture.render(definition, fixtures, '合法零值fixture', {}, '-zero'), { definition: steamDefinition, fixtures });
  const steamZero = page.locator('#case-steam-zero');
  assert.match(await steamZero.innerText(), /LV\.0/);
  assert.equal(await steamZero.locator('.wg-steam-stats strong').first().innerText(), '0');
  await steamZero.screenshot({ path: path.join(output, 'widget-steam-zero.png') });
  report.checks.push('Steam level/count zero are visible as zero');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'widgets-populated-mobile-fixture.png'), fullPage: true });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(horizontalOverflow, false, 'fixture cards must not overflow narrow viewport');
  report.checks.push('390px isolated fixture has no document horizontal overflow; not actual mobile desktop acceptance');

  report.docsmeMobileAppearance = {
    boundary: 'Docsme header and project-link primary text only, over the solid fixture background. Computed RGB/alpha layers and same-RGB gradient endpoints; not wallpaper/backdrop pixels, other widgets, secondary text or full WCAG conformance.',
    minimumRequiredRatio: 4.5,
    cases: []
  };
  try {
    for (const width of [390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      for (const rootDark of [false, true]) {
        for (const appearance of ['follow', 'light', 'dark']) {
          const sample = await page.evaluate(({ rootDark, appearance }) => {
            document.documentElement.classList.toggle('dark', rootDark);
            const card = document.querySelector('#case-docsme .desktop-widget-card');
            card.dataset.widgetAppearance = appearance;
            const targets = ['.wg-docsme-header-left strong', '.wg-docsme-row-item[href] .wg-docsme-row-title'];
            const text = targets.map((selector) => {
              const target = card.querySelector(selector);
              if (!target) throw new Error(`Docsme contrast target missing: ${selector}`);
              const layers = [];
              for (let node = target; node && node !== document.documentElement; node = node.parentElement) {
                const style = getComputedStyle(node);
                layers.unshift({ backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, opacity: style.opacity });
              }
              return { selector, color: getComputedStyle(target).color, layers };
            });
            const style = getComputedStyle(card);
            return { width: innerWidth, rootDark: document.documentElement.classList.contains('dark'),
              appearance: card.dataset.widgetAppearance, backgroundColor: style.backgroundColor,
              backgroundImage: style.backgroundImage, text };
          }, { rootDark, appearance });
          sample.text = sample.text.map((text) => ({ ...text, ...computedTextContrast(text) }));
          report.docsmeMobileAppearance.cases.push(sample);
          for (const text of sample.text) {
            assert.ok(text.minimumRatio >= report.docsmeMobileAppearance.minimumRequiredRatio,
              `Docsme ${width}px root=${rootDark ? 'dark' : 'light'} appearance=${appearance} ${text.selector}: contrast ${text.minimumRatio.toFixed(3)} < 4.5`);
          }
          if (width === 390) {
            await page.locator('#case-docsme').screenshot({ path: path.join(output, `widget-docsme-mobile-root-${rootDark ? 'dark' : 'light'}-${appearance}.png`) });
          }
        }
      }
    }
  } finally {
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.querySelector('#case-docsme .desktop-widget-card').dataset.widgetAppearance = 'follow';
    });
  }
  report.checks.push('Docsme primary-text contrast >= 4.5 in 12 controlled mobile root-theme/appearance cases');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.widgetFixture.clear());
  for (const definition of definitions) {
    const empty = { ...fixtures, bangumisByStatus: {}, bangumiStatusCounts: {}, docsmeProjects: [], photos: [], photoGroups: [], recentMoments: [], recentFriends: [], steamProfile: {}, steamStats: {}, steamRecentGames: [], steamOwnedGames: [] };
    await page.evaluate(({ definition, sources }) => window.widgetFixture.render(definition, sources, '空数据fixture', definition.key === 'douban' ? { status: 'mark', type: 'movie' } : {}), { definition, sources: empty });
  }
  await page.waitForFunction(() => document.querySelector('#case-douban [data-douban-showcase]')?.dataset.doubanHydrated === 'true');
  report.empty = await page.locator('.fixture-case').evaluateAll((nodes) => nodes.map((node) => ({ id: node.id, text: node.innerText })));
  assert.ok(report.empty.every(({ text }) => text.trim().length > 15));
  await page.screenshot({ path: path.join(output, 'widgets-empty-desktop.png'), fullPage: true });
  report.checks.push('7 empty fixture states contain expected text; visual accessibility is not inferred');
  assert.deepEqual(report.blockedWrites, [], 'unexpected business write attempt');
  Object.assign(report, runtime.snapshot());
  assert.deepEqual(runtimeErrorMessages(report), [], 'browser runtime errors, HTTP and network failures');
  assert.equal((await (await get('/themes/theme-sky-blog-3/assets/asset-manifest.json')).json()).__meta.revision, expectedRevision, 'build must remain stable during the test');
  report.finalBuildContext = await readLiveBuildContext(base);
  assert.equal(report.finalBuildContext.sourceFingerprint, buildContext.sourceFingerprint, 'source must remain stable during the test');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (runtime) { Object.assign(report, runtime.snapshot()); runtime.stop(); }
  await browser.close();
  await fs.writeFile(path.join(output, 'widget-fixture-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, build: report.build, checks: report.checks, failure: report.failure, report: path.join(output, 'widget-fixture-report.json') }, null, 2));
}
