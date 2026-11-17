import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Current theme admission + the actual installed official component. Every
// request stays on this isolated origin; no account or Halo write is used.
const jar = process.env.COMMENT_WIDGET_PLUGIN_JAR || new URL('../../../plugins/PluginCommentWidget-3.5.1.jar', import.meta.url).pathname;
const out = process.env.COMMENT_DRAFT_OUTPUT || 'output/plugin-pjax-20261114/comment-drafts';
mkdirSync(out, { recursive: true });
const manifest = execFileSync('unzip', ['-p', jar, 'plugin.yaml'], { encoding: 'utf8' });
assert.match(manifest, /name:\s*["']?PluginCommentWidget["']?\s/);
const version = manifest.match(/\bversion:\s*["']?([^\s"']+)/)?.[1];
const assets = new Map();
const asset = name => {
  assert.match(name, /^[\w.-]+$/);
  if (!assets.has(name)) assets.set(name, execFileSync('unzip', ['-p', jar, `static/${name}`], { maxBuffer: 16 * 1024 * 1024 }));
  return assets.get(name);
};
const bundle = await build({ stdin: { contents: `
  import { initPjax } from './src/shell/desktop-shell/runtime/desktop/pjax/index.js';
  import { prepareNavigation, commitNavigation, prepareNativeHandoff } from './src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js';
  window.__admission = { prepareNavigation, commitNavigation, prepareNativeHandoff };
  window.__initPjax = initPjax;
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
const origin = 'https://comment-draft.test';
const browser = await chromium.launch({ headless: true });
const results = [];
const coldOnly = process.env.COMMENT_DRAFT_CASE === 'cold';

async function runColdEntry(width, mode) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [], requests = [];
  const result = { width, name: `cold source to comment target via ${mode}` };
  const sourceApp = mode === 'same' ? 'docsme' : 'reader';
  const sourcePath = mode === 'same' ? '/docs/cold-source' : '/archives/cold-source';
  const targetPath = '/docs/cold-target';
  const body = target => {
    const app = target ? 'docsme' : sourceApp;
    const variant = app === 'docsme' ? 'docsme' : 'browser';
    const content = target
      ? `<article data-app-root="docsme" data-cold-target><main class="docsme-main"><h1>评论目标</h1></main>
          <section data-lazy-comment><div id="comment-doc-halo-run-DocTree-cold-target"></div></section>
          <script type="module" data-pjax>import {init} from '/plugins/PluginCommentWidget/assets/static/comment-widget.js';
            init('#comment-doc-halo-run-DocTree-cold-target',{group:'doc.halo.run',kind:'DocTree',name:'cold-target'});</script></article>`
      : `<article data-app-root="${app}" data-cold-source><h1>无评论源页</h1></article>`;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${target ? 'Cold comment target' : 'Cold source'}</title></head>
      <body data-debug="true" data-page-app="${app}" data-app-id="${app}" data-window-variant="${variant}" data-page-mode="${app === 'docsme' ? 'browser-docsme' : 'browser-post'}">
      <main id="window-frame-root"><section data-window-content-root><div data-window-content-variant="${variant}">${content}</div></section></main></body></html>`;
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning') (result.diagnostics ||= []).push(message.text());
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname, type: request.resourceType(), navigation: request.isNavigationRequest() });
    assert.equal(url.origin, origin, 'Cold-entry fixture cannot contact another origin');
    assert.equal(request.method(), 'GET', 'Cold-entry regression must not write business data');
    const json = value => route.fulfill({ json: value });
    if (url.pathname.startsWith('/plugins/PluginCommentWidget/assets/static/')) {
      const name = url.pathname.split('/').at(-1);
      return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript', body: asset(name) });
    }
    if (url.pathname === targetPath || url.pathname === sourcePath) return route.fulfill({ contentType: 'text/html', body: body(url.pathname === targetPath) });
    // The real app loader still waits for manifest, CSS and module load events;
    // presentation/lifecycle behavior is intentionally minimal in this fixture.
    if (url.pathname.endsWith('/asset-manifest.json')) return json({});
    if (url.pathname.startsWith('/assets/')) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: url.pathname.endsWith('.css') ? '' : 'export {};' });
    if (url.pathname.endsWith('/config')) return json({ captchaRequired: false, basic: { size: 20, withReplies: true, withReplySize: 5, replySize: 10 }, editor: { enableEmoji: false, upload: { enable: false } }, avatar: { enable: false }, security: { captcha: { enable: false } } });
    if (url.pathname === '/actuator/globalinfo') return json({ allowAnonymousComments: true });
    if (url.pathname.endsWith('/users/-/permissions')) return json({ uiPermissions: [] });
    if (url.pathname.endsWith('/users/-')) return json({ user: { metadata: { name: 'anonymousUser' }, spec: {} } });
    if (url.pathname === '/apis/api.halo.run/v1alpha1/comments') return json({ items: [], page: 1, size: 20, total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
    return json({});
  });
  try {
    await page.goto(origin + sourcePath, { waitUntil: 'domcontentloaded' });
    // Globally loaded plugin definitions are allowed, but there is no comment
    // mount marker or instance to trigger the optional guard on this source.
    await page.addScriptTag({ url: origin + '/plugins/PluginCommentWidget/assets/static/comment-widget.js', type: 'module' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      window.__cold = { documentId: crypto.randomUUID(), settled: [], modes: [], confirms: 0 };
      window.confirm = () => { window.__cold.confirms++; return false; };
      document.addEventListener('theme:navigation-settled', event => window.__cold.settled.push(event.detail));
      document.addEventListener('pjax:same-variant-send', () => window.__cold.modes.push('same'));
      document.addEventListener('pjax:send', () => window.__cold.modes.push('full'));
      window.Alpine = { store: () => ({ show: true, minimized: false }), nextTick: async () => {}, initTree: () => {} };
      window.__initPjax(window.Alpine);
    });
    await page.waitForFunction(() => !!window.pjax?.loadUrl);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-lazy-comment], [id^="comment-"], comment-widget, [data-moment-comment-input]'))), false, 'Cold source must not register protection through a comment mount marker');
    const identity = await page.evaluate(() => window.__cold.documentId);
    await page.evaluate(url => { void window.pjax.loadUrl(url); }, origin + targetPath);
    await page.waitForFunction(() => window.__cold.settled.length > 0);
    result.state = await page.evaluate(() => ({ href: location.href, documentId: window.__cold.documentId,
      source: Boolean(document.querySelector('[data-cold-source]')), target: Boolean(document.querySelector('[data-cold-target]')),
      settled: window.__cold.settled, modes: window.__cold.modes, confirms: window.__cold.confirms }));
    assert.equal(result.state.target, true, 'First comment-target navigation must commit DOM instead of cancelling an unchanged source permit');
    assert.equal(result.state.source, false);
    assert.equal(result.state.documentId, identity, 'Cold entry must complete inside the same browser document');
    assert.equal(result.state.href, origin + targetPath);
    assert.deepEqual(result.state.modes, [mode], 'The requested full/same executor must complete without a fallback');
    assert.deepEqual(result.state.settled.map(event => event.outcome), ['ready']);
    await page.locator('comment-widget comment-form [contenteditable="true"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('comment-widget').count(), 1, 'The target must mount the actual installed official component');
    assert.equal(result.state.confirms, 0, 'An unchanged cold source has no draft to discard');
    assert.equal(requests.filter(request => request.navigation).length, 1);
    assert.equal(requests.filter(request => request.path === targetPath).length, 1);
    assert.deepEqual(errors, []);
    result.passed = true;
  } catch (error) { result.passed = false; result.error = error.message; }
  finally { result.requests = requests; result.errors = errors; results.push(result); await page.close(); }
}

async function fixture(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    assert.equal(u.origin, origin, 'Fixture cannot contact another origin');
    if (u.pathname.startsWith('/plugins/PluginCommentWidget/assets/static/')) {
      const name = u.pathname.split('/').at(-1);
      return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript', body: asset(name) });
    }
    if (r.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>Comment draft</title>
      <body data-page-app="reader" data-app-id="reader" data-window-variant="browser">
      <main id="window-frame-root"><section data-window-content-root data-app-root="reader"><div id="comment-fixture"></div></section></main>
      <script type="module">import {init} from '/plugins/PluginCommentWidget/assets/static/comment-widget.js';init('#comment-fixture',{group:'content.halo.run',kind:'Post',name:'fixture'});</script>` });
    if (u.pathname.endsWith('/config')) return json({ captchaRequired: false, basic: { size: 20, withReplies: true, withReplySize: 5, replySize: 10 }, editor: { enableEmoji: false, upload: { enable: false } }, avatar: { enable: false }, security: { captcha: { enable: false } } });
    if (u.pathname === '/actuator/globalinfo') return json({ allowAnonymousComments: true });
    if (u.pathname.endsWith('/users/-/permissions')) return json({ uiPermissions: [] });
    if (u.pathname.endsWith('/users/-')) return json({ user: { metadata: { name: 'anonymousUser' }, spec: {} } });
    if (u.pathname === '/apis/content.halo.run/v1alpha1/comments/fixture-comment') return json({ metadata: { name: 'fixture-comment', version: 1 }, spec: { raw: '<p>原内容</p>', content: '<p>原内容</p>' } });
    if (u.pathname === '/apis/api.halo.run/v1alpha1/comments') return json({ items: [], page: 1, size: 20, total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
    if (r.method() !== 'GET') return route.fulfill({ status: 405, body: '' });
    return json({});
  });
  await page.goto(origin + '/archives/post', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    window.__confirms = 0; window.__allowLeave = false;
    window.confirm = () => { window.__confirms++; return window.__allowLeave; };
    window.Alpine = { store: () => ({ show: true, minimized: false }), nextTick: async () => {} };
    window.__initPjax(window.Alpine);
  });
  await page.waitForFunction(() => !!window.pjax?.loadUrl);
  const editor = page.locator('comment-widget comment-form [contenteditable="true"]');
  await editor.waitFor();
  return { page, editor, errors };
}
async function run(width, name, action) {
  const f = await fixture(width);
  try { await action(f); assert.deepEqual(f.errors, []); results.push({ width, name, passed: true }); }
  catch(e) { results.push({ width, name, passed: false, error: e.message }); }
  finally { await f.page.close(); }
}
try {
  for (const width of coldOnly ? [] : [1440, 390]) {
    await run(width, 'dirty comment veto keeps official draft and source document', async ({page, editor}) => {
      await editor.fill('尚未提交的评论');
      const result = await page.evaluate(() => {
        const form = document.querySelector('comment-widget').shadowRoot.querySelector('comment-form').shadowRoot.querySelector('base-form');
        const before = form.getDraftSnapshot();
        const vote = window.__admission.prepareNavigation({ url: location.origin + '/archives/other', source: 'click' });
        return { kind: vote.kind, confirms: window.__confirms, same: document.querySelector('comment-widget').shadowRoot.querySelector('comment-form').shadowRoot.querySelector('base-form') === form, before, after: form.getDraftSnapshot() };
      });
      assert.equal(result.kind, 'cancelled'); assert.equal(result.confirms, 1);
      assert.equal(result.same, true); assert.deepEqual(result.after, result.before);
    });
    await run(width, 'input acquired during navigation invalidates the accepted permit', async ({page, editor}) => {
      await page.evaluate(() => { window.__vote = window.__admission.prepareNavigation({ url: location.origin + '/archives/other', source: 'click' }); });
      await editor.fill('请求期间新输入');
      const result = await page.evaluate(() => window.__admission.commitNavigation(window.__vote.permit, () => true));
      assert.equal(result, 'cancelled');
      assert.equal(await editor.innerText(), '请求期间新输入');
    });
    for (const editAfterAdmission of [false, true]) {
      await run(width, 'dormant saved draft: ' + (editAfterAdmission ? 'new input revokes permit' : 'one vote covers the same restored revision'), async ({page, editor}) => {
        const original = '已保存至本浏览器的草稿';
        await editor.fill(original);
        const decisions = await page.evaluate(async () => {
          const admission=window.__admission, prepare=()=>admission.prepareNavigation({url:location.origin+'/archives/other',source:'popstate'});
          window.__allowLeave=true;
          const first=prepare();
          if(admission.commitNavigation(first.permit,()=>true)!=='committed') throw Error('fixture did not record an approved departure');
          const mount=document.getElementById('comment-fixture');
          const key=mount.querySelector('comment-widget').shadowRoot.querySelector('comment-form').shadowRoot.querySelector('base-form').getDraftSnapshot().key;
          const previous=localStorage.getItem(key);
          // Back restores a fresh SSR placeholder; simulate the real plugin's
          // deferred mount on that element only after both leave decisions.
          const fresh=mount.cloneNode(false);mount.replaceWith(fresh);
          window.__allowLeave=false;
          const veto=prepare();
          window.__allowLeave=true;
          window.__restoredVote=prepare();
          const {init}=await import('/plugins/PluginCommentWidget/assets/static/comment-widget.js');
          init('#comment-fixture',{group:'content.halo.run',kind:'Post',name:'fixture'});
          return {veto:veto.kind,accepted:window.__restoredVote.kind,confirms:window.__confirms,preserved:localStorage.getItem(key)===previous};
        });
        assert.deepEqual(decisions,{veto:'cancelled',accepted:'accepted',confirms:3,preserved:true});
        await page.waitForFunction(v=>document.querySelector('comment-widget')?.shadowRoot.querySelector('comment-form')?.shadowRoot.querySelector('base-form')?.getDraftSnapshot().content.includes(v),original);
        if(editAfterAdmission)await editor.fill('导航发出后修改的内容');
        const result=await page.evaluate(()=>({
          commit:window.__admission.commitNavigation(window.__restoredVote.permit,()=>true),
          confirms:window.__confirms
        }));
        assert.deepEqual(result,{commit:editAfterAdmission?'cancelled':'committed',confirms:3});
        assert.equal(await editor.innerText(),editAfterAdmission?'导航发出后修改的内容':original);
      });
    }
    await run(width, 'accepted leave preserves persisted draft and avoids duplicate native prompt', async ({page, editor}) => {
      await editor.fill('接受离开后仍保留草稿');
      const result = await page.evaluate(async () => {
        window.__allowLeave = true;
        const form = document.querySelector('comment-widget').shadowRoot.querySelector('comment-form').shadowRoot.querySelector('base-form');
        const before = form.getDraftSnapshot();
        const vote = window.__admission.prepareNavigation({ url: location.origin + '/login', source: 'programmatic' });
        const native = window.__admission.prepareNativeHandoff(vote.permit, () => true);
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
        const prevented = event.defaultPrevented;
        await Promise.resolve();
        const later = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(later);
        return { kind: vote.kind, native, confirms: window.__confirms, prevented, laterPrevented: later.defaultPrevented, before, after: form.getDraftSnapshot() };
      });
      assert.equal(result.kind, 'accepted'); assert.equal(result.native, 'allowed'); assert.equal(result.confirms, 1);
      assert.equal(result.prevented, false); assert.equal(result.laterPrevented, true);
      assert.deepEqual(result.after, result.before);
    });
    await run(width, 'editing an existing comment asks before leaving and preserves the edit on veto', async ({page}) => {
      await page.evaluate(() => {
        const edit = document.createElement('comment-edit-form');
        edit.resource = 'comments';
        edit.target = { metadata: { name: 'fixture-comment', version: 1 }, spec: { raw: '<p>原内容</p>', content: '<p>原内容</p>' } };
        document.getElementById('comment-fixture').append(edit);
      });
      await page.waitForFunction(() => Boolean(document.querySelector('comment-edit-form')?.baseline));
      await page.locator('comment-edit-form [contenteditable="true"]').fill('编辑后未保存的内容');
      const result = await page.evaluate(() => {
        const form = document.querySelector('comment-edit-form');
        const before = form.content;
        const vote = window.__admission.prepareNavigation({ url: location.origin + '/archives/other', source: 'click' });
        return { kind: vote.kind, confirms: window.__confirms, dirty: form.dirty, before, after: form.content };
      });
      assert.equal(result.dirty, true); assert.equal(result.kind, 'cancelled');
      assert.equal(result.confirms, 1); assert.equal(result.after, result.before);
    });
    await run(width, 'in-flight submission blocks navigation without a discard prompt', async ({page}) => {
      const result = await page.evaluate(() => {
        const form = document.querySelector('comment-widget').shadowRoot.querySelector('comment-form').shadowRoot.querySelector('base-form');
        form.submitting = true;
        const vote = window.__admission.prepareNavigation({ url: location.origin + '/archives/other', source: 'click' });
        return { kind: vote.kind, confirms: window.__confirms, submitting: form.submitting };
      });
      assert.equal(result.kind, 'cancelled'); assert.equal(result.confirms, 0); assert.equal(result.submitting, true);
    });
    await run(width, 'verified comment-only history keeps the draft without a leave prompt', async ({page, editor}) => {
      await editor.fill('评论翻页时保留');
      const result = await page.evaluate(() => {
        const vote = window.__admission.prepareNavigation({ url: location.href + '?comment-page=2', source: 'popstate', retainsCommentForms: true, commentPageHistory: true });
        return { kind: vote.kind, confirms: window.__confirms, commit: window.__admission.commitNavigation(vote.permit, () => true) };
      });
      assert.equal(result.kind, 'accepted'); assert.equal(result.commit, 'committed'); assert.equal(result.confirms, 0);
      assert.equal(await editor.innerText(), '评论翻页时保留');
    });
    await run(width, 'a persisted pending upload session prompts instead of permanently blocking leave', async ({page}) => {
      const result = await page.evaluate(() => {
        const form = document.querySelector('comment-widget').shadowRoot.querySelector('comment-form').shadowRoot.querySelector('base-form');
        // The official getter can remain true after a failed submission even
        // when no network operation is active. Model that boundary state only.
        Object.defineProperty(form.editorRef.value, 'hasPendingUpload', { configurable: true, get: () => true });
        window.__allowLeave = false;
        const veto = window.__admission.prepareNavigation({ url: location.origin + '/archives/other', source: 'click' });
        window.__allowLeave = true;
        const allow = window.__admission.prepareNavigation({ url: location.origin + '/archives/other', source: 'click' });
        return { veto: veto.kind, allow: allow.kind, confirms: window.__confirms, uploading: form.uploading, submitting: form.submitting };
      });
      assert.equal(result.uploading, false); assert.equal(result.submitting, false);
      assert.equal(result.veto, 'cancelled'); assert.equal(result.allow, 'accepted'); assert.equal(result.confirms, 2);
    });
  }
  for (const width of [1440, 390]) for (const mode of ['full', 'same']) await runColdEntry(width, mode);
} finally {
  await browser.close();
  writeFileSync(out + '/report.json', JSON.stringify({ version, jarSha256: createHash('sha256').update(readFileSync(jar)).digest('hex'), results }, null, 2));
}
console.log(JSON.stringify({ version, results }, null, 2));
assert.ok(results.length === (coldOnly ? 4 : 22) && results.every(x => x.passed), 'Comment draft navigation cases must pass');
