import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// The real plugin owns validation and submission. Only HTTP is replaced, so
// copying a draft into an empty placeholder cannot satisfy these checks.
const root = fileURLToPath(new URL('../', import.meta.url));
const jar = process.env.COMMENT_WIDGET_PLUGIN_JAR || path.resolve(root, '../../plugins/PluginCommentWidget-3.4.0.jar');
const asset = (name) => execFileSync('unzip', ['-p', jar, `static/${name}`], { maxBuffer: 3 * 1024 * 1024 });
const interactions = await fs.readFile(path.join(root, 'src/apps/moments/interactions.js'), 'utf8');
const permalink = await fs.readFile(path.join(root, 'src/shared/comment-permalink.js'), 'utf8');
const moduleSource = interactions.replace("from '../../shared/comment-permalink.js'", `from 'data:text/javascript;base64,${Buffer.from(permalink).toString('base64')}'`);
const browser = await chromium.launch({ headless: true });
const draft = '保留这段草稿 <不是 HTML>\n第二行';
const owner = { displayName: 'Fixture User', avatar: '', name: 'fixture-user' };
const reply = { metadata: { name: 'quoted-reply' }, spec: { content: '<p>原回复</p>', raw: '原回复', approved: true, owner: { name: 'fixture-user', annotations: {} } }, owner, stats: { upvote: 0 } };
const comment = { metadata: { name: 'root-comment' }, spec: { content: '<p>根评论</p>', raw: '根评论', approved: true, subjectRef: { group: 'moment.halo.run', kind: 'Moment', version: 'v1alpha1', name: 'fixture-moment' }, owner: { name: 'fixture-user', annotations: {} } }, owner, stats: { upvote: 0 }, status: { visibleReplyCount: 1 }, replies: { items: [reply], page: 1, size: 5, total: 1, totalPages: 1, hasNext: false, hasPrevious: false } };
const list = { items: [comment], page: 1, size: 10, total: 1, totalPages: 1, hasNext: false, hasPrevious: false };

