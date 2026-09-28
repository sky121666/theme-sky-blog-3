import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { collectBrowserRuntimeErrors, runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/+$/, '');
const output = path.resolve(process.env.AUTH_AUDIT_OUTPUT || 'output/auth-audit');
const reportPath = path.join(output, process.env.AUTH_AUDIT_REPORT || 'anonymous-auth-results.json');
const onlyRoutes = new Set(String(process.env.AUTH_AUDIT_ROUTES || '').split(',').filter(Boolean));
await fs.mkdir(output, { recursive: true });
const report = {
  startedAt: new Date().toISOString(), baseUrl,
  scope: 'Anonymous rendering and client-only controls. No form submissions, email sending, credential requests, logout or authenticated user state.',
  buildContext: await readLiveBuildContext(baseUrl),
  pages: [], staticOnly: []
};
const browser = await chromium.launch({ headless: true });

async function pageState(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return {
      title: document.title, url: location.href,
      pageMode: document.body.dataset.pageMode, appId: document.body.dataset.appId,
      theme: document.documentElement.dataset.theme,
      colorScheme: document.documentElement.dataset.colorScheme,
      rootClass: document.documentElement.className,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: { width: innerWidth, height: innerHeight },
      headings: [...document.querySelectorAll('h1,h2')].filter(visible).map((node) => node.textContent.trim()),
      forms: [...document.forms].map((form) => ({
        id: form.id, className: form.className, method: form.method,
        action: form.action,
        fields: [...form.elements].filter((el) => el.type !== 'hidden').map((el) => ({ name: el.name, type: el.type, required: el.required, visible: visible(el) }))
      })),
      providers: [...document.querySelectorAll('a.auth-provider-btn')].map((node) => ({ text: node.textContent.trim(), href: node.href, ariaLabel: node.getAttribute('aria-label') })),
      links: [...document.querySelectorAll('.auth-footer-link a, .auth-action-meta a, .error-modal-actions a')].map((node) => ({ text: node.textContent.trim(), href: node.href })),
      scrollContainers: [...document.querySelectorAll('.auth-card,.auth-stage,.auth-main,.auth-shell')].map((node) => ({ className: node.className, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY })),
      submitAttempts: window.__readonlyAuthAudit?.submits || [],
      credentialAttempts: window.__readonlyAuthAudit?.credentials || []
    };
  });
}

