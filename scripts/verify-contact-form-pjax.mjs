import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginJar = process.env.CONTACT_FORM_PLUGIN_JAR
  || path.resolve(root, '../../plugins/PluginContactForm-2.1.0.jar');
const assets = new Map();
const pluginAsset = (name) => {
  if (!assets.has(name)) assets.set(name, execFileSync('unzip', ['-p', pluginJar, `static/${name}`], { maxBuffer: 2 * 1024 * 1024 }).toString());
  return assets.get(name);
};
const compatPath = path.join(root, 'src/shell/desktop-shell/runtime/shared/plugin-compat.js');
const compatSource = await readFile(compatPath, 'utf8');
const reportDir = process.env.CONTACT_FORM_REPORT_DIR || path.join(root, 'output/contact-form-pjax');
const reportName = process.env.CONTACT_FORM_REPORT_NAME || 'contact-form-pjax';
await mkdir(reportDir, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  compatSha256: createHash('sha256').update(compatSource).digest('hex'),
  jarSha256: createHash('sha256').update(await readFile(pluginJar)).digest('hex'),
  scope: 'Official ContactForm JAR and actual form response shape; every HTTP request intercepted; no server writes.',
  drafts: [],
  passed: false
};
const bundle = await build({
  stdin: {
    contents: `${compatSource}\nwindow.__contactCompat = { preparePluginCompatibilityFromResponse, initPluginCompatibility };`,
    resolveDir: path.dirname(compatPath), loader: 'js'
  }, bundle: true, format: 'iife', write: false, logLevel: 'silent'
});
const config = (name) => ({
  displayFormConfig: {
    asideButtonBackgroundColor: '#2563eb', asideButtonIcon: 'message',
    asideButtonLabel: '开发验收表单（勿提交）', asideButtonStyle: 'label',
    asideButtonTextColor: '#ffffff', displayForm: 'aside_button', displayPosition: 'right_bottom',
    doNotDisturb: false, doNotDisturbCustomStrategy: [], doNotDisturbStrategy: 'once',
    doNotDisturbSubmitStrategy: 'once', route: [], routeType: 'all'
  }, formId: name, modernSlug: name, presentation: { locale: 'auto', messages: {} },
  preview: false, renderer: 'modern'
});
// Hand-checked public response shape from the real 2.1.0 development form.
// Recovery is deliberately disabled: the theme must preserve the live form,
// not depend on the plugin saving or reconstructing a visitor's answers.
const publishedForm = (name) => ({
  formName: name, slug: name, standalonePageEnabled: false,
  title: '开发验收表单', description: 'Local lifecycle regression fixture.',
  revisionNumber: 1,
  revisionHash: 'd45b93b372bbb47aea941975b9d110eb941fbec5f611f23169e46750a5963b8a',
  publishedAt: '2026-10-23T16:51:15.525104796Z',
  availability: { state: 'available' }, prefill: {},
  definition: {
    schemaVersion: 'forms.halo.run/v1alpha1',
    dataSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema', additionalProperties: false,
      properties: { acceptance_text: { type: 'string', title: '开发验收字段（勿提交）', description: '生命周期回归' } },
      required: [], type: 'object'
    },
    logic: { rules: [] },
    settings: {
      abuse: { allowRules: [], blockRules: [], honeypot: true, minimumCompletionMillis: 800, mode: 'balanced' },
      analytics: { mode: 'basic', rawSessionRetentionDays: 30 },
      answerReferences: { enabled: false, fallback: '' }, availability: {},
      completion: { action: 'receipt' }, hiddenValuePolicy: 'clear', identityFields: [], locale: 'auto',
      partialProgress: { enabled: false, fieldIds: [], notice: '保存后可稍后继续填写。', trigger: 'manual', ttlHours: 72 },
      prefill: { enabled: false, mappings: [] },
      recovery: { enabled: false, prompt: '检测到未完成的填写内容，是否继续？', storage: 'session', ttlMinutes: 1440 }
    },
    theme: { mode: 'inherit', responsive: {}, tokens: {} },
    uiSchema: {
      messages: { error: '提交失败，请检查后重试', success: '提交成功', text: {} },
      pages: [{ id: 'page_1', title: '第一页', rows: [{
        id: 'row_1', layout: { align: 'stretch', gap: 'normal' },
        fields: [{ config: { required: false, autocomplete: 'off', localRecovery: false },
          description: '生命周期回归', fieldId: 'acceptance_text', label: '开发验收字段（勿提交）', type: 'text', width: 100 }]
      }] }],
      submit: { alignment: 'start', label: '提交' }
    }
  }
});
const browser = await chromium.launch();

