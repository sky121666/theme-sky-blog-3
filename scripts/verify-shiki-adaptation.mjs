import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const fixturePath = '/__theme_shiki_1_4_1_fixture__';
const modulePath = '/plugins/shiki/assets/static/shiki-code.js?version=1.4.1';
const moduleUrl = new URL(modulePath, `${baseUrl}/`).toString();

const ordinaryCode = [
  'function greet(name) {',
  "  return `Hello, ${name}!`;",
  '}',
  '',
  "console.log(greet('Sky'));"
].join('\n');
const longLineSentinel = `SHIKI_LONG_LINE_${'0123456789'.repeat(72)}`;
const longLineCode = `const longLine = ${JSON.stringify(longLineSentinel)};`;
const foldTailSentinel = `SHIKI_FOLD_TAIL_${'abcdefghij'.repeat(64)}`;
const foldCode = [
  'function pairedFold() {',
  '  // [!code fold:start]',
  "  const hiddenOne = 'paired fold line one';",
  "  const hiddenTwo = 'paired fold line two';",
  '  // [!code fold:end]',
  '  return hiddenOne + hiddenTwo;',
  '}',
  '',
  'function tailFold() {',
  '  // [!code fold:start]',
  `  const foldTail = ${JSON.stringify(foldTailSentinel)};`,
  '  return foldTail;',
  '}'
].join('\n');

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function codeFixture(id, code) {
  return [
    `<section data-shiki-fixture="${id}">`,
    `  <h2>${id}</h2>`,
    `  <pre><code class="language-js">${escapeHtml(code)}</code></pre>`,
    '</section>'
  ].join('\n');
}

function fixtureDocument() {
  return `<!doctype html>
<html lang="zh-CN" class="light color-scheme-light" data-color-scheme="light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shiki 1.4.1 non-destructive fixture</title>
    <style>
      body { margin: 24px; font-family: system-ui, sans-serif; }
      main { width: 440px; }
      section { width: 440px; margin-block: 20px; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      shiki-code { width: 100%; max-width: 100%; }
    </style>
  </head>
  <body class="light color-scheme-light" data-color-scheme="light">
    <main id="shiki-fixtures">
      ${codeFixture('ordinary', ordinaryCode)}
      ${codeFixture('long-line', longLineCode)}
      ${codeFixture('fold', foldCode)}
    </main>
  </body>
</html>`;
}

async function setColorScheme(page, scheme) {
  await page.evaluate((nextScheme) => {
    const isDark = nextScheme === 'dark';
    for (const element of [document.documentElement, document.body]) {
      element.classList.remove(
        'dark',
        'light',
        'color-scheme-auto',
        'color-scheme-dark',
        'color-scheme-light'
      );
      element.classList.add(isDark ? 'dark' : 'light');
      element.classList.add(isDark ? 'color-scheme-dark' : 'color-scheme-light');
      element.setAttribute('data-color-scheme', nextScheme);
    }
    document.documentElement.style.colorScheme = nextScheme;
  }, scheme);

  await page.waitForFunction((expected) => {
    const hosts = Array.from(document.querySelectorAll('shiki-code'));
    if (hosts.length !== 3) return false;
    return hosts.every((host) => {
      const variant = host.shadowRoot?.querySelector(
        'shiki-code-simple-variant, shiki-code-mac-variant'
      );
      return host._colorScheme === expected
        && variant?.getAttribute('color-scheme') === expected
        && Boolean(variant.shadowRoot?.querySelector('.shiki'));
    });
  }, scheme, { timeout: 20_000 });
}

