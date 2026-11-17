import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const site = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
const out = path.resolve(process.env.RECOVERY_OUTPUT || 'output/content-recovery');
const build = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json', 'utf8')).__meta;
const browser = await chromium.launch();
const tests = [];
await fs.mkdir(out, { recursive: true });
async function run(name, width, task) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, reducedMotion: 'reduce', locale: 'zh-CN', serviceWorkers: 'block', extraHTTPHeaders: { 'Cache-Control': 'no-cache' } });
  const row = { name, width, errors: [], intercepted: [], blockedWrites: [] };
  tests.push(row);
  let intercept;
  try {
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method();
      if (u.origin !== site) return route.abort('blockedbyclient');
      if (intercept && await intercept(route, u, m)) { row.intercepted.push([m, u.pathname]); return; }
      if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return route.continue();
      if (u.pathname.endsWith('/trackers/counter')) return route.fulfill({ status: 204, body: '' });
      row.blockedWrites.push([m,u.pathname]); return route.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(18000);
    page.on('pageerror', e => row.errors.push(e.message));
    const visit = async (pathname, app) => {
      const res = await page.goto(new URL(pathname, site).href, { waitUntil: 'domcontentloaded', timeout: 50000 });
      assert.equal(res.status(), 200);
      assert.ok((await res.text()).includes('r=' + build.revision), 'page did not serve current shell');
      await page.waitForFunction(id => window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId === id && !window.__THEME_STARTUP__?.active && !document.querySelector('[data-theme-startup-layer]'), app);
    };
    await task({ page, visit, set: fn => { intercept = fn; }, row });
    assert.deepEqual(row.errors, []); assert.deepEqual(row.blockedWrites, []); row.pass = true;
  } catch (e) { row.pass = false; row.error = String(e.message); }
  finally { await ctx.close(); await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ origin: site, build, tests }, null, 2)); }
  console.log(row.pass ? 'PASS' : 'FAIL', name, row.error || '');
}
try {
for (const archive of [true, false]) await run(archive ? 'archives-truncation-retry' : 'photos-truncation-retry', archive ? 1440 : 390, async ({page,visit,set,row}) => {
  const source = archive ? '/archives/2025/03' : '/photos';
  const cards = page.locator(archive ? '[data-archive-post-option]' : '.photo-card');
  let tries = 0;
  set(async (route,u,m) => {
    if (m !== 'GET' || !(archive ? u.pathname === source + '/page/2' : u.pathname === source && u.searchParams.get('page') === '2')) return;
    if (++tries !== 1) return;
    const response = await route.fetch(), body = await response.text();
    const anchors = [...body.matchAll(archive ? /<a\b[^>]*\bdata-archive-post-option\b[^>]*>/gi : /<a\b[^>]*class="photo-card pjax-link"[^>]*>/gi)];
    assert.ok(anchors.length > 1, 'page 2 has insufficient actual records');
    await route.fulfill({status:200,contentType:'text/html',body:body.slice(0,anchors[1].index)}); return true;
  });
  await visit(source, archive ? 'explorer-archives' : 'photos');
  row.before = await cards.count();
  if (archive) await page.locator('[data-archive-loadmore]').click();
  else await page.locator('.photos-scroll-sentinel').scrollIntoViewIfNeeded();
  const retry = page.locator(archive ? '.archive-load-more--retry' : '[data-photos-retry]');
  await retry.waitFor({state:'visible'});
  assert.equal(await cards.count(), row.before); assert.equal(new URL(page.url()).pathname, source);
  await retry.click();
  await page.waitForFunction(({archive,n})=>document.querySelectorAll(archive?'[data-archive-post-option]':'.photo-card').length>n,{archive,n:row.before});
  row.after = await cards.count(); assert.ok(tries >= 2);
});
await run('docs-mobile-failure-then-retry',390,async ({page,visit,set,row})=>{
  await visit('/docs/halo-theme-sky-blog-1','docsme');
  const toggle=page.locator('[data-docsme-toggle-sidebar]').first();
  await toggle.click(); const link=page.locator('.docsme-tree a:visible').first();
  const destination=new URL(await link.getAttribute('href'),site), previous=page.url();
  assert.notEqual(destination.href,previous);
  let fail=true;
  set(async (route,u,m)=>{ if (fail && m==='GET' && u.pathname===destination.pathname) {await route.fulfill({status:503,contentType:'text/html',body:'<html><body>temporarily unavailable</body></html>'});return true;} });
  await page.evaluate(()=>document.addEventListener('theme:navigation-settled',()=>{window.__recoverySettled=true},{once:true}));
  await link.focus();await link.press('Enter');await page.waitForFunction(()=>window.__recoverySettled);
  assert.equal(page.url(),previous);assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  assert.ok(await link.evaluate(el=>el===document.activeElement && !el.closest('[inert]')));
  fail=false;await link.press('Enter');await page.waitForURL(destination.href,{waitUntil:'commit'});
  await page.waitForFunction(()=>document.querySelector('[data-docsme-toggle-sidebar]')?.getAttribute('aria-expanded')==='false');
  row.destination=destination.pathname;
});
await run('links-back-restores-card-focus',390,async ({page,visit})=>{
  await visit('/links','links'); const card=page.locator('[data-link-card]').first();
  await card.focus(); await card.press('Enter');
  await page.waitForFunction(()=>location.search.includes('link=') && document.activeElement.matches('.links-detail-back'));
  await page.evaluate(()=>history.back());
  await page.waitForFunction(()=>!location.search.includes('link=') && document.activeElement.matches('[data-link-card]'));
  assert.ok(await card.evaluate(el=>el===document.activeElement));
});
await run('steam-unavailable-dates-and-retry',390,async ({page,visit,set})=>{
  let fail = true;
  set(async (route,u,m)=>{if(fail && m==='GET'&&u.pathname.endsWith('/heatmap/records')) {await route.fulfill({status:503,body:'unavailable'});return true;}});
  await visit('/steam','steam');const panel=page.locator('.steam-heatmap-panel'),retry=panel.locator('.steam-heatmap-retry');
  await retry.waitFor({state:'visible'});await panel.locator('[data-steam-heatmap-grid] > span[tabindex="0"]').focus();await page.keyboard.press('ArrowLeft');
  assert.match(await page.locator(':focus').getAttribute('aria-label'),/暂不可用/);assert.match(await panel.locator('[data-steam-heatmap-detail]').innerText(),/暂不可用/);
  fail=false;await retry.click();await page.waitForFunction(()=>document.querySelector('.steam-heatmap-panel')?.dataset.steamHeatmapState==='ready');
});
await run('douban-missing-and-valid-quicklook',390,async({page,visit,set})=>{
  set(async(route,u,m)=>{if (m==='GET'&&u.pathname.endsWith('/doubanmovies')&&Number(u.searchParams.get('size'))>1){
    const res=await route.fetch(), data=await res.json();assert.ok(data.items.length>1);
    data.items[0].link='';data.items[0].poster='';data.items[1].link=site+'/';data.items[1].poster=site+'/themes/theme-sky-blog-3/assets/images/wallpaper-presets/tahoe-blue.svg';
    await route.fulfill({response:res,json:data});return true;}});
  await visit('/douban','douban');const cards=page.locator('[data-douban-grid] [data-douban-item-id]'),dialog=page.locator('[data-douban-quicklook] [role="dialog"]');
  await cards.first().click();await dialog.waitFor({state:'visible'});
  const link=dialog.locator('[data-douban-preview-link]'),img=dialog.locator('[data-douban-preview-poster]'),placeholder=dialog.locator('[data-douban-preview-placeholder]');
  assert.ok(!await link.isVisible());assert.equal(await link.getAttribute('href'),null);assert.ok(!await img.isVisible() && await placeholder.isVisible());
  await page.keyboard.press('Escape');await cards.nth(1).click();await link.waitFor({state:'visible'});await img.waitFor({state:'visible'});
  assert.equal(await link.getAttribute('href'),site+'/');assert.ok(!await placeholder.isVisible());
});
await run('reader-login-html-is-not-a-like',1440,async({page,visit,set})=>{
  await visit('/archives','explorer-archives'); const article=await page.locator('[data-archive-post-option]').first().getAttribute('href');await visit(article,'reader');
  let writes=0;set(async(route,u,m)=>{if(m==='POST' && u.pathname.endsWith('/trackers/upvote')){writes++; await route.fulfill({status:302,headers:{location:site+'/login'}});return true;}
    if(m==='GET'&&u.pathname==='/login'){await route.fulfill({status:200,contentType:'text/html',body:'<html><body>login</body></html>'});return true;}});
  const button=page.locator('.post-action-chip--like'),state=()=>page.evaluate(()=>{const m=window.Alpine.$data(document.querySelector('.post-actions-shell'));return [m.liked, m.upvotes,localStorage.getItem(m.storageKey)];});
  const before=await state();const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/login');await button.click();await response;
  await page.waitForFunction(()=>!window.Alpine.$data(document.querySelector('.post-actions-shell')).loading);assert.deepEqual(await state(),before);assert.equal(writes,1);
});
await run('photos-mobile-comment-surface',390,async({page,visit,row})=>{
  await visit('/photos','photos');const photo=await page.locator('.photo-card').first().getAttribute('href');await visit(photo,'photos');
  await page.locator('[data-photos-control="comments-toggle"]:visible').first().click();const form=page.locator('.photos-detail-comment-drawer > section:visible');
  await form.waitFor();row.background=await form.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.match(row.background,/^rgb\(/);await page.screenshot({path:path.join(out,'photos-comments-390.png')});
});
} finally {await browser.close();}
if(tests.some(t=>!t.pass)) process.exitCode=1;
