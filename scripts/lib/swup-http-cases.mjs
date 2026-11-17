import assert from 'node:assert/strict';

export async function verifyHttpNavigation({ scenario, html, origin }) {
  const paths = { full: '/archives/story', same: '/archives?year=2026' };
  for (const [mode, target] of Object.entries(paths)) {
    await scenario(`${mode}: an accessible inline SVG title is not a second document title`, async page => {
      await page.route(new URL(target, origin).href, route => route.fulfill({
        contentType: 'text/html',
        body: html(new URL(target, origin).pathname).replace('</article>', '<svg><title>chart</title></svg></article>')
      }));
      await page.evaluate(target => window.pjax.loadUrl(target), target);
      assert.deepEqual(await page.evaluate(() => [window.probe?.ready.length, document.querySelector('article svg title')?.textContent]), [1, 'chart']);
    });
    for (const defect of ['wrong MIME', 'range response marked 200', 'truncated after app', ...(mode === 'same' ? ['missing app root', 'ambiguous content root'] : [])]) {
      await scenario(`${mode}: ${defect} keeps the source and allows a single retry`, async page => {
        let count = 0;
        const route = new URL(target, origin).href;
        await page.route(route, request => {
          count++;
          let body = html(new URL(route).pathname);
          if (count === 1) {
            if (defect === 'truncated after app') body = body.slice(0, body.indexOf('</main>'));
            if (defect === 'missing app root') body = body.replace('data-app-root=', 'data-absent-root=');
            if (defect === 'ambiguous content root') body = body.replace('</main>', '<section data-window-content-root></section></main>');
          }
          return request.fulfill({contentType:count === 1 && defect === 'wrong MIME' ? 'text/plain' : 'text/html',
            headers:count === 1 && defect === 'range response marked 200' ? {'Content-Range':'bytes 0-127/256'} : {}, body});
        });
        const before = await page.evaluate(() => {
          window.probe.source = document.querySelector('[data-page-label]'); return history.length;
        });
        await page.evaluate(target => window.pjax.loadUrl(target), target);
        assert.deepEqual(await page.evaluate(() => [location.pathname, history.length,
          document.querySelector('[data-page-label]') === window.probe.source, window.probe.ready.length,
          window.probe.settled.map(e => e.outcome)]), ['/archives', before, true, 0, ['failed']]);
        assert.equal(count, 1, 'malformed HTML must not trigger a second fetch or a document reload');
        await page.evaluate(target => window.pjax.loadUrl(target), target);
        await page.waitForFunction(() => window.probe.ready.length === 1);
        assert.equal(page.url(), route); assert.equal(count, 2);
      });
    }
    for (const [method, status] of [
      ['GET', 204], ['GET', 206], ['GET', 503],
      ...(mode === 'full' ? [['POST', 422], ['POST', 500], ['POST', 503]] : [])
    ]) {
      await scenario(`${mode}: ${method} ${status} retains the page and permits one manual retry`, async page => {
        const href = new URL(target, origin).href;
        const requests = [];
        await page.route(href, route => {
          requests.push([route.request().method(), route.request().isNavigationRequest()]);
          return route.fulfill({ status: requests.length === 1 ? status : 200, contentType: 'text/html',
            body: requests.length === 1 && status === 204 ? '' : html(new URL(href).pathname) });
        });
        const length = await page.evaluate(({ target, method }) => {
          const link = document.querySelector('#nav-story');
          link.href = target;
          window.probe.frame = document.querySelector('#window-frame-root');
          window.probe.source = document.querySelector('[data-page-label]');
          window.probe.failureEvents = [];
          document.addEventListener('pjax:error', e => window.probe.failureEvents.push(e.request.status));
          if (method === 'GET') link.click();
          else void window.pjax.loadUrl(target, { triggerElement: link, requestOptions: {
            requestMethod: method, requestParams: [{ name: 'message', value: 'draft' }]
          } });
          return history.length;
        }, { target, method });
        await page.waitForFunction(() => window.probe?.settled.length || !window.probe, null, { timeout: 2500 });
        assert.deepEqual(requests, [[method, false]], 'no native reload or automatic replay');
        assert.deepEqual(await page.evaluate(() => ({
          outcomes: window.probe.settled.map(e => e.outcome), ready: window.probe.ready.length,
          sameFrame: window.probe.frame === document.querySelector('#window-frame-root'),
          sameSource: window.probe.source === document.querySelector('[data-page-label]'),
          href: location.pathname + location.search, length: history.length,
          busy: document.querySelector('#nav-story').getAttribute('aria-busy'),
          loading: window.probe.frame.classList.contains('pjax-loading')
        })), { outcomes: ['failed'], ready: 0, sameFrame: true, sameSource: true, href: '/archives', length, busy: null, loading: false });
        if (mode === 'full') assert.deepEqual(await page.evaluate(() => [
          window.probe.failureEvents, window.probe.failedComplete
        ]), [[status], 1], 'failed full navigation must also notify existing plugin listeners once');
        await page.evaluate(() => document.querySelector('#nav-story').click());
        await page.waitForFunction(() => window.probe.ready.length === 1);
        assert.equal(page.url(), href);
        assert.deepEqual(requests, [[method, false], ['GET', false]]);
        assert.deepEqual(await page.evaluate(() => window.probe.settled.map(e => e.outcome)), ['failed', 'ready']);
      });
    }
    for (const reason of ['not-found', 'login']) {
      await scenario(`${mode}: ${reason} hands off to one native document`, async page => {
        const href = new URL(target, origin).href;
        const requests = [];
        await page.route(href, route => {
          requests.push(route.request().isNavigationRequest() ? 'document' : 'fetch');
          return route.fulfill(reason === 'login' ? { status: 200, contentType: 'text/html',
            body: '<title>Login</title><body data-page-mode="auth">Login</body>' }
            : { status: 404, contentType: 'text/html', body: '<title>Not found</title>' });
        });
        await page.evaluate(target => { void window.pjax.loadUrl(target); }, target);
        await page.waitForURL(href);
        assert.equal(await page.title(), reason === 'login' ? 'Login' : 'Not found');
        assert.deepEqual(requests, ['fetch', 'document'], 'do not repeat the original PJAX request');
      });
    }
  }
  await scenario('data-no-swup link remains native; cancelling beforeunload cannot block a later managed link', async (page, requests) => {
    page.on('dialog', dialog => dialog.dismiss());
    await page.evaluate(() => {
      document.querySelector('#nav-story').parentElement.setAttribute('data-no-swup', '');
      window.addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = ''; });
    });
    const refused = page.waitForEvent('dialog');
    await page.locator('#nav-story').click({ noWaitAfter: true });
    await refused;
    assert.equal(await page.locator('#nav-story').getAttribute('aria-busy'), null);
    await page.evaluate(() => {
      const next = document.querySelector('#nav-story'); next.parentElement.removeAttribute('data-no-swup');
      next.href = '/archives/2026'; next.click();
    });
    await page.waitForFunction(() => window.probe.ready.length === 1);
    assert.equal(new URL(page.url()).pathname, '/archives/2026');
    assert.equal(requests.filter(r => r.path === '/archives/2026').length, 1);
    assert.deepEqual(await page.evaluate(() => window.probe.settled.map(e=>e.outcome)), ['ready']);
  });
  await scenario('trigger opting out during admission settles the managed session even after a native veto', async page => {
    page.on('dialog', dialog => dialog.dismiss());
    await page.evaluate(() => {
      document.addEventListener('theme:navigation-accepted', () => document.querySelector('#nav-story').setAttribute('data-no-swup', ''), { once: true });
      window.addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = ''; });
    });
    const refused = page.waitForEvent('dialog');
    await page.locator('#nav-story').click({ noWaitAfter: true });
    await refused;
    await page.evaluate(() => {
      const link = document.querySelector('#nav-story');
      link.removeAttribute('data-no-swup');
      link.href = '/archives/2026'; link.click();
    });
    await page.waitForFunction(() => window.probe.ready.length === 1);
    assert.equal(new URL(page.url()).pathname, '/archives/2026');
    assert.deepEqual(await page.evaluate(() => window.probe.settled.map(event => event.outcome)), ['native', 'ready']);
  });
}