async function snapshot(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-shiki-fixture]'))
    .map((fixture) => {
      const host = fixture.querySelector('shiki-code');
      const variant = host?.shadowRoot?.querySelector(
        'shiki-code-simple-variant, shiki-code-mac-variant'
      );
      const variantRoot = variant?.shadowRoot;
      const shiki = variantRoot?.querySelector('.shiki');
      const foldStart = variantRoot?.querySelector('.fold-start');
      const foldTail = variantRoot?.querySelector('.fold-tail-control');
      const hiddenLines = Array.from(variantRoot?.querySelectorAll('.fold-hidden') || []);
      const shikiRect = shiki?.getBoundingClientRect();
      const tailRect = foldTail?.getBoundingClientRect();

      return {
        id: fixture.getAttribute('data-shiki-fixture'),
        tagName: host?.tagName || '',
        customElementRegistered: Boolean(customElements.get('shiki-code')),
        hasShadowRoot: Boolean(host?.shadowRoot),
        loading: Boolean(host?.loading),
        error: String(host?.error || ''),
        colorScheme: String(host?._colorScheme || ''),
        lightTheme: host?.getAttribute('light-theme') || '',
        darkTheme: host?.getAttribute('dark-theme') || '',
        code: String(host?.code || ''),
        html: String(host?.html || ''),
        variantTagName: variant?.tagName || '',
        variantColorScheme: variant?.getAttribute('color-scheme') || '',
        hasVariantShadowRoot: Boolean(variantRoot),
        renderedText: String(variantRoot?.textContent || ''),
        shiki: shiki ? {
          clientWidth: shiki.clientWidth,
          scrollWidth: shiki.scrollWidth,
          overflowX: getComputedStyle(shiki).overflowX,
          color: getComputedStyle(shiki).color,
          backgroundColor: getComputedStyle(shiki).backgroundColor,
          classes: Array.from(shiki.classList)
        } : null,
        fold: {
          startCount: variantRoot?.querySelectorAll('.fold-start').length || 0,
          hiddenCount: hiddenLines.length,
          tailCount: variantRoot?.querySelectorAll('.fold-tail-control').length || 0,
          startExpanded: foldStart?.getAttribute('aria-expanded') || '',
          hiddenStates: hiddenLines.map((line) => line.getAttribute('aria-hidden') || ''),
          tailExpanded: foldTail?.getAttribute('aria-expanded') || '',
          tailPosition: foldTail ? getComputedStyle(foldTail).position : '',
          tailLeftDelta: shikiRect && tailRect ? tailRect.left - shikiRect.left : null,
          tailWidth: tailRect?.width || 0
        }
      };
    }));
}

function fixtureById(results, id) {
  const result = results.find((entry) => entry.id === id);
  assert.ok(result, `missing ${id} fixture result`);
  return result;
}

function assertSharedRendering(results, expectedScheme) {
  assert.equal(results.length, 3, 'renderCodeBlock should wrap exactly three fixtures');
  for (const result of results) {
    assert.equal(result.tagName, 'SHIKI-CODE', `${result.id}: missing shiki-code host`);
    assert.equal(result.customElementRegistered, true, `${result.id}: custom element is not registered`);
    assert.equal(result.hasShadowRoot, true, `${result.id}: missing host shadow root`);
    assert.equal(result.loading, false, `${result.id}: rendering did not finish`);
    assert.equal(result.error, '', `${result.id}: ${result.error}`);
    assert.equal(result.lightTheme, 'github-light', `${result.id}: light theme mismatch`);
    assert.equal(result.darkTheme, 'github-dark', `${result.id}: dark theme mismatch`);
    assert.equal(result.colorScheme, expectedScheme, `${result.id}: host theme did not update`);
    assert.equal(
      result.variantTagName,
      'SHIKI-CODE-SIMPLE-VARIANT',
      `${result.id}: simple variant was not rendered`
    );
    assert.equal(result.hasVariantShadowRoot, true, `${result.id}: missing variant shadow root`);
    assert.equal(
      result.variantColorScheme,
      expectedScheme,
      `${result.id}: variant theme did not update`
    );
    assert.ok(result.shiki, `${result.id}: missing highlighted .shiki element`);
  }
}

