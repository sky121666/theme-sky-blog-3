import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'playwright');
const localAssetManifestFile = path.join(root, 'templates', 'assets', 'asset-manifest.json');
const baseUrl = (process.env.SMOKE_BASE_URL || '').trim();
const requirePluginRoutes = /^(?:1|true)$/i.test(String(process.env.SMOKE_REQUIRE_PLUGIN_ROUTES || '').trim());
const knownStaleContentUrls = new Set([
  'http://192.168.1.23:8090/upload/5BB751C4-JdQx.JPEG',
  'http://192.168.1.23:8090/upload/2E3462BD-FtZg.jpeg',
  'http://192.168.1.23:8090/upload/1D1AF973-QjDN.jpg',
  'http://192.168.1.23:8090/upload/1D3408F2-pylZ.JPEG'
]);

function toAbsoluteUrl(target) {
  return new URL(target, baseUrl).toString();
}

function realChromeUserAgent(browser) {
  const version = String(browser.version() || '').trim() || '142.0.0.0';
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function toPathname(value) {
  try {
    return new URL(value, baseUrl).pathname + new URL(value, baseUrl).search;
  } catch {
    return '';
  }
}

function assetManifestPath(manifest) {
  const shellAsset = String(manifest?.['shell-core']?.js?.[0] || '');
  const marker = '/assets/';
  const markerIndex = shellAsset.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('本地 asset-manifest 缺少可解析的 shell-core 资源路径');
  }
  return `${shellAsset.slice(0, markerIndex + marker.length)}asset-manifest.json`;
}

function readAssetMeta(manifest, source) {
  const version = String(manifest?.__meta?.version || '').trim();
  const revision = String(manifest?.__meta?.revision || '').trim();
  const query = String(manifest?.__meta?.query || '').trim().replace(/^\?/, '');
  if (!version || !revision || !query) {
    throw new Error(`${source} asset-manifest 缺少 __meta.version/revision/query`);
  }
  const queryParams = new URLSearchParams(query);
  if (queryParams.get('v') !== version || queryParams.get('r') !== revision) {
    throw new Error(`${source} asset-manifest 的 query 与 version/revision 不一致`);
  }
  return { version, revision, query };
}

async function verifyServedAssetRevision() {
  const localManifest = JSON.parse(await fs.readFile(localAssetManifestFile, 'utf8'));
  const localMeta = readAssetMeta(localManifest, '本地');
  const manifestPath = assetManifestPath(localManifest);
  const response = await fetch(toAbsoluteUrl(manifestPath), {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache'
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`服务端 asset-manifest 请求失败: HTTP ${response.status} (${manifestPath})`);
  }
  const remoteMeta = readAssetMeta(await response.json(), '服务端');
  if (remoteMeta.version !== localMeta.version || remoteMeta.revision !== localMeta.revision) {
    throw new Error(
      `服务端 assets 与本地构建不一致: server=${remoteMeta.version}/${remoteMeta.revision}, `
      + `local=${localMeta.version}/${localMeta.revision}`
    );
  }
  return { manifestPath, ...localMeta };
}

function appLoadedFlagName(appId) {
  if (!appId) return '';
  return `__THEME_APP_${String(appId).replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_LOADED__`;
}

function isExternalUploadResourceError(message) {
  if (!message || !/^Failed to load resource:/i.test(message.text())) return false;
  const url = message.location()?.url || '';
  if (!url) return false;
  try {
    return knownStaleContentUrls.has(new URL(url).href);
  } catch {
    return false;
  }
}

function isIgnoredRequestFailure(request) {
  const errorText = String(request.failure()?.errorText || '');
  if (/net::ERR_ABORTED/i.test(errorText)) return true;
  try {
    return knownStaleContentUrls.has(new URL(request.url()).href);
  } catch {
    return false;
  }
}

function optionalSkipReason(route, status) {
  if (!route.optional) return '';
  if (route.optionalFailure === 'plugin-unavailable' && status === 404) {
    return 'plugin unavailable (HTTP 404)';
  }
  if (route.optionalFailure === 'sample-missing' && (status === 404 || status === 410)) {
    return `sample missing (HTTP ${status})`;
  }
  return '';
}

function buildOptionalRoute(name, envKey, expectedAppId, expectedPageMode, expectedWindowVariant) {
  const value = (process.env[envKey] || '').trim();
  if (!value) return null;
  return {
    name,
    target: value,
    optional: false,
    expectedAppId,
    expectedPageMode,
    expectedWindowVariant,
    appRootSelector: `[data-app-root="${expectedAppId}"]`,
    appPropsSelector: `script[data-app-props="${expectedAppId}"]`
  };
}

