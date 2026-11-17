import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real CommentWidget + Pjax 0.2.8 + current theme source, bundled in memory.
// Every browser request is fulfilled locally; no Halo credentials or writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(root, process.env.COMMENT_HISTORY_OUTPUT || 'output/playwright/comment-page-history');
const jar = process.env.COMMENT_WIDGET_PLUGIN_JAR || path.resolve(root, '../../plugins/PluginCommentWidget-3.5.1.jar');
const pluginManifest = execFileSync('unzip', ['-p', jar, 'plugin.yaml'], { encoding: 'utf8' });
assert.match(pluginManifest, /name:\s*["']?PluginCommentWidget["']?\s*$/m);
const pluginVersion = pluginManifest.match(/^\s+version:\s*["']?([^\s"']+)["']?\s*$/m)?.[1];
assert.equal(pluginVersion, '3.5.1', 'This regression uses the audited actual pagination implementation');
const bundle = await build({
  stdin: { contents: `import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
    import { watchCommentPermalink } from './src/shared/comment-permalink.js';
    import { registerNavigationGuard } from './src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js';
    window.__initCommentHistory = initPjax; window.__watchCommentHistory = watchCommentPermalink;
    window.__registerCommentHistoryGuard = registerNavigationGuard;`, resolveDir: root },
  bundle: true, write: false, format: 'iife', logLevel: 'silent'
});
const cache = new Map();
const asset = name => {
  assert.match(name, /^[a-zA-Z0-9._-]+$/);
  if (!cache.has(name)) cache.set(name, execFileSync('unzip', ['-p', jar, `static/${name}`], { maxBuffer: 6 * 1024 * 1024 }));
  return cache.get(name);
};
const origin = 'https://comment-history.test';
const initial = `${origin}/archives/post?preview-theme=theme-sky-blog-3`;
const subject = { group: 'content.halo.run', kind: 'Post', name: 'fixture-post', version: 'v1alpha1' };
const comment = page => ({
  metadata: { name: `fixture-comment-${page}`, version: 1 },
  spec: { raw: `<p>第 ${page} 页评论</p>`, content: `<p>第 ${page} 页评论</p>`, subjectRef: subject,
    approved: true, hidden: false, top: false, creationTime: '2026-11-14T00:00:00Z',
    owner: { name: 'fixture-author', kind: 'User', annotations: {} } },
  owner: { name: 'fixture-author', displayName: '模拟作者', avatar: '' }, stats: { upvote: 0 }, status: { visibleReplyCount: 0 }
});
const html = '<!doctype html><html lang="zh-CN"><head><title>Comment history</title></head>'
  + '<body data-page-app="reader" data-app-id="reader" data-window-variant="reader">'
  + '<main id="window-frame-root"><section data-window-content-root data-app-root="reader"><div id="comments" data-lazy-comment></div></section></main></body></html>';
const browser = await chromium.launch({ headless: true });
const report = { observedAt: new Date().toISOString(), pluginVersion, results: [], realBusinessWrites: 0 };

async function fixture(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', locale: 'zh-CN' });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const requests = [], errors = [], pages = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ url: url.href, method: request.method(), navigation: request.isNavigationRequest(), resource: request.resourceType() });
    assert.equal(request.method(), 'GET', 'The isolated regression must never write business data');
    const json = body => route.fulfill({ json: body });
    if (url.pathname.startsWith('/plugin/')) return route.fulfill({ contentType: 'text/javascript', body: asset(path.basename(url.pathname)) });
    if (url.pathname === '/actuator/globalinfo') return json({ allowAnonymousComments: true });
    if (url.pathname === '/apis/api.commentwidget.halo.run/v1alpha1/config') return json({
      basic: { size: 1, withReplies: false, withReplySize: 1, replySize: 1 }, editor: { enableEmoji: false, upload: { enable: false } },
      avatar: { enable: false }, security: { captcha: { enable: false } }
    });
    if (url.pathname.endsWith('/users/-')) return json({ user: { metadata: { name: 'anonymousUser' }, spec: { displayName: '匿名用户' } } });
    if (url.pathname.endsWith('/asset-manifest.json')) return json({});
    if (url.pathname === '/apis/api.halo.run/v1alpha1/comments') {
      const value = Number(url.searchParams.get('page') || 1); pages.push(value);
      return json({ items: [comment(value)], page: value, size: 1, total: 3, totalPages: 3, hasNext: value < 3, hasPrevious: value > 1 });
    }
    if (/\/comments\/fixture-comment-\d+$/.test(url.pathname)) return json(comment(Number(url.pathname.match(/\d+$/)[0])));
    if (/\/comments\/fixture-comment-\d+\/reply$/.test(url.pathname)) return json({ items: [], page: 1, size: 1, total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
    if (request.isNavigationRequest() || request.resourceType() === 'xhr') return route.fulfill({ contentType: 'text/html', body: html });
    throw new Error(`Unexpected isolated request: ${request.method()} ${url.pathname}`);
  });
  await page.goto(initial);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    window.__fixture = { documentId: crypto.randomUUID(), pops: 0, contexts: [], targets: [] };
    window.Alpine = { store: () => ({ show: true, minimized: false }), nextTick: async () => {} };
    window.__registerCommentHistoryGuard({ id: 'fixture-comment-history', capture: () => null,
      isUnchanged: () => true, commit: () => {}, allow: (_, context) => { window.__fixture.contexts.push(context); return !window.__fixture.veto; } });
    window.__initCommentHistory(window.Alpine);
  });
  await page.waitForFunction(() => window.pjax?.loadUrl && history.state?.__browserNavIndex === 0);
  await page.addScriptTag({ url: `${origin}/plugin/comment-widget.js`, type: 'module' });
  await page.evaluate(() => {
    const widget = document.createElement('comment-widget');
    for (const [key, value] of Object.entries({ group: 'content.halo.run', kind: 'Post', name: 'fixture-post', version: 'v1alpha1' })) widget.setAttribute(key, value);
    document.getElementById('comments').append(widget);
    window.__fixture.widget = widget;
    window.__fixture.root = document.getElementById('window-frame-root');
    window.__watchCommentHistory(document.querySelector('[data-app-root]'), target => { window.__fixture.targets.push(target); });
    window.addEventListener('popstate', () => { window.__fixture.pops++; });
  });
  await page.waitForFunction(() => { const list = window.__fixture.widget.shadowRoot?.querySelector('comment-list'); return list?.comments.page === 1 && list.comments.items.length === 1 && !list.loading; });
  await page.locator('comment-form [contenteditable="true"]').waitFor({ state: 'visible' });
  const identity = await page.evaluate(() => {
    window.__fixture.form = window.__fixture.widget.shadowRoot.querySelector('comment-form');
    return { documentId: window.__fixture.documentId, uid: history.state.uid, index: history.state.__browserNavIndex };
  });
  return { context, page, requests, errors, pages, identity };
}

