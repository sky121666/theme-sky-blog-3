import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const momentsRoot = path.join(root, 'src', 'apps', 'moments');
const [hydrateSource, interactionsSource, publishSource] = await Promise.all([
  fs.readFile(path.join(momentsRoot, 'hydrate.js'), 'utf8'),
  fs.readFile(path.join(momentsRoot, 'interactions.js'), 'utf8'),
  fs.readFile(path.join(momentsRoot, 'publish.js'), 'utf8')
]);

assert.doesNotMatch(hydrateSource, /cleanupDeferred|notificationFrame/,
  'Moments hydrate 不得在下一帧重复安装通知、发布和评论控制器');

async function createPage(browser, html) {
  const page = await browser.newPage();
  await page.route('http://moments.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Moments lifecycle</title>' });
  });
  await page.goto('http://moments.test/');
  await page.setContent(html);
  return page;
}

async function exposeModule(page, source, exportName, globalName) {
  await page.addScriptTag({
    type: 'module',
    content: `${source}\nwindow.${globalName} = ${exportName};`
  });
  await page.waitForFunction((name) => typeof window[name] === 'function', globalName);
}

async function exposeNotificationModule(page) {
  const executableSource = hydrateSource.replace(/^import\s+.*?;\s*$/gm, '');
  await page.addScriptTag({
    type: 'module',
    content: `
      const registerPageAppLifecycle = () => {};
      const resolveMomentsAppProtocol = () => ({});
      const setupMomentInteractions = () => null;
      const setupMomentPublish = () => null;
      const warnApiCall = (...args) => window.__notificationWarnings.push(args);
      ${executableSource}
      window.__setupMomentNotifications = setupMomentNotifications;
      window.__normalizeMomentHref = normalizeMomentHref;
    `
  });
  await page.waitForFunction(() => (
    typeof window.__setupMomentNotifications === 'function'
    && typeof window.__normalizeMomentHref === 'function'
  ));
}

