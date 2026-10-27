import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Bundle current source only in memory. Real Chromium History/PopStateEvent and
// Pjax 0.2.8 run against an isolated origin; no Halo resources are substituted.
const bundle = await build({
  stdin: {
    contents: `import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
      import { watchCommentPermalink } from './src/shared/comment-permalink.js';
      window.__watchHashFixture = watchCommentPermalink;
      window.__initHashHistoryFixture = initPjax;`,
    resolveDir: process.cwd()
  }, bundle: true, write: false, format: 'iife', logLevel: 'silent'
});
const origin = 'https://hash-history.test';
const browser = await chromium.launch({ headless: true });
const scenarios = [];
async function fixture() {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    requests.push({ url: route.request().url(), navigation: route.request().isNavigationRequest() });
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html>
      <title>Hash history</title><body data-page-app="reader" data-app-id="reader" data-window-variant="reader">
      <main id="window-frame-root"><section data-window-content-root data-app-root="reader">
      <button id="return-list">返回评论列表</button><a id="native-anchor" href="#heading">TOC</a>
      <h2 id="heading">Heading</h2></section></main></body>` });
  });
  await page.goto(`${origin}/archives/post#halo-comment=comment&reply=reply`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    window.__fixture = { documentId: crypto.randomUUID(), events: [], votes: 0, veto: false, hashes: 0 };
    window.__fixture.root = document.getElementById('window-frame-root');
    window.addEventListener('hashchange', () => { window.__fixture.hashes++; });
    window.addEventListener('theme:before-pjax-navigation', (event) => {
      window.__fixture.votes++;
      if (window.__fixture.veto) event.preventDefault();
    });
    for (const type of ['theme:navigation-accepted', 'theme:navigation-settled']) {
      document.addEventListener(type, (event) => window.__fixture.events.push({ type, ...event.detail }));
    }
    window.Alpine = { store: () => ({ show: true, minimized: false }), nextTick: async () => {} };
    window.__initHashHistoryFixture(window.Alpine);
    document.getElementById('return-list').addEventListener('click', () => {
      const url = new URL(location.href);
      url.hash = '';
      // The actual CommentWidget 3.4 returnToList History/event sequence.
      history.pushState(history.state, '', url);
      window.dispatchEvent(new Event('hashchange'));
    });
  });
  await page.waitForFunction(() => window.pjax?.loadUrl && history.state?.__browserNavIndex === 0);
  await page.evaluate(() => {
    window.__watchHashFixture(document.querySelector('[data-app-root]'), (target) => {
      window.__fixture.commentTarget = target;
    });
  });
  const original = await page.evaluate(() => ({
    documentId: window.__fixture.documentId, uid: history.state.uid, index: history.state.__browserNavIndex
  }));
  return { page, errors, requests, original };
}
async function state(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => ({
    documentId: window.__fixture?.documentId,
    sameRoot: window.__fixture?.root === document.getElementById('window-frame-root'),
    href: location.href, history: history.state,
    votes: window.__fixture?.votes, hashes: window.__fixture?.hashes,
    events: window.__fixture?.events, commentTarget: window.__fixture?.commentTarget
  }));
}
try {
  const f = await fixture();
  try {
    await f.page.locator('#return-list').focus();
    await f.page.locator('#return-list').press('Enter');
    await f.page.goBack({ waitUntil: 'domcontentloaded' });
    await f.page.waitForFunction(() => window.__fixture?.events.some((event) => event.outcome === 'ready'));
    await f.page.goForward({ waitUntil: 'domcontentloaded' });
    const result = await state(f.page);
    assert.equal(result.documentId, f.original.documentId, 'copied-state hash traversal must retain the actual document');
    assert.equal(result.sameRoot, true, 'same-document history must retain the app instance');
    assert.equal(result.history.url, result.href, 'the accepted history entry URL must match its browser address');
    assert.equal(result.history.__browserNavIndex, f.original.index, 'copied plugin indices must not be guessed or incremented');
    assert.equal(result.votes, 2, 'each actual Back/Forward must vote exactly once');
    assert.equal(result.hashes, 3, 'official exit and native Back/Forward each notify once');
    assert.deepEqual(result.events.filter((event) => event.type === 'theme:navigation-settled').map((event) => event.outcome), ['ready', 'ready']);
    assert.equal(f.requests.length, 1, 'hash traversal must issue neither a document reload nor a PJAX HTML fetch');
    assert.deepEqual(f.errors, []);
    scenarios.push('official copied-state exit/back/forward retains document, instance, index and single events');
  } finally { await f.page.close(); }

  const native = await fixture();
  try {
    await native.page.locator('#native-anchor').click();
    let result = await state(native.page);
    assert.equal(result.documentId, native.original.documentId, 'ordinary native anchors must stay in the same document');
    await native.page.goBack({ waitUntil: 'domcontentloaded' });
    await native.page.waitForFunction(() => window.__fixture?.events.filter((event) => event.outcome === 'ready').length >= 1);
    await native.page.goForward({ waitUntil: 'domcontentloaded' });
    result = await state(native.page);
    assert.equal(result.documentId, native.original.documentId);
    assert.equal(result.sameRoot, true);
    assert.equal(result.href, `${origin}/archives/post#heading`);
    assert.equal(result.commentTarget, null);
    assert.equal(native.requests.length, 1);
    assert.deepEqual(native.errors, []);
    scenarios.push('native anchor/back/forward remains native and retains the app');
  } finally { await native.page.close(); }

  const veto = await fixture();
  try {
    await veto.page.locator('#return-list').click();
    await veto.page.evaluate(() => { window.__fixture.veto = true; });
    await veto.page.goBack({ waitUntil: 'domcontentloaded' });
    await veto.page.waitForFunction(() => window.__fixture?.votes === 1 && location.hash === '');
    const result = await state(veto.page);
    assert.equal(result.documentId, veto.original.documentId);
    assert.equal(result.sameRoot, true);
    assert.equal(result.history.__browserNavIndex, veto.original.index);
    assert.equal(result.commentTarget, null, 'a veto must restore the comment component as well as the address');
    assert.equal(result.events.length, 0, 'a veto must not accept or settle a navigation');
    assert.equal(veto.requests.length, 1);
    assert.deepEqual(veto.errors, []);
    scenarios.push('copied-index history veto restores address, component and original app');
  } finally { await veto.page.close(); }

  const indexed = await fixture();
  try {
    await indexed.page.evaluate(() => {
      window.__browserSyncUiHistoryState({ url: `${location.pathname}#heading` });
      window.dispatchEvent(new Event('hashchange'));
    });
    await indexed.page.goBack({ waitUntil: 'domcontentloaded' });
    await indexed.page.waitForFunction(() => window.__fixture?.events.some((event) => event.outcome === 'ready'));
    assert.equal((await state(indexed.page)).history.__browserNavIndex, 0);
    await indexed.page.goForward({ waitUntil: 'domcontentloaded' });
    let result = await state(indexed.page);
    assert.equal(result.history.__browserNavIndex, 1);
    assert.equal(result.documentId, indexed.original.documentId);
    await indexed.page.evaluate(() => { window.__fixture.veto = true; });
    await indexed.page.goBack({ waitUntil: 'domcontentloaded' });
    await indexed.page.waitForFunction(() => location.hash === '#heading' && history.state.__browserNavIndex === 1);
    result = await state(indexed.page);
    assert.equal(result.documentId, indexed.original.documentId);
    assert.equal(result.votes, 3, 'indexed rollback must not ask the same leave guard twice');
    assert.equal(result.commentTarget, null);
    assert.equal(indexed.requests.length, 1);
    assert.deepEqual(indexed.errors, []);
    scenarios.push('known hash indices retain 0/1 and cancelled Back rolls forward without another guard vote');
  } finally { await indexed.page.close(); }

  for (const target of ['/archives/other#halo-comment=other', '/archives/post?different=1#halo-comment=other']) {
    const foreign = await fixture();
    try {
      await foreign.page.evaluate((url) => {
        const initial = location.href;
        const saved = history.state;
        history.pushState(saved, '', url);
        history.pushState(saved, '', initial);
      }, target);
      await foreign.page.goBack({ waitUntil: 'domcontentloaded' });
      await foreign.page.waitForFunction(() => !window.__fixture);
      assert.equal(foreign.requests.filter((request) => request.navigation).length, 2,
        'a different path/query must retain the document handoff and must do it only once');
      assert.deepEqual(foreign.errors, []);
      scenarios.push(`copied-state different route hands off once: ${target}`);
    } finally { await foreign.page.close(); }
  }

  const unknown = await fixture();
  try {
    await unknown.page.evaluate(() => {
      const initial = location.href;
      const saved = history.state;
      history.pushState(null, '', '/unknown');
      history.pushState(saved, '', initial);
    });
    await unknown.page.goBack({ waitUntil: 'domcontentloaded' });
    await unknown.page.waitForFunction(() => !window.__fixture);
    assert.equal(unknown.requests.filter((request) => request.navigation).length, 2, 'null unknown history must hand off only once');
    assert.deepEqual(unknown.errors, []);
    scenarios.push('null unknown history does not recurse through location.replace');
  } finally { await unknown.page.close(); }
  console.log(`PJAX hash history: ${scenarios.length} scenarios passed`);
} finally { await browser.close(); }
