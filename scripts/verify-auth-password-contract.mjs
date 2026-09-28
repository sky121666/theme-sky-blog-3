import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const localTemplate = await fs.readFile(new URL('../templates/login_local.html', import.meta.url), 'utf8');
const commonTemplate = await fs.readFile(new URL('../templates/gateway_fragments/common.html', import.meta.url), 'utf8');

const visiblePassword = localTemplate.match(/<input id="password"[\s\S]*?\/>/)?.[0];
const encryptedPassword = localTemplate.match(/<input[^>]*id="encrypted-password"[\s\S]*?\/>/)?.[0];
assert.ok(visiblePassword, 'local login needs its visible password field');
assert.ok(encryptedPassword, 'local login needs a dedicated encrypted password field');
assert.doesNotMatch(visiblePassword, /\sname="password"/, 'visible password must never be a successful control when a public key exists');
assert.match(visiblePassword, /th:name="\$\{#strings\.isEmpty\(publicKey\) \? 'password' : null\}"/, 'no-key login must retain the native password field name');
assert.match(visiblePassword, /autocomplete="current-password"/, 'password manager semantics must be preserved');
assert.match(encryptedPassword, /name="password"/, 'only the hidden field may carry the encrypted password');
assert.match(encryptedPassword, /th:if="\$\{not #strings\.isEmpty\(publicKey\)\}"/, 'hidden field must only appear for a public-key login');
assert.match(localTemplate, /data-auth-encryption-error[^>]*hidden|hidden[^>]*data-auth-encryption-error/, 'encryption errors need a hidden live region');

const inlineScript = commonTemplate.match(/<script th:inline="javascript" type="text\/javascript">([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, 'public-key login script must exist');
const thymeleafKey = 'const publicKey = /*[[${publicKey}]]*/ "";';
assert.ok(inlineScript.includes(thymeleafKey), 'public key must be inlined by Halo');
const script = inlineScript.replace(thymeleafKey, 'const publicKey = "TEST_PUBLIC_KEY";');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body>
    <form id="login-form" method="post" action="/login">
      <input id="username" name="username" value="fixture-user" />
      <input id="password" type="password" autocomplete="current-password" required />
      <input id="encrypted-password" type="hidden" name="password" value="" />
      <button type="button" data-auth-lockscreen-back>Back</button>
      <p id="auth-encryption-error" data-auth-encryption-error role="alert" hidden></p>
    </form></body></html>`);
  await page.addScriptTag({ content: script });

  const initial = await page.evaluate(() => [...new FormData(document.querySelector('#login-form')).getAll('password')]);
  assert.deepEqual(initial, [''], 'a submission without JavaScript must not contain the visible password');

  async function attempt(mode, password) {
    return page.evaluate(({ mode, password }) => {
      const form = document.querySelector('#login-form');
      const visible = document.querySelector('#password');
      const encrypted = document.querySelector('#encrypted-password');
      const error = document.querySelector('#auth-encryption-error');
      if (mode === 'missing') {
        delete window.JSEncrypt;
      } else {
        window.JSEncrypt = class {
          setPublicKey(key) { if (key !== 'TEST_PUBLIC_KEY') throw new Error('wrong test key'); }
          getKey() { return mode === 'bad-key' ? null : { n: { bitLength: () => 4096 } }; }
          encrypt() {
            if (mode === 'throw') throw new Error('isolated encryption failure');
            return mode === 'false' ? false : 'Q0lQSEVS';
          }
        };
      }
      visible.value = password;
      visible.dispatchEvent(new Event('input', { bubbles: true }));
      const submit = new Event('submit', { bubbles: true, cancelable: true });
      const accepted = form.dispatchEvent(submit);
      return {
        accepted,
        prevented: submit.defaultPrevented,
        hidden: encrypted.value,
        fields: [...new FormData(form).getAll('password')],
        errorVisible: !error.hidden,
        errorText: error.textContent.trim(),
        invalid: visible.getAttribute('aria-invalid'),
      };
    }, { mode, password });
  }

  const successful = await attempt('success', 'fixture-password');
  assert.equal(successful.accepted, true);
  assert.deepEqual(successful.fields, ['Q0lQSEVS']);
  assert.equal(successful.errorVisible, false);

  for (const mode of ['false', 'throw', 'missing', 'bad-key']) {
    const failed = await attempt(mode, 'fixture-password');
    assert.equal(failed.prevented, true, `${mode}: submit must be blocked`);
    assert.deepEqual(failed.fields, [''], `${mode}: no plaintext or stale ciphertext may enter FormData`);
    assert.equal(failed.errorVisible, true, `${mode}: a visible error is required`);
    assert.ok(failed.errorText.length > 0);
    assert.equal(failed.invalid, 'true');
  }

  const afterBack = await page.evaluate(() => {
    document.querySelector('[data-auth-lockscreen-back]').click();
    const error = document.querySelector('#auth-encryption-error');
    return {
      hidden: error.hidden,
      message: error.textContent,
      invalid: document.querySelector('#password').getAttribute('aria-invalid'),
    };
  });
  assert.deepEqual(afterBack, { hidden: true, message: '', invalid: null }, 'returning to identity must clear encryption errors');

  const tooLong = await attempt('success', '密'.repeat(168));
  assert.equal(tooLong.prevented, true, 'UTF-8 byte length must be checked against RSA key capacity');
  assert.deepEqual(tooLong.fields, ['']);
  assert.equal(tooLong.errorVisible, true);

  await attempt('success', 'fixture-password');
  const afterEdit = await page.evaluate(() => {
    const input = document.querySelector('#password');
    input.value = 'changed-password';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return [...new FormData(document.querySelector('#login-form')).getAll('password')];
  });
  assert.deepEqual(afterEdit, [''], 'editing the password must clear earlier ciphertext');

  await attempt('success', 'fixture-password');
  const afterUsernameEdit = await page.evaluate(() => {
    const input = document.querySelector('#username');
    input.value = 'changed-user';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return [...new FormData(document.querySelector('#login-form')).getAll('password')];
  });
  assert.deepEqual(afterUsernameEdit, [''], 'editing the username must clear earlier ciphertext');

  await attempt('success', 'fixture-password');
  const cancelled = await page.evaluate(() => {
    const form = document.querySelector('#login-form');
    form.dataset.authLockscreenStep = 'identity';
    form.addEventListener('submit', (event) => event.preventDefault(), { capture: true, once: true });
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    delete form.dataset.authLockscreenStep;
    return [...new FormData(form).getAll('password')];
  });
  assert.deepEqual(cancelled, [''], 'a lockscreen identity-step cancellation must not leave ciphertext ready to submit');

  const captchaIntercept = await page.evaluate(() => {
    const form = document.querySelector('#login-form');
    const visible = document.querySelector('#password');
    form.dataset.authLockscreenStep = 'password';
    visible.value = 'fixture-password';
    visible.dispatchEvent(new Event('input', { bubbles: true }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, once: true });
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    delete form.dataset.authLockscreenStep;
    return [...new FormData(form).getAll('password')];
  });
  assert.deepEqual(captchaIntercept, ['Q0lQSEVS'], 'captcha interception must receive ciphertext before stopping the form event');
} finally {
  await browser.close();
}

console.log('verify-auth-password-contract passed (no real login requests)');