async function screenshot(page, name, width) {
  const file = path.join(output, `${name}-${width}.png`);
  // Theme attributes change before the browser has painted all inherited colors.
  await page.waitForTimeout(700);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const blockedWrites = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        blockedWrites.push({ method: request.method(), url: request.url() });
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await context.addInitScript(() => {
      window.__readonlyAuthAudit = { submits: [], credentials: [] };
      document.addEventListener('submit', (event) => {
        window.__readonlyAuthAudit.submits.push({ action: event.target.action, method: event.target.method });
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      for (const name of ['submit', 'requestSubmit']) {
        Object.defineProperty(HTMLFormElement.prototype, name, { configurable: true, value() {
          window.__readonlyAuthAudit.submits.push({ action: this.action, method: this.method, direct: name });
          throw new Error('Read-only audit blocked a form submission');
        } });
      }
      if (navigator.credentials) {
        for (const method of ['get', 'create']) {
          Object.defineProperty(navigator.credentials, method, { configurable: true, value: async () => {
            window.__readonlyAuthAudit.credentials.push(method);
            throw new DOMException('Read-only audit does not invoke WebAuthn', 'AbortError');
          } });
        }
      }
    });
    const page = await context.newPage();
    let passkeyPath = '';
    const routes = [
      { name: 'login', target: '/login', kind: 'auth', form: 'form.halo-form', expectedStatus: 200 },
      { name: 'passkey', target: null, kind: 'auth', form: 'form.halo-form', expectedStatus: 200 },
      { name: 'signup', target: '/signup', kind: 'auth', form: '#signup-form', expectedStatus: 200 },
      { name: 'reset-email', target: '/password-reset/email', kind: 'auth', form: 'form.auth-form-stack', expectedStatus: 200 },
      { name: '404', target: '/__theme3_readonly_missing_20260926__', kind: 'error', expectedStatus: 404 }
    ].filter(route => onlyRoutes.size === 0 || onlyRoutes.has(route.name)
      || (route.name === 'login' && onlyRoutes.has('passkey')));
    for (const route of routes) {
      if (route.name === 'passkey' && !passkeyPath) {
        report.pages.push({ name: route.name, viewport: viewport.name, status: 'skipped-provider-unavailable', reason: 'Anonymous login did not expose a Passkey provider link.' });
        continue;
      }
      const item = { name: route.name, viewport: viewport.name, startedAt: new Date().toISOString(), target: route.target || passkeyPath, errors: [], consoleErrors: [], requestFailures: [], screenshots: [], actions: [] };
      const writeStart = blockedWrites.length;
      const expectedUrl = new URL(item.target, baseUrl).href;
      const runtime = collectBrowserRuntimeErrors(page, { expected: (kind, value) =>
        route.expectedStatus === 404 && value.url === expectedUrl
        && ((kind === 'responseErrors' && value.status === 404 && value.resourceType === 'document')
          || (kind === 'consoleErrors' && /^Failed to load resource:.*\b404\b/.test(value.text)))
      });
      try {
        const response = await page.goto(new URL(item.target, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 25000 });
        item.httpStatus = response?.status();
        item.finalUrl = page.url();
        assert.equal(item.httpStatus, route.expectedStatus, `${route.name}: unexpected HTTP status`);
        const html = (await response.text()).replaceAll('\\/', '/');
        item.theme3Identity = html.includes('/themes/theme-sky-blog-3/assets/');
        assert.equal(item.theme3Identity, true, `${route.name}: target theme identity missing`);
        if (route.kind === 'auth') {
          await page.waitForFunction(() => window.__THEME_APP_AUTH_LOADED__ && document.body.dataset.appId === 'auth', null, { timeout: 15000 });
          await page.waitForSelector(route.form, { state: 'visible', timeout: 15000 });
          const form = await page.locator(route.form).first().evaluate((node) => ({ action: node.action, method: node.method, className: node.className }));
          assert.equal(form.method.toLowerCase(), 'post', `${route.name}: native method preserved`);
          assert.equal(new URL(form.action).origin, new URL(baseUrl).origin, `${route.name}: same-origin native action`);
          if (route.name === 'signup') assert.equal(new URL(form.action).pathname, '/signup');
          if (route.name === 'reset-email') assert.equal(new URL(form.action).pathname, '/password-reset/email');
          item.formContract = form;
          if (route.name === 'passkey') {
            const local = page.locator('a[href*="method=local"]');
            item.localProvider = await local.evaluate((node) => {
              const rendered = (child) => {
                if (!child) return false;
                const rect = child.getBoundingClientRect();
                const style = getComputedStyle(child);
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
              };
              return {
                href: node.href,
                accessibleName: node.getAttribute('aria-label'),
                iconVisible: rendered(node.querySelector('.auth-provider-icon-shell')),
                labelVisible: rendered(node.querySelector('.auth-provider-name')),
              };
            });
            assert.ok(item.localProvider.iconVisible || item.localProvider.labelVisible, 'Passkey must expose a visible password login provider');
          }
          const themeToggle = page.locator('[data-auth-theme-toggle]');
          const beforeTheme = await page.evaluate(() => document.documentElement.dataset.theme);
          await themeToggle.click();
          await page.waitForFunction((before) => document.documentElement.dataset.theme !== before, beforeTheme);
          const afterTheme = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, colorScheme: document.documentElement.dataset.colorScheme, className: document.documentElement.className }));
          item.actions.push({ action: 'theme-toggle', before: beforeTheme, after: afterTheme });
          if (route.name === 'login') item.screenshots.push(await screenshot(page, 'login-alternate-theme', viewport.name));
          await themeToggle.click();
          await page.waitForFunction((before) => document.documentElement.dataset.theme === before, beforeTheme);

          if (route.name === 'login') {
            passkeyPath = await page.locator('a[href*="method=passkey"]').first().getAttribute('href').catch(() => '');
          }
          const hasLockscreen = route.name === 'login' && await page.locator('[data-auth-lockscreen-advance]').count() > 0;
          if (hasLockscreen) {
            await page.locator('#username').fill('theme3-readonly-audit');
            await page.locator('[data-auth-lockscreen-advance]').click();
            await page.locator('#password').waitFor({ state: 'visible' });
          }

          const passwordToggles = page.locator('button.auth-toggle-password');
          for (let index = 0; index < await passwordToggles.count(); index += 1) {
            const button = passwordToggles.nth(index);
            const target = await button.getAttribute('aria-controls');
            assert.ok(target, 'Password toggle needs an explicit target');
            const accessibleName = await button.getAttribute('aria-label');
            assert.ok(accessibleName?.trim(), 'Password toggle needs an accessible name');
            const input = page.locator(`[id="${target}"]`);
            assert.equal(await input.getAttribute('type'), 'password');
            const isLocalPassword = route.name === 'login' && target === 'password';
            if (isLocalPassword) await input.fill('theme3-readonly-fixture');
            const originalValue = await input.inputValue();
            const originalName = await input.getAttribute('name');
            await button.focus();
            await button.press('Enter');
            assert.equal(await input.getAttribute('type'), 'text');
            assert.equal(await button.getAttribute('aria-pressed'), 'true');
            assert.equal(await input.inputValue(), originalValue, 'revealing must preserve the typed password');
            // WAI APG toggle buttons retain their label while aria-pressed changes.
            assert.equal(await button.getAttribute('aria-label'), accessibleName);
            await button.press('Space');
            assert.equal(await input.getAttribute('type'), 'password');
            assert.equal(await button.getAttribute('aria-pressed'), 'false');
            assert.equal(await button.getAttribute('aria-label'), accessibleName);
            assert.equal(await input.inputValue(), originalValue, 'hiding must preserve the typed password');
            assert.equal(await input.getAttribute('name'), originalName, 'visibility must not change the submitted field');
            if (isLocalPassword) await input.fill('');
            item.actions.push({ action: 'password-toggle-keyboard', target, accessibleName, status: 'passed' });
          }

          if (hasLockscreen) {
            item.screenshots.push(await screenshot(page, 'login-password-step', viewport.name));
            await page.locator('[data-auth-lockscreen-back]').click();
            await page.locator('#username').waitFor({ state: 'visible' });
            await page.locator('#username').fill('');
            item.actions.push({ action: 'local-login-client-step-and-back', status: 'passed' });
          }
        } else {
          await page.waitForSelector('.error-modal-surface', { state: 'visible', timeout: 15000 });
          assert.equal(await page.locator('.error-modal-code').innerText(), '代码 404');
        }
        item.state = await pageState(page);
        assert.equal(item.state.overflowX, false, `${route.name}/${viewport.name}: horizontal document overflow`);
        assert.deepEqual(item.state.submitAttempts, [], 'No form submission may be attempted');
        assert.deepEqual(item.state.credentialAttempts, [], 'No WebAuthn credential request may be attempted');
        item.screenshots.push(await screenshot(page, route.name, viewport.name));
        item.status = 'passed';
      } catch (error) {
        item.status = 'failed';
        item.failure = error.stack || String(error);
        item.state = await pageState(page).catch(() => null);
        item.screenshots.push(await screenshot(page, `${route.name}-failure`, viewport.name).catch(() => ''));
      } finally {
        item.blockedWrites = blockedWrites.slice(writeStart);
        item.finishedAt = new Date().toISOString();
        Object.assign(item, runtime.snapshot());
        runtime.stop();
        item.errors = item.pageErrors;
        item.runtimeFailures = runtimeErrorMessages(item);
        if (item.runtimeFailures.length) {
          item.status = 'failed';
          item.failure = [item.failure, ...item.runtimeFailures].filter(Boolean).join(' | ');
        }
        report.pages.push(item);
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ name: item.name, viewport: item.viewport, status: item.status, httpStatus: item.httpStatus, errors: item.errors.length, consoleErrors: item.consoleErrors.length, blockedWrites: item.blockedWrites.length, failure: item.failure }));
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const serverError = await fs.readFile('templates/error/5xx.html', 'utf8');
const reset = await fs.readFile('templates/gateway_fragments/password_reset_email_reset.html', 'utf8');
report.staticOnly.push({ name: '5xx', file: 'templates/error/5xx.html', serverVariant: serverError.includes("variant='server'"), themeShell: serverError.includes('modules/shell/layout'), status: 'source-reviewed-not-runtime-tested' });
report.staticOnly.push({ name: 'reset-token', file: 'templates/gateway_fragments/password_reset_email_reset.html', tokenAction: reset.includes('@{/password-reset/email/{resetToken}(resetToken=${resetToken})}'), postMethod: reset.includes('method="post"'), passwordToggleButtons: (reset.match(/class="auth-toggle-password"/g) || []).length, status: 'source-reviewed-no-token-or-submit-used' });
report.finalBuildContext = await readLiveBuildContext(baseUrl);
assert.deepEqual(report.finalBuildContext.build, report.buildContext.build, 'build changed during auth validation');
assert.equal(report.finalBuildContext.sourceFingerprint, report.buildContext.sourceFingerprint, 'source changed during auth validation');
report.finishedAt = new Date().toISOString();
report.status = report.pages.some((page) => page.status === 'failed' || runtimeErrorMessages(page).length) ? 'failed' : 'completed-with-evidence-boundaries';
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, output, pages: report.pages.length }));
process.exitCode = report.status === 'failed' ? 1 : 0;