async function createNotificationHarness(browser, href, { markReadMode = 'success' } = {}) {
  const page = await createPage(browser, `
    <div data-moments-notification
         data-user-endpoint="/user"
         data-notifications-endpoint="/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications"
         data-mark-read-endpoint="/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications/{name}/mark-as-read">
      <button type="button" data-moments-notification-toggle aria-expanded="false">消息</button>
      <i data-moments-notification-dot></i>
      <div data-moments-notification-panel hidden>
        <div data-moments-notification-status></div>
        <div data-moments-notification-list></div>
      </div>
    </div>
  `);

  await page.evaluate(({ notificationHref, readMode }) => {
    window.__notificationWarnings = [];
    window.__notificationProbe = {
      markReadStarted: 0,
      markReadAborted: 0,
      navigations: [],
      href: notificationHref,
      readMode
    };
    window.pjax = {
      attachLink(anchor) {
        anchor.dataset.pjaxAttached = 'true';
      },
      loadUrl(url) {
        window.__notificationProbe.navigations.push(url);
      }
    };
    window.fetch = (input, init = {}) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === '/user') {
        return Promise.resolve(new Response(JSON.stringify({
          user: { metadata: { name: 'tester' }, spec: { displayName: 'Tester' } }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (String(init.method || 'GET').toUpperCase() === 'PUT' && url.pathname.endsWith('/mark-as-read')) {
        window.__notificationProbe.markReadStarted += 1;
        if (window.__notificationProbe.readMode !== 'pending') {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }));
        }
        return new Promise((resolve, reject) => {
          window.__resolveNotificationRead = () => resolve(new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }));
          init.signal?.addEventListener('abort', () => {
            window.__notificationProbe.markReadAborted += 1;
            reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      if (url.pathname.endsWith('/notifications')) {
        const safeAttribute = String(window.__notificationProbe.href)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;');
        return Promise.resolve(new Response(JSON.stringify({
          items: [{
            metadata: { name: 'notification-1', creationTimestamp: new Date().toISOString() },
            spec: {
              unread: true,
              title: '瞬间互动',
              rawContent: '有人评论了你的瞬间',
              htmlContent: `<p class="content">瞬间通知</p><a href="${safeAttribute}">查看瞬间</a>`
            }
          }]
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      throw new Error(`Unexpected notification fetch: ${url.pathname}`);
    };
  }, { notificationHref: href, readMode: markReadMode });

  await exposeNotificationModule(page);
  await page.evaluate(() => {
    window.__notificationCleanup = window.__setupMomentNotifications(document);
  });
  await page.click('[data-moments-notification-toggle]');
  await page.waitForSelector('.moments-notification-item[data-notification-id]');
  return page;
}

async function verifyNotificationNavigationAndCleanup(browser) {
  const policyPage = await createPage(browser, '<main>notification policy</main>');
  await policyPage.evaluate(() => {
    window.__notificationWarnings = [];
  });
  await exposeNotificationModule(policyPage);
  const normalized = await policyPage.evaluate(() => ({
    internal: window.__normalizeMomentHref('/moments/example?from=notification#reply'),
    external: window.__normalizeMomentHref('https://outside.example.test/notice'),
    javascript: window.__normalizeMomentHref('javascript:alert(1)'),
    data: window.__normalizeMomentHref('data:text/html,<script>alert(1)</script>'),
    file: window.__normalizeMomentHref('file:///etc/passwd'),
    ftp: window.__normalizeMomentHref('ftp://outside.example.test/file')
  }));
  assert.deepEqual(normalized, {
    internal: '/moments/example?from=notification#reply',
    external: 'https://outside.example.test/notice',
    javascript: '',
    data: '',
    file: '',
    ftp: ''
  }, 'Moments 通知链接只允许同源/外部 HTTP(S)');
  await policyPage.close();

  const internalPage = await createNotificationHarness(browser, '/moments/example?from=notification#reply');
  const internalAnchor = await internalPage.locator('.moments-notification-item').evaluate((anchor) => ({
    href: anchor.dataset.notificationHref,
    pjaxClass: anchor.classList.contains('pjax-link'),
    pjaxAttached: anchor.dataset.pjaxAttached === 'true'
  }));
  assert.deepEqual(internalAnchor, {
    href: '/moments/example?from=notification#reply',
    pjaxClass: true,
    pjaxAttached: true
  }, '同源 Moments 通知必须交给 PJAX');
  await internalPage.click('.moments-notification-item');
  await internalPage.waitForFunction(() => window.__notificationProbe.navigations.length === 1);
  assert.deepEqual(await internalPage.evaluate(() => window.__notificationProbe.navigations), [
    '/moments/example?from=notification#reply'
  ]);
  await internalPage.close();

  const unsafePage = await createNotificationHarness(browser, 'javascript:alert(document.domain)');
  const unsafeAnchor = await unsafePage.locator('.moments-notification-item').evaluate((anchor) => ({
    href: anchor.dataset.notificationHref,
    pjaxClass: anchor.classList.contains('pjax-link')
  }));
  assert.deepEqual(unsafeAnchor, { href: '', pjaxClass: false }, '危险协议不得进入通知导航数据');
  const unsafeStartUrl = unsafePage.url();
  await unsafePage.click('.moments-notification-item');
  await unsafePage.waitForFunction(() => window.__notificationProbe.markReadStarted === 1);
  await unsafePage.waitForTimeout(50);
  assert.equal(unsafePage.url(), unsafeStartUrl, '危险协议通知点击后不得导航');
  assert.deepEqual(await unsafePage.evaluate(() => window.__notificationProbe.navigations), []);
  await unsafePage.close();

  const pendingPage = await createNotificationHarness(browser, '/moments/late', { markReadMode: 'pending' });
  await pendingPage.click('.moments-notification-item');
  await pendingPage.waitForFunction(() => window.__notificationProbe.markReadStarted === 1);
  await pendingPage.evaluate(() => window.__notificationCleanup());
  await pendingPage.waitForFunction(() => window.__notificationProbe.markReadAborted === 1);
  await pendingPage.waitForTimeout(50);
  assert.deepEqual(await pendingPage.evaluate(() => window.__notificationProbe.navigations), [],
    '通知 cleanup 后已读请求不得迟到触发 PJAX 导航');
  await pendingPage.close();

  const externalPage = await createNotificationHarness(browser, 'https://outside.example.test/notice');
  await externalPage.route('https://outside.example.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>External notice</title>' });
  });
  const externalAnchor = await externalPage.locator('.moments-notification-item').evaluate((anchor) => ({
    href: anchor.dataset.notificationHref,
    pjaxClass: anchor.classList.contains('pjax-link')
  }));
  assert.deepEqual(externalAnchor, {
    href: 'https://outside.example.test/notice',
    pjaxClass: false
  }, '外部 HTTP(S) 通知不得交给 PJAX');
  await Promise.all([
    externalPage.waitForURL('https://outside.example.test/notice'),
    externalPage.click('.moments-notification-item')
  ]);
  assert.equal(externalPage.url(), 'https://outside.example.test/notice');
  await externalPage.close();
}

async function verifyPublishCancellation(browser) {
  const page = await createPage(browser, `
    <div class="moments-window">
      <button type="button" data-moments-publish-open hidden>发布</button>
      <dialog data-moments-publish-dialog
              data-user-endpoint="/user"
              data-upload-endpoint="/upload"
              data-moment-endpoint="/moments">
        <form data-moments-publish-form method="dialog">
          <textarea data-moments-publish-content maxlength="1000"></textarea>
          <span data-moments-publish-count></span>
          <span data-moments-publish-status></span>
          <span data-moments-publish-account></span>
          <div data-moments-publish-preview hidden></div>
          <div data-moments-publish-tags hidden></div>
          <div data-moments-publish-tag-row hidden><input data-moments-publish-tag-input></div>
          <div data-moments-publish-emoji-panel hidden></div>
          <input type="file" data-moments-publish-file hidden>
          <button type="button" data-moments-publish-media="image">图片</button>
          <button type="button" data-moments-publish-close>取消</button>
          <button type="submit" data-moments-publish-submit>发表</button>
        </form>
      </dialog>
    </div>
  `);

  await page.evaluate(() => {
    window.__publishProbe = {
      uploadStarted: 0,
      uploadAborted: 0,
      uploadMode: 'pending',
      pollStarted: 0,
      pollAborted: 0,
      publishStarted: 0,
      publishAborted: 0,
      navigations: [],
      publishMode: 'pending'
    };
    window.pjax = {
      loadUrl(url) {
        window.__publishProbe.navigations.push(url);
      }
    };
    window.fetch = (input, init = {}) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === '/user') {
        return Promise.resolve(new Response(JSON.stringify({
          user: { metadata: { name: 'tester' }, spec: { displayName: 'Tester' } }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.pathname === '/upload') {
        window.__publishProbe.uploadStarted += 1;
        if (window.__publishProbe.uploadMode === 'poll') {
          return Promise.resolve(new Response(JSON.stringify({
            metadata: { name: 'attachment-pending' }
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return new Promise((resolve, reject) => {
          window.__resolveUpload = () => resolve(new Response(JSON.stringify({
            status: { permalink: '/media/late.png' }
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
          init.signal?.addEventListener('abort', () => {
            window.__publishProbe.uploadAborted += 1;
            reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      if (url.pathname === '/api/v1alpha1/attachments/attachment-pending') {
        window.__publishProbe.pollStarted += 1;
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            window.__publishProbe.pollAborted += 1;
            reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      if (url.pathname === '/moments') {
        window.__publishProbe.publishStarted += 1;
        if (window.__publishProbe.publishMode === 'success') {
          return Promise.resolve(new Response('{}', {
            status: 201,
            headers: { 'content-type': 'application/json' }
          }));
        }
        return new Promise((resolve, reject) => {
          window.__resolvePublish = () => resolve(new Response('{}', {
            status: 201,
            headers: { 'content-type': 'application/json' }
          }));
          init.signal?.addEventListener('abort', () => {
            window.__publishProbe.publishAborted += 1;
            reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    };
  });

  await exposeModule(page, publishSource, 'setupMomentPublish', '__setupMomentPublish');
  await page.evaluate(() => {
    window.__publishCleanup = window.__setupMomentPublish(document);
  });
  await page.waitForFunction(() => !document.querySelector('[data-moments-publish-open]').hidden);

  await page.click('[data-moments-publish-open]');
  await page.waitForFunction(() => document.querySelector('[data-moments-publish-dialog]').open);
  await page.locator('[data-moments-publish-file]').setInputFiles({
    name: 'slow.png',
    mimeType: 'image/png',
    buffer: Buffer.from('slow upload')
  });
  await page.waitForFunction(() => window.__publishProbe.uploadStarted === 1);
  await page.click('[data-moments-publish-close]');
  await page.waitForFunction(() => window.__publishProbe.uploadAborted === 1);
  await page.waitForTimeout(50);

  const uploadState = await page.evaluate(() => ({
    open: document.querySelector('[data-moments-publish-dialog]').open,
    previewCount: Number(document.querySelector('[data-moments-publish-preview]').dataset.count || 0),
    content: document.querySelector('[data-moments-publish-content]').value,
    navigations: [...window.__publishProbe.navigations]
  }));
  assert.equal(uploadState.open, false, '关闭发布窗口后 dialog 应关闭');
  assert.equal(uploadState.previewCount, 0, '迟到的上传结果不得写入已重置草稿');
  assert.equal(uploadState.content, '', '关闭发布窗口后应清空草稿');
  assert.deepEqual(uploadState.navigations, [], '取消上传不得触发导航');

  await page.evaluate(() => {
    window.__publishProbe.uploadMode = 'poll';
  });
  await page.click('[data-moments-publish-open]');
  await page.locator('[data-moments-publish-file]').setInputFiles({
    name: 'poll.png',
    mimeType: 'image/png',
    buffer: Buffer.from('attachment poll')
  });
  await page.waitForFunction(() => window.__publishProbe.pollStarted === 1);
  await page.click('[data-moments-publish-close]');
  await page.waitForFunction(() => window.__publishProbe.pollAborted === 1);
  assert.equal(await page.evaluate(() => Number(document.querySelector('[data-moments-publish-preview]').dataset.count || 0)), 0,
    '关闭发布窗口后附件轮询结果不得写回草稿');

  await page.click('[data-moments-publish-open]');
  await page.fill('[data-moments-publish-content]', 'slow publish');
  await page.dispatchEvent('[data-moments-publish-content]', 'input');
  await page.click('[data-moments-publish-submit]');
  await page.waitForFunction(() => window.__publishProbe.publishStarted === 1);
  await page.click('[data-moments-publish-close]');
  await page.waitForFunction(() => window.__publishProbe.publishAborted === 1);
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => window.__publishProbe.navigations), [],
    '取消在途发布后不得跳转到 Moments 列表');

  await page.evaluate(() => {
    window.__publishProbe.publishMode = 'success';
  });
  await page.click('[data-moments-publish-open]');
  await page.fill('[data-moments-publish-content]', 'successful publish');
  await page.dispatchEvent('[data-moments-publish-content]', 'input');
  await page.click('[data-moments-publish-submit]');
  await page.waitForFunction(() => window.__publishProbe.publishStarted === 2);
  await page.waitForFunction(() => !document.querySelector('[data-moments-publish-dialog]').open);
  await page.evaluate(() => window.__publishCleanup());
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => window.__publishProbe.navigations), [],
    '生命周期清理必须取消发布成功后的延迟跳转');

  await page.close();
}

async function verifyCommentGenerationAndViewerCleanup(browser) {
  const page = await createPage(browser, `
    <div class="moments-window">
      <div class="moments-body">
        <main data-app-root="moments">
          <section class="moment-comments--custom">
            <article data-moment-card
                     data-moment-name="moment-1"
                     data-moment-detail-comments
                     data-comment-count="1"
                     data-upvote-count="0">
              <button type="button" data-moment-photo data-moment-photo-url="/photo.png"><img src="/thumb.png" alt=""></button>
              <div class="moment-comments-shell" data-moment-comments-panel>
                <div data-moment-comments-list></div>
                <p data-moment-comments-status></p>
                <button type="button" data-moment-comments-more></button>
                <form data-moment-comment-form>
                  <textarea data-moment-comment-input></textarea>
                  <button type="submit" data-moment-comment-submit></button>
                </form>
              </div>
            </article>
          </section>
        </main>
      </div>
    </div>
  `);

  await page.evaluate(() => {
    window.__commentRequests = [];
    window.fetch = (_input, init = {}) => new Promise((resolve, reject) => {
      const request = {
        aborted: false,
        resolve() {
          const index = window.__commentRequests.indexOf(request) + 1;
          resolve(new Response(JSON.stringify({
            page: 1,
            hasNext: false,
            total: 1,
            items: [{
              metadata: { name: `comment-${index}` },
              spec: { content: `comment ${index}`, approved: true },
              owner: { displayName: 'Tester' },
              replies: { items: [], page: 1, hasNext: false }
            }]
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
      };
      window.__commentRequests.push(request);
      init.signal?.addEventListener('abort', () => {
        request.aborted = true;
        reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  });

  await exposeModule(page, interactionsSource, 'setupMomentInteractions', '__setupMomentInteractions');
  await page.evaluate(() => {
    window.__firstInteractionsCleanup = window.__setupMomentInteractions(document);
  });
  await page.waitForFunction(() => window.__commentRequests.length === 1);
  await page.evaluate(() => {
    window.__secondInteractionsCleanup = window.__setupMomentInteractions(document);
  });
  await page.waitForFunction(() => window.__commentRequests.length === 2);
  await page.evaluate(() => window.__firstInteractionsCleanup());
  await page.waitForTimeout(50);

  const pendingState = await page.evaluate(() => ({
    firstAborted: window.__commentRequests[0].aborted,
    secondAborted: window.__commentRequests[1].aborted,
    loading: document.querySelector('[data-moment-comments-panel]').classList.contains('is-loading')
  }));
  assert.equal(pendingState.firstAborted, true, '重复初始化必须中止旧评论请求');
  assert.equal(pendingState.secondAborted, false, '旧 cleanup 再次执行不得中止新评论请求');
  assert.equal(pendingState.loading, true, '旧请求 finally 不得清除新请求的 loading 状态');

  await page.evaluate(() => window.__commentRequests[1].resolve());
  await page.waitForFunction(() => document.querySelectorAll('[data-moment-comment]').length === 1);
  const rendered = await page.textContent('[data-moment-comment]');
  assert.match(rendered, /comment 2/, '只允许最新一代评论请求写入页面');

  await page.click('[data-moment-photo]');
  await page.waitForFunction(() => !document.querySelector('.moment-photo-viewer').hidden);
  await page.evaluate(() => window.__secondInteractionsCleanup());
  const viewerState = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    const notPrevented = window.dispatchEvent(event);
    const overlay = document.querySelector('.moment-photo-viewer');
    return {
      hidden: !overlay || overlay.hidden,
      keyNotPrevented: notPrevented
    };
  });
  assert.equal(viewerState.hidden, true, 'Moments cleanup 必须关闭图片查看器');
  assert.equal(viewerState.keyNotPrevented, true, '离开 Moments 后查看器不得继续拦截方向键');

  await page.close();
}

async function verifyViewerRefCountCleanup(browser) {
  const page = await createPage(browser, `
    <section class="moments-window" data-window="first">
      <main data-app-root="moments">
        <div class="moments-feed-list">
          <button type="button" data-moment-photo data-moment-photo-url="/first.png"><img src="/first-thumb.png" alt=""></button>
        </div>
      </main>
    </section>
    <section class="moments-window" data-window="second">
      <main data-app-root="moments">
        <div class="moments-feed-list">
          <button type="button" data-moment-photo data-moment-photo-url="/second.png"><img src="/second-thumb.png" alt=""></button>
        </div>
      </main>
    </section>
  `);

  await page.evaluate(() => {
    const nativeAdd = window.addEventListener.bind(window);
    const nativeRemove = window.removeEventListener.bind(window);
    window.__viewerListenerProbe = { added: [], removed: [] };
    window.addEventListener = (type, listener, options) => {
      if (type === 'keydown') window.__viewerListenerProbe.added.push(listener);
      return nativeAdd(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (type === 'keydown') window.__viewerListenerProbe.removed.push(listener);
      return nativeRemove(type, listener, options);
    };
  });

  await exposeModule(page, interactionsSource, 'setupMomentInteractions', '__setupMomentInteractions');
  await page.evaluate(() => {
    const roots = document.querySelectorAll('[data-app-root="moments"]');
    window.__firstViewerCleanup = window.__setupMomentInteractions(roots[0]);
    window.__secondViewerCleanup = window.__setupMomentInteractions(roots[1]);
  });

  await page.click('[data-window="first"] [data-moment-photo]');
  await page.waitForFunction(() => !document.querySelector('.moment-photo-viewer')?.hidden);
  assert.deepEqual(await page.evaluate(() => ({
    added: window.__viewerListenerProbe.added.length,
    removed: window.__viewerListenerProbe.removed.length
  })), { added: 1, removed: 0 }, 'viewer 首次创建应只安装一个全局 keydown');

  await page.evaluate(() => window.__firstViewerCleanup());
  assert.deepEqual(await page.evaluate(() => ({
    overlayPresent: Boolean(document.querySelector('.moment-photo-viewer')),
    removed: window.__viewerListenerProbe.removed.length
  })), { overlayPresent: true, removed: 0 }, '仍有 Moments 使用者时不得销毁共享 viewer 监听');

  await page.click('[data-window="second"] [data-moment-photo]');
  await page.waitForFunction(() => !document.querySelector('.moment-photo-viewer')?.hidden);
  await page.evaluate(() => window.__secondViewerCleanup());
  const finalState = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    return {
      overlayPresent: Boolean(document.querySelector('.moment-photo-viewer')),
      added: window.__viewerListenerProbe.added.length,
      removed: window.__viewerListenerProbe.removed.length,
      keyNotPrevented: window.dispatchEvent(event)
    };
  });
  assert.deepEqual(finalState, {
    overlayPresent: false,
    added: 1,
    removed: 1,
    keyNotPrevented: true
  }, '最后一个 Moments 使用者 cleanup 后必须解绑 viewer 全局 keydown 并移除 overlay');

  await page.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await verifyNotificationNavigationAndCleanup(browser);
  await verifyPublishCancellation(browser);
  await verifyCommentGenerationAndViewerCleanup(browser);
  await verifyViewerRefCountCleanup(browser);
  console.log('Moments lifecycle verification passed');
} finally {
  await browser.close();
}
