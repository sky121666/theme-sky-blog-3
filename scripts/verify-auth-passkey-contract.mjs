import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Exercise the installed plugin's real browser code without credentials or Halo writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const jar = process.env.PASSKEY_PLUGIN_JAR || path.resolve(root, '../../plugins/auth-passkey-2.0.0.jar');
const pluginScript = process.env.PASSKEY_PLUGIN_SCRIPT
  ? await fs.readFile(process.env.PASSKEY_PLUGIN_SCRIPT, 'utf8')
  : execFileSync('unzip', ['-p', jar, 'static/login-context.js'], { encoding: 'utf8' });
const template = await fs.readFile(path.join(root, 'templates/gateway_fragments/login.html'), 'utf8');
const form = template.match(/<form class="halo-form[\s\S]*?<\/form>/)?.[0];
const providers = template.match(/<div[^>]*th:fragment="formAuthProviders"[\s\S]*$/)?.[0];
const adapter = await fs.readFile(path.join(root, 'src/apps/auth/passkey.js'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
assert.ok(form && providers, 'login fragments must exist');
const continueTo = '/oauth2/authorize?client_id=fixture&redirect_uri=https%3A%2F%2Fclient.test%2Fcallback%3Fa%3D1%26b%3D2&state=a%2Bb';
const origin = 'http://localhost:31997';
const browser = await chromium.launch({ headless: true });

async function fixture({ method = 'local', remember = true, unsupported = false, success = false, credentialSuccess = success, includePlugin = true, adapterFirst = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  const navigations = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest()) {
      navigations.push(url.pathname + url.search);
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${form}${providers}</body></html>` });
    }
    requests.push({ path: url.pathname, search: url.search, method: request.method(), body: request.postDataJSON() });
    if (url.pathname.endsWith('/authentication/options')) {
      return route.fulfill({ json: { challenge: 'AQID', rpId: 'localhost', timeout: 60000, userVerification: 'preferred', sessionId: 'fixture-session', allowCredentials: [] } });
    }
    if (url.pathname.endsWith('/authentication/verify')) return route.fulfill({ status: success ? 200 : 401, json: success ? {} : { message: 'fixture rejected' } });
    throw new Error(`Unexpected request: ${request.method()} ${url.pathname}`);
  });
  const url = new URL('/login', origin);
  url.searchParams.set('method', method);
  url.searchParams.set('redirect_uri', continueTo);
  url.searchParams.set('remember-me', String(remember));
  await page.goto(url.href);
  // Resolve only the two relevant server-side branches; keep the production form/wrappers.
  await page.evaluate(({ method, unsupported, credentialSuccess }) => {
    for (const node of document.querySelectorAll('*')) {
      const condition = node.getAttribute('th:if');
      const unless = node.getAttribute('th:unless');
      const passkeyCondition = "${fragmentTemplateName == 'login_passkey'}";
      if ((condition === passkeyCondition && method !== 'passkey') || (unless === passkeyCondition && method === 'passkey')) node.remove();
    }
    for (const node of document.querySelectorAll('[th\\:replace]')) {
      if (node.getAttribute('th:replace').includes('loginProviderSection')) {
        node.outerHTML = `<div class="auth-provider-section"><div class="auth-provider-grid auth-provider-grid-icons"><a class="auth-provider-btn" href="/login?method=${method === 'passkey' ? 'local' : 'passkey'}">${method === 'passkey' ? '密码登录' : '使用通行密钥'}</a></div></div>`;
      } else {
        node.outerHTML = method === 'passkey'
          ? '<div id="passkey-error" style="display:none"></div><div id="passkey-warn" style="display:none"></div>'
          : '<input id="username" value="fixture"><input id="password" type="password">';
      }
    }
    for (const node of document.querySelectorAll('[th\\:remove="tag"]')) node.replaceWith(...node.childNodes);
    document.querySelector('#login-form').action = '/login';
    document.querySelector('#login-form').method = 'post';
    window.fixtureCredentialCalls = 0;
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: unsupported ? undefined : function () {} });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      async get() {
        window.fixtureCredentialCalls++;
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!credentialSuccess) throw new DOMException('fixture cancellation', 'NotAllowedError');
        return { rawId: new Uint8Array([1]).buffer, response: { authenticatorData: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null } };
      }
    } });
  }, { method, unsupported, credentialSuccess });
  if (includePlugin) await page.evaluate(() => {
    const marker = document.createElement('script');
    marker.type = 'application/json';
    marker.src = '/plugins/auth-passkey/assets/static/login-context.js?v=2.0.0';
    document.head.append(marker);
  });
  const adapt = () => adapter ? page.addScriptTag({ content: `${adapter.replace(/^export /gm, '')}\ninitAuthPasskeyAdapter();` }) : Promise.resolve();
  if (adapterFirst) await adapt();
  if (includePlugin) await page.addScriptTag({ content: pluginScript });
  if (!adapterFirst) await adapt();
  return { page, context, errors, requests, navigations, url };
}

try {
  const legacy = await fixture({ method: 'passkey', includePlugin: false });
  assert.equal(await legacy.page.locator('#login-form button[type="submit"]').count(), 1, 'older Passkey plugins must retain their native submit button');
  await legacy.context.close();
  for (const remember of [true, false]) {
    const f = await fixture({ remember });
    await f.page.locator('a[href*="method=passkey"]').click();
    await f.page.waitForFunction(() => window.fixtureCredentialCalls > 0, null, { timeout: 1500 }).catch(() => {});
    assert.equal(await f.page.evaluate(() => window.fixtureCredentialCalls), 1, 'Passkey provider must open WebAuthn on the original login page');
    await f.page.locator('#passkey-error').waitFor({ state: 'visible' });
    assert.equal(f.navigations.length, 1, 'Passkey cancellation must not navigate to a separate login page');
    const providerUrl = new URL(await f.page.locator('a[href*="method=passkey"]').getAttribute('href'), origin);
    assert.equal(providerUrl.searchParams.get('redirect_uri'), continueTo, 'nested OIDC continuation must keep its encoding');
    assert.equal(providerUrl.searchParams.get('remember-me'), String(remember));
    assert.equal(await f.page.locator('#password').count(), 1, 'cancellation keeps the password fallback');
    assert.equal(f.requests.some(r => r.path.endsWith('/verify')), false, 'cancellation must not send a verification request');
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }

  for (const [method, adapterFirst, remember] of [['local', false, false], ['local', false, true], ['passkey', false, false], ['passkey', true, false]]) {
    const f = await fixture({ method, success: true, adapterFirst });
    await f.page.locator('#remember-me').setChecked(remember);
    const trigger = method === 'local' ? f.page.locator('a[href*="method=passkey"]') : f.page.locator('#login-form .auth-btn-primary');
    await trigger.focus();
    await trigger.press('Enter');
    await f.page.waitForURL(url => url.pathname === '/oauth2/authorize', { timeout: 2500 });
    assert.equal(f.navigations.at(-1), continueTo, 'Passkey success returns to the original OIDC authorization request');
    const verify = f.requests.filter(r => r.path.endsWith('/authentication/verify'));
    assert.equal(verify.length, 1, 'one activation must submit exactly one assertion');
    assert.equal(new URLSearchParams(verify[0].search).get('remember-me'), String(remember), 'current remember-me state must reach verification');
    assert.equal(verify[0].body.sessionId, 'fixture-session');
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }

  const rejected = await fixture({ credentialSuccess: true });
  await rejected.page.locator('a[href*="method=passkey"]').click();
  await rejected.page.locator('#passkey-error').waitFor({ state: 'visible' });
  assert.equal(await rejected.page.locator('#passkey-error').textContent(), 'fixture rejected');
  assert.equal(rejected.navigations.length, 1);
  assert.equal(await rejected.page.locator('a[href*="method=passkey"]').getAttribute('aria-disabled'), 'false');
  assert.equal(await rejected.page.locator('#password').count(), 1);
  assert.deepEqual(rejected.errors, []);
  await rejected.context.close();

  const unsupported = await fixture({ unsupported: true });
  await unsupported.page.locator('a[href*="method=passkey"]').click();
  await unsupported.page.locator('#passkey-warn').waitFor({ state: 'visible' });
  assert.equal(unsupported.navigations.length, 1);
  assert.equal(unsupported.requests.length, 0);
  assert.equal(await unsupported.page.locator('#password').count(), 1);
  assert.deepEqual(unsupported.errors, []);
  await unsupported.context.close();
  console.log('verify-auth-passkey-contract passed: original-page WebAuthn, cancel/fallback, OIDC, remember-me, legacy entry, keyboard and unsupported browser; no real authentication requests');
} finally {
  await browser.close();
}