async function assertFoldInteraction(page) {
  const before = await page.evaluate(() => {
    const host = document.querySelector('[data-shiki-fixture="fold"] shiki-code');
    const variant = host?.shadowRoot?.querySelector('shiki-code-simple-variant');
    const root = variant?.shadowRoot;
    const control = root?.querySelector('.fold-start');
    const hidden = root?.querySelector(`.fold-hidden[data-fold-id="${control?.dataset.foldId || ''}"]`);
    return {
      control: Boolean(control),
      controlExpanded: control?.getAttribute('aria-expanded') || '',
      hiddenState: hidden?.getAttribute('aria-hidden') || ''
    };
  });
  assert.deepEqual(before, {
    control: true,
    controlExpanded: 'false',
    hiddenState: 'true'
  }, 'paired fold should start collapsed');

  await page.evaluate(() => {
    const host = document.querySelector('[data-shiki-fixture="fold"] shiki-code');
    const variant = host?.shadowRoot?.querySelector('shiki-code-simple-variant');
    variant?.shadowRoot?.querySelector('.fold-start')?.click();
  });

  await page.waitForFunction(() => {
    const host = document.querySelector('[data-shiki-fixture="fold"] shiki-code');
    const variant = host?.shadowRoot?.querySelector('shiki-code-simple-variant');
    const root = variant?.shadowRoot;
    const control = root?.querySelector('.fold-start');
    if (control?.getAttribute('aria-expanded') !== 'true') return false;
    const hidden = root?.querySelector(`.fold-hidden[data-fold-id="${control.dataset.foldId}"]`);
    return hidden?.getAttribute('aria-hidden') === 'false';
  }, null, { timeout: 5_000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
const failedPluginRequests = [];
const pluginResponses = [];

page.on('pageerror', (error) => {
  pageErrors.push(error?.message || String(error));
});
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('requestfailed', (request) => {
  if (request.url().includes('/plugins/shiki/assets/static/')) {
    failedPluginRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || 'request failed'
    });
  }
});
page.on('response', (response) => {
  if (response.url().includes('/plugins/shiki/assets/static/')) {
    pluginResponses.push({ url: response.url(), status: response.status() });
  }
});

await page.route(absoluteUrl(fixturePath), async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: fixtureDocument()
  });
});