try {
  const errors = [];
  const requests = [];
  const unexpectedRequests = [];
  const checkOrigin = (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'https://contact.fixture') return true;
    unexpectedRequests.push({ url: url.href, method: request.method() });
    return false;
  };
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const draftPage = await browser.newPage({ viewport, locale: 'zh-CN', serviceWorkers: 'block' });
    draftPage.setDefaultTimeout(10000);
    draftPage.on('pageerror', (error) => errors.push(error.message));
    await draftPage.route('**/*', async (route) => {
      if (!checkOrigin(route)) return route.abort('blockedbyclient');
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ path: url.pathname, method: request.method() });
      if (request.method() === 'POST' && url.pathname.endsWith('/analytics/events')) {
        return route.fulfill({ status: 204, body: '' });
      }
      if (request.method() !== 'GET') {
        unexpectedRequests.push({ url: url.href, method: request.method() });
        return route.abort('blockedbyclient');
      }
      if (url.pathname.startsWith('/plugins/PluginContactForm/assets/static/')) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: pluginAsset(path.basename(url.pathname)) });
      }
      const form = url.pathname.match(/^\/apis\/api.forms.halo.run\/v1alpha1\/forms\/([^/]+)(?:\/by-name)?$/);
      if (form) return route.fulfill({ status: 200, json: publishedForm(form[1]) });
      if (request.isNavigationRequest()) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>ContactForm 草稿回归</h1></main></body></html>' });
      }
      unexpectedRequests.push({ url: url.href, method: request.method() });
      return route.abort('blockedbyclient');
    });
    await draftPage.goto('https://contact.fixture/draft');
    await draftPage.evaluate((forms) => { window.autoContactFrom = forms; }, [config('draft-a')]);
    await draftPage.addScriptTag({ url: 'https://contact.fixture/plugins/PluginContactForm/assets/static/contact-form-loader.iife.js?build=fixture' });
    await draftPage.addScriptTag({ content: bundle.outputFiles[0].text });
    await draftPage.evaluate(() => window.__contactCompat.initPluginCompatibility());
    await draftPage.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).click();
    const field = draftPage.getByRole('textbox', { name: '开发验收字段（勿提交）', exact: true });
    const draft = `${viewport.width}px 未提交草稿：失败导航后继续填写`;
    await field.fill(draft);
    await draftPage.evaluate(() => {
      window.__originalAuto = document.querySelector('body > halo-contact-form-auto-display');
      window.__findContactNode = (root, selector) => {
        const direct = root?.querySelector(selector);
        if (direct) return direct;
        if (root?.shadowRoot) {
          const found = window.__findContactNode(root.shadowRoot, selector);
          if (found) return found;
        }
        for (const node of root?.querySelectorAll('*') || []) {
          if (node.shadowRoot) {
            const found = window.__findContactNode(node.shadowRoot, selector);
            if (found) return found;
          }
        }
        return null;
      };
      window.__originalForm = window.__findContactNode(window.__originalAuto, 'halo-contact-form');
      window.__originalInput = window.__findContactNode(window.__originalForm, 'input:not([type="hidden"]):not([tabindex="-1"])');
    });
    const run = { viewport, checkpoints: [] };
    report.drafts.push(run);
    const checkDraft = async (checkpoint) => {
      const state = await draftPage.evaluate(() => {
        const auto = document.querySelector('body > halo-contact-form-auto-display');
        const form = window.__findContactNode(auto, 'halo-contact-form');
        const input = window.__findContactNode(form, 'input:not([type="hidden"]):not([tabindex="-1"])');
        const dialog = window.__findContactNode(auto, '[role="dialog"]');
        return {
          sameAuto: auto === window.__originalAuto, connected: window.__originalAuto.isConnected,
          sameForm: form === window.__originalForm, sameInput: input === window.__originalInput,
          value: input?.value ?? null,
          open: !!dialog?.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden',
          count: document.querySelectorAll('body > halo-contact-form-auto-display').length
        };
      });
      run.checkpoints.push({ checkpoint, ...state });
      assert.deepEqual(state, { sameAuto: true, connected: true, sameForm: true, sameInput: true, value: draft, open: true, count: 1 },
        `${viewport.width}px ${checkpoint}: pending or failed navigation must preserve the real instance, draft and open dialog`);
    };
    const stage = (forms, intentId) => draftPage.evaluate(async ({ forms, intentId }) => {
      document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId } }));
      await window.__contactCompat.preparePluginCompatibilityFromResponse(`<script>var autoContactFrom = ${JSON.stringify(forms)}<\/script>`);
    }, { forms, intentId });
    const settle = (intentId, outcome) => draftPage.evaluate(({ intentId, outcome }) => {
      document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId, outcome } }));
    }, { intentId, outcome });
    await checkDraft('before navigation');
    await draftPage.screenshot({ path: path.join(reportDir, `${reportName}-${viewport.width}-before.png`) });
    // This catches premature removal or disconnect/reconnect. Real custom
    // elements reset their child form on reconnect even if the root is reused.
    await stage([], 1);
    await checkDraft('staged unassigned target');
    await settle(1, 'failed');
    await checkDraft('failed unassigned target');
    assert.deepEqual(await draftPage.evaluate(() => window.autoContactFrom.map((item) => item.formId)), ['draft-a']);
    await stage([config('draft-b')], 2);
    await checkDraft('staged different target');
    await settle(2, 'cancelled');
    await checkDraft('cancelled different target');
    await stage([], 3);
    await stage([config('draft-b')], 4);
    await settle(3, 'failed');
    await draftPage.evaluate(() => document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 3, mode: 'content' } })));
    await checkDraft('stale failure and readiness');
    await settle(4, 'failed');
    await settle(4, 'failed');
    await checkDraft('repeated failed navigation');
    await draftPage.screenshot({ path: path.join(reportDir, `${reportName}-${viewport.width}-rollback.png`) });
    // A new page may use identical placement data. Config equality must not
    // carry a prior page's open dialog and answers into a successful commit.
    await stage([config('draft-a')], 5);
    await checkDraft('staged identical placement');
    await draftPage.evaluate(() => document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 5, mode: 'content' } })));
    assert.equal(await draftPage.evaluate(() => window.__originalAuto.isConnected), false,
      'successful same-App navigation with identical placement must dispose the original draft instance');
    await draftPage.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).waitFor();
    assert.equal(await draftPage.getByRole('dialog').count(), 0, 'identical placement on a successful target starts closed');
    await draftPage.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).click();
    assert.equal(await field.inputValue(), '', 'identical placement on a successful target has no prior-page draft');
    const committedDraft = '目标页新草稿：重复 ready 必须保留';
    await field.fill(committedDraft);
    await field.evaluate((input) => {
      window.__committedContactInput = input;
      window.__committedContactAuto = document.querySelector('body > halo-contact-form-auto-display');
    });
    await draftPage.evaluate(() => document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 5, mode: 'content' } })));
    assert.equal(await field.inputValue(), committedDraft, 'duplicate readiness must not clear the new target draft');
    assert.equal(await field.evaluate((input) => input === window.__committedContactInput
      && input.isConnected && window.__committedContactAuto === document.querySelector('body > halo-contact-form-auto-display')), true,
    'duplicate readiness preserves the committed target instance and input');
    assert.equal(await draftPage.getByRole('dialog').isVisible(), true, 'duplicate readiness preserves the target open state');
    run.identicalPlacementCommit = { oldInstanceDisposed: true, targetInitiallyEmpty: true, targetInitiallyClosed: true, duplicateReadyPreserved: true };
    // A successful commit must still retire the old instance and draft.
    await stage([], 6);
    await draftPage.evaluate(() => {
      document.dispatchEvent(new Event('pjax:success'));
      document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 6, mode: 'full' } }));
      document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 6, mode: 'full' } }));
    });
    assert.equal(await draftPage.locator('body > halo-contact-form-auto-display').count(), 0, 'successful navigation clears automatic form');
    assert.equal(await draftPage.evaluate(() => window.__originalAuto.isConnected), false, 'successful navigation disposes original instance');
    await stage([config('draft-a')], 7);
    await draftPage.evaluate(() => document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 7, mode: 'content' } })));
    await draftPage.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).click();
    assert.equal(await field.inputValue(), '', 'returning after a successful navigation starts a fresh form when recovery is disabled');
    await draftPage.close();
  }
  const page = await browser.newPage({ serviceWorkers: 'block' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    if (!checkOrigin(route)) return route.abort('blockedbyclient');
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, method: route.request().method() });
    if (url.pathname.startsWith('/plugins/PluginContactForm/assets/static/')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: pluginAsset(path.basename(url.pathname)) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><main id="content"></main><halo-contact-form id="manual-owned-by-content"></halo-contact-form></body></html>' });
  });
  await page.goto('https://contact.fixture/a');
  await page.evaluate((initial) => { window.autoContactFrom = initial; }, [config('fixture-a')]);
  // The real 2.1.0 loader, runtime, display and floating component are loaded
  // from the installed official JAR; no copied plugin implementation ships here.
  await page.addScriptTag({ url: 'https://contact.fixture/plugins/PluginContactForm/assets/static/contact-form-loader.iife.js?build=fixture' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => window.__contactCompat.initPluginCompatibility());
  await page.waitForSelector('body > halo-contact-form-auto-display', { state: 'attached' });
  await page.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).waitFor();
  await page.evaluate(() => { window.__manualForm = document.querySelector('#manual-owned-by-content'); });
  const snapshot = () => page.evaluate(() => ({
    names: (window.autoContactFrom || []).map((item) => item.formId),
    mounts: document.querySelectorAll('body > halo-contact-form-auto-display, body > halo-contact-form-auto-loader').length,
    manual: document.querySelectorAll('#manual-owned-by-content').length
  }));
  const prepare = (forms, intentId) => page.evaluate(async ({ forms, intentId }) => {
    document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId } }));
    await window.__contactCompat.preparePluginCompatibilityFromResponse(`<html><head><script class="pjax">var autoContactFrom = ${JSON.stringify(forms)}<\/script></head></html>`);
  }, { forms, intentId });
  const ready = (intentId, full = false) => page.evaluate(({ intentId, full }) => {
    if (full) document.dispatchEvent(new Event('pjax:success'));
    document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId, mode: full ? 'full' : 'content', root: document } }));
  }, { intentId, full });
  const waitForForm = (name) => page.waitForFunction((name) => {
    const nodes = document.querySelectorAll('body > halo-contact-form-auto-display');
    return nodes.length === 1 && JSON.parse(nodes[0].config || '{}').formId === name;
  }, name);

  await prepare([], 1);
  await ready(1, true);
  assert.deepEqual(await snapshot(), { names: [], mounts: 0, manual: 1 }, 'A -> unassigned B must clear page config and only automatic plugin mounts');

  await prepare([config('fixture-c')], 2);
  await ready(2);
  await waitForForm('fixture-c');
  assert.deepEqual(await snapshot(), { names: ['fixture-c'], mounts: 1, manual: 1 }, 'same-App content navigation must mount the target without a global pjax:success replay');
  await ready(2);
  assert.equal((await snapshot()).mounts, 1, 'duplicate readiness must not duplicate automatic instances');
  assert.equal(await page.evaluate(() => window.__manualForm === document.querySelector('#manual-owned-by-content')), true, 'manual content nodes must preserve identity');

  await prepare([], 3);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 3, outcome: 'failed' } })));
  await waitForForm('fixture-c');
  assert.deepEqual((await snapshot()).names, ['fixture-c'], 'failed committed response must restore the last ready page configuration');

  await prepare([config('fixture-d')], 4);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme:navigation-settled', { detail: { intentId: 3, outcome: 'failed' } })));
  await ready(4);
  await waitForForm('fixture-d');
  assert.deepEqual((await snapshot()).names, ['fixture-d'], 'stale navigation failure must not roll back a newer response');

  await prepare([], 5);
  await ready(5);
  await page.evaluate(() => window.__contactCompat.preparePluginCompatibilityFromResponse('<script class="pjax">var autoContactFrom = []; window.__executedContactPayload = true;<\/script>'));
  assert.equal(await page.evaluate(() => window.__executedContactPayload), undefined, 'response configuration must be parsed as data, never executed');
  assert.equal((await snapshot()).mounts, 0);

  // A cold page may have had no automatic placement when the plugin loader's
  // brief global-config polling ended. The bridge must load by URL exactly once.
  const cold = await browser.newPage({ serviceWorkers: 'block' });
  cold.on('pageerror', (error) => errors.push(error.message));
  await cold.route('**/*', async (route) => {
    if (!checkOrigin(route)) return route.abort('blockedbyclient');
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, method: route.request().method() });
    if (url.pathname.startsWith('/plugins/PluginContactForm/assets/static/')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: pluginAsset(path.basename(url.pathname)) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
  });
  await cold.goto('https://contact.fixture/empty');
  await cold.addScriptTag({ content: bundle.outputFiles[0].text });
  await cold.evaluate(async (target) => {
    window.autoContactFrom = [];
    // Keep the observed loader URL but omit its polling, reproducing the state
    // after the plugin has stopped its 30-second automatic-placement polling.
    const loader = document.createElement('script');
    loader.type = 'application/json';
    loader.src = '/plugins/PluginContactForm/assets/static/contact-form-loader.iife.js?build=fixture';
    document.head.append(loader);
    window.__contactCompat.initPluginCompatibility();
    document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1 } }));
    await window.__contactCompat.preparePluginCompatibilityFromResponse(`<script class="pjax">var autoContactFrom = ${JSON.stringify(target)}<\/script>`);
    document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 1, mode: 'content' } }));
  }, [config('fixture-cold')]);
  await cold.waitForSelector('body > halo-contact-form-auto-display halo-contact-form-floating', { state: 'attached' });
  await cold.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).waitFor();
  assert.equal(await cold.evaluate(() => document.querySelectorAll('body > halo-contact-form-auto-display').length), 1);
  const coldAssets = await cold.locator('script[src*="/PluginContactForm/"]').evaluateAll((nodes) => nodes.map((node) => node.src));
  assert.equal(new Set(coldAssets).size, coldAssets.length, 'cold lazy assets must not load a URL twice');

  // The official loader retains a failed script with its error-state marker.
  // After its polling expires, a same-App visit must retry that URL rather than
  // wait forever for the failed node to define the custom element.
  const recovered = await browser.newPage({ serviceWorkers: 'block' });
  let runtimeAttempts = 0;
  recovered.on('pageerror', (error) => errors.push(error.message));
  await recovered.clock.install();
  await recovered.route('**/*', async (route) => {
    if (!checkOrigin(route)) return route.abort('blockedbyclient');
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, method: route.request().method() });
    if (url.pathname.startsWith('/plugins/PluginContactForm/assets/static/')) {
      if (path.basename(url.pathname) === 'contact-form.iife.js' && ++runtimeAttempts === 1) {
        return route.abort('failed');
      }
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: pluginAsset(path.basename(url.pathname)) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><halo-contact-form></halo-contact-form></body></html>' });
  });
  await recovered.goto('https://contact.fixture/recovery');
  await recovered.evaluate(() => { window.autoContactFrom = []; });
  await recovered.addScriptTag({ url: 'https://contact.fixture/plugins/PluginContactForm/assets/static/contact-form-loader.iife.js?build=fixture' });
  await recovered.locator('script[src*="/contact-form.iife.js"][data-contact-form-script-state="error"]').waitFor({ state: 'attached' });
  await recovered.clock.fastForward(31_000);
  await recovered.addScriptTag({ content: bundle.outputFiles[0].text });
  await recovered.evaluate(async (target) => {
    window.__contactCompat.initPluginCompatibility();
    document.dispatchEvent(new CustomEvent('theme:navigation-accepted', { detail: { intentId: 1 } }));
    await window.__contactCompat.preparePluginCompatibilityFromResponse(`<script class="pjax">var autoContactFrom = ${JSON.stringify(target)}<\/script>`);
    document.dispatchEvent(new CustomEvent('theme:pjax-ready', { detail: { intentId: 1, mode: 'content' } }));
  }, [config('fixture-recovered')]);
  await recovered.getByRole('button', { name: '开发验收表单（勿提交）', exact: true }).waitFor({ timeout: 5000 });
  assert.equal(runtimeAttempts, 2, 'the failed official runtime URL must be requested again exactly once');
  assert.equal(await recovered.locator('script[src*="/contact-form.iife.js"]').count(), 1, 'retry must replace the failed runtime node');
  assert.deepEqual(errors, [], 'real plugin lifecycle must not throw');
  assert.deepEqual(unexpectedRequests, [], 'every HTTP request must be known and locally intercepted');
  assert.equal(requests.some((request) => request.method !== 'GET' && !request.path.endsWith('/analytics/events')), false, 'lifecycle acceptance must not submit or mutate form data');
  report.passed = true;
  report.requests = requests;
  console.log('ContactForm 2.1.0 real-runtime PJAX lifecycle passed: real draft/dialog/instance rollback at 1440/390px, successful cleanup, same-App mount, stale event, cold assets, failed asset retry, no submission');
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(reportDir, `${reportName}.json`), JSON.stringify(report, null, 2));
}