async function fixture({ status = 403, captcha = true, pending = false, feed = false, nativeFailure = false, moduleFailure = false, delayedSsrMount = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  const writes = [];
  const modules = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/plugin/') || url.pathname.startsWith('/plugins/PluginCommentWidget/assets/static/')) {
      if (path.basename(url.pathname) === 'comment-widget.js') {
        modules.push(url.pathname + url.search);
        if (moduleFailure && modules.length === 1) return route.abort('failed');
      }
      return route.fulfill({ contentType: 'text/javascript', body: asset(path.basename(url.pathname)) });
    }
    if (request.method() === 'POST') {
      writes.push({ url: url.pathname, body: request.postDataJSON(), headers: request.headers() });
      const hasCaptcha = Boolean(request.headers()['x-captcha-code']);
      const nativeAttempt = writes.filter((entry) => entry.headers['x-captcha-code']).length;
      return route.fulfill({ status: !hasCaptcha ? status : nativeFailure && nativeAttempt === 1 ? 503 : 200, headers: captcha ? { 'X-Require-Captcha': 'true' } : {}, json: !hasCaptcha ? { type: 'https://www.halo.run/probs/captcha-required', detail: '需要验证码', captcha: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>' } : comment });
    }
    if (url.pathname === '/actuator/globalinfo') return route.fulfill({ json: { allowAnonymousComments: false } });
    if (url.pathname.endsWith('/config')) return route.fulfill({ json: { captchaRequired: true, basic: { size: 20, withReplies: true, withReplySize: 5, replySize: 10 }, editor: { enableEmoji: false, upload: { enable: false } }, avatar: { enable: false }, security: { captcha: { enable: true, required: true, audience: 'ALL', type: 'ALPHANUMERIC' } } } });
    if (url.pathname.endsWith('/users/-')) return route.fulfill({ json: { user: { metadata: { name: 'fixture-user' }, spec: { displayName: 'Fixture User' } } } });
    if (url.pathname.endsWith('/permissions')) return route.fulfill({ json: { uiPermissions: [] } });
    if (url.pathname.endsWith('/captcha/-/generate')) return route.fulfill({ contentType: 'text/plain', body: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
    if (url.pathname.endsWith('/reply/quoted-reply')) return route.fulfill({ json: reply });
    if (url.pathname.endsWith('/comments/root-comment')) return route.fulfill({ json: comment });
    if (url.pathname.endsWith('/reply')) return route.fulfill({ json: comment.replies });
    if (url.pathname.endsWith('/comments')) return route.fulfill({ json: list });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><main data-app-root="moments"><section class="${feed ? 'moments-feed-list' : 'moment-comments--custom'}"><article data-moment-card data-moment-name="fixture-moment" ${feed ? '' : 'data-moment-detail-comments'} data-comment-count="1">
      <button data-moment-comments-toggle>评论</button><div data-moment-comments-panel><div data-moment-comments-status></div><div data-moment-comments-list></div><div data-moment-reply-bar><span data-moment-reply-label></span></div><form data-moment-comment-form><textarea data-moment-comment-input></textarea><button data-moment-comment-submit type="submit">发送</button></form></div>
      ${feed ? '' : `<div data-moment-official-comments hidden style="display:none">${delayedSsrMount ? '<div id="comment-moment-halo-run-Moment-fixture-moment"></div>' : '<comment-widget group="moment.halo.run" kind="Moment" version="v1alpha1" name="fixture-moment"></comment-widget>'}</div>`}
    </article></section></main>${feed ? '' : delayedSsrMount ? `<script type="module">import { init } from '/plugin/comment-widget.js'; window.__completeSsrMount = () => init('#comment-moment-halo-run-Moment-fixture-moment', { group: 'moment.halo.run', kind: 'Moment', name: 'fixture-moment' });</script>` : '<script type="module" src="/plugin/comment-widget.js"></script>'}` });
    throw new Error(`Unexpected fixture request: ${request.method()} ${url.pathname}`);
  });
  await page.goto(`http://moments.fixture/moments/fixture-moment${delayedSsrMount ? '#halo-comment' : ''}`);
  await page.addScriptTag({ type: 'module', content: `${moduleSource}\nwindow.__cleanup = setupMomentInteractions(document);` });
  await page.waitForFunction(() => typeof window.__cleanup === 'function');
  await page.locator('[data-moment-comment="root-comment"]').waitFor();
  if (pending) await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (url, options) => options?.method === 'POST'
      ? new Promise((resolve) => { window.__finishPost = () => resolve(new Response('{}', { status: 403, headers: { 'X-Require-Captcha': 'true' } })); })
      : original(url, options);
  });
  return { page, writes, errors, modules };
}

async function sendDraft(f, replyMode = false) {
  if (replyMode) await f.page.locator('[data-moment-reply="quoted-reply"]').click();
  else await f.page.locator('[data-moment-comments-toggle]').click();
  await f.page.locator('[data-moment-comment-input]').fill(draft);
  await f.page.locator('[data-moment-comment-submit]').click();
}

try {
  const ssr = await fixture({ delayedSsrMount: true });
  await ssr.page.waitForFunction(() => typeof window.__completeSsrMount === 'function');
  await sendDraft(ssr, true);
  await ssr.page.waitForFunction(() => document.querySelector('[data-moment-comment-form]').hidden);
  await ssr.page.evaluate(() => {
    window.__recoveredWidget = document.querySelector('[data-moment-official-comments] comment-widget');
    window.__completeSsrMount();
  });
  assert.equal(await ssr.page.locator('[data-moment-official-comments] comment-widget').count(), 1, 'late official SSR init must reuse the recovery widget instead of mounting a second one');
  assert.equal(await ssr.page.locator('#comment-moment-halo-run-Moment-fixture-moment > comment-widget').evaluate((node) => node === window.__recoveredWidget), true, 'recovery must use the exact official SSR mount container');
  assert.equal(await ssr.page.locator('reply-form [contenteditable="true"]').innerText(), draft);
  assert.equal(await ssr.page.locator('reply-form').evaluate((node) => node.comment.metadata.name + '/' + node.quoteReply.metadata.name), 'root-comment/quoted-reply');
  assert.deepEqual(ssr.errors, []);
  await ssr.page.close();
  console.log('PASS delayed actual SSR init: one widget, same official mount, intact reply target and draft');

  for (const [label, replyMode, feed] of [['comment', false, false], ['reply', true, false], ['feed reply', true, true]]) {
    const f = await fixture({ feed });
    await sendDraft(f, replyMode);
    await f.page.waitForFunction(() => !document.querySelector('[data-moment-comment-submit]').disabled);
    const status = await f.page.locator('[data-moment-comments-status]').textContent();
    assert.doesNotMatch(status, /登录后评论/, `${label}: a required captcha must not be reported as an unauthenticated user`);
    const editor = f.page.locator(`[data-moment-official-comments] ${replyMode ? 'reply-form' : 'comment-form'} [contenteditable="true"]`);
    await editor.waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await editor.innerText(), draft, `${label}: official editor must contain the original plain-text draft`);
    assert.equal(await f.page.locator('[data-moment-comment-input]').inputValue(), draft, 'keep the original draft until official success');
    if (replyMode) assert.equal(await f.page.locator('reply-form').evaluate((node) => node.comment.metadata.name + '/' + node.quoteReply.metadata.name), 'root-comment/quoted-reply');
    const nativeForm = f.page.locator(`[data-moment-official-comments] ${replyMode ? 'reply-form' : 'comment-form'}`);
    await nativeForm.locator('input[name="captchaCode"]').fill('ABCD');
    await nativeForm.locator('comment-editor').evaluate((host) => { window.__submittedEditor = host.editor; });
    await nativeForm.locator('button[type="submit"]').click();
    await f.page.waitForFunction(() => window.__submittedEditor.isEmpty || window.__submittedEditor.isDestroyed);
    assert.equal(await f.page.locator('[data-moment-comment-input]').inputValue(), draft, 'the theme keeps a recoverable original until the user explicitly discards it');
    assert.equal(f.writes.length, 2, 'one rejected theme request and one explicit official submission');
    assert.equal(f.writes[1].headers['x-captcha-code'], 'ABCD', 'the official component owns captcha submission');
    assert.equal(f.writes[1].url, replyMode ? '/apis/api.halo.run/v1alpha1/comments/root-comment/reply' : '/apis/api.halo.run/v1alpha1/comments');
    if (replyMode) assert.equal(f.writes[1].body.quoteReply, 'quoted-reply');
    if (!replyMode) {
      await f.page.locator('[data-moment-recovery-action="return"]').click();
      await f.page.locator('[data-moment-comment-submit]').click();
      await f.page.waitForFunction(() => document.querySelector('[data-moment-comment-form]').hidden);
      assert.equal(await editor.innerText(), draft, 'successful reuse of the same editor must transfer an identical new draft again');
    }
    await f.page.locator('[data-moment-recovery-action="discard"]').click();
    assert.equal(await f.page.locator('[data-moment-comment-input]').inputValue(), '', 'only explicit discard clears the retained original');
    assert.deepEqual(f.errors, []);
    await f.page.close();
    console.log(`PASS ${label}: captcha handoff, retained draft/target and official submission`);
  }

  const unrelated = await fixture();
  await sendDraft(unrelated);
  await unrelated.page.locator('[data-moment-official-comments] comment-form [contenteditable="true"]').waitFor({ state: 'visible' });
  await unrelated.page.locator('comment-form comment-editor').evaluate((host) => host.editor.commands.clearContent());
  await unrelated.page.evaluate(() => {
    const widget = document.createElement('comment-widget');
    widget.id = 'other-comment-subject';
    widget.setAttribute('group', 'moment.halo.run');
    widget.setAttribute('kind', 'Moment');
    widget.setAttribute('name', 'other-moment');
    document.body.appendChild(widget);
  });
  const other = unrelated.page.locator('#other-comment-subject comment-form');
  await other.locator('[contenteditable="true"]').waitFor({ state: 'visible' });
  await other.locator('comment-editor').evaluate((host) => host.editor.commands.setContent('<p>另一个表单的评论</p>'));
  await other.locator('input[name="captchaCode"]').fill('ABCD');
  await other.locator('button[type="submit"]').click();
  await unrelated.page.waitForFunction(() => document.querySelector('#other-comment-subject').shadowRoot.querySelector('comment-form').baseFormRef.value.editorRef.value.editor.isEmpty);
  assert.equal(await unrelated.page.locator('[data-moment-comment-input]').inputValue(), draft, 'another official form succeeding must never clear this retained draft');
  await unrelated.page.close();

  for (const [status, expected] of [[401, /登录后评论/], [403, /权限/]]) {
    const f = await fixture({ status, captcha: false });
    await sendDraft(f);
    await f.page.waitForFunction(() => !document.querySelector('[data-moment-comment-submit]').disabled);
    assert.match(await f.page.locator('[data-moment-comments-status]').textContent(), expected);
    assert.equal(await f.page.locator('[data-moment-comment-input]').inputValue(), draft);
    assert.equal(await f.page.locator('[data-moment-official-comments]').isVisible(), false, 'ordinary authorization errors must not enter captcha recovery');
    await f.page.close();
  }

  const retry = await fixture({ nativeFailure: true });
  await sendDraft(retry);
  const nativeForm = retry.page.locator('[data-moment-official-comments] comment-form');
  const nativeEditor = nativeForm.locator('[contenteditable="true"]');
  await nativeEditor.waitFor({ state: 'visible' });
  await nativeForm.locator('input[name="captchaCode"]').fill('ABCD');
  await nativeForm.locator('button[type="submit"]').click();
  await retry.page.waitForFunction(() => !document.querySelector('comment-widget').shadowRoot.querySelector('comment-form').submitting);
  assert.equal(await nativeEditor.innerText(), draft, 'official submission failure must retain the transferred draft');
  assert.equal(await retry.page.locator('[data-moment-comment-input]').inputValue(), draft, 'failed native submit must not clear the original');
  await nativeForm.locator('comment-editor').evaluate((host) => { window.__submittedEditor = host.editor; });
  await nativeForm.locator('button[type="submit"]').click();
  await retry.page.waitForFunction(() => window.__submittedEditor.isEmpty);
  assert.equal(await retry.page.locator('[data-moment-comment-input]').inputValue(), draft);
  assert.equal(retry.writes.length, 3, 'retry remains an explicit native submission, with no theme resubmission');
  assert.equal((retry.writes[2].body.content.match(/保留这段草稿/g) || []).length, 1, 'retry must not append the handoff draft a second time');
  await retry.page.close();
  console.log('PASS failed official submission: draft survives and explicit retry does not duplicate it');

  const existing = await fixture();
  await existing.page.locator('comment-form [contenteditable="true"]').waitFor({ state: 'attached' });
  await existing.page.locator('comment-form comment-editor').evaluate((host) => host.editor.commands.setContent('<p>已有官方草稿</p>'));
  await sendDraft(existing);
  await existing.page.locator('[data-moment-official-comments] comment-form [contenteditable="true"]').waitFor({ state: 'visible' });
  const merged = await existing.page.locator('comment-form [contenteditable="true"]').innerText();
  assert.match(merged, /已有官方草稿/, 'handoff must not overwrite an existing official draft');
  assert.equal((merged.match(/保留这段草稿/g) || []).length, 1);
  await existing.page.locator('[data-moment-comments-toggle]').click();
  await existing.page.locator('[data-moment-comment-submit]').click();
  await existing.page.waitForFunction(() => document.querySelector('[data-moment-comment-form]').hidden);
  assert.equal((await existing.page.locator('comment-form [contenteditable="true"]').innerText()).match(/保留这段草稿/g).length, 1, 'reopening the same draft must not append it again');
  await existing.page.close();

  const incompatible = await fixture();
  await incompatible.page.locator('comment-form [contenteditable="true"]').waitFor({ state: 'attached' });
  await incompatible.page.locator('comment-widget').evaluate((widget) => { widget.fetchConfigMapData = undefined; });
  await sendDraft(incompatible);
  await incompatible.page.waitForFunction(() => !document.querySelector('[data-moment-comment-submit]').disabled);
  assert.equal(await incompatible.page.locator('[data-moment-comment-input]').inputValue(), draft);
  assert.equal(await incompatible.page.locator('comment-form [contenteditable="true"]').isVisible(), true, 'unsupported handoff internals must leave a usable official form');
  assert.match(await incompatible.page.locator('[data-moment-comments-status]').textContent(), /草稿.*保留/);
  await incompatible.page.close();
  console.log('PASS existing official draft and unsupported handoff API retain user input and a working official entry');

  const cold = await fixture({ feed: true, moduleFailure: true });
  assert.equal(cold.modules.length, 0, 'cold feed must not preload a plugin script');
  await sendDraft(cold, true);
  await cold.page.waitForFunction(() => !document.querySelector('[data-moment-comment-submit]').disabled);
  assert.equal(await cold.page.locator('[data-moment-comment-input]').inputValue(), draft);
  assert.equal(cold.modules[0], '/plugins/PluginCommentWidget/assets/static/comment-widget.js');
  await cold.page.locator('[data-moment-comment-input]').fill(`${draft}（恢复后编辑）`);
  assert.equal(await cold.page.locator('[data-moment-comment-submit]').textContent(), '继续验证', 'editing a preserved draft must retain the recovery action');
  await cold.page.locator('[data-moment-comment-input]').fill(draft);
  await cold.page.locator('[data-moment-comment-submit]').click();
  await cold.page.locator('reply-form [contenteditable="true"]').waitFor({ state: 'visible' });
  await cold.page.waitForFunction(() => document.querySelector('[data-moment-comment-form]').hidden);
  assert.equal(await cold.page.locator('reply-form [contenteditable="true"]').innerText(), draft);
  assert.deepEqual(cold.modules, ['/plugins/PluginCommentWidget/assets/static/comment-widget.js', '/plugins/PluginCommentWidget/assets/static/comment-widget.js?theme-retry=1']);
  assert.equal(cold.writes.length, 1, 'failed asset recovery must not resubmit the rejected comment');
  assert.deepEqual(cold.errors, []);
  await cold.page.close();
  console.log('PASS actual cold module path: first import failure and explicit recovery preserve the reply draft');
  const disposed = await fixture({ pending: true });
  await sendDraft(disposed);
  await disposed.page.evaluate(() => { window.__cleanup(); window.__finishPost(); });
  await disposed.page.waitForTimeout(50);
  assert.equal(await disposed.page.locator('[data-moment-official-comments]').isVisible(), false, 'late rejected submissions must not mutate a disposed root');
  assert.equal(await disposed.page.locator('[data-moment-comment-input]').inputValue(), draft);
  assert.deepEqual(disposed.errors, []);
  await disposed.page.close();
  console.log('Moments captcha recovery passed; real CommentWidget 3.4.0, all HTTP responses isolated, no live comments submitted');
} finally { await browser.close(); }
