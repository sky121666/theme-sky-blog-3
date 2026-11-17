import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit } from 'playwright';

// Public, read-only acceptance. Override the fixtures for a different Halo site.
const origin = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
const project = process.env.READING_PROJECT_PATH || '/docs/halo-theme-sky-blog-1';
const chapter = process.env.READING_CHAPTER_PATH || project + '/jianjie';
const article = process.env.READING_ARTICLE_PATH || '/archives/mac-restart-podman-container-start';
const away = process.env.READING_AWAY_PATH || '/links';
const provider = process.env.READING_SEO_PROVIDER || 'plugin';
const out = path.resolve(process.env.READING_OUTPUT || 'output/reading-entry-live');
const engine = process.env.READING_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const browser = await ({ chromium, webkit }[engine]).launch(), results = [];
await mkdir(out, { recursive: true });

async function scenario(name, options, run) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
  const rec = { name, engine, version: browser.version() };
  try {
    await ctx.route('**/*', route => {
      const req = route.request();
      if (new URL(req.url()).origin !== origin) return route.abort('blockedbyclient');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fulfill({ status: 204, body: '' });
      return route.continue();
    });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; p.on('pageerror', error => errors.push(error.message));
    await run(p, rec);
    rec.revision = await p.locator('#shell-core-style').evaluate(link => new URL(link.href).searchParams.get('r'));
    assert.deepEqual(errors, []); rec.pass = true;
  } catch (error) { rec.pass = false; rec.error = error.message; }
  finally { await ctx.close(); results.push(rec); console.log(rec.pass ? 'PASS' : 'FAIL', name, rec.error || ''); }
}
async function open(p, url) {
  const response = await p.goto(origin + url, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200, 'public URL');
}
async function identity(p) {
  return p.evaluate(() => ({
    canonical: [...document.querySelectorAll('head link[rel="canonical"]')].map(n => n.href),
    themeCanonical: !!document.querySelector('head link[rel="canonical"][data-theme-seo-fallback]'),
    og: [...document.querySelectorAll('head meta[property="og:url"]')].map(n => n.content),
    schema: [...document.querySelectorAll('head script[type="application/ld+json"]')]
      .flatMap(n => { const j = JSON.parse(n.textContent); return j['@graph'] || j; })
      .filter(n => n['@type'] === 'TechArticle').map(n => n.url || n.mainEntityOfPage?.['@id'])
  }));
}
const serverHeads = {};
try {
  for (const [name, url, selector] of [
    ['chapter', chapter, '.docsme-article'], ['article', article, '#window-frame-root article']
  ]) {
    for (const width of [1440, 390]) {
      await scenario(name + '-without-js-' + width, { javaScriptEnabled: false, viewport: { width, height: 844 } }, async p => {
        await open(p, url);
        await p.waitForLoadState('load');
        const body = p.locator(selector).first();
        assert.ok((await body.textContent()).trim(), 'article must contain server-rendered text');
        assert.ok(await body.isVisible(), 'reader must be visible without JavaScript');
        assert.equal(await p.locator('script[data-theme-startup]').count(), 0, 'a direct reading link does not mount a blocking boot screen');
        const scroller = name === 'chapter' ? '.docsme-main' : '[data-window-content-root][data-window-scroll]';
        const pane = p.locator(scroller).first(), rect = await pane.boundingBox();
        const x = rect.x + rect.width * .5, y = rect.y + rect.height * .55;
        assert.ok(await pane.evaluate((e, pt) => e.scrollHeight > e.clientHeight &&
          e.contains(document.elementFromPoint(pt.x, pt.y)), {x, y}), 'reading pane must be onscreen and scrollable');
        await p.mouse.move(x, y);
        await p.mouse.wheel(0,230);
        // Node polls the browser's scroll position; a no-JS document cannot run an in-page RAF loop.
        for (let i = 0; i < 40 && !await pane.evaluate(e => e.scrollTop); i++) await delay(25);
        assert.ok(await pane.evaluate(e => e.scrollTop > 0), 'native scrolling must work without scripts');
        await p.screenshot({ path: path.join(out, name + '-nojs-' + width + '.png') });
      });
    }
  }
  for (const js of [false, true]) {
    await scenario('canonical-' + (js ? 'enhanced' : 'server'), { javaScriptEnabled: js }, async (p, rec) => {
      const heads = {};
      for (const [key, url] of [['chapter', chapter], ['alias', project]]) {
        await open(p, url);
        if (js) await p.waitForFunction(() => !!window.Alpine && !!window.pjax);
        assert.equal(new URL(p.url()).pathname, url, 'keep the project entry dynamic');
        heads[key] = await identity(p);
        if (!js) serverHeads[key] = heads[key];
      }
      rec.heads = heads;
      const preferred = heads.chapter.canonical[0];
      assert.ok(preferred && new URL(preferred).pathname === chapter);
      for (const [key, head] of Object.entries(heads)) {
        const expected = provider === 'plugin' && key === 'alias' ? new URL(project, preferred).href : preferred;
        assert.deepEqual(head.canonical, [expected], 'canonical belongs to ' + provider);
        assert.equal(head.themeCanonical, provider === 'theme', 'correct metadata owner');
        if (provider === 'theme') assert.deepEqual(head.og, [expected]);
        if (js) assert.deepEqual(head, serverHeads[key], 'initialization must preserve server metadata');
      }
    });
  }
  await scenario('canonical-swup', {}, async (p, rec) => {
    await open(p, '/docs'); await p.waitForFunction(() => !!window.pjax);
    await p.evaluate(() => {
      window.__readingSeo = { desktop: document.querySelector('.desktop-surface'), ready: false };
      document.addEventListener('theme:pjax-ready', () => { window.__readingSeo.ready = true; }, { once: true });
    });
    await p.locator('a[href="' + project + '"]:visible').first().press('Enter');
    await p.waitForFunction(() => window.__readingSeo?.ready);
    assert.equal(new URL(p.url()).pathname, project);
    rec.head = await identity(p); assert.deepEqual(rec.head, serverHeads.alias);
    assert.ok(await p.evaluate(() => window.__readingSeo.desktop === document.querySelector('.desktop-surface')));
  });
  await scenario('desktop-home-without-js', { javaScriptEnabled: false }, async p => {
    await open(p, '/'); assert.ok(await p.locator('.desktop-surface').isVisible());
    assert.equal(await p.locator('.window-layer').isVisible(), false, 'home must not show a reading window');
  });
  await scenario('enhanced-window-restores-saved-geometry', {}, async (p, rec) => {
    await p.addInitScript(() => localStorage.setItem('theme-window-metrics-docsme',
      JSON.stringify({x:64, y:70, width:1000, height:680})));
    await open(p, chapter);
    const surface = p.locator('[data-window-surface]').first();
    await p.waitForFunction(() => document.querySelector('[data-window-surface]')?.style.left === '64px');
    rec.rect = await surface.boundingBox();
    for (const [key, v] of Object.entries({x:64, y:70, width:1000, height:680}))
      assert.ok(Math.abs(rec.rect[key] - v) <= 2, 'saved ' + key + ' takes precedence over initial CSS');
  });
  for (const [name, url, scroller] of [
    ['document', chapter, '.docsme-main'], ['article', article, '[data-window-content-root][data-window-scroll]']
  ]) {
    await scenario(name + '-back', {}, async (p, rec) => {
      await open(p, url);
      await p.waitForFunction(() => !!window.Alpine && !!window.pjax);
      const surface = p.locator(scroller).first(); await surface.waitFor({ state: 'visible' });
      const box = await surface.boundingBox(); const max = await surface.evaluate(e => e.scrollHeight - e.clientHeight);
      const distance = Math.min(700, Math.floor(max * .6)); assert.ok(distance > 60, 'test fixture needs a scrollable article');
      await p.mouse.move(box.x + box.width * .48, box.y + box.height * .55); await p.mouse.wheel(0, distance);
      await p.waitForFunction(({ sel, offset }) => Math.abs(document.querySelector(sel).scrollTop - offset) <= 2,
        { sel: scroller, offset: distance });
      rec.before = await surface.evaluate(e => e.scrollTop);
      await p.evaluate(() => { window.__readingVisit = { desktop: document.querySelector('.desktop-surface'), routes: [] };
        document.addEventListener('theme:pjax-ready', () => window.__readingVisit.routes.push(location.pathname)); });
      const ready = target => p.waitForFunction(t => window.__readingVisit?.routes.includes(t), target);
      await p.locator('a[href="' + away + '"]:visible').first().click();
      await ready(away); await p.goBack({ waitUntil: 'commit' }); await ready(url);
      await surface.waitFor({ state: 'visible' });
      await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      rec.after = await surface.evaluate(e => e.scrollTop);
      assert.ok(Math.abs(rec.after - rec.before) <= 2, 'reading position: ' + rec.before + ' → ' + rec.after);
      assert.ok(await p.evaluate(() => window.__readingVisit.desktop === document.querySelector('.desktop-surface')), 'desktop survived traversal');
    });
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'result.json'), JSON.stringify(results, null, 2) + '\n');
}
if (results.some(r => !r.pass)) process.exitCode = 1;
