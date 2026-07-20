import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(process.env.SMOKE_BASE_URL || '').trim();
const configuredCategoriesPath = String(process.env.CATEGORIES_BASE_PATH || '/categories').trim();
const categoriesBasePath = `/${configuredCategoriesPath.replace(/^\/+|\/+$/g, '') || 'categories'}`;

if (!baseUrl) {
  console.log('跳过分类真页验证：未设置 SMOKE_BASE_URL');
  process.exit(0);
}

function absoluteUrl(target) {
  return new URL(target, baseUrl).toString();
}

function withoutTrailingSlash(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function categoryPagePath(categoryPath, pageNumber) {
  return `${withoutTrailingSlash(categoryPath)}/page/${pageNumber}`;
}

function unique(values) {
  return [...new Set(values)];
}

async function waitForPjax(page) {
  await page.waitForFunction(() => Boolean(window.pjax), null, { timeout: 15_000 });
}

async function waitForCategoryRoot(page) {
  await page.waitForSelector('[data-app-root="explorer-categories"] [data-category-root]', { timeout: 15_000 });
  await page.waitForFunction((expectedPath) => (
    (location.pathname.length > 1 ? location.pathname.replace(/\/+$/, '') : location.pathname) === expectedPath
    && document.body?.dataset.pageApp === 'explorer-categories'
    && Boolean(document.querySelector('[data-app-root="explorer-categories"] [data-category-root]'))
  ), categoriesBasePath, { timeout: 15_000 });
}

async function waitForCategoryDetail(page, expected = {}) {
  await page.waitForSelector('[data-app-root="explorer-categories"] .category-workspace', { timeout: 15_000 });
  await page.waitForFunction(({ pathname, categoryName, pageNumber }) => {
    const root = document.querySelector('[data-app-root="explorer-categories"] .category-workspace');
    const normalizePath = (value) => value?.length > 1 ? value.replace(/\/+$/, '') : value;
    if (!root || document.body?.dataset.pageApp !== 'explorer-categories') return false;
    if (pathname && normalizePath(location.pathname) !== normalizePath(pathname)) return false;
    if (categoryName && root.dataset.categoryName !== categoryName) return false;
    if (pageNumber && Number(root.dataset.categoryCurrentPage || 0) !== pageNumber) return false;
    return true;
  }, expected, { timeout: 15_000 });
}

async function rootState(page) {
  return page.evaluate(() => {
    const describeLinks = (selector) => Array.from(document.querySelectorAll(selector)).map((node) => {
      const url = new URL(node.getAttribute('href') || '', location.href);
      const countMatch = (node.getAttribute('aria-label') || '').match(/(\d+)\s*篇/);
      return {
        tagName: node.tagName,
        href: node.getAttribute('href') || '',
        pathname: url.pathname,
        sameOrigin: url.origin === location.origin,
        pjaxApp: node.dataset.pjaxApp || '',
        count: Number(countMatch?.[1] || 0)
      };
    });

    return {
      appId: document.body?.dataset.pageApp || '',
      sidebarLinks: describeLinks('[data-category-root] [data-category-link]'),
      overviewLinks: describeLinks('[data-category-root] [data-category-overview-link]')
    };
  });
}

async function detailState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-app-root="explorer-categories"] .category-workspace');
    const pathOf = (node) => node ? new URL(node.getAttribute('href') || '', location.href).pathname : '';
    const treeLinks = Array.from(root?.querySelectorAll('[data-category-link]') || []);
    const currentLinks = treeLinks.filter((node) => node.getAttribute('aria-current') === 'page');
    const posts = Array.from(root?.querySelectorAll('[data-category-post-option]') || []);
    const next = root?.querySelector('[data-category-next]');
    const previous = root?.querySelector('[data-category-prev]');

    return {
      pathname: location.pathname,
      appId: document.body?.dataset.pageApp || '',
      categoryName: root?.dataset.categoryName || '',
      currentPage: Number(root?.dataset.categoryCurrentPage || 0),
      totalPages: Number(root?.dataset.categoryTotalPages || 0),
      treePaths: treeLinks.map(pathOf),
      currentPaths: currentLinks.map(pathOf),
      postKeys: posts.map((node) => node.dataset.postKey || ''),
      nextPath: pathOf(next),
      previousPath: pathOf(previous),
      marker: document.documentElement.dataset.categoryVerifyMarker || ''
    };
  });
}

async function clickCategoryPath(page, pathname) {
  const links = page.locator('[data-category-root] [data-category-overview-link]');
  const index = await links.evaluateAll((nodes, expectedPath) => nodes.findIndex((node) => (
    new URL(node.getAttribute('href') || '', location.href).pathname === expectedPath
  )), pathname);
  assert.ok(index >= 0, `分类根页必须包含候选分类链接：${pathname}`);
  await links.nth(index).click();
}

