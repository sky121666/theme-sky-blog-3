// Diagnostic for a local development site. No cache flush, plugin changes or writes.
import http from 'node:http';
import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090');
const out = path.resolve(process.env.COLD_OUTPUT || 'output/reading-cold');
const reps = Math.max(1, Number(process.env.COLD_REPEATS || 3));
const chapter = process.env.READING_CHAPTER_PATH || '/docs/halo-theme-sky-blog-1/jianjie';
const post = process.env.READING_ARTICLE_PATH || '/archives/mac-restart-podman-container-start';
const project = process.env.READING_PROJECT_PATH || '/docs/halo-theme-sky-blog-1';
const routes = ['/', '/docs', chapter, '/archives', post, '/photos', '/shop/products'];
const report = { origin: base.origin, repetitions: reps, http: [], browser: [], clicks: [] };
await mkdir(out, { recursive: true });
const save = () => writeFile(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');

function raw(route, bypass) {
  return new Promise((resolve, reject) => {
    const start = performance.now(), ms = () => Math.round(performance.now() - start);
    const headers = { Accept: 'text/html', 'Accept-Encoding': 'identity', ...(bypass ? { 'Cache-Control': 'no-cache' } : {}) };
    const request = (base.protocol === 'https:' ? https : http).get(new URL(route, base), { headers }, res => {
      const rec = { route, bypass, status: res.statusCode, headersMs: ms(), pageCache: res.headers['x-halo-cache-at'] || null };
      const chunks = []; let n = 0;
      res.on('data', chunk => { chunks.push(chunk); n += chunk.length; rec.firstBodyMs ??= ms(); });
      res.on('error', reject);
      res.on('end', () => {
        rec.endMs = ms(); rec.bytes = n;
        const head = Buffer.concat(chunks).toString().split('</head>', 1)[0];
        rec.headCss = (head.match(/<link\b[^>]*\brel=["']stylesheet["']/gi) || []).length;
        const scripts = head.match(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi) || [];
        rec.parserBlockingPluginScripts = scripts.filter(s => /src=["'][^"']*\/plugins\//i.test(s) && !/\b(?:async|defer)\b|type=["']module["']/i.test(s))
          .map(s => s.match(/src=["']([^"']+)/i)[1].split('?')[0]);
        resolve(rec);
      });
    });
    request.on('error', reject); request.setTimeout(30000, () => request.destroy(new Error('HTTP timeout: ' + route)));
  });
}

let browser;
async function visit(route, target = null, firstPartyOnly = false, options = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 },
    ...(options.member ? {storageState:process.env.COLD_STORAGE_STATE} : {}) });
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (options.latency) await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:options.latency,
    downloadThroughput:10e6/8, uploadThroughput:3e6/8});
  if (options.cpu) await cdp.send('Emulation.setCPUThrottlingRate',{rate:options.cpu});
  if (options.played) await ctx.addInitScript(() => sessionStorage.setItem('theme:startup:played:v1','1'));
  await ctx.route('**/*', handler => {
    const req = handler.request(), local = new URL(req.url()).origin === base.origin;
    if (!['GET','HEAD','OPTIONS'].includes(req.method())) return handler.fulfill({ status: 204, body: '' });
    if (!local) return firstPartyOnly ? handler.abort('blockedbyclient') : handler.continue();
    return handler.continue({ headers: { ...req.headers(), 'cache-control': 'no-cache' } });
  });
  const pages = [];
  page.on('response', res => {
    const u = new URL(res.url()), h = res.headers();
    if (u.origin === base.origin && /text\/html/.test(h['content-type'] || ''))
      pages.push({ route: u.pathname, status: res.status(), pageCache: h['x-halo-cache-at'] || null, type: res.request().resourceType() });
  });
  await page.addInitScript(() => {
    const tr = window.__coldReading = { accepted: [], ready: [], long: [], lcp: null };
    const now = () => Math.round(performance.now());
    try { new PerformanceObserver(list => list.getEntries().forEach(e => tr.long.push([Math.round(e.startTime),Math.round(e.duration)]))).observe({type:'longtask',buffered:true}); } catch {}
    try { new PerformanceObserver(list => { tr.lcp = Math.round(list.getEntries().at(-1).startTime); }).observe({type:'largest-contentful-paint',buffered:true}); } catch {}
    document.addEventListener('theme:navigation-accepted', () => tr.accepted.push(now()));
    document.addEventListener('theme:pjax-ready', () => tr.ready.push(now()));
    let bootstrap;
    function frame() {
      const home = location.pathname === '/';
      const content = document.querySelector(home ? '.desktop-surface' : '#window-frame-root .docsme-main h1, #window-frame-root article, #window-frame-root [data-app-root], #window-frame-root [data-window-content-root]');
      if (tr.content == null && content?.getClientRects().length && !document.querySelector('.theme-startup-layer')) {
        const rc=content.getBoundingClientRect(), x=Math.min(innerWidth-1,Math.max(0,rc.left+Math.min(rc.width/2,52))), y=Math.min(innerHeight-1,Math.max(0,rc.top+Math.min(rc.height/2,45)));
        const hit=document.elementFromPoint(x,y);
        if (hit && (content.contains(hit) || hit.contains(content) || (!home && hit.closest('#window-frame-root')))) tr.content = now();
      }
      const heading = document.querySelector('[data-reading-scroll] h1, .post-header .post-title');
      if (heading && tr.readingTitle == null && !document.querySelector('.theme-startup-layer')) {
        const rect = heading.getBoundingClientRect(), x = rect.left + 12, y = rect.top + Math.min(12, rect.height / 2);
        if (rect.width && rect.height && heading.contains(document.elementFromPoint(x, y))) tr.readingTitle = now();
      }
      if (!bootstrap && window.__THEME_BOOTSTRAP_READY__) {
        bootstrap = window.__THEME_BOOTSTRAP_READY__;
        bootstrap.then(() => { tr.bootstrap = now(); }, () => { tr.bootstrapError = true; });
      }
      if (!tr.interactive && tr.content != null && tr.bootstrap != null && window.pjax) tr.interactive = now();
      if ((tr.interactive == null || (heading && tr.readingTitle == null)) && now() < 30000) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  const rec = { route, target, firstPartyOnly, options, pages };
  try {
    await page.goto(new URL(route,base).href, {waitUntil:'commit', timeout:30000});
    await page.waitForFunction(isReader => window.__coldReading?.interactive != null &&
      (!isReader || window.__coldReading.readingTitle != null), route === chapter || route === post, {timeout:30000});
    if (target) {
      const anchor = page.locator('a[href="'+target+'"]:visible').first();
      await anchor.press('Enter');
      await page.waitForFunction(() => !!window.__coldReading.ready.length, null, {timeout:30000});
      rec.finalPath = new URL(page.url()).pathname;
    }
    Object.assign(rec, await page.evaluate(({ target }) => {
      const t=window.__coldReading, nav=performance.getEntriesByType('navigation')[0];
      const resources=performance.getEntriesByType('resource');
      const fg=target ? resources.filter(r => {const u=new URL(r.name); return u.origin===location.origin && u.pathname===target;}).at(-1) : null;
      const fcp=performance.getEntriesByName('first-contentful-paint')[0];
      const completed=resources.filter(r=>new URL(r.name).origin===location.origin && r.responseEnd<=t.interactive);
      const assetGroups={theme:0,plugins:0,other:0};
      for (const r of completed) {
        const p=new URL(r.name).pathname; assetGroups[p.startsWith('/themes/')?'theme':p.startsWith('/plugins/')?'plugins':'other']+=r.transferSize;
      }
      return { revision:window.__THEME_ASSET_IDENTITY__?.revision, ttfb:Math.round(nav.responseStart), htmlEnd:Math.round(nav.responseEnd), dcl:Math.round(nav.domContentLoadedEventEnd),
        authenticated:document.querySelector('[data-theme-settings-protocol]')?.dataset.authenticated==='true',
        localTransferBeforeReady:completed.reduce((s,r)=>s+r.transferSize,0), assetGroups,
        largestLocalAssets:[...completed].sort((a,b)=>b.transferSize-a.transferSize).slice(0,6).map(r=>({path:new URL(r.name).pathname,bytes:r.transferSize})),
        fcp:fcp && Math.round(fcp.startTime), content:t.content, readingTitle:t.readingTitle, bootstrap:t.bootstrap, interactive:t.interactive, lcpSample:t.lcp,
        longTasksBeforeReady:t.long.filter(([start])=>start<=t.interactive),
        firstPartyBeforeReady:resources.filter(r=>new URL(r.name).origin===location.origin&&r.startTime<=t.interactive).length,
        pluginBeforeReady:resources.filter(r=>new URL(r.name).origin===location.origin&&new URL(r.name).pathname.startsWith('/plugins/')&&r.startTime<=t.interactive).length,
        localLastBeforeReady:resources.filter(r=>new URL(r.name).origin===location.origin && r.responseEnd<=t.interactive)
          .sort((a,b)=>b.responseEnd-a.responseEnd).slice(0,6).map(r=>({path:new URL(r.name).pathname,start:Math.round(r.startTime),end:Math.round(r.responseEnd)})),
        click:t.accepted.at(-1), targetReady:t.ready.at(-1), targetGet:fg && {start:Math.round(fg.startTime),headers:Math.round(fg.responseStart),end:Math.round(fg.responseEnd)} };
    }, {target}));
    if (!pages.some(x=>x.route===route) || pages.some(x=>x.pageCache)) rec.error='uncertain page-cache bypass';
    if (target && (!rec.targetGet || !pages.some(x=>x.route===target) || rec.click == null)) rec.error='target GET or admission was not observed';
  } catch (e) { rec.error=e.message; }
  finally { await ctx.close(); }
  return rec;
}
try {
  browser=await chromium.launch();
  if (process.env.COLD_MODE === 'public-apps') {
    const appRoutes=[...new Set([...routes,'/categories','/tags','/moments','/links','/steam','/douban','/bangumis','/equipments'])];
    const options={label:'public-first-party-uncached-startup-already-played',played:true};
    for (let n=0; n<reps; n++) {
      const offset=n%appRoutes.length;
      for (const route of [...appRoutes.slice(offset),...appRoutes.slice(0,offset)]) {
        const record=await visit(route,null,true,options);
        if (!record.revision || !record.pages.some(p=>p.route===route && p.status===200 && p.type==='document')) record.error??='destination document not verified';
        report.browser.push(record); await save();
      }
    }
  } else if (process.env.COLD_MODE === 'profiles') {
    const profiles = [{label:'ordinary'}, {label:'startup-already-played',played:true},
      {label:'80ms-10Mbps',latency:80}, {label:'CPU-4x',cpu:4}, {label:'80ms-10Mbps-CPU-4x',latency:80,cpu:4}];
    if (process.env.COLD_STORAGE_STATE) profiles.push({label:'member',member:true});
    for (let n=0;n<reps;n++) for(const options of [...profiles.slice(n),...profiles.slice(0,n)]) {
      const record = await visit(chapter,null,!!options.member,options);
      if (options.member && !record.authenticated) record.error='session expired; not a member sample';
      report.browser.push(record); await save();
    }
  } else {
    for (let n=0; n<reps; n++) for (const route of [...routes.slice(n), ...routes.slice(0,n)]) {
      report.http.push(await raw(route,true),await raw(route,false));
    }
    await save();
    for (let n=0; n<reps; n++) {
      const list=['/',chapter,post,'/photos','/shop/products'];
      for (const r of [...list.slice(n),...list.slice(0,n)]) {report.browser.push(await visit(r)); await save();}
      for (const [r,t] of [['/docs',project],['/archives',post]]) {report.clicks.push(await visit(r,t)); await save();}
    }
    // A labelled diagnostic control for third-party influence; never mixed into field timings.
    report.firstPartyControl=await visit(chapter,null,true);
  }
} finally { await browser?.close(); await save(); }
const failed=[...report.browser,...report.clicks,report.firstPartyControl].filter(r=>r?.error);
console.log(JSON.stringify({http:report.http.length,browser:report.browser.length,clicks:report.clicks.length,failed:failed.map(r=>[r.route,r.target,r.error])}));
if (report.http.some(r=>r.bypass&&r.pageCache) || failed.length) process.exitCode=1;
