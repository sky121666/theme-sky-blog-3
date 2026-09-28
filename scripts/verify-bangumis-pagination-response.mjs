import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const origin = 'http://bangumis-pagination.test';
const requestPath = '/bangumis/page/2?typeNum=2&status=1&size=2';
const requestUrl = `${origin}${requestPath}`;
const nextPath = '/bangumis/page/3?typeNum=2&status=1&size=2';

const card = '<a data-bangumi-card data-bangumi-title="第二页" href="/item/2">第二页</a>';
const page = (content) => `<!doctype html><html><head><title>追剧</title></head>
  <body data-error-page="false" data-page-mode="browser-bangumis" data-app-id="bangumis" data-window-variant="bangumis">
    <div data-app-root="bangumis"><script type="application/json" data-app-props="bangumis">{"version":1,"appId":"bangumis"}</script>
      <div class="bangumis-main-scroll">${content}</div>
    </div>
  </body></html>`;
const library = (cards, next = '') => `<section class="bangumis-library"><div class="bangumis-list">${cards}</div>
  <div data-bangumis-loadmore data-next-url="${next}"><span data-bangumis-scroll-sentinel></span></div></section>`;
const emptyPage = page('<section class="bangumis-empty">暂无记录</section>');
const completePage = page(library(card, nextPath));
const lastPage = page(library(card));

const bundled = await build({
  stdin: {
    contents: `import { registerBangumisExplorer } from './src/apps/bangumis/runtime.js';
      registerBangumisExplorer({ data(_name, factory) { window.bangumisFactory = factory; } });`,
    resolveDir: process.cwd(),
    sourcefile: 'bangumis-pagination-fixture.js',
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
const pageTab = await context.newPage();
let responseBody = completePage;
let redirectPath = '';
let paginationRequests = 0;

await pageTab.route(`${origin}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/bangumis') {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div data-app-root="bangumis"><div class="bangumis-main-scroll"><div class="bangumis-list"></div><div data-bangumis-loadmore data-next-url=""></div></div></div></body></html>' });
  } else {
    paginationRequests += 1;
    if (redirectPath && `${url.pathname}${url.search}` === requestPath) {
      await route.fulfill({ status: 302, headers: { location: redirectPath }, body: '' });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/html', body: responseBody });
    }
  }
});

try {
  await pageTab.goto(`${origin}/bangumis`);
  await pageTab.addScriptTag({ content: bundled.outputFiles[0].text });
  await pageTab.evaluate(() => { window.Alpine = { initTree() {} }; });

  const cases = [
    {
      name: 'truncated HTTP 200 stays retryable',
      body: '<!doctype html><html><body><div class="bangumis-list"></div>',
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'truncated HTTP 200 with page markers stays retryable',
      body: completePage.slice(0, completePage.lastIndexOf('</body>')),
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'HTTP 200 without the loader stays retryable',
      body: page('<section class="bangumis-library"><div class="bangumis-list">' + card + '</div></section>'),
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'HTTP 200 with a loader but no cards stays retryable',
      body: page(library('', '')),
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'HTTP 200 with the wrong page protocol stays retryable',
      body: completePage.replace('data-page-mode="browser-bangumis"', 'data-page-mode="browser-home"'),
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'HTTP 200 with the wrong app identity stays retryable',
      body: completePage.replace('data-app-id="bangumis"', 'data-app-id="home"'),
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'HTTP 200 with the wrong window variant stays retryable',
      body: completePage.replace('data-window-variant="bangumis"', 'data-window-variant="none"'),
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'HTTP 200 redirected to another query stays retryable',
      body: completePage,
      redirect: '/bangumis/page/2?typeNum=1&status=1&size=2',
      want: { loadError: true, hasMore: true, nextUrl: requestUrl, cardCount: 0 }
    },
    {
      name: 'valid next page appends cards and advances the cursor',
      body: completePage,
      want: { loadError: false, hasMore: true, nextUrl: nextPath, cardCount: 1 }
    },
    {
      name: 'valid terminal page appends its cards and finishes',
      body: lastPage,
      want: { loadError: false, hasMore: false, nextUrl: '', cardCount: 1 }
    },
    {
      name: 'valid empty terminal page finishes without an error',
      body: emptyPage,
      want: { loadError: false, hasMore: false, nextUrl: '', cardCount: 0 }
    }
  ];

  for (const scenario of cases) {
    responseBody = scenario.body;
    redirectPath = scenario.redirect || '';
    const actual = await pageTab.evaluate(async (url) => {
      const root = document.querySelector('[data-app-root="bangumis"]');
      root.querySelector('.bangumis-list').replaceChildren();
      const model = window.bangumisFactory();
      model.$root = root;
      model.$nextTick = (callback) => callback();
      model.nextUrl = url;
      model.hasMore = true;
      await model.loadNext();
      window.paginationModel = model;
      return {
        loadError: model.loadError,
        hasMore: model.hasMore,
        nextUrl: model.nextUrl,
        cardCount: root.querySelectorAll('.bangumis-list > [data-bangumi-card]').length
      };
    }, requestUrl);
    assert.deepEqual(actual, scenario.want, scenario.name);
    console.log(`passed: ${scenario.name}`);

    if (scenario.name === 'truncated HTTP 200 stays retryable') {
      const beforeRetry = paginationRequests;
      await pageTab.evaluate(() => window.paginationModel.checkScrollFallback());
      assert.equal(paginationRequests, beforeRetry, 'failed page must not retry automatically at the scroll edge');
      responseBody = completePage;
      const afterRetry = await pageTab.evaluate(async () => {
        const model = window.paginationModel;
        await model.loadNext();
        return {
          loadError: model.loadError,
          hasMore: model.hasMore,
          nextUrl: model.nextUrl,
          cardCount: model.$root.querySelectorAll('.bangumis-list > [data-bangumi-card]').length
        };
      });
      assert.equal(paginationRequests, beforeRetry + 1, 'manual retry must issue one new request');
      assert.deepEqual(afterRetry,
        { loadError: false, hasMore: true, nextUrl: nextPath, cardCount: 1 },
        'manual retry should recover after a complete response');
      console.log('passed: malformed response waits for one manual retry and recovers');
    }
  }
  console.log('bangumis pagination response contracts passed');
} finally {
  await context.close();
  await browser.close();
}
