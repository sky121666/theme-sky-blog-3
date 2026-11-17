// Check public delivery separately from reload, which deliberately bypasses the HTML cache.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';

const base = new URL(process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').origin;
const local = assertCurrentBuild();
const shell = local['shell-core'], expected = local.__meta;
const out = path.resolve(process.env.VISITOR_BUILD_OUTPUT || 'output/visitor-build');
const routes = [
  ['/', '', false], ['/archives', 'explorer-archives', false], ['/docs', 'docsme', false],
  [process.env.READING_CHAPTER_PATH || '/docs/halo-theme-sky-blog-1/jianjie', 'docsme', true],
  [process.env.READING_ARTICLE_PATH || '/archives/mac-restart-podman-container-start', 'reader', true],
  ['/photos', 'photos', false], ['/shop/products', 'shop', false]
];
if (process.argv.includes('--public-apps')) routes.push(
  ['/categories','explorer-categories',false], ['/tags','explorer-tags',false],
  ['/moments','moments',false], ['/links','links',false], ['/links?view=friends','links',false],
  ['/steam','steam',false], ['/douban','douban',false], ['/bangumis','bangumis',false],
  ['/equipments','equipments',false]
);
const report = { base, expected, observedAt: new Date().toISOString(), rows: [] };
const manifestURL = new URL('../../asset-manifest.json', new URL(shell.js[0], base));
const manifest = await fetch(manifestURL, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  redirect: 'error', signal: AbortSignal.timeout(10000) });
assert.equal(manifest.status, 200, 'served manifest unavailable');
report.served = (await manifest.json()).__meta;
const sameBuild = (identity) => identity?.version === expected.version && identity?.revision === expected.revision;
const browser = await chromium.launch();
const parser = await browser.newPage();
// This page only inspects the original response; the live theme can rewrite link.href during bootstrap.
await parser.route('**/*', route => route.abort());
try {
  for (const [routePath, app, reading] of routes) {
    const url = new URL(routePath, base);
    assert.equal(url.origin, base);
    const row = { path: routePath, errors: [] };
    for (const mode of ['visitor', 'fresh']) {
      const context = await browser.newContext({ ...(mode === 'fresh' ? { extraHTTPHeaders: { 'Cache-Control': 'no-cache' } } : {}) });
      const p = await context.newPage(), record = {};
      row[mode] = record;
      try {
        const response = await p.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        record.status = response?.status();
        if (record.status !== 200) throw new Error('document HTTP ' + record.status);
        record.haloCacheAt = await response.headerValue('x-halo-cache-at');
        record.raw = await parser.evaluate(({ html, base }) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const href = doc.querySelector('head link#shell-core-style[rel="stylesheet"]')?.getAttribute('href');
          const css = href ? new URL(href, base) : null;
          return { css: css?.pathname, revision: css?.searchParams.get('r'), version: css?.searchParams.get('v'),
            app: doc.body.dataset.pageApp || '', reading: !!doc.querySelector('.window-layer[data-reading-entry="true"]'),
            boot: !!doc.querySelector('script[data-theme-startup]') };
        }, { html: await response.text(), base });
        await p.waitForFunction(() => !!window.pjax && !!window.__THEME_ASSET_IDENTITY__, null, { timeout: 15000 });
        record.runtime = await p.evaluate((shellPath) => {
          const { revision, version } = window.__THEME_ASSET_IDENTITY__;
          const loaded = performance.getEntriesByType('resource').map(r => new URL(r.name))
            .filter(u => u.origin === location.origin && u.pathname === shellPath)
            .map(u => ({ version: u.searchParams.get('v'), revision: u.searchParams.get('r') }));
          return { revision, version, loaded };
        }, shell.js[0]);
        const delivered = new URL(response.url());
        if (record.status !== 200 || delivered.origin !== base || delivered.pathname !== url.pathname || delivered.search !== url.search)
          row.errors.push(mode + ': route');
        if (!sameBuild(record.raw) || record.raw.css !== shell.css[0]) row.errors.push(mode + ': HTML build');
        if (record.raw.app !== app || (reading && (!record.raw.reading || record.raw.boot))) row.errors.push(mode + ': HTML structure');
        if (!sameBuild(record.runtime) || !record.runtime.loaded.length || !record.runtime.loaded.every(sameBuild)) row.errors.push(mode + ': shell runtime');
      } catch (error) { row.errors.push(mode + ': ' + error.message.split('\n')[0]); }
      finally { await context.close(); }
    }
    row.pass = !row.errors.length;
    if (!row.pass && sameBuild(row.fresh.raw) && row.visitor.status === 200 && !sameBuild(row.visitor.raw))
      row.diagnosis = '普通访问的 HTML 与绕过缓存的 HTML 不同；检查页面缓存。';
    report.rows.push(row);
    console.log(row.pass ? 'PASS' : 'FAIL', routePath, 'visitor=' + row.visitor.raw?.revision, 'fresh=' + row.fresh.raw?.revision, row.errors.join('; '));
  }
} finally { await browser.close(); }
report.pass = sameBuild(report.served) && report.rows.every(row => row.pass);
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'public-delivery.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.pass) process.exitCode = 1;
