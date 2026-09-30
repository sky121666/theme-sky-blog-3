import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// This is an isolated browser fixture. All https://theme.test responses come
// from memory or local source files; no Halo instance or site data is touched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pjaxEntry = require.resolve('pjax');
const pjaxBundle = path.join(path.dirname(pjaxEntry), 'pjax.js');
const alpineBundle = path.join(root, 'node_modules/alpinejs/dist/cdn.min.js');
const origin = 'https://theme.test';

assert.equal(path.basename(pjaxEntry), 'index.js', 'Vite must resolve the Pjax CommonJS package entry');

const [entrySource, browserPjaxSource, alpineSource] = await Promise.all([
  readFile(pjaxEntry, 'utf8'),
  readFile(pjaxBundle, 'utf8'),
  readFile(alpineBundle, 'utf8')
]);
assert.ok(browserPjaxSource.includes(entrySource.slice(0, 120)), 'browser Pjax bundle must contain the package CommonJS entry');

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== origin) return route.abort();
    if (requestUrl.pathname === '/base') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>Navigation click fixture</title>
          <base href="${origin}/base"></head><body>
          <main id="fixture"><a id="plain" class="pjax-link" href="/links?view=friends">plain</a></main>
          </body></html>`
      });
    }
    if (requestUrl.pathname.startsWith('/src/') && requestUrl.pathname.endsWith('.js')) {
      const sourcePath = path.resolve(root, `.${requestUrl.pathname}`);
      if (!sourcePath.startsWith(path.join(root, 'src') + path.sep)) return route.abort();
      try {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(sourcePath, 'utf8') });
      } catch (error) {
        if (error.code === 'ENOENT') return route.fulfill({ status: 404, contentType: 'text/plain', body: `Missing source module: ${requestUrl.pathname}` });
        throw error;
      }
    }
    return route.abort();
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/base`);
  await page.addScriptTag({ content: browserPjaxSource });

  const baseline = await page.evaluate(() => {
    const attached = [];
    const originalAttach = window.Pjax.prototype.attachLink;
    window.Pjax.prototype.attachLink = function (link) {
      attached.push(link.id);
      return originalAttach.call(this, link);
    };
    const library = new window.Pjax({ elements: 'a:not(*)', selectors: ['title', '#fixture'], cacheBust: false });
    library.refresh(document);
    const disabledAttachCount = attached.length;
    const negative = new window.Pjax({ elements: '', selectors: ['title'], cacheBust: false });
    const emptySelector = negative.options.elements;
    const oldAttachedIds = [...attached];
    document.getElementById('plain').outerHTML = '<a id="plain" class="pjax-link" href="/links?view=friends">plain</a>';
    window.Pjax.prototype.attachLink = originalAttach;
    window.__clickFixtureLibrary = library;
    return { disabledAttachCount, emptySelector, oldAttachedIds };
  });
  assert.equal(baseline.disabledAttachCount, 0, 'the real Pjax constructor and refresh must attach zero links with a nonmatching selector');
  assert.equal(baseline.emptySelector, 'a[href], form[action]', 'empty elements selector is an unsafe Pjax default');
  assert.ok(baseline.oldAttachedIds.includes('plain'), 'old automatic binding must be visible as a negative control');
  console.log(`Pjax CJS baseline: disabled selector attached ${baseline.disabledAttachCount}; empty selector attached ${baseline.oldAttachedIds.join(', ')}`);

  await page.evaluate(() => {
    const host = document.getElementById('fixture');
    const menu = document.createElement('section');
    menu.id = 'menu';
    menu.setAttribute('x-data', '{ open: true }');
    menu.innerHTML = `
      <a id="alpine-close" class="pjax-link" href="/links" @click="open=false; window.__clickFixture.trace.push('alpine-close')">close</a>
      <a id="alpine-cancel" class="pjax-link" href="/links" @click.prevent="window.__clickFixture.trace.push('alpine-cancel')">cancel</a>`;
    host.append(menu);
  });
  await page.addScriptTag({ content: alpineSource });
  await page.waitForFunction(() => Boolean(window.Alpine && document.getElementById('menu')._x_dataStack));

  // Import the actual source ESM through an in-memory origin. A missing A1/A2
  // implementation makes this fixture RED instead of silently testing a model.
  await page.evaluate(async () => {
    const policy = await import('/src/shared/navigation-link-policy.js');
    const controller = await import('/src/shell/desktop-shell/runtime/desktop/pjax/click-controller.js');
    if (typeof policy.classifyLinkClick !== 'function') throw new Error('classifyLinkClick export is missing');
    if (typeof controller.installClickController !== 'function') throw new Error('installClickController export is missing');
    window.__navigationClickModules = { policy, controller };
  });

  const results = await page.evaluate(() => {
    const { installClickController } = window.__navigationClickModules.controller;
    const f = window.__clickFixture = {
      ready: true,
      cancelNext: false,
      calls: [],
      requests: [],
      native: [],
      restores: 0,
      minimized: false,
      trace: [],
      results: []
    };
    const library = window.__clickFixtureLibrary;
    library.loadUrl = (href) => { f.requests.push(href); };
    const readContext = () => ({
      currentUrl: window.location.href,
      baseTarget: document.querySelector('base[target]')?.getAttribute('target') ?? '',
      runtimeReady: f.ready
    });
    const requestNavigation = ({ href, source, triggerElement, options }) => {
      f.trace.push('controller');
      f.calls.push({ href, source, triggerId: triggerElement?.id ?? null, options });
      if (f.cancelNext) {
        f.cancelNext = false;
        return { kind: 'cancelled', reason: 'fixture veto' };
      }
      library.loadUrl(href, options);
      return { kind: 'started', intentId: f.calls.length };
    };
    const restoreCurrentDockWindow = () => {
      if (!f.minimized) return false;
      f.restores++;
      f.minimized = false;
      return true;
    };
    const install = () => installClickController({ document, readContext, requestNavigation, restoreCurrentDockWindow });
    let dispose = install();
    const test = (name, pass, detail = null) => f.results.push({ name, pass: Boolean(pass), detail });
    test('controller returns a disposer', typeof dispose === 'function');

    // Window observes the event after document bubbling, then prevents the
    // fixture browser from following native links or opening downloads.
    window.addEventListener('click', (event) => {
      f.native.push({ preventedBeforeSink: event.defaultPrevented, trusted: event.isTrusted });
      event.preventDefault();
    });
    const click = (id, options = {}) => {
      const callsBefore = f.calls.length;
      const requestsBefore = f.requests.length;
      const nativeBefore = f.native.length;
      f.trace = [];
      const target = document.getElementById(id);
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, ...options }));
      return {
        calls: f.calls.length - callsBefore,
        requests: f.requests.length - requestsBefore,
        sink: f.native.length > nativeBefore ? f.native.at(-1) : null,
        trace: [...f.trace]
      };
    };
    const managed = (name, id = 'plain', options) => {
      const value = click(id, options);
      test(name, value.calls === 1 && value.requests === 1 && value.sink?.preventedBeforeSink === true, value);
      return value;
    };
    const native = (name, id = 'plain', options) => {
      const value = click(id, options);
      test(name, value.calls === 0 && value.requests === 0 && value.sink?.preventedBeforeSink === false, value);
      return value;
    };
    const plain = document.getElementById('plain');
    managed('ordinary opted-in anchor starts one request');
    for (const [name, options] of Object.entries({
      meta: { metaKey: true }, ctrl: { ctrlKey: true }, shift: { shiftKey: true },
      alt: { altKey: true }, middle: { button: 1 }, right: { button: 2 }
    })) native(`native ${name} click`, 'plain', options);

    for (const target of ['_blank', '_top', '_parent', 'named-frame']) {
      plain.setAttribute('target', target);
      native(`native explicit target ${target}`);
    }
    plain.setAttribute('target', '_self');
    managed('explicit _self target');
    plain.removeAttribute('target');
    const base = document.querySelector('base');
    base.setAttribute('target', '_blank');
    native('inherited base target');
    plain.setAttribute('target', '');
    managed('explicit empty target overrides base target');
    plain.removeAttribute('target');
    base.removeAttribute('target');

    plain.setAttribute('download', '');
    native('download added after install');
    plain.removeAttribute('download');
    managed('download removed after install');
    for (const href of [
      'https://outside.test/next', 'mailto:demo@example.invalid', 'javascript:void(0)',
      '#heading', 'https://theme.test/base#', 'http://['
    ]) {
      plain.setAttribute('href', href);
      native(`native href ${href}`);
    }
    plain.setAttribute('href', '');
    native('empty href');
    plain.removeAttribute('href');
    native('missing href');
    plain.setAttribute('href', '/base');
    managed('current URL without hash retains full navigation');
    plain.setAttribute('href', '/links');
    plain.classList.remove('pjax-link');
    native('link without opt-in class');
    plain.classList.add('pjax-link');
    f.ready = false;
    native('runtime unavailable');
    f.ready = true;
    managed('dynamic href becomes eligible without refresh');
    test('dynamic href is resolved from the current DOM', f.calls.at(-1)?.href === 'https://theme.test/links', f.calls.at(-1));

    const cached = document.createElement('a');
    cached.id = 'cached';
    cached.className = 'pjax-link';
    cached.href = '/links';
    for (const marker of ['data-pjax-state', 'data-pjax-attached', 'data-pjax-managed']) cached.setAttribute(marker, 'true');
    document.getElementById('fixture').insertAdjacentHTML('beforeend', cached.outerHTML);
    managed('serialized cache markers do not suppress a fresh link', 'cached');
    const dynamic = document.createElement('a');
    dynamic.id = 'dynamic';
    dynamic.className = 'pjax-link';
    dynamic.href = '/links';
    dynamic.textContent = 'dynamic';
    document.getElementById('fixture').append(dynamic);
    managed('newly inserted link needs no attach scan', 'dynamic');
    const inner = document.createElement('span');
    inner.id = 'inner';
    inner.textContent = 'inner';
    dynamic.append(inner);
    const nested = click('inner');
    test('composed path finds the containing anchor once', nested.calls === 1 && nested.requests === 1 && nested.sink?.preventedBeforeSink === true, nested);
    const shadowHost = document.createElement('div');
    document.getElementById('fixture').append(shadowHost);
    const shadowLink = document.createElement('a');
    shadowLink.className = 'pjax-link';
    shadowLink.href = '/links';
    shadowHost.attachShadow({ mode: 'open' }).append(shadowLink);
    const shadowBefore = { calls: f.calls.length, requests: f.requests.length };
    shadowLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
    const shadowResult = { calls: f.calls.length - shadowBefore.calls, requests: f.requests.length - shadowBefore.requests, sink: f.native.at(-1) };
    test('composed path handles an anchor inside open shadow DOM', shadowResult.calls === 1 && shadowResult.requests === 1 && shadowResult.sink?.preventedBeforeSink === true, shadowResult);

    const inline = document.createElement('a');
    inline.id = 'inline-cancel';
    inline.className = 'pjax-link';
    inline.href = '/links';
    inline.onclick = (event) => { f.trace.push('inline'); event.preventDefault(); };
    document.getElementById('fixture').append(inline);
    const cancelled = click('inline-cancel');
    test('local preventDefault wins before document owner', cancelled.calls === 0 && cancelled.requests === 0 && cancelled.trace.join(',') === 'inline', cancelled);
    const grid = document.createElement('section');
    document.getElementById('fixture').append(grid);
    grid.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); }, true);
    const editing = document.createElement('a');
    editing.id = 'editing';
    editing.className = 'pjax-link';
    editing.href = '/links';
    grid.append(editing);
    const editedClick = click('editing');
    test('grid edit capture owns the click', editedClick.calls === 0 && editedClick.requests === 0, editedClick);
    const stopped = document.createElement('a');
    stopped.id = 'stopped';
    stopped.className = 'pjax-link';
    stopped.href = '/links';
    // A component that owns a link must also cancel its native activation;
    // the window fixture sink cannot see a stopped event.
    stopped.onclick = (event) => { event.stopPropagation(); event.preventDefault(); };
    document.getElementById('fixture').append(stopped);
    let stoppedReachedDocument = 0;
    const observeStopped = (event) => { if (event.target === stopped) stoppedReachedDocument++; };
    document.addEventListener('click', observeStopped);
    const stoppedClick = click('stopped');
    document.removeEventListener('click', observeStopped);
    test('component stopPropagation owns the click', stoppedClick.calls === 0 && stoppedClick.requests === 0 && stoppedReachedDocument === 0, { ...stoppedClick, stoppedReachedDocument });
    const alpineClose = click('alpine-close');
    test('Alpine local click runs before navigation', alpineClose.calls === 1 && alpineClose.requests === 1 && alpineClose.trace.join(',') === 'alpine-close,controller', alpineClose);
    const alpineCancel = click('alpine-cancel');
    test('Alpine prevent modifier cancels navigation', alpineCancel.calls === 0 && alpineCancel.requests === 0 && alpineCancel.trace.join(',') === 'alpine-cancel', alpineCancel);

    f.cancelNext = true;
    const veto = click('plain');
    test('cancelled admission stays on page without a native fallback', veto.calls === 1 && veto.requests === 0 && veto.sink?.preventedBeforeSink === true, veto);
    const secondDispose = install();
    test('repeated install returns the same disposer', secondDispose === dispose);
    managed('repeated install still owns only one request');
    dispose();
    native('dispose restores native behavior');
    dispose = install();
    managed('reinstall after dispose owns one request');
    f.dispose = dispose;
    return f.results;
  });

  const trusted = [];
  for (const [name, action] of [
    ['trusted mouse click', () => page.click('#plain')],
    ['trusted Enter activation', () => page.press('#plain', 'Enter')]
  ]) {
    const before = await page.evaluate(() => ({ calls: window.__clickFixture.calls.length, requests: window.__clickFixture.requests.length, native: window.__clickFixture.native.length }));
    await action();
    const after = await page.evaluate(() => {
      const f = window.__clickFixture;
      return { calls: f.calls.length, requests: f.requests.length, native: f.native.length, sink: f.native.at(-1) };
    });
    trusted.push({ name, pass: after.calls - before.calls === 1 && after.requests - before.requests === 1 && after.native - before.native === 1 && after.sink.preventedBeforeSink && after.sink.trusted, detail: { before, after } });
  }

  await page.evaluate(() => {
    const dock = document.createElement('div');
    dock.className = 'dock-container';
    dock.innerHTML = '<a id="dock-current" class="dock-icon pjax-link" target="_self" href="/base">current</a>';
    document.body.append(dock);
    const scroller = document.createElement('div');
    scroller.id = 'content-scroll';
    scroller.style.cssText = 'height: 20px; overflow: auto';
    scroller.innerHTML = '<div style="height: 200px"></div>';
    document.body.append(scroller);
    scroller.scrollTop = 70;
    window.__dockHistoryWrites = 0;
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method].bind(history);
      history[method] = (...args) => {
        window.__dockHistoryWrites++;
        return original(...args);
      };
    }
  });
  const dockChecks = [];
  for (const [name, url] of [
    ['same URL without hash restores minimized window', `${origin}/base`],
    ['same URL with matching query and hash restores minimized window', `${origin}/base?view=friends#item`]
  ]) {
    await page.evaluate((nextUrl) => {
      history.replaceState({}, '', nextUrl);
      document.getElementById('dock-current').href = nextUrl;
      window.__clickFixture.minimized = true;
    }, url);
    const before = await page.evaluate(() => ({
      calls: window.__clickFixture.calls.length,
      requests: window.__clickFixture.requests.length,
      restores: window.__clickFixture.restores,
      historyLength: history.length,
      historyWrites: window.__dockHistoryWrites,
      scroll: document.getElementById('content-scroll').scrollTop
    }));
    await page.click('#dock-current');
    const after = await page.evaluate(() => ({
      calls: window.__clickFixture.calls.length,
      requests: window.__clickFixture.requests.length,
      restores: window.__clickFixture.restores,
      historyLength: history.length,
      historyWrites: window.__dockHistoryWrites,
      scroll: document.getElementById('content-scroll').scrollTop,
      url: location.href,
      sink: window.__clickFixture.native.at(-1)
    }));
    dockChecks.push({ name, pass: after.restores - before.restores === 1
      && after.calls === before.calls && after.requests === before.requests
      && after.historyLength === before.historyLength && after.historyWrites === before.historyWrites
      && after.scroll === before.scroll
      && after.url === url && after.sink?.trusted && after.sink?.preventedBeforeSink,
    detail: { before, after } });
  }

  for (const [name, href, target, clickOptions, expected] of [
    ['other Dock URL keeps navigation', '/links', '_self', {}, 'managed'],
    ['different query keeps navigation', '/base?view=other', '_self', {}, 'managed'],
    ['different hash keeps native anchor behavior', '/base?view=friends#other', '_self', {}, 'native'],
    ['modified Dock click stays native', '/base?view=friends#item', '_self', { modifiers: ['Meta'] }, 'native'],
    ['middle Dock click stays native', '/base?view=friends#item', '_self', { button: 'middle' }, 'native'],
    ['new-tab Dock click stays native', '/base?view=friends#item', '_blank', {}, 'native'],
    ['external Dock click stays native', 'https://outside.test/next', '_self', {}, 'native'],
    ['visible window keeps existing navigation', '/base', '_self', {}, 'managed']
  ]) {
    await page.evaluate(({ href, target, visible }) => {
      history.replaceState({}, '', visible ? `${location.origin}/base` : `${location.origin}/base?view=friends#item`);
      const link = document.getElementById('dock-current');
      link.href = href;
      link.target = target;
      window.__clickFixture.minimized = !visible;
    }, { href, target, visible: name.startsWith('visible') });
    const before = await page.evaluate(() => ({
      calls: window.__clickFixture.calls.length,
      requests: window.__clickFixture.requests.length,
      restores: window.__clickFixture.restores
    }));
    await page.click('#dock-current', clickOptions);
    const after = await page.evaluate(() => ({
      calls: window.__clickFixture.calls.length,
      requests: window.__clickFixture.requests.length,
      restores: window.__clickFixture.restores,
      sink: window.__clickFixture.native.at(-1)
    }));
    const managed = expected === 'managed';
    dockChecks.push({ name, pass: after.restores === before.restores
      && after.calls - before.calls === Number(managed)
      && after.requests - before.requests === Number(managed)
      && after.sink?.preventedBeforeSink === managed,
    detail: { before, after } });
  }

  const all = [...results, ...trusted, ...dockChecks, { name: 'browser page errors', pass: pageErrors.length === 0, detail: pageErrors }];
  for (const result of all) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : ` ${JSON.stringify(result.detail)}`}`);
  assert.equal(all.filter((result) => !result.pass).length, 0, `${all.filter((result) => !result.pass).length}/${all.length} navigation click checks failed`);
  console.log(`Navigation clicks: ${all.length}/${all.length} passed`);
} finally {
  await browser.close();
}