async function run(label, action, width) {
  const f = await fixture(width);
  const result = { label, width: width || 1440 };
  try { await action(f, result); assert.deepEqual(f.errors, []); result.passed = true; }
  catch (error) { result.passed = false; result.error = error.message; }
  finally {
    result.commentRequests = f.pages; result.htmlRequests = f.requests.filter(r => r.navigation || r.resource === 'xhr'); result.errors = f.errors;
    report.results.push(result); await f.context.close(); console.log(`${label}: ${result.passed ? 'PASS' : `FAIL ${result.error}`}`);
  }
}

async function traverse(f, direction, expectedPage) {
  await f.page[direction]({ waitUntil: 'domcontentloaded' });
  await f.page.waitForFunction(page => {
    if (!window.__fixture) return true;
    const list = window.__fixture.widget.shadowRoot?.querySelector('comment-list');
    return list?.comments.page === page && !list.loading && list.comments.items[0]?.metadata.name === `fixture-comment-${page}`;
  }, expectedPage);
  const current = await f.page.evaluate(() => ({ documentId: window.__fixture?.documentId,
    sameWidget: window.__fixture?.widget === document.querySelector('comment-widget'),
    sameRoot: window.__fixture?.root === document.getElementById('window-frame-root'),
    sameForm: window.__fixture?.form === document.querySelector('comment-widget')?.shadowRoot?.querySelector('comment-form'),
    page: new URL(location.href).searchParams.get('comment-page'), stateUrl: history.state?.url, href: location.href,
    index: history.state?.__browserNavIndex, contexts: window.__fixture?.contexts, pops: window.__fixture?.pops }));
  assert.equal(current.documentId, f.identity.documentId, 'Comment pagination traversal must retain the document');
  assert.equal(current.sameWidget && current.sameRoot && current.sameForm, true, 'Pagination must retain the real comment widget, form and page app');
  assert.equal(current.stateUrl, current.href, 'The accepted copied state must describe the visible address');
  assert.equal(current.index, f.identity.index, 'Copied plugin history must not invent theme indices');
  return current;
}

