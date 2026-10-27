import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Isolated real CommentWidget, using current compatibility source (not stale
// built theme assets). Every request is handled locally, including all writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(root, process.env.COMMENT_EDIT_OUTPUT || 'output/functional-fixes-20261026/comments/source-regression');
const jar = process.env.COMMENT_WIDGET_PLUGIN_JAR || path.resolve(root, '../../plugins/PluginCommentWidget-3.4.0.jar');
const enabled = process.env.COMMENT_EDIT_COMPAT !== '0';
const source = enabled ? await fs.readFile(path.join(root, 'src/shared/comment-edit-readiness.js'), 'utf8') : '';
const cache = new Map();
const asset = name => {
  assert.match(name, /^[a-zA-Z0-9._-]+$/);
  if (!cache.has(name)) cache.set(name, execFileSync('unzip', ['-p', jar, `static/${name}`], { maxBuffer: 5 * 1024 * 1024 }));
  return cache.get(name);
};
await fs.mkdir(out, { recursive: true });
const report = { observedAt: new Date().toISOString(), mode: enabled ? 'Official JAR + current theme compatibility source' : 'Official JAR without compatibility: RED control', sourceSha256: source && crypto.createHash('sha256').update(source).digest('hex'), results: [], realBusinessWrites: 0 };
const browser = await chromium.launch({ headless: true });

async function run(width, label, { raw = '<p>原内容</p>', resource = 'comments', slow = false } = {}, action) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', locale: 'zh-CN' });
  const page = await context.newPage();
  if (slow) await page.addInitScript(() => {
    // Simulate a delayed readiness poll without changing official component
    // code/state. The editor can become usable between real timer callbacks.
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 50 ? 1000 : delay, ...args);
  });
  const result = { width, label, errors: [], writes: [], assertions: [] }; report.results.push(result);
  page.on('pageerror', error => result.errors.push(error.message));
  const target = { metadata: { name: 'mock-target', version: 4 }, spec: { raw, content: raw, commentName: 'mock-root' } };
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/compat.js') return route.fulfill({ contentType: 'text/javascript', body: source });
    if (url.pathname.startsWith('/plugin/')) {
      if (slow && path.basename(url.pathname).startsWith('dist-CT1spbYk')) await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ contentType: 'text/javascript', body: asset(path.basename(url.pathname)) });
    }
    if (request.method() === 'PUT') {
      assert.equal(url.pathname, `/apis/api.console.halo.run/v1alpha1/${resource}/mock-target/content`);
      result.writes.push(request.postDataJSON());
      return route.fulfill({ json: target });
    }
    if (url.pathname === `/apis/content.halo.run/v1alpha1/${resource}/mock-target`) return route.fulfill({ json: target });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><button id="outside">外部焦点</button><main id="host"></main><script type="module">
      ${enabled ? "import { installCommentEditReadiness } from '/compat.js'; window.installCompat = installCommentEditReadiness; window.registeredBeforeInstall = Boolean(customElements.get('comment-edit-form')); window.installPending = installCommentEditReadiness(window);" : ''}
      await import('/plugin/comment-widget.js');
      ${enabled ? 'window.installed = await window.installPending;' : ''}
      await customElements.whenDefined('comment-edit-form');
      window.mountForm = () => { const form = document.createElement('comment-edit-form'); form.target = ${JSON.stringify(target)}; form.resource = ${JSON.stringify(resource)}; form.configMapData = { editor: { enableEmoji: false } }; form.addEventListener('edit-close', () => form.remove()); document.querySelector('#host').append(form); return form; };
      window.form = window.mountForm();
    </script></body></html>` });
    throw new Error(`Unexpected isolated request: ${request.method()} ${url.pathname}`);
  });
  try {
    await page.goto('http://comment.fixture/edit', { waitUntil: 'domcontentloaded' });
    if (enabled) {
      await page.waitForFunction(() => typeof window.installed === 'boolean');
      result.installed = await page.evaluate(() => window.installed);
      assert.equal(await page.evaluate(() => window.registeredBeforeInstall), false, 'Cold-load fixture must start compatibility before the official element is registered');
      assert.equal(result.installed, true, 'Audited official component must accept the compatibility wrapper');
    }
    await action(page, result);
    assert.deepEqual(result.errors, []);
    result.passed = true;
  } catch (error) {
    result.passed = false; result.error = error.message;
    await page.screenshot({ path: path.join(out, `${width}-${label}-failure.png`) }).catch(() => {});
  } finally {
    await context.close();
    console.log(`${width} ${label}: ${result.passed ? 'PASS' : `FAIL ${result.error}`}`);
  }
}

try {
  for (const width of [1440, 390]) {
    for (const resource of ['comments', 'replies']) await run(width, `early-${resource}`, { resource, slow: true }, async (page, result) => {
      const form = page.locator('comment-edit-form'), edit = form.locator('[contenteditable="true"]');
      await edit.waitFor({ state: 'visible' });
      result.beforeInput = await form.evaluate(node => ({ baseline: node.baseline, busy: node.getAttribute('aria-busy'), styles: [...node.shadowRoot.querySelectorAll('[data-theme-comment-edit-readiness]')].map(style => style.textContent), editorVisibility: getComputedStyle(node.shadowRoot.querySelector('comment-editor')).visibility, inputVisibility: getComputedStyle(node.shadowRoot.querySelector('comment-editor').shadowRoot.querySelector('[contenteditable]')).visibility }));
      await edit.fill('刚开放编辑便粘贴 <安全文本>');
      await page.waitForFunction(() => Boolean(window.form.baseline));
      await page.waitForTimeout(80); // Also cross the official 50 ms poll boundary.
      result.state = await form.evaluate(node => ({ baseline: node.baseline, content: node.content, dirty: node.dirty, canSave: node.canSave }));
      assert.equal(await form.locator('.edit-form-submit').isEnabled(), true, 'Early input must remain a change and be saveable');
      await form.locator('.edit-form-submit').click();
      await form.waitFor({ state: 'detached' });
      assert.deepEqual(result.writes, [{ raw: '<p>刚开放编辑便粘贴 &lt;安全文本&gt;</p>', content: '<p>刚开放编辑便粘贴 &lt;安全文本&gt;</p>', version: 4 }]);
      result.assertions.push('Slow initialization; earliest visible input remains dirty', 'Official sanitization and versioned save preserved');
    });
    for (const [label, raw] of [['formatted', '<p><strong>保留格式</strong> 与 <em>原文</em></p>'], ['plain', '第一行\n第二行'], ['empty', '']]) await run(width, `unchanged-${label}`, { raw }, async (page, result) => {
      const form = page.locator('comment-edit-form');
      await form.locator('[contenteditable="true"]').waitFor({ state: 'visible' });
      await page.waitForFunction(() => Boolean(window.form.baseline));
      assert.equal(await form.locator('.edit-form-submit').isDisabled(), true);
      assert.equal(await form.evaluate(node => node.dirty), false);
      assert.deepEqual(result.writes, []);
      if (label === 'formatted') assert.equal(await form.locator('strong').innerText(), '保留格式');
      if (label === 'empty') {
        await form.locator('[contenteditable="true"]').fill('   ');
        await page.waitForFunction(() => !window.form.hasContent);
        assert.equal(await form.locator('.edit-form-submit').isDisabled(), true, 'Whitespace alone cannot enable save');
        await form.locator('[contenteditable="true"]').fill('');
      }
      await page.waitForTimeout(180);
      assert.equal(await form.locator('[contenteditable="true"]').evaluate(node => node.getRootNode().activeElement === node), true, 'Original editor focus must be restored after initialization');
      page.once('dialog', dialog => dialog.accept());
      await form.locator('.edit-form-cancel').click();
      await form.waitFor({ state: 'detached' });
      result.assertions.push('No edit does not become dirty', 'Original formatting/empty content normalized by official editor', 'Cancel remains available without a write');
    });
    await run(width, 'cancel-during-initialization', { slow: true }, async (page, result) => {
      const form = page.locator('comment-edit-form');
      await form.locator('comment-editor').waitFor({ state: 'attached' });
      assert.equal(await form.locator('.edit-form-cancel').isVisible(), true);
      assert.equal(await form.locator('.edit-form-cancel').isEnabled(), true);
      await form.locator('.edit-form-cancel').click();
      await form.waitFor({ state: 'detached' });
      await page.locator('#outside').focus();
      await page.waitForTimeout(1400);
      assert.equal(await page.locator('#outside').evaluate(node => document.activeElement === node), true);
      assert.equal(await page.evaluate(() => window.form.shadowRoot.querySelectorAll('[data-theme-comment-edit-readiness]').length), 0);
      assert.deepEqual(result.writes, []);
      result.assertions.push('Cancel usable during slow initialization', 'Detached editor releases temporary style and does not steal focus');
    });
    if (enabled) await run(width, 'repeat-install-and-recreate', {}, async (page, result) => {
      await page.locator('comment-edit-form [contenteditable="true"]').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(async () => { const original = customElements.get('comment-edit-form').prototype.focusEditor; await window.installCompat(window); await window.installCompat(window); return original === customElements.get('comment-edit-form').prototype.focusEditor; }), true);
      assert.deepEqual(await page.evaluate(async () => {
        const Current = customElements.get('comment-edit-form');
        class Updated extends Current { async focusEditor() { await this.updateComplete; } }
        const updated = Updated.prototype.focusEditor;
        const accepted = await window.installCompat({ customElements: { whenDefined: async () => {}, get: name => name === 'comment-edit-form' ? Updated : customElements.get(name) } });
        return { accepted, untouched: Updated.prototype.focusEditor === updated };
      }), { accepted: false, untouched: true }, 'An updated official method must be left untouched');
      await page.evaluate(() => { window.form.remove(); document.querySelector('#host').replaceChildren(); window.form = window.mountForm(); });
      const form = page.locator('comment-edit-form');
      await form.locator('[contenteditable="true"]').fill('换页后的新草稿');
      await page.waitForFunction(() => Boolean(window.form.baseline));
      assert.equal(await form.locator('.edit-form-submit').isEnabled(), true);
      await form.locator('.edit-form-submit').click();
      await form.waitFor({ state: 'detached' });
      assert.equal(result.writes.length, 1);
      assert.equal(result.writes[0].content, '<p>换页后的新草稿</p>');
      result.assertions.push('Repeated installation keeps one wrapper', 'Changed official method is not wrapped', 'PJAX-style removal/recreation preserves fresh editor ownership');
    });
  }
} finally {
  await browser.close();
  report.summary = { passed: report.results.filter(item => item.passed).length, failed: report.results.filter(item => !item.passed).length };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
}
if (report.summary.failed) process.exitCode = 1;
