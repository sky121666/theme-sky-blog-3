import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertCurrentBuild } from './lib/build-identity.mjs';

// Real theme HTML + current built assets + the installed CommentWidget JAR.
// All HTTP mutations and WebSockets are stopped before reaching the server.
// Authentication, permissions, comments and replies are fixture DTOs, never a
// real signed-in browser, credentials, or live private comments.
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(root, process.env.COMMENT_MOCK_OUTPUT || 'output/functional-mock-20261026/comments');
const base = process.env.COMMENT_MOCK_BASE || 'http://localhost:8090';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const docPath = '/docs/halo-theme-sky-blog-1/jianjie';
const jar = process.env.COMMENT_WIDGET_PLUGIN_JAR || path.resolve(root, '../../plugins/PluginCommentWidget-3.4.0.jar');
await fs.mkdir(out, { recursive: true });
const manifest = assertCurrentBuild(root);
const remote = await fetch(`${base}/themes/theme-sky-blog-3/assets/asset-manifest.json`).then(r => r.json());
assert.deepEqual(remote.__meta, manifest.__meta);
const docHtml = await fetch(`${base}${docPath}`).then(r => { assert.equal(r.status, 200); return r.text(); });
const subjectName = docHtml.match(/id="comment-doc-halo-run-DocTree-([a-zA-Z0-9-]+)"/)?.[1];
assert.ok(subjectName, 'Current Docsme page must expose its actual comment subject');
const subject = { group: 'doc.halo.run', kind: 'DocTree', version: 'v1alpha1', name: subjectName };
const fixtureHtml = process.env.COMMENT_MOCK_STANDALONE === '1'
  ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div class="docsme-comment"><comment-widget group="${subject.group}" kind="${subject.kind}" name="${subject.name}" version="v1alpha1"></comment-widget></div><script type="module" src="/plugins/PluginCommentWidget/assets/static/comment-widget.js"></script></body></html>`
  : docHtml;
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const assetCache = new Map();
const asset = name => {
  assert.match(name, /^[a-zA-Z0-9._-]+$/);
  if (!assetCache.has(name)) assetCache.set(name, execFileSync('unzip', ['-p', jar, `static/${name}`], { maxBuffer: 5 * 1024 * 1024 }));
  return assetCache.get(name);
};
const entry = asset('comment-widget.js');
const coreName = entry.toString().match(/from"\.\/([^"]+)"/)?.[1];
assert.ok(coreName);
const core = asset(coreName).toString();
assert.equal(sha(await fetch(`${base}/plugins/PluginCommentWidget/assets/static/comment-widget.js`).then(r => r.arrayBuffer()).then(b => Buffer.from(b))), sha(entry), 'Live official widget entry must match installed JAR');
assert.equal(sha(await fetch(`${base}/plugins/PluginCommentWidget/assets/static/${coreName}`).then(r => r.arrayBuffer()).then(b => Buffer.from(b))), sha(core), 'Live official widget implementation must match installed JAR');
const sourceEvidence = ['system:comments:manage', 'comment-edit-form', 'Private replies are not publicly visible', 'Your draft has been kept.', 'version:this.version'].map(needle => {
  const at = core.indexOf(needle); assert.ok(at >= 0, `Missing official component contract: ${needle}`);
  return { needle, offset: at, excerpt: core.slice(Math.max(0, at - 180), at + needle.length + 240) };
});
const report = {
  observedAt: new Date().toISOString(), base, route: docPath, subject,
  build: manifest.__meta, jar: { path: jar, sha256: sha(await fs.readFile(jar)), entrySha256: sha(entry), coreName, coreSha256: sha(core) },
  scope: 'Anonymous live GET-only theme host; official JAR assets; mock comment/auth/permission DTOs; all non-GET requests locally handled; WebSockets blocked; external resources excluded.',
  host: process.env.COMMENT_MOCK_STANDALONE === '1' ? 'Official widget only, without theme scripts/styles, for fault attribution' : 'Full current Docsme theme HTML',
  sourceEvidence, results: [], network: [], errors: [], limitations: [
    'Server authorization, persistence, real private-comment visibility and email delivery are not asserted by mocked DTOs.',
    'Editing is an official CommentWidget management feature, gated by system:comments:manage; authors without that permission do not receive an edit entry.',
    'Uses the existing Docsme document and its real theme integration; other hosts are covered by prior suites, not inferred here.'
  ]
};
const owner = { displayName: '模拟评论作者', avatar: '', name: 'fixture-author' };
const pageList = items => ({ items, page: 1, size: 10, total: items.length, totalPages: items.length ? 1 : 0, hasNext: false, hasPrevious: false });
function data() {
  const reply = { metadata: { name: 'mock-reply', version: 7 }, spec: { commentName: 'mock-root', content: '<p>模拟原回复</p>', raw: '<p>模拟原回复</p>', hidden: false, approved: true, creationTime: '2026-10-26T01:00:00Z', owner: { name: 'fixture-author', kind: 'User', annotations: {} } }, owner, stats: { upvote: 0 } };
  const comment = { metadata: { name: 'mock-root', version: 12 }, spec: { content: '<p>模拟根评论</p>', raw: '<p>模拟根评论</p>', hidden: false, approved: true, top: false, creationTime: '2026-10-26T00:00:00Z', subjectRef: subject, owner: { name: 'fixture-author', kind: 'User', annotations: {} } }, owner, stats: { upvote: 0 }, status: { visibleReplyCount: 1 }, replies: pageList([reply]) };
  return { comment, reply };
}
const config = { captchaRequired: false, basic: { size: 20, withReplies: true, withReplySize: 5, replySize: 10, enablePrivateComment: true, showPrivateCommentBadge: true }, editor: { enableEmoji: false, upload: { enable: false } }, avatar: { enable: false }, security: { captcha: { enable: false } } };
const browser = await chromium.launch({ headless: true });
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
async function fixture(width, label, opts = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, serviceWorkers: 'block', locale: 'zh-CN', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const state = { ...data(), writes: [], editStatus: opts.editStatus || 200, replyStatus: opts.replyStatus || 200, privateEnabled: opts.privateEnabled !== false, denied: opts.denied || false };
  const caseName = `${width}-${label}`;
  page.on('pageerror', error => report.errors.push({ case: caseName, kind: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ case: caseName, kind: 'console', message: message.text(), location: message.location(), expected: /Failed to load resource: the server responded with a status of (403|404|409|503)/.test(message.text()) && /\/apis\/.*\/(mock-root|mock-reply)(\/|$)/.test(message.location().url) }); });
  page.on('requestfailed', request => report.network.push({ case: caseName, kind: 'failed', method: request.method(), url: request.url(), reason: request.failure()?.errorText }));
  await context.routeWebSocket('**/*', socket => { report.network.push({ case: caseName, kind: 'blocked-websocket', url: socket.url() }); socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), p = url.pathname;
    const record = (kind, extra = {}) => report.network.push({ case: caseName, kind, method, path: p, ...extra });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method !== 'GET') {
      if (method === 'PUT' && /^\/apis\/api.console.halo.run\/v1alpha1\/(comments|replies)\/mock-(root|reply)\/content$/.test(p)) {
        const body = request.postDataJSON(), target = p.includes('/replies/') ? state.reply : state.comment;
        const write = { method, path: p, body, status: state.editStatus }; state.writes.push(write); record('mock-edit', write);
        if (state.editStatus !== 200) return json({ title: `模拟保存失败 ${state.editStatus}` }, state.editStatus);
        target.spec.raw = body.raw; target.spec.content = body.content; target.metadata.version += 1;
        return json(target);
      }
      if (method === 'POST' && p === '/apis/api.halo.run/v1alpha1/comments/mock-root/reply') {
        const body = request.postDataJSON(), write = { method, path: p, body, status: state.replyStatus }; state.writes.push(write); record('mock-reply', write);
        if (state.replyStatus !== 200) return json({ title: '模拟回复失败', detail: `模拟 ${state.replyStatus}` }, state.replyStatus);
        state.created = { ...data().reply, metadata: { name: 'mock-created-private-reply', version: 1 }, spec: { ...data().reply.spec, ...body } };
        state.comment.replies = pageList([state.reply, state.created]); state.comment.status.visibleReplyCount = 2;
        return json(state.created);
      }
      record(p.endsWith('/trackers/counter') ? 'mock-counter' : 'blocked-unexpected-write', { method });
      return route.fulfill({ status: p.endsWith('/trackers/counter') ? 204 : 405, body: '' });
    }
    if (url.origin !== new URL(base).origin) {
      record('external-excluded', { host: url.host, resourceType: request.resourceType() });
      return route.fulfill({ status: 200, contentType: request.resourceType() === 'image' ? 'image/svg+xml' : request.resourceType() === 'script' ? 'text/javascript' : 'text/plain', body: request.resourceType() === 'image' ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' : '' });
    }
    if (p.startsWith('/plugins/PluginCommentWidget/assets/static/')) {
      const name = path.basename(p); record('official-jar-asset', { name });
      return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript', body: asset(name) });
    }
    if (p === '/actuator/globalinfo') return json({ allowAnonymousComments: true });
    if (p === '/apis/api.commentwidget.halo.run/v1alpha1/config') return json({ ...config, basic: { ...config.basic, enablePrivateComment: state.privateEnabled } });
    if (p.endsWith('/users/-/permissions')) return json({ uiPermissions: opts.role === 'admin' ? ['system:comments:manage'] : [] });
    if (p.endsWith('/users/-')) return json({ user: { metadata: { name: opts.role === 'anonymous' ? 'anonymousUser' : 'fixture-author' }, spec: { displayName: '模拟用户' } } });
    if (p === '/apis/api.halo.run/v1alpha1/comments/mock-root/reply/mock-reply') { record('mock-reply-read', { status: state.denied ? 404 : 200 }); return json(state.denied ? { title: 'Not found' } : state.reply, state.denied ? 404 : 200); }
    if (p === '/apis/api.halo.run/v1alpha1/comments/mock-root') { record('mock-root-read'); return json(state.comment); }
    if (p === '/apis/content.halo.run/v1alpha1/comments/mock-root') { record('mock-latest-read', { version: state.comment.metadata.version }); return json(state.comment); }
    if (p === '/apis/content.halo.run/v1alpha1/replies/mock-reply') { record('mock-latest-read', { version: state.reply.metadata.version }); return json(state.reply); }
    if (p === '/apis/api.halo.run/v1alpha1/comments/mock-root/reply') return json(state.comment.replies);
    if (p === '/apis/api.halo.run/v1alpha1/comments') return json(pageList([state.comment]));
    if (p === '/apis/api.console.halo.run/v1alpha1/replies') return json(state.comment.replies);
    if (p === docPath) return route.fulfill({ contentType: 'text/html', body: fixtureHtml });
    // Remaining same-origin requests are anonymous GETs for the genuine theme.
    return route.continue();
  });
  await page.addInitScript(() => { window.__mockCommentDocument = crypto.randomUUID(); });
  return { context, page, state, caseName, width };
}
async function stateOf(page) {
  return page.evaluate(() => {
    const w = document.querySelector('.docsme-comment comment-widget'), d = w?.shadowRoot?.querySelector('comment-detail');
    let active = document.activeElement; const focus = [];
    while (active) { focus.push({ tag: active.tagName, class: String(active.className || '') }); active = active.shadowRoot?.activeElement; }
    const rect = w?.getBoundingClientRect();
    return { href: location.href, document: window.__mockCommentDocument, initialized: w?.isInitialized, visible: w?.checkVisibility(), target: d?.target, root: d?.comment?.metadata.name, reply: d?.reply?.metadata.name, loading: d?.loading, error: d?.error, focus, rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, overflow: document.documentElement.scrollWidth > innerWidth };
  });
}
async function ready(f, hash = '') {
  await f.page.goto(base + docPath + hash, { waitUntil: 'domcontentloaded' });
  await f.page.locator('.docsme-comment').waitFor({ state: 'visible', timeout: 30000 });
  await f.page.locator('.docsme-comment').scrollIntoViewIfNeeded();
  await f.page.locator('comment-widget comment-form [contenteditable="true"]').waitFor({ state: 'visible' });
  await f.page.locator('comment-widget comment-item').first().waitFor();
}
async function evidence(f, label) {
  const file = `${f.caseName}-${label}.png`;
  await f.page.screenshot({ path: path.join(out, file) });
  return { screenshot: file, state: await stateOf(f.page) };
}
async function run(width, label, opts, action) {
  if (process.env.COMMENT_MOCK_CASE && !new RegExp(process.env.COMMENT_MOCK_CASE).test(`${width}-${label}`)) return;
  const f = await fixture(width, label, opts), item = { width, label, assertions: [], evidence: [] }; report.results.push(item);
  f.item = item;
  try {
    await action(f);
    const finalState = await stateOf(f.page);
    assert.equal(finalState.overflow, false, `${f.caseName}: document must not overflow horizontally`);
    item.assertions.push('Final document horizontal overflow asserted absent');
    item.passed = true;
  }
  catch (error) { item.passed = false; item.error = error.message; item.stack = error.stack; item.evidence.push(await evidence(f, 'failure').catch(e => ({ error: e.message }))); }
  item.writes = f.state.writes;
  item.finalState = await stateOf(f.page).catch(() => ({}));
  await f.context.close(); await save();
  console.log(`${width} ${label}: ${item.passed ? 'PASS' : 'FAIL ' + item.error}`);
}
async function openEdit(f, resource, waitBaseline = true) {
  const holder = f.page.locator(resource === 'comments' ? 'comment-item' : 'reply-item').first();
  const management = holder.locator('comment-management').first();
  await management.locator('summary').click();
  await management.getByRole('button', { name: /^(编辑|Edit)$/ }).click();
  const form = holder.locator('comment-edit-form').first();
  await form.locator('[contenteditable="true"]').waitFor({ state: 'visible' });
  if (waitBaseline) await form.evaluate(async host => {
    for (let i = 0; i < 100 && !host.baseline; i++) await new Promise(resolve => setTimeout(resolve, 50));
    if (!host.baseline) throw new Error('Official edit baseline did not initialize');
  });
  return { holder, form };
}
try {
  for (const width of [1440, 390]) {
    if (process.env.COMMENT_MOCK_EARLY_PROBE === '1') for (const resource of ['comments', 'replies']) await run(width, `edit-early-input-probe-${resource}`, { role: 'admin' }, async f => {
      await ready(f); const { form } = await openEdit(f, resource, false);
      await form.locator('[contenteditable="true"]').fill('编辑器刚显示便粘贴的新内容');
      await form.evaluate(async host => {
        for (let i = 0; i < 100 && !host.baseline; i++) await new Promise(resolve => setTimeout(resolve, 50));
        await host.updateComplete;
      });
      f.item.editState = await form.evaluate(host => ({ content: host.content, baseline: host.baseline, dirty: host.dirty, version: host.version, hasContent: host.hasContent, canSave: host.canSave }));
      f.item.evidence.push(await evidence(f, 'immediate-input'));
      assert.equal(f.item.editState.canSave, true, 'Typing as soon as the edit surface is visible must remain a change, not become the initialization baseline');
      await form.locator('.edit-form-submit').click();
      await form.waitFor({ state: 'detached' });
      assert.equal(f.state.writes.length, 1);
      assert.equal(f.state.writes[0].body.version, resource === 'comments' ? 12 : 7);
      assert.equal(f.state.writes[0].body.content, '<p>编辑器刚显示便粘贴的新内容</p>');
      assert.equal(f.state.writes[0].body.raw, f.state.writes[0].body.content);
      f.item.assertions.push('Earliest visible input remains dirty', 'One official save with intact content and latest version');
    });
    for (const resource of ['comments', 'replies']) {
      await run(width, `edit-${resource}`, { role: 'admin' }, async f => {
        await ready(f); const { form } = await openEdit(f, resource);
        const edit = form.locator('[contenteditable="true"]'), saveButton = form.locator('.edit-form-submit');
        assert.equal(await saveButton.isDisabled(), true);
        assert.match(await edit.innerText(), resource === 'comments' ? /模拟根评论/ : /模拟原回复/);
        await edit.fill('模拟编辑内容 <保留文字>');
        f.item.editState = await form.evaluate(host => ({ content: host.content, baseline: host.baseline, dirty: host.dirty, version: host.version, hasContent: host.hasContent, canSave: host.canSave }));
        f.state.editStatus = 409;
        await saveButton.click(); await form.locator('[role="alert"]').waitFor();
        assert.match(await form.locator('[role="alert"]').innerText(), /已发生变化|has changed/);
        assert.equal(await edit.innerText(), '模拟编辑内容 <保留文字>');
        assert.equal(f.state.writes[0].body.version, resource === 'comments' ? 12 : 7);
        f.item.evidence.push(await evidence(f, 'conflict-draft'));
        for (const status of [403, 404, 503]) {
          f.state.editStatus = status; await saveButton.click();
          await f.page.waitForFunction(() => { const walk = root => [...root.querySelectorAll('*')].flatMap(n => [n, ...(n.shadowRoot ? walk(n.shadowRoot) : [])]); return walk(document).some(n => n.localName === 'comment-edit-form' && !n.saving && n.errorMessage); });
          assert.equal(await edit.innerText(), '模拟编辑内容 <保留文字>');
          assert.match(await form.locator('[role="alert"]').innerText(), /草稿已保留|draft has been kept/);
        }
        f.state.editStatus = 200; await saveButton.click(); await form.waitFor({ state: 'detached' });
        const target = resource === 'comments' ? f.state.comment : f.state.reply;
        assert.match(target.spec.content, /模拟编辑内容/); assert.match(target.spec.content, /&lt;保留文字&gt;/);
        assert.equal(f.state.writes.length, 5); assert.ok(f.state.writes.every(w => w.body.raw === w.body.content));
        f.item.assertions.push('Unchanged save disabled', 'Latest version included', '409/403/404/503 preserve draft', 'Successful save closes editor and updates DTO', 'No raw HTML injection from plain text');
        f.item.evidence.push(await evidence(f, 'saved'));
        const reopened = (await openEdit(f, resource)).form;
        await reopened.locator('[contenteditable="true"]').fill('取消前的新草稿');
        f.page.once('dialog', dialog => dialog.dismiss()); await reopened.locator('.edit-form-cancel').click();
        assert.equal(await reopened.locator('[contenteditable="true"]').innerText(), '取消前的新草稿');
        f.page.once('dialog', dialog => dialog.accept()); await reopened.locator('.edit-form-cancel').click(); await reopened.waitFor({ state: 'detached' });
        assert.equal(f.state.writes.length, 5);
        f.item.assertions.push('Dismiss discard confirmation retains draft; accept closes without write');
      });
    }
    for (const role of ['anonymous', 'author']) {
      await run(width, `permissions-${role}`, { role }, async f => {
        await ready(f); assert.equal(await f.page.locator('comment-management summary').count(), 0);
        assert.equal(await f.page.locator('comment-form input[name="hidden"]').isVisible(), true);
        f.item.assertions.push('No edit/manage entry without management permission', 'Private root checkbox available under configured capability');
        f.item.evidence.push(await evidence(f, 'no-management'));
      });
    }
    await run(width, 'private-reply-draft-submit', { role: 'author' }, async f => {
      await ready(f);
      await f.page.locator('reply-item').first().locator('.reply-button').click();
      let form = f.page.locator('reply-form');
      await form.locator('[contenteditable="true"]').fill('模拟私密引用回复，失败后保留');
      await form.locator('input[name="hidden"]').check();
      assert.match(await form.locator('#private-description').innerText(), /已登录的被回复者|Signed-in recipients/);
      f.state.replyStatus = 503; await form.locator('button[type="submit"]').click();
      await f.page.waitForFunction(() => {
        const w = document.querySelector('comment-widget');
        const walk = r => [...r.querySelectorAll('*')].flatMap(n => [n, ...(n.shadowRoot ? walk(n.shadowRoot) : [])]);
        return walk(w.shadowRoot).some(n => n.localName === 'reply-form' && !n.submitting);
      });
      assert.equal(await form.locator('[contenteditable="true"]').innerText(), '模拟私密引用回复，失败后保留');
      assert.equal(await form.locator('input[name="hidden"]').isChecked(), true);
      f.item.evidence.push(await evidence(f, 'failed-retained'));
      // Re-open the genuine form after a document reload; the official draft store owns persistence.
      await ready(f); await f.page.locator('reply-item').first().locator('.reply-button').click();
      form = f.page.locator('reply-form');
      await form.locator('[contenteditable="true"]').waitFor({ state: 'visible' });
      assert.equal(await form.locator('[contenteditable="true"]').innerText(), '模拟私密引用回复，失败后保留');
      assert.equal(await form.locator('input[name="hidden"]').isChecked(), true);
      f.state.replyStatus = 200; await form.locator('button[type="submit"]').click(); await form.waitFor({ state: 'detached' });
      assert.equal(f.state.writes.length, 2);
      for (const write of f.state.writes) { assert.equal(write.body.hidden, true); assert.equal(write.body.quoteReply, 'mock-reply'); assert.equal(write.body.raw, write.body.content); }
      assert.equal(f.state.created.spec.hidden, true);
      const created = f.page.locator('reply-item').filter({ hasText: '模拟私密引用回复，失败后保留' });
      await created.getByText('私密', { exact: true }).waitFor({ state: 'visible' });
      f.item.assertions.push('Private recipient explanation', '503 preserves content and hidden flag', 'Official draft survives reload with quote target', 'Explicit retry sends one POST with hidden and quoteReply', 'Returned authorized private reply shows configured private badge');
      f.item.evidence.push(await evidence(f, 'private-submitted'));
    });
    await run(width, 'private-disabled', { role: 'author', privateEnabled: false }, async f => {
      await ready(f); await f.page.locator('reply-item').first().locator('.reply-button').click();
      await f.page.locator('reply-form [contenteditable="true"]').waitFor();
      assert.equal(await f.page.locator('comment-form input[name="hidden"]').count(), 0);
      assert.equal(await f.page.locator('reply-form input[name="hidden"]').count(), 0);
      f.item.assertions.push('Private root/reply checkbox follows official config capability');
      f.item.evidence.push(await evidence(f, 'disabled'));
    });
    await run(width, 'private-reply-denied', { role: 'anonymous', denied: true }, async f => {
      await f.page.goto(`${base}${docPath}#halo-comment=mock-root&reply=mock-reply`, { waitUntil: 'domcontentloaded' });
      await f.page.locator('comment-detail [role="status"]').waitFor();
      assert.match(await f.page.locator('comment-detail [role="status"]').innerText(), /不存在或暂不可查看|not found or unavailable/);
      assert.equal(await f.page.locator('comment-detail reply-item').count(), 0);
      assert.equal(await f.page.locator('comment-detail .retry').count(), 0);
      f.item.assertions.push('404 denied reply renders unavailable state without private content or retry');
      f.item.evidence.push(await evidence(f, 'denied'));
    });
    await run(width, 'docsme-permalink-navigation', { role: 'author' }, async f => {
      const hashes = ['#halo-comment=mock-root', '#halo-comment=mock-root&reply=mock-reply'];
      const assertDetail = async (hash, id, stage) => {
        await f.page.waitForFunction(wantsReply => { const w = document.querySelector('.docsme-comment comment-widget'), d = w?.shadowRoot?.querySelector('comment-detail'); return d && !d.loading && !d.error && d.comment?.metadata.name === 'mock-root' && (wantsReply ? d.reply?.metadata.name === 'mock-reply' : !d.reply) && w.checkVisibility(); }, hash.includes('&reply='));
        const s = await stateOf(f.page); assert.equal(s.document, id); assert.equal(s.overflow, false);
        f.item.evidence.push(await evidence(f, `${stage}-${hash.includes('&reply=') ? 'reply-detail' : 'root-detail'}`));
      };
      for (const hash of hashes) {
        await ready(f, hash); const id = await f.page.evaluate(() => window.__mockCommentDocument); await assertDetail(hash, id, 'cold');
        const back = f.page.locator('comment-detail .back').first(); await back.focus(); await back.press('Enter');
        await f.page.waitForFunction(() => !location.hash.includes('halo-comment='));
        await f.page.locator('comment-list').waitFor();
        const after = await stateOf(f.page); assert.ok(after.focus.some(n => n.tag === 'COMMENT-LIST'), 'keyboard return must restore focus to list');
        await f.page.goBack({ waitUntil: 'domcontentloaded' }); await assertDetail(hash, id, 'history-back');
        await f.page.goForward({ waitUntil: 'domcontentloaded' }); await f.page.locator('comment-list').waitFor();
        // Existing PJAX API performs the real route transition and History lifecycle.
        await f.page.evaluate(href => { void window.pjax.loadUrl(href); }, `${base}/`);
        await f.page.waitForURL(`${base}/`, { waitUntil: 'domcontentloaded' });
        await f.page.evaluate(href => { void window.pjax.loadUrl(href); }, base + docPath + hash);
        await f.page.waitForURL(base + docPath + hash, { waitUntil: 'domcontentloaded' }); await assertDetail(hash, id, 'pjax');
      }
      f.item.assertions.push('Docsme root/reply cold navigation', 'Keyboard exit restores list focus', 'Back/Forward retain document identity', 'PJAX away and back retain document and detail target', 'No horizontal document overflow');
    });
  }
} finally {
  await browser.close();
  report.summary = { passed: report.results.filter(x => x.passed).length, failed: report.results.filter(x => !x.passed).length, pageErrors: report.errors.filter(x => x.kind === 'pageerror').length, expectedConsoleErrors: report.errors.filter(x => x.kind === 'console' && x.expected).length, unexpectedConsoleErrors: report.errors.filter(x => x.kind === 'console' && !x.expected).length, failedRequests: report.network.filter(x => x.kind === 'failed').length, blockedUnexpectedWrites: report.network.filter(x => x.kind === 'blocked-unexpected-write').length, realBusinessWrites: 0, mockedWrites: report.results.reduce((n, x) => n + x.writes.length, 0) };
  await save(); console.log(JSON.stringify({ summary: report.summary, report: path.join(out, 'report.json') }, null, 2));
}
// This suite fulfills excluded external resources and deliberate HTTP failures;
// it does not intentionally abort HTTP requests. Any requestfailed is unexpected.
if (report.summary.failed || report.summary.pageErrors || report.summary.unexpectedConsoleErrors || report.summary.failedRequests || report.summary.blockedUnexpectedWrites) process.exitCode = 1;
