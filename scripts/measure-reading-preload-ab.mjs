// Anonymous HTTP development site. A loopback-only HTTP proxy keeps Chromium's
// actual document origin, streaming parser and CDP network shaping in both arms.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';
import { readingHintFilter, summarizePairs } from './lib/reading-preload-ab.mjs';

const origin = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
assert.equal(new URL(origin).protocol, 'http:', 'Use a local HTTP Halo dev site; no TLS interception');
const manifest = assertCurrentBuild();
const meta = manifest.__meta;
const assets = manifest['shell-core'].js[0].split('/assets/')[0] + '/assets/';
const experimentalHref = assets + 'js/chunks/shell-runtime/runtime/desktop/pjax/swup-navigation.js?' + meta.query;
const repetitions = Number(process.env.READING_AB_PAIRS || 20);
assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0);
const project = process.env.READING_PROJECT_PATH || '/docs/halo-theme-sky-blog-1';
const fixtures = { chapter: process.env.READING_CHAPTER_PATH || project + '/jianjie',
  article: process.env.READING_ARTICLE_PATH || '/archives/mac-restart-podman-container-start' };
const entries = process.env.READING_AB_ENTRY ? [process.env.READING_AB_ENTRY] : Object.keys(fixtures);
for (const key of entries) assert.ok(Object.hasOwn(fixtures, key), 'Unknown READING_AB_ENTRY');
const outBase = path.resolve(process.env.READING_AB_OUTPUT || 'output/reading-preload-ab', meta.revision);
await mkdir(outBase, { recursive: true });
const out = await mkdtemp(path.join(outBase, 'run-'));
const report = { origin, build: meta, repetitions, fixtures, entries, profile: {
  latencyMs: 80, downloadMbps: 10, uploadMbps: 3, cpuSlowdown: 4,
  browserCache: false, serviceWorkers: 'block', cacheControl: 'no-cache', sameOriginOnly: true,
  mainDocument: 'streaming HTTP proxy, identity encoding; control masks only marked links using equal-length spaces',
  entryGate: '>=20 pairs, paired median and difference of group medians both >=50ms, title P75 increase <=50ms; exact module requests once'
}, samples: {}, scope: [], summaries: {} };
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
let active, browser;
const proxy = http.createServer((request, response) => {
  let url;
  try { url = new URL(request.url); } catch { response.writeHead(400).end(); return; }
  if (!active || url.origin !== origin) { response.writeHead(403).end(); return; }
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) { response.writeHead(204).end(); return; }
  const run = active;
  const document = request.headers['sec-fetch-dest'] === 'document' && url.href === run.document;
  // Every upstream request uses exactly no-cache, including Chromium's
  // browser-internal loads whose default headers can have extra directives.
  const headers = { ...request.headers, 'cache-control': 'no-cache', host: url.host };
  delete headers['proxy-connection']; delete headers['proxy-authorization']; delete headers.connection;
  if (document) headers['accept-encoding'] = 'identity';
  if (url.pathname.includes('/assets/js/')) run.scripts.push(url.href);
  const upstream = http.request(url, { method: request.method, headers }, res => {
    const sent = { ...res.headers };
    delete sent.connection; delete sent['keep-alive']; delete sent['transfer-encoding'];
    const fail = e => { response.destroy(e); };
    res.on('error', fail);
    if (!document) { response.writeHead(res.statusCode, sent); res.pipe(response); return; }
    run.documents.push({ status: res.statusCode, cacheControl: headers['cache-control'],
      haloCacheAt: sent['x-halo-cache-at'] ?? null, contentEncoding: sent['content-encoding'] || 'identity' });
    delete sent['content-length'];
    response.writeHead(res.statusCode, sent); response.flushHeaders();
    const filter = readingHintFilter(run.variant, hint => run.hints.push(new URL(hint, origin).href), experimentalHref);
    filter.on('error', fail); res.pipe(filter).pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
});
proxy.on('connect', (_, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });

function measureFrames() {
  const tr = window.__readingPreloadAB = {};
  let bootstrap, timeout = performance.now() + 40000;
  function frame(now) {
    const el = document.querySelector('[data-reading-scroll] h1, .post-header .post-title');
    const visible = node => {
      if (!node || document.querySelector('.theme-startup-layer')) return false;
      const box = node.getBoundingClientRect();
      return box.width && box.height && node.contains(document.elementFromPoint(box.left + Math.min(12, box.width / 2), box.top + Math.min(12, box.height / 2)));
    };
    if (tr.title == null && visible(el)) tr.title = performance.now();
    if (!bootstrap && window.__THEME_BOOTSTRAP_READY__) {
      bootstrap = window.__THEME_BOOTSTRAP_READY__;
      bootstrap.then(() => { tr.bootstrap = performance.now(); }, e => { tr.error = String(e); });
    }
    if (tr.interactive == null && tr.title != null && tr.bootstrap != null && window.pjax?.swup)
      tr.interactive = performance.now();
    if (tr.interactive == null && !tr.error && now < timeout) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function visit(key, variant) {
  const document = new URL(fixtures[key], origin).href;
  const run = active = { document, variant, documents: [], scripts: [], hints: [] };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width:1440,height:900 },
    extraHTTPHeaders: { 'Cache-Control': 'no-cache' } });
  try {
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline:false,latency:80,downloadThroughput:10e6/8,uploadThroughput:3e6/8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate:4 });
    await page.addInitScript(measureFrames);
    const response = await page.goto(document, { waitUntil:'commit', timeout:40000 });
    assert.equal(response.status(), 200, document); assert.equal(response.url(), document, 'No redirects in reading fixtures');
    await page.waitForFunction(() => window.__readingPreloadAB?.interactive != null || window.__readingPreloadAB?.error, null, { timeout:40000 });
    const sampled = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return { ...window.__readingPreloadAB, ttfb:nav.responseStart, htmlEnd:nav.responseEnd,
        shell:document.querySelector('link#shell-core-style')?.href,
        markers:[...document.querySelectorAll('head link[data-reading-navigation-preload]')].map(n=>n.href),
        resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/assets/js/'))
          .map(e=>({href:e.name,transferBytes:e.transferSize,startMs:e.startTime,endMs:e.responseEnd})) };
    });
    assert.ok(!sampled.error && Number.isFinite(sampled.interactive) && Number.isFinite(sampled.title), sampled.error || 'Missing visible heading or Swup readiness');
    assert.equal(new URL(sampled.shell).searchParams.toString(), meta.query, 'Served shell build differs');
    assert.deepEqual(run.documents, [{status:200,cacheControl:'no-cache',haloCacheAt:null,contentEncoding:'identity'}], 'Document must be an uncached network GET through the proxy');
    assert.ok(run.hints.length && new Set(run.hints).size === run.hints.length, 'Missing or duplicate SSR hint');
    assert.deepEqual(sampled.markers, variant === 'with' ? run.hints : [], 'SSR control must mask only its reading hints');
    const requests = {};
    for (const hint of run.hints) {
      const url = new URL(hint);
      assert.equal(url.origin, origin); assert.equal(url.searchParams.toString(), meta.query);
      const suffix = url.pathname.slice(url.pathname.indexOf('/assets/js/'));
      assert.deepEqual(run.scripts.filter(s => new URL(s).pathname.endsWith(suffix)), [hint], 'Duplicate or different request for ' + suffix);
      const downloads = sampled.resources.filter(r => r.href === hint);
      assert.ok(downloads.length === 1 && downloads[0].transferBytes > 0 && downloads[0].endMs > 0, 'Module did not finish one network transfer: ' + hint);
      requests[suffix] = downloads[0];
    }
    const { resources, markers, ...metrics } = sampled;
    return { ...metrics, requests, hints:run.hints, documents:run.documents };
  } finally { await ctx.close(); active = null; }
}