async function inspectResponsiveLayout(page) {
  return page.evaluate(() => {
    const isVisible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const documentElement = document.documentElement;
    const preview = document.querySelector('.category-preview-pane');
    const postsPane = document.querySelector('.category-posts-pane');
    const postsRect = postsPane?.getBoundingClientRect();
    const visiblePanes = Array.from(document.querySelectorAll('.category-folder-pane, .category-posts-pane'))
      .filter(isVisible)
      .map((node) => node.getBoundingClientRect());

    return {
      overflow: documentElement.scrollWidth > documentElement.clientWidth + 1,
      panesContained: visiblePanes.every((rect) => rect.left >= -1 && rect.right <= window.innerWidth + 1),
      previewVisible: isVisible(preview),
      postsVisible: isVisible(postsPane)
        && postsRect.bottom > 0
        && postsRect.top < window.innerHeight
    };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

try {
  const rootResponse = await page.goto(absoluteUrl(categoriesBasePath), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(rootResponse?.status(), 200, '分类根路由必须返回 200');
  await waitForCategoryRoot(page);
  await waitForPjax(page);

  const initialRootState = await rootState(page);
  assert.equal(initialRootState.appId, 'explorer-categories', '分类根页必须激活 explorer-categories');
  assert.ok(initialRootState.sidebarLinks.length > 0, '分类根页必须展示完整分类树链接');
  assert.ok(initialRootState.overviewLinks.length > 0, '分类根页必须展示可进入的真实分类链接');

  for (const link of [...initialRootState.sidebarLinks, ...initialRootState.overviewLinks]) {
    assert.equal(link.tagName, 'A', '分类入口必须使用真实 a[href]');
    assert.ok(link.href && link.href !== '#', '分类入口不得使用空地址或占位地址');
    assert.equal(link.sameOrigin, true, `分类入口必须为站内地址：${link.href}`);
    assert.equal(link.pjaxApp, 'explorer-categories', `分类入口必须声明 explorer-categories：${link.href}`);
    assert.ok(
      withoutTrailingSlash(link.pathname).startsWith(`${categoriesBasePath}/`),
      `分类入口必须位于配置的分类根路径下：${link.pathname}`
    );
  }

  const rootTreePaths = unique(initialRootState.sidebarLinks.map((link) => withoutTrailingSlash(link.pathname)));
  const rootOverviewPaths = unique(initialRootState.overviewLinks.map((link) => withoutTrailingSlash(link.pathname)));
  assert.equal(rootTreePaths.length, initialRootState.sidebarLinks.length, '分类根页树链接不得重复');
  assert.equal(rootOverviewPaths.length, initialRootState.overviewLinks.length, '分类根页概览链接不得重复');
  assert.deepEqual(rootOverviewPaths, rootTreePaths, '分类概览必须覆盖完整分类树');

  const candidates = [...initialRootState.overviewLinks]
    .sort((left, right) => right.count - left.count);
  let candidate = null;

  for (const link of candidates) {
    const candidatePath = withoutTrailingSlash(link.pathname);
    const response = await page.goto(absoluteUrl(candidatePath), {
      waitUntil: 'domcontentloaded',
      timeout: 20_000
    });
    assert.equal(response?.status(), 200, `分类链接必须可直接访问：${candidatePath}`);
    await waitForCategoryDetail(page, { pathname: candidatePath, pageNumber: 1 });
    const state = await detailState(page);
    if (state.nextPath) {
      candidate = {
        pathname: candidatePath,
        categoryName: state.categoryName,
        nextPath: state.nextPath
      };
      break;
    }
  }

  assert.ok(candidate, '需要至少一个存在下一页的分类样本以验证分类内分页');

  await page.goto(absoluteUrl(categoriesBasePath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForCategoryRoot(page);
  await waitForPjax(page);
  const marker = `category-${Date.now()}`;
  await page.evaluate((value) => { document.documentElement.dataset.categoryVerifyMarker = value; }, marker);

  await clickCategoryPath(page, candidate.pathname);
  await waitForCategoryDetail(page, {
    pathname: candidate.pathname,
    categoryName: candidate.categoryName,
    pageNumber: 1
  });

  const firstPageState = await detailState(page);
  assert.equal(firstPageState.marker, marker, '选择分类必须走 PJAX 并保留当前 Document 标记');
  assert.equal(firstPageState.appId, 'explorer-categories', '分类详情必须继续由 explorer-categories 接管');
  assert.deepEqual(
    unique(firstPageState.treePaths.map(withoutTrailingSlash)),
    rootTreePaths,
    '分类详情必须保留根页完整分类树'
  );
  assert.equal(
    unique(firstPageState.treePaths.map(withoutTrailingSlash)).length,
    firstPageState.treePaths.length,
    '分类详情树链接不得重复'
  );
  assert.deepEqual(
    firstPageState.currentPaths.map(withoutTrailingSlash),
    [candidate.pathname],
    '分类详情必须且只能为当前分类设置 aria-current="page"'
  );
  assert.ok(firstPageState.postKeys.length > 0, '分页候选分类第一页必须展示文章');
  assert.equal(new Set(firstPageState.postKeys).size, firstPageState.postKeys.length, '分类第一页文章不得重复');
  assert.equal(
    withoutTrailingSlash(firstPageState.nextPath).replace(/\/page\/[1-9]\d*$/, ''),
    candidate.pathname,
    '下一页必须保持在同一分类路径内'
  );

  await page.locator('[data-category-next]').click();
  await waitForCategoryDetail(page, {
    pathname: firstPageState.nextPath,
    categoryName: candidate.categoryName,
    pageNumber: 2
  });
  const secondPageState = await detailState(page);
  assert.equal(secondPageState.marker, marker, '分类下一页必须走 PJAX 并保留当前 Document');
  assert.equal(secondPageState.categoryName, firstPageState.categoryName, '下一页不得切换分类');
  assert.deepEqual(secondPageState.currentPaths.map(withoutTrailingSlash), [candidate.pathname], '第二页必须保持当前分类 aria-current');
  assert.ok(secondPageState.postKeys.length > 0, '分类第二页必须展示文章');
  assert.equal(new Set(secondPageState.postKeys).size, secondPageState.postKeys.length, '分类第二页文章不得重复');
  assert.deepEqual(
    secondPageState.postKeys.filter((postKey) => firstPageState.postKeys.includes(postKey)),
    [],
    '分类第二页不得重复第一页文章'
  );

  await page.goBack();
  await waitForCategoryDetail(page, {
    pathname: candidate.pathname,
    categoryName: candidate.categoryName,
    pageNumber: 1
  });
  const backState = await detailState(page);
  assert.equal(backState.marker, marker, '后退必须在同一 Document 内恢复分类第一页');
  assert.deepEqual(backState.postKeys, firstPageState.postKeys, '后退必须恢复分类第一页文章');

  await page.goForward();
  await waitForCategoryDetail(page, {
    pathname: firstPageState.nextPath,
    categoryName: candidate.categoryName,
    pageNumber: 2
  });
  const forwardState = await detailState(page);
  assert.equal(forwardState.marker, marker, '前进必须在同一 Document 内恢复分类第二页');
  assert.deepEqual(forwardState.postKeys, secondPageState.postKeys, '前进必须恢复分类第二页文章');

  const overflowPath = categoryPagePath(candidate.pathname, 999999);
  const overflowResponse = await page.goto(absoluteUrl(overflowPath), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(overflowResponse?.status(), 200, '越界分类分页必须返回可渲染空态');
  await waitForCategoryDetail(page, {
    pathname: overflowPath,
    categoryName: candidate.categoryName,
    pageNumber: 999999
  });
  await page.waitForSelector('[data-category-empty]', { state: 'visible', timeout: 15_000 });
  const recoveryState = await page.evaluate(() => ({
    rootPath: new URL(document.querySelector('[data-category-return-root]')?.getAttribute('href') || '', location.href).pathname,
    firstPath: new URL(document.querySelector('[data-category-return-first]')?.getAttribute('href') || '', location.href).pathname,
    lastPath: new URL(document.querySelector('[data-category-return-last]')?.getAttribute('href') || '', location.href).pathname,
    totalPages: Number(document.querySelector('.category-workspace')?.dataset.categoryTotalPages || 0),
    rootVisible: Boolean(document.querySelector('[data-category-return-root]')?.getClientRects().length),
    firstVisible: Boolean(document.querySelector('[data-category-return-first]')?.getClientRects().length),
    lastVisible: Boolean(document.querySelector('[data-category-return-last]')?.getClientRects().length)
  }));
  assert.equal(withoutTrailingSlash(recoveryState.rootPath), categoriesBasePath, '越界空态必须提供返回分类根页入口');
  assert.equal(withoutTrailingSlash(recoveryState.firstPath), candidate.pathname, '越界空态必须提供返回当前分类第一页入口');
  assert.equal(recoveryState.rootVisible, true, '返回分类根页入口必须可见');
  assert.equal(recoveryState.firstVisible, true, '返回当前分类第一页入口必须可见');
  if (recoveryState.totalPages > 1) {
    assert.equal(recoveryState.lastPath, categoryPagePath(candidate.pathname, recoveryState.totalPages), '越界空态必须直达最后一个有效分页');
    assert.equal(recoveryState.lastVisible, true, '返回最后一页入口必须可见');
  }

  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto(absoluteUrl(candidate.pathname), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForCategoryDetail(page, { pathname: candidate.pathname, categoryName: candidate.categoryName, pageNumber: 1 });
  const tabletState = await inspectResponsiveLayout(page);
  assert.equal(tabletState.overflow, false, '700×900 分类详情不得横向溢出');
  assert.equal(tabletState.panesContained, true, '700×900 分类栏与文章栏必须完整位于视口内');
  assert.equal(tabletState.previewVisible, false, '700×900 必须隐藏文章预览栏');
  assert.equal(tabletState.postsVisible, true, '700×900 文章区域必须可见');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(absoluteUrl(candidate.pathname), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForCategoryDetail(page, { pathname: candidate.pathname, categoryName: candidate.categoryName, pageNumber: 1 });
  const mobileState = await page.evaluate(() => {
    const heights = (selector) => Array.from(document.querySelectorAll(selector))
      .filter((node) => getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0)
      .map((node) => node.getBoundingClientRect().height);
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      panesContained: ['.category-folder-pane', '.category-posts-pane', '.category-folder-back']
        .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
        .filter(Boolean)
        .every((rect) => rect.left >= -1 && rect.right <= window.innerWidth + 1),
      categoryHeights: heights('[data-category-link]'),
      articleHeights: heights('[data-category-post-option]'),
      paginationHeights: heights('[data-category-pagination] a.category-page-btn')
    };
  });
  assert.equal(mobileState.overflow, false, '390×844 分类详情不得横向溢出');
  assert.equal(mobileState.panesContained, true, '390×844 分类栏、返回入口与文章栏不得被视口裁切');
  assert.ok(mobileState.categoryHeights.length > 0, '移动端必须存在分类触控入口');
  assert.ok(mobileState.articleHeights.length > 0, '移动端必须存在文章触控入口');
  assert.ok(mobileState.paginationHeights.length > 0, '移动端必须存在分页触控入口');
  assert.ok(Math.min(...mobileState.categoryHeights) >= 44, '移动端分类触控目标高度不得低于 44px');
  assert.ok(Math.min(...mobileState.articleHeights) >= 44, '移动端文章触控目标高度不得低于 44px');
  assert.ok(Math.min(...mobileState.paginationHeights) >= 44, '移动端分页触控目标高度不得低于 44px');

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(absoluteUrl(candidate.pathname), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForCategoryDetail(page, { pathname: candidate.pathname, categoryName: candidate.categoryName, pageNumber: 1 });
  await page.evaluate(() => {
    const scroller = document.querySelector('.window-body');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(100);
  const dockState = await page.evaluate(() => {
    const pagination = document.querySelector('[data-category-pagination]');
    const dock = document.querySelector('.dock-container');
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const paginationRect = pagination?.getBoundingClientRect();
    const dockRect = dock?.getBoundingClientRect();
    const controlRects = Array.from(pagination?.querySelectorAll('.category-page-btn, .category-page-indicator') || [])
      .filter(visible)
      .map((node) => node.getBoundingClientRect());
    const overlaps = Boolean(dockRect && controlRects.some((rect) => (
      rect.left < dockRect.right
      && rect.right > dockRect.left
      && rect.top < dockRect.bottom
      && rect.bottom > dockRect.top
    )));
    const controlsBottom = controlRects.length ? Math.max(...controlRects.map((rect) => rect.bottom)) : Number.NaN;
    return {
      paginationVisible: visible(pagination)
        && controlRects.some((rect) => rect.bottom > 0 && rect.top < innerHeight),
      dockVisible: visible(dock)
        && dockRect.bottom > 0
        && dockRect.top < innerHeight,
      overlaps,
      clearance: dockRect && Number.isFinite(controlsBottom) ? dockRect.top - controlsBottom : Number.NaN
    };
  });
  assert.equal(dockState.paginationVisible, true, '1280×720 分类分页必须可见');
  assert.equal(dockState.dockVisible, true, '1280×720 Dock 必须可见才能验证避让');
  assert.equal(dockState.overlaps, false, `1280×720 分类分页不得与 Dock 重叠（间距 ${dockState.clearance}px）`);

  await page.waitForTimeout(100);
  assert.deepEqual(runtimeErrors, [], `分类真页出现运行时错误：${runtimeErrors.join(' | ')}`);
  console.log(`分类真页验证通过：${candidate.categoryName}，根路径 ${categoriesBasePath}，分页与响应式契约正常`);
} finally {
  await browser.close();
}