try {
  const response = await page.goto(absoluteUrl(fixturePath), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(response?.status(), 200, 'synthetic Shiki fixture should return 200');

  const importResult = await page.evaluate(async ({ sourceUrl, config }) => {
    const module = await import(sourceUrl);
    if (typeof module.renderCodeBlock !== 'function') {
      throw new TypeError('plugin-shiki module does not export renderCodeBlock');
    }
    module.renderCodeBlock(config);
    return {
      exportType: typeof module.renderCodeBlock,
      hosts: document.querySelectorAll('shiki-code').length,
      remainingRawBlocks: document.querySelectorAll('#shiki-fixtures > section > pre > code').length
    };
  }, {
    sourceUrl: moduleUrl,
    config: {
      lightTheme: 'github-light',
      darkTheme: 'github-dark',
      variant: 'simple',
      fontSize: '0.875em',
      excludedLanguages: []
    }
  });

  assert.deepEqual(importResult, {
    exportType: 'function',
    hosts: 3,
    remainingRawBlocks: 0
  }, 'renderCodeBlock should convert all synthetic code blocks');

  await setColorScheme(page, 'light');
  const lightResults = await snapshot(page);
  assertSharedRendering(lightResults, 'light');

  const ordinary = fixtureById(lightResults, 'ordinary');
  assert.ok(ordinary.code.includes('function greet'), 'ordinary code source was not preserved');
  assert.ok(ordinary.renderedText.includes('Hello'), 'ordinary code did not render in shadow DOM');

  const longLine = fixtureById(lightResults, 'long-line');
  assert.ok(longLine.code.includes(longLineSentinel), 'long-line source was not preserved');
  assert.ok(longLine.renderedText.includes(longLineSentinel), 'long line did not render in shadow DOM');
  assert.equal(longLine.shiki.overflowX, 'auto', 'long-line code block should allow horizontal scrolling');
  assert.ok(
    longLine.shiki.scrollWidth > longLine.shiki.clientWidth,
    `long line should overflow horizontally (${longLine.shiki.scrollWidth} <= ${longLine.shiki.clientWidth})`
  );

  const fold = fixtureById(lightResults, 'fold');
  assert.ok(fold.code.includes('[!code fold:start]'), 'fold source marker was not preserved on the host');
  assert.equal(fold.html.includes('[!code fold:start]'), false, 'fold start marker leaked into rendered HTML');
  assert.equal(fold.html.includes('[!code fold:end]'), false, 'fold end marker leaked into rendered HTML');
  assert.ok(fold.shiki.classes.includes('has-fold'), 'fold notation did not create has-fold markup');
  assert.ok(fold.shiki.classes.includes('has-fold-tail'), 'open tail fold did not create has-fold-tail markup');
  assert.ok(fold.fold.startCount >= 1, 'expected a paired fold start control');
  assert.ok(fold.fold.hiddenCount >= 4, 'expected hidden lines for paired and tail folds');
  assert.equal(fold.fold.tailCount, 1, 'expected one tail fold control');
  assert.equal(fold.fold.tailPosition, 'sticky', 'tail fold control should stay aligned on long lines');
  assert.ok(Math.abs(fold.fold.tailLeftDelta) <= 24, 'tail fold control is not aligned to the code viewport');
  assert.ok(fold.fold.tailWidth > 400, 'tail fold control should span the visible fixture width');

  await assertFoldInteraction(page);

  await setColorScheme(page, 'dark');
  const darkResults = await snapshot(page);
  assertSharedRendering(darkResults, 'dark');
  for (const light of lightResults) {
    const dark = fixtureById(darkResults, light.id);
    assert.notEqual(
      dark.shiki.backgroundColor,
      light.shiki.backgroundColor,
      `${light.id}: dark theme background did not change`
    );
    assert.notEqual(
      dark.shiki.color,
      light.shiki.color,
      `${light.id}: dark theme foreground did not change`
    );
  }

  await setColorScheme(page, 'light');
  const restoredResults = await snapshot(page);
  assertSharedRendering(restoredResults, 'light');
  for (const initial of lightResults) {
    const restored = fixtureById(restoredResults, initial.id);
    assert.equal(
      restored.shiki.backgroundColor,
      initial.shiki.backgroundColor,
      `${initial.id}: light theme background was not restored`
    );
    assert.equal(
      restored.shiki.color,
      initial.shiki.color,
      `${initial.id}: light theme foreground was not restored`
    );
  }

  const mainModuleResponse = pluginResponses.find((entry) => entry.url === moduleUrl);
  assert.ok(mainModuleResponse, `Shiki module was not requested: ${moduleUrl}`);
  assert.equal(mainModuleResponse.status, 200, 'Shiki 1.4.1 module should return 200');
  assert.deepEqual(failedPluginRequests, [], 'Shiki module/chunk requests should not fail');
  assert.equal(
    pluginResponses.some((entry) => entry.status >= 400),
    false,
    `Shiki resource returned an error: ${JSON.stringify(pluginResponses)}`
  );
  assert.deepEqual(pageErrors, [], 'Shiki fixture should not raise page errors');
  assert.deepEqual(consoleErrors, [], 'Shiki fixture should not log console errors');

  console.log(JSON.stringify({
    status: 'passed',
    pluginVersion: '1.4.1',
    moduleUrl,
    fixtures: lightResults.map((result) => ({
      id: result.id,
      rendered: Boolean(result.shiki),
      scrollWidth: result.shiki?.scrollWidth || 0,
      clientWidth: result.shiki?.clientWidth || 0,
      fold: result.fold
    })),
    themeSwitch: {
      light: lightResults.map((result) => result.shiki?.backgroundColor || ''),
      dark: darkResults.map((result) => result.shiki?.backgroundColor || ''),
      restored: restoredResults.map((result) => result.shiki?.backgroundColor || '')
    },
    resources: pluginResponses.length,
    errors: {
      page: pageErrors,
      console: consoleErrors,
      requests: failedPluginRequests
    }
  }, null, 2));
} finally {
  await browser.close();
}