try {
  const exclusions = ['/', '/docs', process.env.READING_CATALOG_PATH || project + '/theme-settings', '/login', '/shop/products'];
  for (const route of exclusions) {
    const res = await fetch(new URL(route, origin), { headers:{ 'Cache-Control':'no-cache' }, redirect:'error', signal:AbortSignal.timeout(15000) });
    assert.equal(res.status, 200, route); assert.equal(res.headers.get('x-halo-cache-at'), null, 'Cached exclusion ' + route);
    assert.doesNotMatch(await res.text(), /<link\b[^>]*\sdata-reading-navigation-preload(?=[\s=/>])/i, route);
    report.scope.push({route,status:res.status,hints:0});
  }
  browser = await chromium.launch({ proxy:{server:'http://127.0.0.1:' + proxy.address().port,bypass:'<-loopback>'} });
  report.chromium = browser.version();
  for (const k of entries) report.samples[k] = [];
  for (let i=0; i<repetitions; i++) {
    for (const k of (i % 2 ? [...entries].reverse() : entries)) {
      const pair = { number:i+1, order:i % 2 ? ['with','without'] : ['without','with'] };
      report.samples[k].push(pair);
      for (const arm of pair.order) { pair[arm] = await visit(k, arm); await save(); }
      assert.deepEqual(pair.with.hints, pair.without.hints, 'Build changed between arms');
      console.log(k, i+1 + '/' + repetitions, 'interactive without→with', Math.round(pair.without.interactive), Math.round(pair.with.interactive));
    }
  }
  for (const k of entries) report.summaries[k] = summarizePairs(report.samples[k]);
  report.passed = Object.values(report.summaries).every(x => x.passed);
  console.log(JSON.stringify(report.summaries, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.error = error.message; throw error; }
finally { await browser?.close(); proxy.close(); proxy.closeAllConnections(); await save(); console.log('Report:', out); }