async function captureFailure(page, name) {
  await fs.mkdir(outputDir, { recursive: true });
  const safeName = name.replace(/[^a-zA-Z0-9-_]+/g, '-');
  const file = path.join(outputDir, `${safeName}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    // Ignore screenshot failures and keep the original assertion failure.
  }
  return file;
}

async function writeReport(report) {
  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, 'smoke-report.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

async function main() {
  if (!baseUrl) {
    if (requirePluginRoutes) {
      throw new Error('严格插件 smoke 缺少 SMOKE_BASE_URL');
    }
    console.log('跳过 Playwright smoke：未设置 SMOKE_BASE_URL');
    process.exit(0);
  }

  const assetRevision = await verifyServedAssetRevision();
  console.log(`Assets revision 已对齐: ${assetRevision.version}/${assetRevision.revision}`);

  const routes = [
    {
      name: 'home',
      target: '/',
      optional: false,
      requireShellLoaded: false,
      expectedAppId: '',
      expectedPageMode: 'browser-home',
      expectedWindowVariant: 'none',
      extraSelectors: ['body[data-page-mode="browser-home"]']
    },
    {
      name: 'archives',
      target: '/archives',
      optional: false,
      requireShellLoaded: true,
      expectedAppId: 'explorer-archives',
      expectedPageMode: 'browser-list',
      expectedWindowVariant: 'browser',
      appRootSelector: '[data-app-root="explorer-archives"]',
      appPropsSelector: 'script[data-app-props="explorer-archives"]'
    },
    {
      name: 'tags',
      target: '/tags',
      optional: false,
      requireShellLoaded: true,
      expectedAppId: 'explorer-tags',
      expectedPageMode: 'browser-list',
      expectedWindowVariant: 'browser',
      appRootSelector: '[data-app-root="explorer-tags"]',
      appPropsSelector: 'script[data-app-props="explorer-tags"]'
    },
    {
      name: 'categories',
      target: '/categories',
      optional: false,
      requireShellLoaded: true,
      expectedAppId: 'explorer-categories',
      expectedPageMode: 'browser-list',
      expectedWindowVariant: 'browser',
      appRootSelector: '[data-app-root="explorer-categories"]',
      appPropsSelector: 'script[data-app-props="explorer-categories"]'
    },
    {
      name: 'auth',
      target: '/login',
      optional: false,
      requireShellLoaded: false,
      expectedAppId: 'auth',
      expectedPageMode: 'auth',
      expectedWindowVariant: 'none',
      appRootSelector: '[data-app-root="auth"]',
      appPropsSelector: 'script[data-app-props="auth"]',
      extraSelectors: ['.halo-form']
    },
    {
      name: 'moments',
      target: '/moments',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'moments',
      expectedPageMode: 'browser-moments',
      expectedWindowVariant: 'moments',
      appRootSelector: '[data-app-root="moments"]',
      appPropsSelector: 'script[data-app-props="moments"]'
    },
    {
      name: 'links',
      target: '/links',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'links',
      expectedPageMode: 'browser-links',
      expectedWindowVariant: 'links',
      appRootSelector: '[data-app-root="links"]',
      appPropsSelector: 'script[data-app-props="links"]'
    },
    {
      name: 'bangumis',
      target: '/bangumis',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'bangumis',
      expectedPageMode: 'browser-bangumis',
      expectedWindowVariant: 'bangumis',
      appRootSelector: '[data-app-root="bangumis"]',
      appPropsSelector: 'script[data-app-props="bangumis"]'
    },
    {
      name: 'douban',
      target: '/douban',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'douban',
      expectedPageMode: 'browser-douban',
      expectedWindowVariant: 'douban',
      appRootSelector: '[data-app-root="douban"]',
      appPropsSelector: 'script[data-app-props="douban"]'
    },
    {
      name: 'docsme',
      target: '/docs',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'docsme',
      expectedPageMode: 'browser-docsme',
      expectedWindowVariant: 'docsme',
      appRootSelector: '[data-app-root="docsme"]',
      appPropsSelector: 'script[data-app-props="docsme"]'
    },
    {
      name: 'steam',
      target: '/steam',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'steam',
      expectedPageMode: 'browser-steam',
      expectedWindowVariant: 'steam',
      appRootSelector: '[data-app-root="steam"]',
      appPropsSelector: 'script[data-app-props="steam"]'
    },
    {
      name: 'equipments',
      target: '/equipments',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'equipments',
      expectedPageMode: 'browser-equipments',
      expectedWindowVariant: 'equipments',
      appRootSelector: '[data-app-root="equipments"]',
      appPropsSelector: 'script[data-app-props="equipments"]'
    },
    {
      name: 'photos',
      target: '/photos',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      requireShellLoaded: true,
      expectedAppId: 'photos',
      expectedPageMode: 'browser-list',
      expectedWindowVariant: 'photos',
      appRootSelector: '[data-app-root="photos"]',
      appPropsSelector: 'script[data-app-props="photos"]'
    }
  ];

  const extraRoutes = [
    buildOptionalRoute('reader-detail', 'SMOKE_READER_PATH', 'reader', 'browser-reader', 'browser'),
    buildOptionalRoute('author-detail', 'SMOKE_AUTHOR_PATH', 'explorer-author', 'browser-list', 'browser'),
    buildOptionalRoute('moment-detail', 'SMOKE_MOMENT_DETAIL_PATH', 'moments', 'browser-moments', 'moments')
  ].filter(Boolean);

  routes.push(...extraRoutes);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    // The Douban image proxy blocks HeadlessChrome while serving a valid JPEG
    // to ordinary Chrome. Keep the engine headless but use a real-user UA.
    userAgent: realChromeUserAgent(browser)
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  function createRuntimeErrorCollector() {
    const pageErrors = [];
    const consoleErrors = [];
    const requestFailures = [];
    const handlePageError = (error) => {
      pageErrors.push(String(error?.message || error));
    };
    const handleConsole = (message) => {
      if (message.type() !== 'error' || isExternalUploadResourceError(message)) return;
      consoleErrors.push(message.text());
    };
    const handleRequestFailed = (request) => {
      if (isIgnoredRequestFailure(request)) return;
      requestFailures.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        errorText: String(request.failure()?.errorText || 'unknown request failure')
      });
    };

    page.on('pageerror', handlePageError);
    page.on('console', handleConsole);
    page.on('requestfailed', handleRequestFailed);

    return {
      snapshot() {
        return {
          pageErrors: [...pageErrors],
          consoleErrors: [...consoleErrors],
          requestFailures: requestFailures.map((failure) => ({ ...failure }))
        };
      },
      assertEmpty(scope) {
        if (!pageErrors.length && !consoleErrors.length && !requestFailures.length) return;
        const detail = [
          ...pageErrors.map((message) => `pageerror: ${message}`),
          ...consoleErrors.map((message) => `console.error: ${message}`),
          ...requestFailures.map((failure) => (
            `requestfailed: ${failure.method} ${failure.resourceType} ${failure.url} (${failure.errorText})`
          ))
        ].join(' | ');
        throw new Error(`${scope}存在运行时错误: ${detail}`);
      },
      stop() {
        page.off('pageerror', handlePageError);
        page.off('console', handleConsole);
        page.off('requestfailed', handleRequestFailed);
      }
    };
  }

  async function navigate(route) {
    const runtimeErrors = createRuntimeErrorCollector();

    try {
      let response = null;
      let waitUntil = route.waitUntil || 'networkidle';
      let usedFallback = false;

      try {
        response = await page.goto(toAbsoluteUrl(route.target), {
          waitUntil,
          timeout: 20_000
        });
      } catch (error) {
        const isTimeout = /TimeoutError/i.test(String(error));
        if (!isTimeout || waitUntil !== 'networkidle') {
          throw error;
        }

        waitUntil = 'domcontentloaded';
        usedFallback = true;
        response = await page.goto(toAbsoluteUrl(route.target), {
          waitUntil,
          timeout: 20_000
        });
      }

      const status = response?.status() ?? 0;
      await page.waitForTimeout(route.settleTimeMs ?? 1200);
      if (route.requireShellLoaded) {
        await page.waitForFunction(
          () => Boolean(window.__THEME_SHELL_CORE_LOADED__ || window.__THEME_MAIN_LOADED__),
          null,
          { timeout: 10000 }
        ).catch(() => {});
      }

      const shellState = await page.evaluate(() => ({
        appId: document.body?.dataset.appId || '',
        pageMode: document.body?.dataset.pageMode || '',
        windowVariant: document.body?.dataset.windowVariant || '',
        mainLoaded: Boolean(window.__THEME_SHELL_CORE_LOADED__ || window.__THEME_MAIN_LOADED__)
      }));

      return { status, shellState, ...runtimeErrors.snapshot(), waitUntil, usedFallback };
    } finally {
      runtimeErrors.stop();
    }
  }

  async function validateRoute(route) {
    const nav = await navigate(route);
    const { status, shellState, pageErrors, consoleErrors, requestFailures, waitUntil, usedFallback } = nav;

    if (status >= 400) {
      const skipReason = optionalSkipReason(route, status);
      if (skipReason) {
        skipped.push(`${route.name}: ${skipReason}`);
        return false;
      }
      throw new Error(`HTTP ${status}`);
    }

    if (shellState.appId !== route.expectedAppId) {
      throw new Error(`appId 不匹配，期望 ${route.expectedAppId}，实际 ${shellState.appId}`);
    }
    if (shellState.pageMode !== route.expectedPageMode) {
      throw new Error(`pageMode 不匹配，期望 ${route.expectedPageMode}，实际 ${shellState.pageMode}`);
    }
    if (shellState.windowVariant !== route.expectedWindowVariant) {
      throw new Error(`windowVariant 不匹配，期望 ${route.expectedWindowVariant}，实际 ${shellState.windowVariant}`);
    }

    if (route.requireShellLoaded && !shellState.mainLoaded) {
      throw new Error('shell core loaded flag 未就绪');
    }

    const appLoadedFlag = appLoadedFlagName(route.expectedAppId);
    if (appLoadedFlag) {
      const appLoaded = await page.evaluate((flag) => Boolean(window[flag]), appLoadedFlag);
      if (!appLoaded) {
        throw new Error(`${appLoadedFlag} 未就绪`);
      }
    }

    if (route.appRootSelector) {
      const count = await page.locator(route.appRootSelector).count();
      if (count < 1) {
        throw new Error(`缺少 app root: ${route.appRootSelector}`);
      }
    }

    if (route.appPropsSelector) {
      const count = await page.locator(route.appPropsSelector).count();
      if (count < 1) {
        throw new Error(`缺少 app props: ${route.appPropsSelector}`);
      }
    }

    const contentRootCount = await page.locator('[data-window-content-root]').count();
    if (route.expectedAppId && route.expectedAppId !== 'auth' && contentRootCount < 1) {
      throw new Error('缺少 data-window-content-root');
    }

    for (const selector of route.extraSelectors || []) {
      const count = await page.locator(selector).count();
      if (count < 1) {
        throw new Error(`缺少选择器: ${selector}`);
      }
    }

    if (pageErrors.length || consoleErrors.length || requestFailures.length) {
      const detail = [
        ...pageErrors.map((message) => `pageerror: ${message}`),
        ...consoleErrors.map((message) => `console.error: ${message}`),
        ...requestFailures.map((failure) => (
          `requestfailed: ${failure.method} ${failure.resourceType} ${failure.url} (${failure.errorText})`
        ))
      ].join(' | ');
      throw new Error(`页面存在运行时错误: ${detail}`);
    }

    return {
      status,
      appId: shellState.appId,
      pageMode: shellState.pageMode,
      windowVariant: shellState.windowVariant,
      waitUntil,
      usedFallback,
      pageErrors,
      consoleErrors,
      requestFailures
    };
  }

  async function validateLinksInteractions() {
    const route = {
      name: 'links-interactions',
      target: '/links',
      optional: !requirePluginRoutes,
      optionalFailure: 'plugin-unavailable',
      expectedAppId: 'links',
      expectedPageMode: 'browser-links',
      expectedWindowVariant: 'links',
      appRootSelector: '[data-app-root="links"]',
      appPropsSelector: 'script[data-app-props="links"]'
    };

    const runtimeErrors = createRuntimeErrorCollector();
    try {
      const baseValidation = await validateRoute(route);
      if (!baseValidation) return null;

      const firstCard = page.locator('.link-card').first();
      if (await firstCard.count() < 1) {
        runtimeErrors.assertEmpty('友链交互');
        return { ...baseValidation, ...runtimeErrors.snapshot() };
      }

      const totalCards = await page.locator('.link-card').count();
      const allLinksButton = page.locator('.links-sidebar-item').first();
      const totalBadge = Number(await allLinksButton.locator('.links-sidebar-count-pill').innerText());
      if (totalBadge !== totalCards) {
        throw new Error(`全部友链计数不稳定: badge=${totalBadge}, cards=${totalCards}`);
      }

      const renderedDescriptions = await page.locator('.link-card-desc').allTextContents();
      if (renderedDescriptions.some((value) => /<(?:br|strong)\b/i.test(value))) {
        throw new Error('友链描述仍显示上游 HTML 标签文本');
      }

      await page.locator('.links-toolbar-search').fill('http');
      await page.waitForTimeout(250);
      const visibleCards = await page.locator('.link-card:visible').count();
      if (visibleCards < 1) {
        throw new Error('搜索后未保留任何友链卡片');
      }
      await page.locator('.links-toolbar-search').fill('');

      const firstGroup = page.locator('[data-links-group]').first();
      if (await firstGroup.count() > 0) {
        const groupKey = await firstGroup.getAttribute('data-group-key');
        await firstGroup.click();
        await page.waitForFunction((key) => new URL(window.location.href).searchParams.get('group') === key, groupKey);
        if (Number(await allLinksButton.locator('.links-sidebar-count-pill').innerText()) !== totalCards) {
          throw new Error('切换分组后“全部友链”计数被错误改成筛选结果数');
        }

        await page.goBack();
        await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('group'));
        await page.goForward();
        await page.waitForFunction((key) => new URL(window.location.href).searchParams.get('group') === key, groupKey);
      }

      await page.goto(toAbsoluteUrl('/links?group=__missing_group__'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-app-root="links"]');
      await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('group'));
      if (await allLinksButton.getAttribute('aria-pressed') !== 'true') {
        throw new Error('非法友链分组没有回退到“全部友链”');
      }

      const emptyGroup = page.locator('[data-links-group][data-group-count="0"]').first();
      if (await emptyGroup.count() > 0) {
        await emptyGroup.click();
        await page.waitForSelector('.links-empty:visible');
        const emptyTitle = await page.locator('.links-empty:visible .links-empty-title').innerText();
        if (!emptyTitle.includes('该分组暂无友链')) {
          throw new Error(`空分组提示不准确: ${emptyTitle}`);
        }
        await allLinksButton.click();
      }

      const boardButton = page.locator('#nav-board');
      if (await boardButton.count() > 0) {
        await boardButton.click();
        await page.waitForFunction(() => new URL(window.location.href).searchParams.get('view') === 'board');
        await page.waitForSelector('#view-board:visible');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#view-board:visible');
        if (new URL(page.url()).searchParams.get('view') !== 'board') {
          throw new Error('留言板刷新后没有保留 view=board 深链状态');
        }
      }

      const feedApiRequests = [];
      await page.route('**/apis/api.link.halo.run/v1alpha1/linkfeeds**', async (requestRoute) => {
        const requestUrl = new URL(requestRoute.request().url());
        feedApiRequests.push(requestUrl);
        const source = requestUrl.searchParams.get('linkName') || '';
        const cursor = requestUrl.searchParams.get('beforeId') || '';
        const items = source
          ? [{
              id: 'feed-source-a',
              linkName: source,
              url: 'https://source-a.example/posts/filtered',
              title: '来源筛选动态',
              summary: '只显示当前来源。',
              author: '来源 A',
              authorUrl: 'https://source-a.example/',
              publishedAt: '2026-07-22T01:00:00Z'
            }]
          : cursor
            ? [{
                id: 'feed-3',
                linkName: 'source-c',
                url: 'https://source-c.example/posts/3',
                title: '游标续载动态',
                summary: '第二页动态。',
                author: '来源 C',
                authorUrl: 'https://source-c.example/',
                publishedAt: '2026-07-20T01:00:00Z'
              }]
            : [
                {
                  id: 'feed-1',
                  linkName: 'source-a',
                  url: 'https://source-a.example/posts/1',
                  title: '官方 RSS 动态一',
                  summary: 'PluginLinks 公开 feed 第一条。',
                  author: '来源 A',
                  authorUrl: 'https://source-a.example/',
                  publishedAt: '2026-07-22T01:00:00Z'
                },
                {
                  id: 'feed-2',
                  linkName: 'source-b',
                  url: 'https://source-b.example/posts/2',
                  title: '官方 RSS 动态二',
                  summary: 'PluginLinks 公开 feed 第二条。',
                  author: '来源 B',
                  authorUrl: 'https://source-b.example/',
                  publishedAt: '2026-07-21T01:00:00Z'
                }
              ];
        await requestRoute.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items,
            hasNext: !source && !cursor,
            nextBeforePublishedAt: !source && !cursor ? '2026-07-21T01:00:00Z' : '',
            nextBeforeId: !source && !cursor ? 'feed-2' : ''
          })
        });
      });

      const friendsButton = page.locator('.links-sidebar-item[aria-controls="view-friends"]').first();
      if (await friendsButton.count() < 1) {
        throw new Error('PluginLinks 2.2.1 友链页缺少朋友圈视图入口');
      }
      await friendsButton.click();
      await page.waitForSelector('#view-friends:visible');
      await page.waitForFunction(() => new URL(window.location.href).searchParams.get('view') === 'friends');

      const refreshFeedButton = page.locator('.links-toolbar-refresh');
      await page.waitForFunction(() => {
        const button = document.querySelector('.links-toolbar-refresh');
        return button && !button.disabled;
      });
      await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === '/apis/api.link.halo.run/v1alpha1/linkfeeds'),
        refreshFeedButton.click()
      ]);
      await page.waitForFunction(() => document.querySelectorAll('[data-feed-item]').length >= 2);
      if (await page.locator('.links-feed-skeleton, [data-feed-list] .skeleton').count() > 0) {
        throw new Error('朋友圈切换仍渲染骨架屏');
      }

      if (!feedApiRequests.some((requestUrl) => requestUrl.searchParams.get('beforeId') === 'feed-2')) {
        await page.waitForFunction(() => {
          const button = document.querySelector('.links-feed-more');
          return button && !button.disabled && getComputedStyle(button).display !== 'none';
        });
        await page.locator('.links-feed-more').click();
      }
      await page.waitForFunction(() => document.querySelectorAll('[data-feed-item]').length === 3);
      if (!feedApiRequests.some((requestUrl) => requestUrl.searchParams.get('beforePublishedAt')
        && requestUrl.searchParams.get('beforeId') === 'feed-2')) {
        throw new Error('朋友圈继续加载没有携带完整游标');
      }

      const sourceFilterButton = page.locator('[data-feed-item][data-feed-link-name="source-a"] .links-feed-source-action').first();
      await Promise.all([
        page.waitForResponse((response) => {
          const responseUrl = new URL(response.url());
          return responseUrl.pathname === '/apis/api.link.halo.run/v1alpha1/linkfeeds'
            && responseUrl.searchParams.get('linkName') === 'source-a';
        }),
        sourceFilterButton.click()
      ]);
      await page.waitForFunction(() => new URL(window.location.href).searchParams.get('linkName') === 'source-a');
      await page.waitForFunction(() => document.querySelectorAll('[data-feed-item]').length === 1);
      const sourceRequest = feedApiRequests.find((requestUrl) => requestUrl.searchParams.get('linkName') === 'source-a');
      if (!sourceRequest || sourceRequest.searchParams.has('groupName')) {
        throw new Error('朋友圈来源筛选错误地同时发送 linkName 与 groupName');
      }

      const submitButton = page.locator('.links-toolbar-apply').first();
      if (await submitButton.count() > 0) {
        const metadataPath = '/__link-metadata-smoke';
        const metadataUrl = toAbsoluteUrl(metadataPath);
        await page.route('**/apis/api.console.halo.run/v1alpha1/users/-*', async (requestRoute) => {
          await requestRoute.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ metadata: { name: 'anonymousUser' }, spec: { displayName: 'Anonymous' } })
          });
        });
        await page.route('**/__link-metadata-smoke*', async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname.endsWith('.svg')) {
            await route.fulfill({
              status: 200,
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#2563eb"/></svg>'
            });
            return;
          }
          if (url.pathname.endsWith('.json')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><html><head>
              <title>友链识别测试站</title>
              <meta name="description" content="纯前端识别&lt;strong&gt;测试&lt;/strong&gt;">
              <meta name="generator" content="Halo 2.25">
              <link rel="icon" href="${metadataPath}-logo.svg">
              <link rel="alternate" type="application/rss+xml" href="${metadataPath}-rss.xml">
            </head><body></body></html>`
          });
        });

        await submitButton.click();
        await page.waitForSelector('#link-submit-modal[open]');
        await page.locator('[data-link-meta-input]').fill(metadataUrl);
        await page.locator('[data-link-meta-action="autofill"]').click();
        await page.waitForFunction(() => document.querySelector('[data-link-field="displayName"]')?.value === '友链识别测试站');
        const metadataValues = await page.evaluate(() => ({
          description: document.querySelector('[data-link-field="description"]')?.value || '',
          logo: document.querySelector('[data-link-field="logo"]')?.value || '',
          rssUrl: document.querySelector('[data-link-field="rssUrl"]')?.value || '',
          platform: document.querySelector('.links-preview-platform')?.textContent || '',
          result: document.querySelector('.links-submit-result')?.textContent || ''
        }));
        if (metadataValues.description !== '纯前端识别 测试') {
          throw new Error(`友链描述识别或清理异常: ${metadataValues.description}`);
        }
        if (!metadataValues.logo.endsWith(`${metadataPath}-logo.svg`)
          || !metadataValues.rssUrl.endsWith(`${metadataPath}-rss.xml`)
          || !metadataValues.platform.includes('Halo')
          || metadataValues.result.trim() !== '') {
          throw new Error(`友链 Logo/RSS/平台识别异常: ${JSON.stringify(metadataValues)}`);
        }

        await page.locator('[data-link-meta-input]').fill(toAbsoluteUrl(`${metadataPath}.json`));
        await page.locator('[data-link-meta-action="autofill"]').click();
        await page.waitForFunction(() => document.querySelector('.links-submit-result')?.textContent?.includes('网址已保留'));
        if (await page.locator('[data-link-field="description"]').inputValue() !== '') {
          throw new Error('识别新网址失败后仍残留上一站点的描述');
        }
        await page.locator('.links-modal-close').click();
        await page.unroute('**/apis/api.console.halo.run/v1alpha1/users/-*');
        await page.unroute('**/__link-metadata-smoke*');
        await page.waitForTimeout(150);
      }

      await page.unroute('**/apis/api.link.halo.run/v1alpha1/linkfeeds**');

      runtimeErrors.assertEmpty('友链交互');
      return { ...baseValidation, ...runtimeErrors.snapshot() };
    } finally {
      runtimeErrors.stop();
    }
  }

  async function validateBangumiInvalidPage() {
    const baseResponse = await context.request.get(toAbsoluteUrl('/bangumis'), {
      failOnStatusCode: false
    });
    if (baseResponse.status() === 404) {
      if (requirePluginRoutes) {
        throw new Error('Bangumi 已进入严格插件清单，但 /bangumis 返回 404');
      }
      skipped.push('bangumis-invalid-page: plugin unavailable');
      return null;
    }

    const invalidPath = '/bangumis/page/not-a-number';
    const invalidResponse = await context.request.get(toAbsoluteUrl(invalidPath), {
      failOnStatusCode: false,
      maxRedirects: 0
    });
    if (invalidResponse.status() !== 404) {
      throw new Error(`Bangumi 1.4.1 非法页码应返回 404，实际 ${invalidResponse.status()}`);
    }

    return {
      status: invalidResponse.status(),
      expectedStatus: 404
    };
  }

  async function validateSearchInteraction() {
    const runtimeErrors = createRuntimeErrorCollector();
    try {
      const nav = await navigate({
        name: 'search-interaction',
        target: '/',
        optional: false,
        requireShellLoaded: false
      });
      if (nav.status >= 400) throw new Error(`HTTP ${nav.status}`);

      const button = page.locator('.menubar-search-btn').first();
      if (await button.count() < 1) {
        runtimeErrors.assertEmpty('搜索交互');
        if (requirePluginRoutes) {
          throw new Error('PluginSearchWidget 已进入严格插件清单，但首页缺少搜索入口');
        }
        skipped.push('search-interaction: PluginSearchWidget unavailable or disabled');
        return null;
      }

      await button.click();
      await page.waitForSelector('search-modal', { state: 'attached', timeout: 5_000 });
      await page.waitForFunction(() => {
        const findInput = (root) => {
          if (!root?.querySelectorAll) return null;
          for (const element of root.querySelectorAll('*')) {
            if (element.matches?.('input')) return element;
            const nested = findInput(element.shadowRoot);
            if (nested) return nested;
          }
          return null;
        };
        const input = findInput(document.querySelector('search-modal')?.shadowRoot);
        if (!input) return false;
        const rect = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      }, null, { timeout: 5_000 });
      await page.waitForTimeout(200);

      const firstState = await page.evaluate(() => ({
        modalCount: document.querySelectorAll('search-modal').length,
        styleInjected: Array.from(document.querySelectorAll('search-modal'))
          .some((modal) => Boolean(modal.shadowRoot?.getElementById('mac-search-style'))),
        inputVisible: Array.from(document.querySelectorAll('search-modal')).some((modal) => {
          const findInput = (root) => {
            if (!root?.querySelectorAll) return null;
            for (const element of root.querySelectorAll('*')) {
              if (element.matches?.('input')) return element;
              const nested = findInput(element.shadowRoot);
              if (nested) return nested;
            }
            return null;
          };
          const input = findInput(modal.shadowRoot);
          if (!input) return false;
          const rect = input.getBoundingClientRect();
          const style = getComputedStyle(input);
          return rect.width > 0 && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
        })
      }));
      assertSearchState(firstState);

      await button.click();
      await page.waitForTimeout(100);
      const modalCount = await page.locator('search-modal').count();
      if (modalCount !== 1) {
        throw new Error(`重复打开搜索不得产生多个 search-modal，实际 ${modalCount}`);
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(100);

      runtimeErrors.assertEmpty('搜索交互');
      return {
        status: nav.status,
        modalCount,
        styleInjected: firstState.styleInjected,
        inputVisible: firstState.inputVisible,
        ...runtimeErrors.snapshot()
      };
    } finally {
      runtimeErrors.stop();
    }
  }

  function assertSearchState(state) {
    if (state.modalCount !== 1) {
      throw new Error(`搜索打开后应有一个 search-modal，实际 ${state.modalCount}`);
    }
    if (!state.styleInjected) {
      throw new Error('搜索 Shadow DOM 缺少主题样式注入');
    }
    if (!state.inputVisible) {
      throw new Error('搜索组件已创建，但 Shadow DOM 输入框不可见');
    }
  }

  async function discoverHref(pagePath, selectors, matcher) {
    let response = null;
    try {
      response = await page.goto(toAbsoluteUrl(pagePath), {
        waitUntil: 'domcontentloaded',
        timeout: 20_000
      });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    } catch {
      return null;
    }
    if ((response?.status() ?? 0) >= 400) return null;

    const hrefs = await page.$$eval(selectors.join(', '), (elements) => (
      elements.map((element) => element.getAttribute('href')).filter(Boolean)
    ));

    return hrefs.find((href) => matcher(href)) || null;
  }

  const failures = [];
  const skipped = [];
  const discovered = {};
  const routeResults = [];

  for (const route of routes) {
    try {
      routeResults.push({ name: route.name, target: route.target, ...(await validateRoute(route)) });
    } catch (error) {
      const screenshot = await captureFailure(page, route.name);
      failures.push(`${route.name}: ${error.message} [${screenshot}]`);
    }
  }

  discovered.reader = (process.env.SMOKE_READER_PATH || '').trim()
    || await discoverHref('/archives', ['a[data-pjax-app="reader"]'], (href) => {
      const normalized = toPathname(href);
      return normalized.startsWith('/archives/') && normalized !== '/archives/';
    });

  discovered.tagDetail = (process.env.SMOKE_TAG_DETAIL_PATH || '').trim()
    || await discoverHref('/tags', ['a[href]'], (href) => {
      const normalized = toPathname(href);
      return normalized.startsWith('/tags/') && normalized !== '/tags/';
    });

  discovered.categoryDetail = (process.env.SMOKE_CATEGORY_DETAIL_PATH || '').trim()
    || await discoverHref('/categories', ['a[href]'], (href) => {
      const normalized = toPathname(href);
      return normalized.startsWith('/categories/') && normalized !== '/categories/';
    });

  discovered.authorDetail = (process.env.SMOKE_AUTHOR_PATH || '').trim();
  if (!discovered.authorDetail && discovered.reader) {
    discovered.authorDetail = await discoverHref(discovered.reader, ['a[href]'], (href) => {
      const normalized = toPathname(href);
      return normalized.startsWith('/authors/') && normalized !== '/authors/';
    });
  }

  discovered.momentDetail = (process.env.SMOKE_MOMENT_DETAIL_PATH || '').trim()
    || await discoverHref('/moments', ['a[href]'], (href) => {
      const normalized = toPathname(href);
      return normalized.startsWith('/moments/') && normalized !== '/moments/';
    });

  discovered.photosAlbums = await discoverHref('/photos', ['a[href]'], (href) => toPathname(href).includes('/photos?view=albums'));
  discovered.photosGroup = await discoverHref('/photos', ['a[href]'], (href) => toPathname(href).startsWith('/photos?group='));
  discovered.photoDetail = (process.env.SMOKE_PHOTO_DETAIL_PATH || '').trim()
    || await discoverHref('/photos', ['a[data-photo-name][href]'], (href) => {
      const normalized = toPathname(href);
      return normalized.startsWith('/photos/') && normalized !== '/photos/';
    });

  for (const [name, target] of Object.entries({
    'reader-detail': discovered.reader,
    'tag-detail': discovered.tagDetail,
    'category-detail': discovered.categoryDetail,
    'author-detail': discovered.authorDetail,
    'moment-detail': discovered.momentDetail,
    'photos-albums': discovered.photosAlbums,
    'photos-group': discovered.photosGroup,
    'photo-detail': discovered.photoDetail
  })) {
    if (!target) skipped.push(`${name}: sample missing (no matching href)`);
  }

  const discoveredRoutes = [
    discovered.reader
      ? {
          name: 'reader-detail',
          target: discovered.reader,
          optional: false,
          expectedAppId: 'reader',
          expectedPageMode: 'browser-reader',
          expectedWindowVariant: 'browser',
          appRootSelector: '[data-app-root="reader"]',
          appPropsSelector: 'script[data-app-props="reader"]'
        }
      : null,
    discovered.tagDetail
      ? {
          name: 'tag-detail',
          target: discovered.tagDetail,
          optional: false,
          expectedAppId: 'explorer-tags',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'browser',
          appRootSelector: '[data-app-root="explorer-tags"]',
          appPropsSelector: 'script[data-app-props="explorer-tags"]'
        }
      : null,
    discovered.categoryDetail
      ? {
          name: 'category-detail',
          target: discovered.categoryDetail,
          optional: false,
          expectedAppId: 'explorer-categories',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'browser',
          appRootSelector: '[data-app-root="explorer-categories"]',
          appPropsSelector: 'script[data-app-props="explorer-categories"]'
        }
      : null,
    discovered.authorDetail
      ? {
          name: 'author-detail',
          target: discovered.authorDetail,
          optional: false,
          expectedAppId: 'explorer-author',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'browser',
          appRootSelector: '[data-app-root="explorer-author"]',
          appPropsSelector: 'script[data-app-props="explorer-author"]'
        }
      : null,
    discovered.momentDetail
      ? {
          name: 'moment-detail',
          target: discovered.momentDetail,
          optional: false,
          expectedAppId: 'moments',
          expectedPageMode: 'browser-moments',
          expectedWindowVariant: 'moments',
          appRootSelector: '[data-app-root="moments"]',
          appPropsSelector: 'script[data-app-props="moments"]'
        }
      : null,
    discovered.photosAlbums
      ? {
          name: 'photos-albums',
          target: discovered.photosAlbums,
          optional: false,
          expectedAppId: 'photos',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'photos',
          appRootSelector: '[data-app-root="photos"]',
          appPropsSelector: 'script[data-app-props="photos"]'
        }
      : null,
    discovered.photosGroup
      ? {
          name: 'photos-group',
          target: discovered.photosGroup,
          optional: false,
          expectedAppId: 'photos',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'photos',
          appRootSelector: '[data-app-root="photos"]',
          appPropsSelector: 'script[data-app-props="photos"]'
        }
      : null,
    discovered.photoDetail
      ? {
          name: 'photo-detail',
          target: discovered.photoDetail,
          optional: false,
          expectedAppId: 'photos',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'photos',
          appRootSelector: '[data-app-root="photos"]',
          appPropsSelector: 'script[data-app-props="photos"]',
          extraSelectors: [
            '.photos-detail-shell',
            '.photos-detail-shell > .photos-sidebar[aria-label="图库导航"]',
            '.photos-detail-image',
            '.photos-detail-filmstrip',
            '.photos-detail-neighbor[aria-current="true"]'
          ]
        }
      : null
  ].filter(Boolean);

  for (const route of discoveredRoutes) {
    try {
      routeResults.push({ name: route.name, target: route.target, ...(await validateRoute(route)) });
    } catch (error) {
      const screenshot = await captureFailure(page, route.name);
      failures.push(`${route.name}: ${error.message} [${screenshot}]`);
    }
  }

  try {
    const interactionResult = await validateLinksInteractions();
    if (interactionResult) {
      routeResults.push({ name: 'links-interactions', target: '/links', ...interactionResult });
    }
  } catch (error) {
    const screenshot = await captureFailure(page, 'links-interactions');
    failures.push(`links-interactions: ${error.message} [${screenshot}]`);
  }

  try {
    const invalidPageResult = await validateBangumiInvalidPage();
    if (invalidPageResult) {
      routeResults.push({
        name: 'bangumis-invalid-page',
        target: '/bangumis/page/not-a-number',
        ...invalidPageResult
      });
    }
  } catch (error) {
    const screenshot = await captureFailure(page, 'bangumis-invalid-page');
    failures.push(`bangumis-invalid-page: ${error.message} [${screenshot}]`);
  }

  try {
    const searchResult = await validateSearchInteraction();
    if (searchResult) {
      routeResults.push({ name: 'search-interaction', target: '/', ...searchResult });
    }
  } catch (error) {
    const screenshot = await captureFailure(page, 'search-interaction');
    failures.push(`search-interaction: ${error.message} [${screenshot}]`);
  }

  const reportFile = await writeReport({
    baseUrl,
    cacheDisabled: true,
    assetRevision,
    skipped,
    discovered,
    routes: routeResults,
    failures
  });

  await Promise.allSettled([
    cdp.detach().catch(() => {}),
    page.close().catch(() => {}),
    context.close().catch(() => {}),
    browser.close().catch(() => {})
  ]);

  if (skipped.length) {
    console.log(`可选路由跳过: ${skipped.join(', ')}`);
  }

  if (failures.length) {
    console.error('\nPlaywright smoke 失败:\n');
    failures.forEach((failure) => console.error(`- ${failure}`));
    console.error(`\n详细报告: ${reportFile}`);
    process.exit(1);
  }

  console.log(`Playwright smoke 通过\n详细报告: ${reportFile}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
