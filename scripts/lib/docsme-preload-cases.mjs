import assert from 'node:assert/strict';

export async function verifyDocsmePreloadRepair({ fixture, html, ready, origin, source }) {
  async function retainedThenRetry(page) {
    await page.waitForFunction(() => __probe.settled[0]?.outcome === 'failed', null, { timeout: 2500 });
    assert.deepEqual(await page.evaluate(() => ({
      path: location.pathname, original: __probe.docsRoot === document.querySelector('.docsme-app'),
      busy: __probe.docsRoot.classList.contains('is-pjax-loading'), frame: __probe.frame === document.querySelector('#window-frame-root'),
      history: history.state.__browserNavIndex, ready: __probe.ready.length, animations: __probe.animations.length,
      settled: __probe.settled.length
    })), { path: source, original: true, busy: false, frame: true, history: 0, ready: 0, animations: 0, settled: 1 });
    await page.evaluate(() => document.getElementById('next').click());
    await ready(page, '/docs/next');
    assert.deepEqual(await page.evaluate(() => __probe.settled.map(event => event.outcome)), ['failed', 'ready']);
  }
  for (const [label, headers, offset, requests] of [
    ['no-store', { 'cache-control': 'private, no-store, max-age=60' }, 0, 2],
    ['no-cache', { 'cache-control': 'no-cache, max-age=60' }, 0, 2],
    ['short freshness', { 'cache-control': 'max-age=3, s-maxage=120, must-revalidate' }, 5000, 2],
    ['already aged', { 'cache-control': 'max-age=4', age: '3' }, 1500, 2],
    ['unspecified', { 'cache-control': '' }, 0, 2],
    ['variable representation', { 'cache-control': 'max-age=20', vary: 'Cookie' }, 0, 2],
    ['fresh', { 'cache-control': 'max-age=3, must-revalidate' }, 500, 1]
  ]) {
    await fixture('origin caching: ' + label, async ({ page, count }) => {
      const versions = await page.evaluate(async offset => {
        const read = async () => (await (await __fetchDocsPage('/docs/next')).text()).match(/revision-(\d+)/)[1];
        const before = await read(); __clockOffset += offset; return [before, await read()];
      }, offset);
      assert.equal(count('/docs/next'), requests);
      assert.deepEqual(versions, ['1', String(requests)]);
    }, { responses: { '/docs/next': count => ({ headers, body: html('/docs/next').replace('真实 Docsme', 'revision-' + count) }) } });
  }
  await fixture('an explicit click bypasses unrelated speculative work', async ({ page, count }) => {
    await page.focus('#slow'); await page.focus('#next');
    await page.evaluate(() => document.getElementById('fast').click());
    await page.waitForFunction(() => __probe.ready.at(-1)?.url.endsWith('/docs/fast'), null, { timeout: 1100 });
    assert.equal(count('/docs/fast'), 1);
  }, { responses: { '/docs/slow': { delay: 2200 }, '/docs/next': { delay: 2200 } } });
  await fixture('leaving docs discards pending speculative jobs while the old DOM is visible', async ({ page, count }) => {
    await page.focus('#slow'); await page.focus('#next'); await page.focus('#fast');
    await page.evaluate(() => document.getElementById('other').click());
    await ready(page, '/archives/post');
    assert.equal(count('/docs/fast'), 0);
  }, { responses: { '/docs/slow': { delay: 1200 }, '/docs/next': { delay: 1200 }, '/archives/post': { delay: 500 } } });
  await fixture('a shared preload deadline produces a failed navigation and allows retry', async ({ page, count }) => {
    // Keep real timer ordering: speculation starts first, click has its own later deadline.
    await page.evaluate(() => { const timer = window.setTimeout; window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 15000 ? 650 : ms, ...args); });
    await page.focus('#next'); await page.waitForTimeout(140);
    await page.evaluate(() => document.getElementById('next').click());
    await retainedThenRetry(page); assert.equal(count('/docs/next'), 2);
  }, { responses: { '/docs/next': count => ({ delay: count === 1 ? 1500 : 0 }) } });
  await fixture('initial pageshow cannot interrupt an already accepted click', async ({ page, count }) => {
    const started = page.waitForRequest(req => new URL(req.url()).pathname === '/docs/next');
    await page.evaluate(() => document.getElementById('next').click());
    await started;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
    await ready(page, '/docs/next');
    assert.equal(count('/docs/next'), 1);
  }, { responses: { '/docs/next': { delay: 220 } } });
  for (const dirty of [false, true]) {
    await fixture('a lazy comment form appearing during retry ' + (dirty ? 'protects new input' : 'does not revoke a clean permit'), async ({ page }) => {
      await page.evaluate(() => document.getElementById('next').click());
      await page.waitForFunction(() => __probe.settled.at(-1)?.outcome === 'failed');
      const started = page.waitForRequest(req => new URL(req.url()).pathname === '/docs/next');
      await page.evaluate(() => document.getElementById('next').click());
      await started;
      await page.evaluate(dirty => {
        const form = document.createElement('base-form');
        form.id = 'late-comment';
        if (dirty) form.content = '刚刚输入的评论';
        document.querySelector('[data-lazy-comment]').append(form);
      }, dirty);
      if (dirty) {
        await page.waitForFunction(() => __probe.settled.length === 2);
        assert.deepEqual(await page.evaluate(() => [__probe.settled.at(-1).outcome, location.pathname, document.querySelector('#late-comment')?.content]), ['cancelled', source, '刚刚输入的评论']);
      } else await ready(page, '/docs/next');
    }, { responses: { '/docs/next': count => count === 1 ? { status: 206 } : { delay: 250 } } });
  }
  for (const [label, response] of [
    ['partial document', { status: 206, body: html('/docs/next').split('<h2')[0] }],
    ['ambiguous document', { body: html('/docs/next').replace('</body>', '<div id="window-frame-root"></div></body>') }],
    ['temporary server failure', { status: 503 }]
  ]) {
    await fixture(label + ' is not committed and can be retried', async ({ page, count }) => {
      await page.evaluate(() => document.getElementById('next').click());
      await retainedThenRetry(page); assert.equal(count('/docs/next'), 2);
    }, { responses: { '/docs/next': count => count === 1 ? response : {} } });
  }
  await fixture('a sign-in page served at a docs URL is handed off once without warming it', async ({ page, requests }) => {
    await page.evaluate(() => document.getElementById('next').click());
    await page.waitForURL(origin + '/docs/next', { timeout: 2500 });
    assert.equal(await page.title(), 'Login');
    assert.deepEqual(requests.filter(r => r.path === '/docs/next').map(r => r.navigation), [false, true]);
  }, { documents: 2, responses: { '/docs/next': { body: "<title>Login</title><body data-page-mode='auth'>Login</body>" } } });
  await fixture('cross-document fragment uses one in-flight GET and retains the fragment', async ({ page, count }) => {
    await page.evaluate(() => { document.getElementById('next').href += '#section'; });
    await page.focus('#next'); await page.waitForTimeout(60);
    await page.evaluate(() => document.getElementById('next').click());
    await ready(page, '/docs/next');
    assert.equal(new URL(page.url()).hash, '#section'); assert.equal(count('/docs/next'), 1);
  }, { responses: { '/docs/next': { delay: 320 } } });
  await fixture('expired keyboard attention starts a fresh preload before click', async ({ page, count }) => {
    await page.evaluate(async () => { await __fetchDocsPage('/docs/next'); __clockOffset = 21000; });
    await page.focus('#next'); await page.waitForTimeout(150);
    assert.equal(count('/docs/next'), 2); assert.equal(new URL(page.url()).pathname, source);
  });
  const nested = '/docs/chapter/intro?preview-theme=theme-sky-blog-3';
  await fixture('relative preview link is based on the destination before history commit', async ({ page }) => {
    await page.evaluate(url => { const a = document.getElementById('next'); a.href = url; a.click(); }, nested);
    await ready(page, nested);
    assert.equal(await page.locator('#sibling').getAttribute('href'), origin + '/docs/chapter/sibling?preview-theme=theme-sky-blog-3');
  }, { responses: { [nested]: { body: html(nested).replace('</nav>', '<a href="./sibling" id="sibling">同级文档</a></nav>') } } });
  await fixture('redirect uses the final docs URL for history and retains requested section', async ({ page }) => {
    await page.evaluate(() => { const a = document.getElementById('next'); a.href += '#section'; a.click(); });
    await ready(page, '/docs/chapter/intro');
    assert.equal(new URL(page.url()).hash, '#section');
    assert.equal(await page.evaluate(() => __probe.frame === document.getElementById('window-frame-root')), true);
  }, { httpRedirect: true, responses: { '/docs/next': { status: 302, headers: { location: '/docs/chapter/intro' }, body: '' } } });
}
