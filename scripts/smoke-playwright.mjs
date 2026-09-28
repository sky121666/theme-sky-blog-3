import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';
import { readLiveBuildContext } from './lib/live-build-context.mjs';

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
  // A mounted theme's assets can be current while another theme renders the site.
  // This suite follows normal navigation, so require the target theme at its entry.
  const homeResponse = await fetch(toAbsoluteUrl('/'), {
    headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(10_000)
  });
  const homeHtml = await homeResponse.text();
  const shellAsset = String(localManifest['shell-core']?.js?.[0] || '');
  const shellPath = new URL(shellAsset, baseUrl).pathname;
  if (!homeResponse.ok || !homeHtml.replaceAll('\\/', '/').includes(shellPath)) {
    throw new Error(`当前首页未渲染目标主题 (${shellPath})；完整导航 smoke 需要目标主题运行环境，不能使用其他主题结果代替`);
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

async function waitForLinksHistoryNavigation(page, navigateHistory, expectedUrl) {
  // A popstate changes the URL before PJAX has fetched and swapped the page.
  // Starting the next history action at that point aborts the old /links XHR.
  // Links stores filters in history but PJAX requests the base /links document.
  const target = new URL(expectedUrl);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => {
      const requested = new URL(candidate.url());
      return requested.origin === target.origin && requested.pathname === target.pathname
        && candidate.request().method() === 'GET'
        && candidate.request().resourceType() === 'xhr';
    }),
    navigateHistory()
  ]);
  if (!response.ok()) throw new Error(`友链历史导航返回 HTTP ${response.status()} (${expectedUrl})`);
  const completionError = await response.finished();
  if (completionError) throw completionError;
  await page.waitForFunction((url) => {
    const frame = document.getElementById('window-frame-root');
    return window.location.href === url && frame && !frame.classList.contains('pjax-loading');
  }, expectedUrl);
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
  // The caller reports screenshotError without masking the original case.
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function writeReport(report) {
  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, 'smoke-report.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

const smokeFailureSnapshots = new WeakMap();

function rememberSmokeFailure(error, snapshot) {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    const previous = smokeFailureSnapshots.get(error) || {};
    // An outer collector covers more events, but may not know the document
    // response observed by an inner navigation/route check.
    const observed = Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value != null));
    smokeFailureSnapshots.set(error, structuredClone({ ...previous, ...observed }));
  }
}

function smokeFailureResult(name, target, error, screenshot) {
  const snapshot = error && (typeof error === 'object' || typeof error === 'function')
    ? smokeFailureSnapshots.get(error) : null;
  return {
    name, target, status: 'failed',
    error: { name: String(error?.name || 'Error'), message: String(error?.message || error) },
    screenshot,
    runtimeSnapshotAvailable: Boolean(snapshot),
    snapshotAt: snapshot?.snapshotAt || null,
    httpStatus: typeof snapshot?.status === 'number' ? snapshot.status : null,
    domContentLoaded: snapshot?.domContentLoaded ?? null,
    documentReadyState: snapshot?.documentReadyState ?? null,
    pageErrors: snapshot?.pageErrors ?? null,
    consoleErrors: snapshot?.consoleErrors ?? null,
    requestFailures: snapshot?.requestFailures ?? null,
    responseErrors: snapshot?.responseErrors ?? null,
    expectedErrors: snapshot?.expectedErrors ?? null,
    pendingRequests: snapshot?.pendingRequests ?? null,
    pluginResources: snapshot?.pluginResources ?? null,
    networkObservation: snapshot
      ? 'Only observed events are recorded; missing response/body progress remains unknown.'
      : 'unknown: no runtime/network snapshot was collected for this failure'
  };
}