async function observedTraversal(f, direction) {
  const before = await f.page.evaluate(() => window.__fixture.contexts.length);
  await f.page[direction]({ waitUntil: 'domcontentloaded' });
  let traversed = true;
  try {
    await f.page.waitForFunction(count => !window.__fixture || window.__fixture.contexts.length > count,
      before, { timeout: 1500 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    traversed = false;
  }
  if (traversed) await f.page.waitForFunction(() => {
    if (!window.__fixture) return true;
    const list = window.__fixture.widget.shadowRoot?.querySelector('comment-list');
    const page = Number(new URL(location.href).searchParams.get('comment-page') || 1);
    return !list?.loading && list?.comments.page === page
      && list.comments.items[0]?.metadata.name === `fixture-comment-${page}`;
  });
  return f.page.evaluate(traversed => ({
    traversed, href: location.href, stateUrl: history.state?.url,
    page: Number(new URL(location.href).searchParams.get('comment-page') || 1),
    renderedPage: window.__fixture?.widget.shadowRoot?.querySelector('comment-list')?.comments.page,
    documentId: window.__fixture?.documentId,
    sameWidget: window.__fixture?.widget === document.querySelector('comment-widget'),
    sameRoot: window.__fixture?.root === document.getElementById('window-frame-root'),
    sameForm: window.__fixture?.form === document.querySelector('comment-widget')?.shadowRoot?.querySelector('comment-form'),
    historyLength: history.length, index: history.state?.__browserNavIndex,
    contexts: window.__fixture?.contexts.length, pops: window.__fixture?.pops
  }), traversed);
}

async function visitOfficialPages(f) {
  const visited = [{ page: 1, href: f.page.url() }];
  for (const page of [2, 3]) {
    await f.page.locator('comment-pagination button[rel="next"]').click();
    await f.page.waitForFunction(expected => {
      const list = window.__fixture.widget.shadowRoot?.querySelector('comment-list');
      return Number(new URL(location.href).searchParams.get('comment-page')) === expected
        && !list?.loading && list?.comments.page === expected;
    }, page);
    visited.push({ page, href: f.page.url() });
  }
  return visited;
}

function assertRetainedTraversal(f, actual, expected) {
  assert.equal(actual.traversed, true, `The recorded history entry for page ${expected.page} must still be traversable`);
  assert.equal(actual.href, expected.href, 'Retry must reach the same URL recorded before the veto');
  assert.equal(actual.renderedPage, expected.page, 'The actual official widget must render the recorded history page');
  assert.equal(actual.documentId, f.identity.documentId);
  assert.equal(actual.sameWidget && actual.sameRoot && actual.sameForm, true);
  assert.equal(actual.stateUrl, actual.href);
  assert.equal(actual.index, f.identity.index);
}

try {
  for (const width of [1440, 390]) await run(`${width}-official-pagination`, async (f, result) => {
    if (width === 390) await f.page.locator('comment-form [contenteditable="true"]').fill('分页前的未发送草稿');
    for (const value of [2, 3]) {
      await f.page.locator('comment-pagination button[rel="next"]').click();
      await f.page.waitForFunction(page => new URL(location.href).searchParams.get('comment-page') === String(page), value);
    }
    for (const [direction, value] of [['goBack', 2], ['goBack', 1], ['goForward', 2], ['goForward', 3]]) result.state = await traverse(f, direction, value);
    assert.equal(result.state.pops, 4, 'Each native popstate must reach the official widget and later listeners exactly once');
    assert.equal(result.state.contexts.length, 4);
    assert.equal(result.state.contexts.every(context => context.retainsCommentForms === true), true, 'Only a confirmed local plan may bypass the draft leave prompt');
    assert.equal(result.state.contexts.every(context => context.commentPageHistory === true), true, 'Draft guards must distinguish root comment forms from rows replaced by pagination');
    assert.deepEqual(f.pages, [1, 2, 3, 2, 1, 2, 3], 'The actual official list must fetch each traversed page once');
    assert.equal(f.requests.filter(r => r.navigation || r.resource === 'xhr').length, 1, 'Pagination history must not request a new document or PJAX HTML');
    if (width === 390) assert.equal(await f.page.locator('comment-form [contenteditable="true"]').innerText(), '分页前的未发送草稿');
    await f.page.evaluate(() => {
      const url = new URL(location.href); url.hash = 'halo-comment=fixture-comment-3';
      history.pushState(history.state, '', url); window.dispatchEvent(new Event('hashchange'));
    });
    await f.page.waitForFunction(() => window.__fixture.targets.some(target => target?.comment === 'fixture-comment-3'));
    result.assertions = ['Official page buttons and Back/Forward keep document/widget/form', 'No HTML fetch or guessed history index', 'One native popstate and API request per traversal', 'Permalink ownership survives comment-page changes'];
  }, width);

  await run('first-page copied-state Back', async f => {
    await f.page.locator('comment-pagination button[rel="next"]').click();
    await f.page.waitForFunction(() => new URL(location.href).searchParams.get('comment-page') === '2');
    const state = await traverse(f, 'goBack', 1);
    assert.equal(state.pops, 1);
    assert.deepEqual(f.pages, [1, 2, 1]);
  });

  await run('veto restores the actual source comment page', async f => {
    for (const value of [2, 3]) {
      await f.page.locator('comment-pagination button[rel="next"]').click();
      await f.page.waitForFunction(page => new URL(location.href).searchParams.get('comment-page') === String(page), value);
    }
    await f.page.evaluate(() => { window.__fixture.veto = true; });
    await f.page.goBack({ waitUntil: 'domcontentloaded' });
    await f.page.waitForFunction(() => window.__fixture?.contexts.length === 1);
    await f.page.waitForTimeout(50); // Existing copied-index rollback is scheduled with setTimeout(0).
    assert.equal(new URL(f.page.url()).searchParams.get('comment-page'), '3', 'A refused Back must restore page 3, not the stale state copied from page 1');
    assert.equal(await f.page.evaluate(() => window.__fixture.widget.shadowRoot.querySelector('comment-list').comments.page), 3);
    assert.deepEqual(f.pages, [1, 2, 3], 'A vetoed event must not fetch a new official comment page');
    assert.equal(f.requests.filter(r => r.navigation || r.resource === 'xhr').length, 1);
  });

  for (const width of [1440, 390]) {
    await run(`${width}-vetoed Back preserves subsequent Back and Forward order`, async (f, result) => {
      result.visited = await visitOfficialPages(f);
      await f.page.evaluate(() => { window.__fixture.veto = true; });
      result.veto = await observedTraversal(f, 'goBack');
      assertRetainedTraversal(f, result.veto, result.visited[2]);
      assert.deepEqual(f.pages, [1, 2, 3], 'A veto must not request replacement comments');
      await f.page.evaluate(() => { window.__fixture.veto = false; });
      result.expected = [result.visited[1], result.visited[0], result.visited[1], result.visited[2]];
      result.observed = [];
      for (const [index, direction] of ['goBack', 'goBack', 'goForward', 'goForward'].entries()) {
        const actual = await observedTraversal(f, direction);
        result.observed.push({ direction, ...actual });
        assertRetainedTraversal(f, actual, result.expected[index]);
      }
      assert.deepEqual(f.pages, [1, 2, 3, 2, 1, 2, 3]);
      assert.equal(f.requests.filter(r => r.navigation || r.resource === 'xhr').length, 1);
    }, width);

    await run(`${width}-vetoed Forward preserves the original Forward entry`, async (f, result) => {
      result.visited = await visitOfficialPages(f);
      assertRetainedTraversal(f, await observedTraversal(f, 'goBack'), result.visited[1]);
      await f.page.evaluate(() => { window.__fixture.veto = true; });
      result.veto = await observedTraversal(f, 'goForward');
      assertRetainedTraversal(f, result.veto, result.visited[1]);
      assert.deepEqual(f.pages, [1, 2, 3, 2], 'A vetoed Forward must not request replacement comments');
      await f.page.evaluate(() => { window.__fixture.veto = false; });
      result.expected = [result.visited[2], result.visited[1]];
      result.observed = [];
      for (const [index, direction] of ['goForward', 'goBack'].entries()) {
        const actual = await observedTraversal(f, direction);
        result.observed.push({ direction, ...actual });
        assertRetainedTraversal(f, actual, result.expected[index]);
      }
      assert.deepEqual(f.pages, [1, 2, 3, 2, 3, 2]);
      assert.equal(f.requests.filter(r => r.navigation || r.resource === 'xhr').length, 1);
    }, width);
  }

  // Even a valid comment-page cannot hide a different path or other query.
  for (const target of [
    '/archives/other?comment-page=2',
    '/archives/post?preview-theme=theme-sky-blog-3&other=1&comment-page=2',
    ...['0', '-1', '1.5', 'x', '2&comment-page=3', '9007199254740992'].map(value => `/archives/post?preview-theme=theme-sky-blog-3&comment-page=${value}`)
  ]) await run(`fallback ${target}`, async f => {
    await f.page.evaluate(target => { const saved = history.state; history.pushState(saved, '', target); history.pushState(saved, '', location.origin + '/archives/post?preview-theme=theme-sky-blog-3'); }, target);
    await f.page.goBack({ waitUntil: 'domcontentloaded' });
    await f.page.waitForFunction(() => !window.__fixture);
    assert.equal(f.requests.filter(r => r.navigation).length, 2, 'Foreign or invalid query history must preserve one document handoff');
  });
} finally {
  await browser.close(); await fs.mkdir(out, { recursive: true });
  report.summary = { passed: report.results.filter(r => r.passed).length, failed: report.results.filter(r => !r.passed).length };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, report: path.join(out, 'report.json') }));
}
if (report.summary.failed) process.exitCode = 1;
