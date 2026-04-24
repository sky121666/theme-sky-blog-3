import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'playwright');
const baseUrl = (process.env.SMOKE_BASE_URL || '').trim();

function toAbsoluteUrl(target) {
  return new URL(target, baseUrl).toString();
}

function toPathname(value) {
  try {
    return new URL(value, baseUrl).pathname + new URL(value, baseUrl).search;
  } catch {
    return '';
  }
}

function appLoadedFlagName(appId) {
  if (!appId) return '';
  return `__THEME_APP_${String(appId).replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_LOADED__`;
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
    console.log('跳过 Playwright smoke：未设置 SMOKE_BASE_URL');
    process.exit(0);
  }

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
      appPropsSelector: 'script[data-app-props="auth"]'
    },
    {
      name: 'moments',
      target: '/moments',
      optional: true,
      requireShellLoaded: true,
      expectedAppId: 'moments',
      expectedPageMode: 'browser-moments',
      expectedWindowVariant: 'moments',
      appRootSelector: '[data-app-root="moments"]',
      appPropsSelector: 'script[data-app-props="moments"]'
    },
    {
      name: 'friends',
      target: '/friends',
      optional: true,
      requireShellLoaded: true,
      expectedAppId: 'friends',
      expectedPageMode: 'browser-friends',
      expectedWindowVariant: 'friends',
      appRootSelector: '[data-app-root="friends"]',
      appPropsSelector: 'script[data-app-props="friends"]'
    },
    {
      name: 'links',
      target: '/links',
      optional: true,
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
      optional: true,
      requireShellLoaded: true,
      expectedAppId: 'bangumis',
      expectedPageMode: 'browser-bangumis',
      expectedWindowVariant: 'bangumis',
      appRootSelector: '[data-app-root="bangumis"]',
      appPropsSelector: 'script[data-app-props="bangumis"]'
    },
    {
      name: 'photos',
      target: '/photos',
      optional: true,
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
    viewport: { width: 1440, height: 960 }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  async function navigate(route) {
    const pageErrors = [];
    const consoleErrors = [];
    const handlePageError = (error) => {
      pageErrors.push(String(error?.message || error));
    };
    const handleConsole = (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    };

    page.on('pageerror', handlePageError);
    page.on('console', handleConsole);

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

      return { status, shellState, pageErrors, consoleErrors, waitUntil, usedFallback };
    } finally {
      page.off('pageerror', handlePageError);
      page.off('console', handleConsole);
    }
  }

  async function validateRoute(route) {
    const nav = await navigate(route);
    const { status, shellState, pageErrors, consoleErrors, waitUntil, usedFallback } = nav;

    if (status >= 400) {
      if (route.optional) {
        skipped.push(`${route.name}: ${status}`);
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

    if (pageErrors.length || consoleErrors.length) {
      const detail = [
        ...pageErrors.map((message) => `pageerror: ${message}`),
        ...consoleErrors.map((message) => `console.error: ${message}`)
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
      consoleErrors
    };
  }

  async function validateFriendsInteractions() {
    const route = {
      name: 'friends-interactions',
      target: '/friends',
      optional: true,
      expectedAppId: 'friends',
      expectedPageMode: 'browser-friends',
      expectedWindowVariant: 'friends',
      appRootSelector: '[data-app-root="friends"]',
      appPropsSelector: 'script[data-app-props="friends"]'
    };

    const nav = await navigate(route);
    if (nav.status >= 400) {
      if (route.optional) {
        skipped.push(`${route.name}: ${nav.status}`);
        return null;
      }
      throw new Error(`HTTP ${nav.status}`);
    }

    const baseValidation = await validateRoute(route);
    const firstCard = page.locator('.friends-feed-list > article').first();
    if (await firstCard.count() < 1) {
      return baseValidation;
    }

    const menuToggle = firstCard.locator('.friend-feed-action-toggle').first();
    await menuToggle.click();
    await page.waitForTimeout(150);

    const sourceFilter = firstCard.locator('.friend-feed-actions-menu a.pjax-link').first();
    if (await sourceFilter.count() < 1) {
      throw new Error('首条朋友圈缺少“只看此来源”入口');
    }

    const titleLink = firstCard.locator('.friend-feed-title-link').first();
    if (await titleLink.count() > 0) {
      const href = await titleLink.getAttribute('href');
      if (!href) {
        throw new Error('标题链接缺少 href');
      }
    }

    const authorLink = firstCard.locator('.friend-feed-author-link, .friend-feed-avatar-link').first();
    if (await authorLink.count() > 0) {
      const href = await authorLink.getAttribute('href');
      if (!href) {
        throw new Error('来源主页链接缺少 href');
      }
    }

    await sourceFilter.click();
    await page.waitForTimeout(1200);

    const pageMode = await page.evaluate(() => document.body?.dataset.pageMode || '');
    if (pageMode !== 'browser-friends') {
      throw new Error(`筛选后 pageMode 异常: ${pageMode}`);
    }

    const search = await page.evaluate(() => window.location.search || '');
    if (!search.includes('linkName=')) {
      throw new Error(`筛选后缺少 linkName 参数: ${search}`);
    }

    return baseValidation;
  }

  async function validateLinksInteractions() {
    const route = {
      name: 'links-interactions',
      target: '/links',
      optional: true,
      expectedAppId: 'links',
      expectedPageMode: 'browser-links',
      expectedWindowVariant: 'links',
      appRootSelector: '[data-app-root="links"]',
      appPropsSelector: 'script[data-app-props="links"]'
    };

    const nav = await navigate(route);
    if (nav.status >= 400) {
      if (route.optional) {
        skipped.push(`${route.name}: ${nav.status}`);
        return null;
      }
      throw new Error(`HTTP ${nav.status}`);
    }

    const baseValidation = await validateRoute(route);
    const firstCard = page.locator('.link-card').first();
    if (await firstCard.count() < 1) {
      return baseValidation;
    }

    await page.locator('.links-toolbar-search').fill('http');
    await page.waitForTimeout(250);
    const visibleCards = await page.locator('.link-card:visible').count();
    if (visibleCards < 1) {
      throw new Error('搜索后未保留任何友链卡片');
    }

    const submitButton = page.locator('.links-toolbar-apply').first();
    if (await submitButton.count() > 0) {
      await submitButton.click();
      await page.waitForSelector('#link-submit-modal[open]');
      await page.locator('.links-modal-close').click();
      await page.waitForTimeout(150);
    }

    return baseValidation;
  }

  async function discoverHref(pagePath, selectors, matcher) {
    const response = await page.goto(toAbsoluteUrl(pagePath), {
      waitUntil: 'networkidle',
      timeout: 20_000
    });
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

  const discoveredRoutes = [
    discovered.reader
      ? {
          name: 'reader-detail',
          target: discovered.reader,
          optional: true,
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
          optional: true,
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
          optional: true,
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
          optional: true,
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
          optional: true,
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
          optional: true,
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
          optional: true,
          expectedAppId: 'photos',
          expectedPageMode: 'browser-list',
          expectedWindowVariant: 'photos',
          appRootSelector: '[data-app-root="photos"]',
          appPropsSelector: 'script[data-app-props="photos"]'
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
    const interactionResult = await validateFriendsInteractions();
    if (interactionResult) {
      routeResults.push({ name: 'friends-interactions', target: '/friends', ...interactionResult });
    }
  } catch (error) {
    const screenshot = await captureFailure(page, 'friends-interactions');
    failures.push(`friends-interactions: ${error.message} [${screenshot}]`);
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

  const reportFile = await writeReport({ baseUrl, cacheDisabled: true, skipped, discovered, routes: routeResults, failures });

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