function smokeDiagnosticUrl(value) {
  try {
    const url = new URL(value, baseUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return '<unparseable-url>'; }
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
  const buildContext = await readLiveBuildContext(baseUrl);
  const expectedRuntimeErrors = [];
  console.log(`Assets revision 已对齐: ${assetRevision.version}/${assetRevision.revision}`);

  const routes = [
    {
      name: 'home',
      target: '/',
      optional: false,
      requireShellLoaded: true,
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
  let context, page, cdp;
  try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    // The Douban image proxy blocks HeadlessChrome while serving a valid JPEG
    // to ordinary Chrome. Keep the engine headless but use a real-user UA.
    userAgent: realChromeUserAgent(browser)
  });
  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  function createRuntimeErrorCollector(route = null, { recordExpectedGlobally = true } = {}) {
    const pageErrors = [];
    const consoleErrors = [];
    const requestFailures = [];
    const responseErrors = [];
    const expectedErrors = [];
    const pendingRequests = new Map();
    const pluginResources = new Map();
    const isPluginResource = (url) => {
      try { return new URL(url, baseUrl).pathname.startsWith('/plugins/'); }
      catch { return false; }
    };
    const expect = (kind, value, reason) => {
      const entry = { kind, value, reason };
      expectedErrors.push(entry);
      if (recordExpectedGlobally) expectedRuntimeErrors.push(entry);
    };
    const expectedHttp = (url, status, method = 'GET', resourceType = '') => {
      if (knownStaleContentUrls.has(url)) return 'registered-stale-content-url';
      if (route && resourceType === 'document' && url === toAbsoluteUrl(route.target)
        && optionalSkipReason(route, status)) return 'optional-route-unavailable';
      const parsed = new URL(url, baseUrl);
      // Anonymous contexts intentionally probe the current-user endpoint; see
      // window-manager.js fetchCurrentUser and links/runtime.js current user.
      if (method === 'GET' && [401, 403].includes(status) && parsed.origin === new URL(baseUrl).origin
        && parsed.pathname === '/apis/api.console.halo.run/v1alpha1/users/-' && !parsed.search) return 'anonymous-current-user-probe';
      return '';
    };
    const handlePageError = (error) => {
      pageErrors.push(String(error?.message || error));
    };
    const handleConsole = (message) => {
      if (message.type() !== 'error') return;
      const value = { text: message.text(), url: message.location()?.url || '' };
      if (isExternalUploadResourceError(message)) return expect('consoleErrors', value, 'registered-stale-content-url');
      const status = /^Failed to load resource:.*\b(4\d\d|5\d\d)\b/.exec(value.text)?.[1];
      const reason = status && expectedHttp(value.url, Number(status), 'GET', 'document');
      if (reason) return expect('consoleErrors', value, reason);
      consoleErrors.push(message.text());
    };
    const handleRequest = (request) => {
      pendingRequests.set(request, {
        method: request.method(), resourceType: request.resourceType(),
        url: smokeDiagnosticUrl(request.url()), startedAt: new Date().toISOString(),
        responseStatus: null, responseState: 'unknown', responseReceivedAt: null,
        bodyCompletion: 'unknown'
      });
      if (isPluginResource(request.url())) {
        pluginResources.set(request, {
          method: request.method(), resourceType: request.resourceType(),
          url: smokeDiagnosticUrl(request.url()), state: 'pending',
          status: null, errorText: null
        });
      }
    };
    const handleRequestFinished = (request) => {
      pendingRequests.delete(request);
      const resource = pluginResources.get(request);
      if (resource) resource.state = 'finished';
    };
    const handleRequestFailed = (request) => {
      // Navigation can abort a request that started on the previous page.
      // Attribute only requests observed by this route's collector.
      if (!pendingRequests.has(request)) return;
      pendingRequests.delete(request);
      const resource = pluginResources.get(request);
      if (resource) {
        resource.state = 'failed';
        resource.errorText = String(request.failure()?.errorText || 'unknown request failure');
      }
      const failure = {
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        errorText: String(request.failure()?.errorText || 'unknown request failure')
      };
      if (isIgnoredRequestFailure(request)) return expect('requestFailures', failure, 'registered-stale-content-url');
      requestFailures.push(failure);
    };
    const handleResponse = (response) => {
      const pending = pendingRequests.get(response.request());
      if (!pending) return;
      pending.responseStatus = response.status();
      pending.responseState = 'observed';
      pending.responseReceivedAt = new Date().toISOString();
      const resource = pluginResources.get(response.request());
      if (resource) {
        resource.state = 'response';
        resource.status = response.status();
      }
      if (response.status() < 400) return;
      const failure = {
        method: response.request().method(),
        resourceType: response.request().resourceType(),
        status: response.status(),
        url: response.url()
      };
      const reason = expectedHttp(failure.url, failure.status, failure.method, failure.resourceType);
      if (reason) return expect('responseErrors', failure, reason);
      responseErrors.push(failure);
    };

    page.on('pageerror', handlePageError);
    page.on('console', handleConsole);
    page.on('request', handleRequest);
    page.on('requestfinished', handleRequestFinished);
    page.on('requestfailed', handleRequestFailed);
    page.on('response', handleResponse);

    return {
      snapshot() {
        const observedPlugins = Array.from(pluginResources.values(), (resource) => ({ ...resource }));
        return {
          snapshotAt: new Date().toISOString(),
          pageErrors: [...pageErrors],
          consoleErrors: [...consoleErrors],
          requestFailures: requestFailures.map((failure) => ({ ...failure })),
          responseErrors: responseErrors.map((failure) => ({ ...failure })),
          expectedErrors: expectedErrors.map((failure) => ({ ...failure })),
          pendingRequests: Array.from(pendingRequests.values(), (request) => ({ ...request })),
          pluginResources: {
            pending: observedPlugins.filter((resource) => ['pending', 'response'].includes(resource.state)),
            failed: observedPlugins.filter((resource) => resource.state === 'failed' || resource.status >= 400),
            completed: observedPlugins.filter((resource) => resource.state === 'finished'
              && typeof resource.status === 'number' && resource.status < 400)
          }
        };
      },
      assertEmpty(scope) {
        if (!pageErrors.length && !consoleErrors.length && !requestFailures.length && !responseErrors.length) return;
        const detail = [
          ...pageErrors.map((message) => `pageerror: ${message}`),
          ...consoleErrors.map((message) => `console.error: ${message}`),
          ...requestFailures.map((failure) => (
            `requestfailed: ${failure.method} ${failure.resourceType} ${failure.url} (${failure.errorText})`
          )),
          ...responseErrors.map((failure) => (
            `response: ${failure.method} ${failure.resourceType} ${failure.url} (HTTP ${failure.status})`
          ))
        ].join(' | ');
        throw new Error(`${scope}存在运行时错误: ${detail}`);
      },
      stop() {
        page.off('pageerror', handlePageError);
        page.off('console', handleConsole);
        page.off('request', handleRequest);
        page.off('requestfinished', handleRequestFinished);
        page.off('requestfailed', handleRequestFailed);
        page.off('response', handleResponse);
      }
    };
  }

  async function navigate(route) {
    const runtimeErrors = createRuntimeErrorCollector(route);
    let observedStatus = null;
    let domContentLoaded = false;
    const onDomContentLoaded = () => { domContentLoaded = true; };
    page.on('domcontentloaded', onDomContentLoaded);

    try {
      const response = await page.goto(toAbsoluteUrl(route.target), {
        waitUntil: 'commit', timeout: 20_000
      });
      const status = response?.status() ?? 0;
      observedStatus = response ? status : null;
      if (status < 400) {
        await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 15_000 });
        await page.locator('body[data-page-mode]').waitFor({ timeout: 15_000 });
        if (route.expectedPageMode !== 'auth') {
          await page.waitForFunction(
            () => window.__THEME_MAIN_LOADED__ === true
              && window.__THEME_ALPINE_STARTED__ === true
              && window.__THEME_BOOTSTRAP_CANCELLED__ !== true,
            null,
            { timeout: 15_000 }
          );
        }
        const appLoadedFlag = appLoadedFlagName(route.expectedAppId);
        if (appLoadedFlag) {
          await page.waitForFunction((flag) => window[flag] === true, appLoadedFlag, { timeout: 10_000 });
        }
        // Auth hydration is scheduled on DOMContentLoaded by auth/entry.js.
        if (route.expectedPageMode === 'auth') {
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        }
        await page.waitForTimeout(route.settleTimeMs ?? 1200);
      }

      const shellState = status >= 400 ? {
        appId: '', pageMode: '', windowVariant: '', mainLoaded: false
      } : await page.evaluate(() => ({
        appId: document.body?.dataset.appId || '',
        pageMode: document.body?.dataset.pageMode || '',
        windowVariant: document.body?.dataset.windowVariant || '',
        mainLoaded: window.__THEME_MAIN_LOADED__ === true
          && window.__THEME_ALPINE_STARTED__ === true
          && window.__THEME_BOOTSTRAP_CANCELLED__ !== true
      }));
      const documentReadyState = status >= 400 ? null : await page.evaluate(() => document.readyState);

      return {
        status, shellState, ...runtimeErrors.snapshot(),
        waitUntil: 'commit', usedFallback: false, domContentLoaded, documentReadyState
      };
    } catch (error) {
      const documentReadyState = observedStatus === null ? null
        : await page.evaluate(() => document.readyState).catch(() => null);
      rememberSmokeFailure(error, {
        ...runtimeErrors.snapshot(), status: observedStatus,
        domContentLoaded: observedStatus === null ? null : domContentLoaded,
        documentReadyState
      });
      throw error;
    } finally {
      page.off('domcontentloaded', onDomContentLoaded);
      runtimeErrors.stop();
    }
  }

  async function validateRoute(route) {
    // Keep observing through protocol and selector checks: a pending plugin
    // resource can fail after the theme has become ready.
    const runtimeErrors = createRuntimeErrorCollector(route, { recordExpectedGlobally: false });
    let nav = null;
    try {
    nav = await navigate(route);
    const { status, shellState, waitUntil, usedFallback, domContentLoaded, documentReadyState } = nav;

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

    if (route.expectedPageMode !== 'auth' && !shellState.mainLoaded) {
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

    const routeSnapshot = runtimeErrors.snapshot();
    const routeErrors = runtimeErrorMessages(routeSnapshot);
    if (routeErrors.length) {
      throw new Error(`页面存在运行时错误: ${routeErrors.join(' | ')}`);
    }

    return {
      status,
      appId: shellState.appId,
      pageMode: shellState.pageMode,
      windowVariant: shellState.windowVariant,
      waitUntil,
      usedFallback,
      domContentLoaded,
      documentReadyState,
      pageErrors: routeSnapshot.pageErrors,
      consoleErrors: routeSnapshot.consoleErrors,
      responseErrors: routeSnapshot.responseErrors,
      expectedErrors: routeSnapshot.expectedErrors,
      requestFailures: routeSnapshot.requestFailures,
      pluginResources: routeSnapshot.pluginResources
    };
    } catch (error) {
      rememberSmokeFailure(error, { ...nav, ...runtimeErrors.snapshot(), status: nav?.status });
      throw error;
    } finally {
      runtimeErrors.stop();
    }
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

      const firstCard = page.locator('[data-link-card]').first();
      if (await firstCard.count() < 1) {
        runtimeErrors.assertEmpty('友链交互');
        return { ...baseValidation, ...runtimeErrors.snapshot() };
      }

      const totalCards = await page.locator('[data-link-card]').count();
      const allLinksButton = page.locator('.links-rail-button[title="链接"]').first();
      const totalBadge = Number(await allLinksButton.locator('.links-rail-badge').innerText());
      if (totalBadge !== totalCards) {
        throw new Error(`全部友链计数不稳定: badge=${totalBadge}, cards=${totalCards}`);
      }

      const renderedDescriptions = await page.locator('.link-card-desc').allTextContents();
      if (renderedDescriptions.some((value) => /<(?:br|strong)\b/i.test(value))) {
        throw new Error('友链描述仍显示上游 HTML 标签文本');
      }

      const firstLinkName = await firstCard.getAttribute('data-link-name') || '';
      await page.locator('.links-search').fill(firstLinkName.slice(0, Math.max(1, Math.min(3, firstLinkName.length))));
      await page.waitForTimeout(250);
      const visibleCards = await page.locator('[data-link-card]:visible').count();
      if (visibleCards < 1) {
        throw new Error('搜索后未保留任何友链卡片');
      }
      await page.locator('.links-search').fill('');

      const firstGroup = page.locator('.links-group-filter option[data-links-group]').first();
      if (await firstGroup.count() > 0) {
        const groupKey = await firstGroup.getAttribute('data-group-key');
        await page.locator('.links-group-filter select').selectOption(groupKey);
        await page.waitForFunction((key) => new URL(window.location.href).searchParams.get('group') === key, groupKey);
        const groupUrl = page.url();
        if (Number(await allLinksButton.locator('.links-rail-badge').innerText()) !== totalCards) {
          throw new Error('切换分组后“全部友链”计数被错误改成筛选结果数');
        }

        await waitForLinksHistoryNavigation(page, () => page.goBack(), toAbsoluteUrl('/links'));
        await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('group'));
        await waitForLinksHistoryNavigation(page, () => page.goForward(), groupUrl);
        await page.waitForFunction((key) => new URL(window.location.href).searchParams.get('group') === key, groupKey);
      }

      await page.goto(toAbsoluteUrl('/links?group=__missing_group__'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-app-root="links"]');
      await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('group'));
      if (await allLinksButton.getAttribute('aria-pressed') !== 'true') {
        throw new Error('非法友链分组没有回退到“全部友链”');
      }

      const emptyGroup = page.locator('.links-group-filter option[data-links-group][data-group-count="0"]').first();
      if (await emptyGroup.count() > 0) {
        const emptyGroupKey = await emptyGroup.getAttribute('data-group-key');
        await page.locator('.links-group-filter select').selectOption(emptyGroupKey);
        await page.waitForSelector('.links-list-empty:visible');
        const emptyTitle = await page.locator('.links-list-empty:visible strong').innerText();
        if (!emptyTitle.includes('该分组暂无友链')) {
          throw new Error(`空分组提示不准确: ${emptyTitle}`);
        }
        await page.locator('.links-group-filter select').selectOption('');
      }

      await page.waitForSelector('[data-link-card]:visible');
      const firstLinkKey = await page.locator('[data-link-card]:visible').first().getAttribute('data-link-key');
      const compactWidth = await page.locator('[data-window-surface]').evaluate((element) => element.getBoundingClientRect().width);
      await page.locator('[data-link-card]:visible').first().click();
      await page.waitForFunction((key) => new URL(window.location.href).searchParams.get('link') === key, firstLinkKey);
      const detailUrl = page.url();
      await page.waitForSelector('.links-detail-pane:visible');
      await page.waitForFunction((width) => {
        const surface = document.querySelector('[data-window-surface]');
        return surface && surface.getBoundingClientRect().width > width + 200;
      }, compactWidth);
      await waitForLinksHistoryNavigation(page, () => page.goBack(), toAbsoluteUrl('/links'));
      await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('link'));
      await page.waitForFunction((width) => {
        const surface = document.querySelector('[data-window-surface]');
        return surface && surface.getBoundingClientRect().width <= width + 2;
      }, compactWidth);
      await waitForLinksHistoryNavigation(page, () => page.goForward(), detailUrl);
      await page.waitForFunction((key) => new URL(window.location.href).searchParams.get('link') === key, firstLinkKey);
      await page.waitForSelector('.links-detail-pane:visible');
      await page.locator('.links-detail-close').click();
      await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('link'));

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

      const friendsButton = page.locator('.links-rail-button[aria-controls="view-friends"]').first();
      if (await friendsButton.count() < 1) {
        throw new Error('PluginLinks 2.3.0 友链页缺少朋友圈视图入口');
      }
      await friendsButton.click();
      await page.waitForFunction(() => new URL(window.location.href).searchParams.get('view') === 'friends');
      await page.waitForSelector('.links-feed-all-row:visible');
      if (feedApiRequests.length !== 0) {
        throw new Error('朋友圈来源列表不应提前请求动态正文');
      }

      await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === '/apis/api.link.halo.run/v1alpha1/linkfeeds'),
        page.locator('.links-feed-all-row').click()
      ]);
      await page.waitForFunction(() => new URL(window.location.href).searchParams.get('scope') === 'all');
      await page.waitForSelector('#view-friends:visible');

      const refreshFeedButton = page.locator('.links-detail-action[aria-label="刷新动态"]');
      await page.waitForFunction(() => {
        const button = document.querySelector('.links-detail-action[aria-label="刷新动态"]');
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

      // Fixture pagination must follow the rendered cards after refresh.
      // A prior cursor request may have been cancelled by the refresh while
      // remaining in the request log; it does not prove the third card exists.
      await page.waitForFunction(() => {
        if (document.querySelectorAll('[data-feed-item]').length >= 3) return true;
        const button = document.querySelector('.links-feed-more');
        return button && !button.disabled && getComputedStyle(button).display !== 'none';
      });
      if (await page.locator('[data-feed-item]').count() < 3) {
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

      const submitButton = page.locator('.links-list-add').first();
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
        await page.waitForFunction(() => new URL(window.location.href).searchParams.get('view') === 'apply');
        await page.waitForSelector('#view-apply:visible');
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
        await page.locator('.links-detail-close').click();
        await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('view'));
        await page.unroute('**/apis/api.console.halo.run/v1alpha1/users/-*');
        await page.unroute('**/__link-metadata-smoke*');
        await page.waitForTimeout(150);
      }

      await page.unroute('**/apis/api.link.halo.run/v1alpha1/linkfeeds**');

      runtimeErrors.assertEmpty('友链交互');
      return { ...baseValidation, ...runtimeErrors.snapshot() };
    } catch (error) {
      rememberSmokeFailure(error, runtimeErrors.snapshot());
      throw error;
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
    let observedStatus = null;
    try {
      const nav = await navigate({
        name: 'search-interaction',
        target: '/',
        optional: false,
        requireShellLoaded: true
      });
      observedStatus = nav.status;
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
    } catch (error) {
      rememberSmokeFailure(error, { ...runtimeErrors.snapshot(), status: observedStatus });
      throw error;
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
    let documentResponse = null;
    let documentRequest = null;
    const ssrOnly = (route) => route.request().resourceType() === 'document'
      ? route.continue()
      : route.abort();
    const runtimeErrors = createRuntimeErrorCollector(null, { recordExpectedGlobally: false });
    const recordDocumentResponse = (candidate) => {
      if (candidate.request().resourceType() !== 'document') return;
      documentRequest = candidate.request();
      documentResponse = {
        url: smokeDiagnosticUrl(candidate.url()),
        status: candidate.status(),
        observedAt: new Date().toISOString(),
        bodyCompletion: 'unknown'
      };
    };
    const recordDocumentFinished = (request) => {
      if (request === documentRequest) documentResponse.bodyCompletion = 'finished';
    };
    const recordDocumentFailed = (request) => {
      if (request === documentRequest) documentResponse.bodyCompletion = 'failed';
    };
    const networkSnapshot = () => {
      const snapshot = runtimeErrors.snapshot();
      return {
        snapshotAt: snapshot.snapshotAt,
        pageErrors: snapshot.pageErrors,
        consoleErrors: snapshot.consoleErrors,
        requestFailures: snapshot.requestFailures.map((failure) => ({
          ...failure, url: smokeDiagnosticUrl(failure.url)
        })),
        responseErrors: snapshot.responseErrors.map((failure) => ({
          ...failure, url: smokeDiagnosticUrl(failure.url)
        })),
        pendingRequests: snapshot.pendingRequests
      };
    };
    page.on('response', recordDocumentResponse);
    page.on('requestfinished', recordDocumentFinished);
    page.on('requestfailed', recordDocumentFailed);
    // Discovery reads server-rendered links only. Avoid waiting for unrelated
    // plugin styles or scripts before the parser reaches those links.
    await page.route('**/*', ssrOnly);
    try {
      response = await page.goto(toAbsoluteUrl(pagePath), {
        // A plugin's deferred script can delay DOMContentLoaded after the
        // theme's document has parsed. Discovery only needs server HTML links.
        waitUntil: 'commit',
        timeout: 20_000
      });
      await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 10_000 });
    } catch (error) {
      const message = String(error?.message || error);
      discoveryErrors.push({
        pagePath, phase: 'navigation', message,
        documentResponse, networkSnapshot: networkSnapshot()
      });
      failures.push(`sample-discovery ${pagePath}: ${message}`);
      return null;
    } finally {
      await page.unroute('**/*', ssrOnly);
      page.off('response', recordDocumentResponse);
      page.off('requestfinished', recordDocumentFinished);
      page.off('requestfailed', recordDocumentFailed);
      runtimeErrors.stop();
    }
    if ((response?.status() ?? 0) >= 400) {
      if (response.status() !== 404) {
        discoveryErrors.push({
          pagePath, phase: 'http', status: response.status(),
          documentResponse, networkSnapshot: networkSnapshot()
        });
        failures.push(`sample-discovery ${pagePath}: HTTP ${response.status()}`);
      }
      return null;
    }

    const hrefs = await page.$$eval(selectors.join(', '), (elements) => (
      elements.map((element) => element.getAttribute('href')).filter(Boolean)
    ));

    return hrefs.find((href) => matcher(href)) || null;
  }

  const failures = [];
  const skipped = [];
  const discovered = {};
  const discoveryErrors = [];
  const routeResults = [];

  async function recordCaseFailure(name, target, error) {
    const result = smokeFailureResult(name, target, error, null);
    routeResults.push(result);
    const failureIndex = failures.push(`${name}: ${result.error.message}`) - 1;
    try {
      result.screenshot = await captureFailure(page, name);
      failures[failureIndex] += ` [${result.screenshot}]`;
    } catch (screenshotError) {
      result.screenshotError = String(screenshotError?.message || screenshotError);
    }
  }

  for (const route of routes) {
    try {
      routeResults.push({ name: route.name, target: route.target, ...(await validateRoute(route)) });
    } catch (error) {
      await recordCaseFailure(route.name, route.target, error);
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
    if (!target) skipped.push(`${name}: sample unavailable (see discoveryErrors for navigation failures)`);
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
      await recordCaseFailure(route.name, route.target, error);
    }
  }

  try {
    const interactionResult = await validateLinksInteractions();
    if (interactionResult) {
      routeResults.push({ name: 'links-interactions', target: '/links', ...interactionResult });
    }
  } catch (error) {
    await recordCaseFailure('links-interactions', '/links', error);
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
    await recordCaseFailure('bangumis-invalid-page', '/bangumis/page/not-a-number', error);
  }

  try {
    const searchResult = await validateSearchInteraction();
    if (searchResult) {
      routeResults.push({ name: 'search-interaction', target: '/', ...searchResult });
    }
  } catch (error) {
    await recordCaseFailure('search-interaction', '/', error);
  }

  const reportFile = await writeReport({
    baseUrl,
    cacheDisabled: true,
    assetRevision,
    buildContext,
    expectedRuntimeErrors,
    skipped,
    discovered,
    discoveryErrors,
    routes: routeResults,
    failures
  });

  if (skipped.length) {
    console.log(`可选路由跳过: ${skipped.join(', ')}`);
  }

  if (failures.length) {
    console.error('\nPlaywright smoke 失败:\n');
    failures.forEach((failure) => console.error(`- ${failure}`));
    console.error(`\n详细报告: ${reportFile}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Playwright smoke 通过\n详细报告: ${reportFile}`);
  process.exitCode = 0;
  } finally {
    await Promise.allSettled([
      cdp?.detach(), page?.close(), context?.close(), browser.close()
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
