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

async function waitForFinder(page, expected = {}) {
  await page.waitForSelector('[data-app-root="explorer-categories"] .category-workspace', { timeout: 15_000 });
  await page.waitForFunction(({ pathname, scope, pageNumber, categoryName, queryPage, previewReady }) => {
    const workspace = document.querySelector('[data-app-root="explorer-categories"] .category-workspace');
    const normalizePath = (value) => value?.length > 1 ? value.replace(/\/+$/, '') : value;
    if (!workspace || document.body?.dataset.pageApp !== 'explorer-categories') return false;
    if (pathname && normalizePath(location.pathname) !== normalizePath(pathname)) return false;
    if (scope && workspace.dataset.categoryScope !== scope) return false;
    if (pageNumber && Number(workspace.dataset.categoryCurrentPage || 0) !== pageNumber) return false;
    if (categoryName && workspace.dataset.categoryName !== categoryName) return false;
    if (queryPage && Number(new URLSearchParams(location.search).get('page') || 0) !== queryPage) return false;

    if (previewReady === false) return true;

    const firstPost = workspace.querySelector('[data-category-post-option]');
    if (!firstPost) return true;
    const activePost = workspace.querySelector('[data-category-post-option].is-active');
    return activePost?.dataset.postKey === firstPost.dataset.postKey
      && Boolean(workspace.querySelector('.category-preview-panel'));
  }, expected, { timeout: 15_000 });
}

async function finderState(page) {
  return page.evaluate(() => {
    const workspace = document.querySelector('[data-app-root="explorer-categories"] .category-workspace');
    const pathOf = (node) => node ? new URL(node.getAttribute('href') || '', location.href).pathname : '';
    const searchOf = (node) => node ? new URL(node.getAttribute('href') || '', location.href).search : '';
    const isVisible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const describeLinks = (selector) => Array.from(workspace?.querySelectorAll(selector) || []).map((node) => {
      const url = new URL(node.getAttribute('href') || '', location.href);
      return {
        tagName: node.tagName,
        href: node.getAttribute('href') || '',
        pathname: url.pathname,
        search: url.search,
        sameOrigin: url.origin === location.origin,
        pjaxApp: node.dataset.pjaxApp || '',
        current: node.getAttribute('aria-current') || ''
      };
    });
    const treeLinks = Array.from(workspace?.querySelectorAll('[data-category-link]') || []);
    const postOptions = Array.from(workspace?.querySelectorAll('[data-category-post-option]') || []);
    const firstPost = postOptions[0];
    const activePosts = postOptions.filter((node) => node.classList.contains('is-active'));
    const previewPanel = workspace?.querySelector('.category-preview-panel');
    const previewAction = workspace?.querySelector('.category-preview-action');
    const paneSelectors = ['.category-folder-pane', '.category-posts-pane', '.category-preview-pane'];
    const paneVisibility = Object.fromEntries(paneSelectors.map((selector) => [selector, isVisible(workspace?.querySelector(selector))]));
    const paneRects = paneSelectors
      .map((selector) => workspace?.querySelector(selector))
      .filter(isVisible)
      .map((node) => node.getBoundingClientRect());
    const workspaceRect = workspace?.getBoundingClientRect();

    return {
      pathname: location.pathname,
      search: location.search,
      appId: document.body?.dataset.pageApp || '',
      scope: workspace?.dataset.categoryScope || '',
      categoryName: workspace?.dataset.categoryName || '',
      currentPage: Number(workspace?.dataset.categoryCurrentPage || 0),
      totalPages: Number(workspace?.dataset.categoryTotalPages || 0),
      totalPosts: Number(workspace?.dataset.categoryTotalPosts || 0),
      pageSize: Number(workspace?.dataset.categoryPageSize || 0),
      allLinks: describeLinks('[data-category-all-link]'),
      treeLinks: describeLinks('[data-category-link]'),
      treePaths: treeLinks.map(pathOf),
      currentTreePaths: treeLinks.filter((node) => node.getAttribute('aria-current') === 'page').map(pathOf),
      postKeys: postOptions.map((node) => node.dataset.postKey || ''),
      postPaths: postOptions.map(pathOf),
      postSearches: postOptions.map(searchOf),
      firstPost: firstPost ? {
        key: firstPost.dataset.postKey || '',
        title: firstPost.dataset.postTitle || '',
        href: firstPost.href || '',
        parentName: firstPost.dataset.postParentName || ''
      } : null,
      activePostKeys: activePosts.map((node) => node.dataset.postKey || ''),
      previewVisible: isVisible(previewPanel),
      previewTitle: workspace?.querySelector('.category-preview-title')?.textContent?.trim() || '',
      previewPath: workspace?.querySelector('.category-preview-path')?.textContent?.trim() || '',
      previewActionHref: previewAction?.href || '',
      next: describeLinks('[data-category-next], [data-category-all-next]')[0] || null,
      previous: describeLinks('[data-category-prev], [data-category-all-prev]')[0] || null,
      emptyVisible: isVisible(workspace?.querySelector('[data-category-empty]')),
      recovery: describeLinks('[data-category-return-root], [data-category-return-first], [data-category-return-last]'),
      gridColumnCount: workspace
        ? getComputedStyle(workspace).gridTemplateColumns.split(/\s+/).filter(Boolean).length
        : 0,
      workspaceWidth: workspaceRect?.width || 0,
      paneVisibility,
      panesContained: paneRects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      marker: document.documentElement.dataset.categoryVerifyMarker || ''
    };
  });
}

function assertFinderCore(state, expectedScope) {
  assert.equal(state.appId, 'explorer-categories', '分类 Finder 必须由 explorer-categories 接管');
  assert.equal(state.scope, expectedScope, `分类 Finder scope 必须为 ${expectedScope}`);
  assert.equal(state.allLinks.length, 1, '分类 Finder 必须且只能有一个“全部分类”入口');
  assert.equal(state.allLinks[0].tagName, 'A', '“全部分类”入口必须使用真实 a[href]');
  assert.equal(state.allLinks[0].sameOrigin, true, '“全部分类”入口必须为站内地址');
  assert.equal(state.allLinks[0].pjaxApp, 'explorer-categories', '“全部分类”入口必须声明 explorer-categories');
  assert.equal(withoutTrailingSlash(state.allLinks[0].pathname), categoriesBasePath, '“全部分类”入口必须返回分类根路由');
  assert.ok(state.treeLinks.length > 0, '分类 Finder 必须展示分类树');
  assert.equal(unique(state.treePaths.map(withoutTrailingSlash)).length, state.treePaths.length, '分类树链接不得重复');

  for (const link of state.treeLinks) {
    assert.equal(link.tagName, 'A', '分类节点必须使用真实 a[href]');
    assert.ok(link.href && link.href !== '#', '分类节点不得使用空地址或占位地址');
    assert.equal(link.sameOrigin, true, `分类节点必须为站内地址：${link.href}`);
    assert.equal(link.pjaxApp, 'explorer-categories', `分类节点必须声明 explorer-categories：${link.href}`);
    assert.ok(
      withoutTrailingSlash(link.pathname).startsWith(`${categoriesBasePath}/`),
      `分类节点必须位于配置的分类根路径下：${link.pathname}`
    );
  }
}

function assertPostsAndPreview(state, label) {
  assert.ok(state.postKeys.length > 0, `${label}必须展示文档`);
  assert.equal(new Set(state.postKeys).size, state.postKeys.length, `${label}文档不得重复`);
  assert.ok(state.firstPost?.key, `${label}第一篇文档必须有稳定键`);
  assert.deepEqual(state.activePostKeys, [state.firstPost.key], `${label}必须默认选中且只选中第一篇文档`);
  assert.equal(state.previewVisible, true, `${label}默认文档预览必须可见`);
  assert.equal(state.previewTitle, state.firstPost.title, `${label}预览标题必须对应默认选中文档`);
  assert.ok(state.previewPath.includes(state.firstPost.parentName), `${label}预览路径必须包含当前文档来源`);
  assert.equal(state.previewActionHref, state.firstPost.href, `${label}预览打开地址必须对应默认选中文档`);
}

async function clickCategoryPath(page, pathname) {
  const links = page.locator('[data-category-link]');
  const index = await links.evaluateAll((nodes, expectedPath) => {
    const normalizePath = (value) => value.length > 1 ? value.replace(/\/+$/, '') : value;
    return nodes.findIndex((node) => (
      normalizePath(new URL(node.getAttribute('href') || '', location.href).pathname) === normalizePath(expectedPath)
    ));
  }, pathname);
  assert.ok(index >= 0, `当前分类树必须包含候选分类：${pathname}`);
  await links.nth(index).click();
}

async function verifyResponsive(page, target, expected, label) {
  await page.setViewportSize(expected.viewport);
  const response = await page.goto(absoluteUrl(target), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(response?.status(), 200, `${label}必须可直接访问`);
  await waitForFinder(page, expected.waitFor);
  const state = await finderState(page);
  assert.equal(state.overflow, false, `${label}不得横向溢出`);
  assert.equal(state.panesContained, true, `${label}可见栏必须完整位于视口内`);
  assert.equal(state.gridColumnCount, expected.columns, `${label}必须为 ${expected.columns} 栏布局`);
  assert.equal(state.paneVisibility['.category-folder-pane'], true, `${label}分类栏必须可见`);
  assert.equal(state.paneVisibility['.category-posts-pane'], true, `${label}文档栏必须可见`);
  assert.equal(state.paneVisibility['.category-preview-pane'], expected.previewVisible, `${label}预览栏可见性不符合断点契约`);

  if (expected.desktopWidth) {
    assert.ok(
      state.workspaceWidth >= expected.desktopWidth.min && state.workspaceWidth <= expected.desktopWidth.max,
      `${label}工作区应保持约 1086px（实际 ${state.workspaceWidth.toFixed(1)}px）`
    );
  }

  if (expected.touch) {
    const touchTargets = await page.evaluate(() => {
      const heights = (selector) => Array.from(document.querySelectorAll(selector))
        .filter((node) => {
          const style = getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        })
        .map((node) => node.getBoundingClientRect().height);
      return {
        categories: heights('[data-category-all-link], [data-category-link]'),
        posts: heights('[data-category-post-option]'),
        pagination: heights('[data-category-pagination] .category-page-btn')
      };
    });
    assert.ok(touchTargets.categories.length > 0, `${label}必须有分类触控入口`);
    assert.ok(touchTargets.posts.length > 0, `${label}必须有文档触控入口`);
    assert.ok(touchTargets.pagination.length > 0, `${label}必须有分页触控入口`);
    assert.ok(Math.min(...touchTargets.categories) >= 44, `${label}分类触控目标高度不得低于 44px`);
    assert.ok(Math.min(...touchTargets.posts) >= 44, `${label}文档触控目标高度不得低于 44px`);
    assert.ok(Math.min(...touchTargets.pagination) >= 44, `${label}分页触控目标高度不得低于 44px`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 1 });
  await waitForPjax(page);

  const rootPageOne = await finderState(page);
  assertFinderCore(rootPageOne, 'all');
  assert.equal(rootPageOne.allLinks[0].current, 'page', '分类根页必须激活唯一“全部分类”入口');
  assert.deepEqual(rootPageOne.currentTreePaths, [], '分类根页不得误激活某个分类节点');
  assert.equal(rootPageOne.currentPage, 1, '分类根页默认必须展示全部文档第一页');
  assert.ok(rootPageOne.totalPages >= 2, '真页样本必须至少有两页全部文档，才能验证 query 分页');
  assert.ok(rootPageOne.totalPosts > rootPageOne.postKeys.length, '全部文档总数必须大于第一页数量');
  assert.ok(rootPageOne.pageSize >= rootPageOne.postKeys.length, '全部文档每页数量不得超过 categoryPageSize');
  assertPostsAndPreview(rootPageOne, '分类根页');
  assert.ok(rootPageOne.next, '分类根页必须提供下一页');
  assert.equal(withoutTrailingSlash(rootPageOne.next.pathname), categoriesBasePath, '全部文档下一页不得改变分类根路径');
  assert.equal(new URLSearchParams(rootPageOne.next.search).get('page'), '2', '全部文档下一页必须使用 ?page=2');

  const rootTreePaths = rootPageOne.treePaths.map(withoutTrailingSlash);
  const rootMarker = `categories-root-${Date.now()}`;
  await page.evaluate((value) => { document.documentElement.dataset.categoryVerifyMarker = value; }, rootMarker);
  await page.locator('[data-category-all-next]').click();
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 2, queryPage: 2 });
  const rootPageTwo = await finderState(page);
  assert.equal(rootPageTwo.marker, rootMarker, '全部文档下一页必须走 PJAX 并保留当前 Document');
  assert.equal(rootPageTwo.search, '?page=2', '全部文档第二页地址必须明确为 /categories?page=2');
  assert.equal(rootPageTwo.allLinks[0].current, 'page', '全部文档翻页后必须继续激活唯一“全部分类”入口');
  assert.deepEqual(rootPageTwo.treePaths.map(withoutTrailingSlash), rootTreePaths, '全部文档翻页不得改变分类树');
  assert.deepEqual(rootPageTwo.postKeys.filter((key) => rootPageOne.postKeys.includes(key)), [], '全部文档第二页不得重复第一页文档');
  assertPostsAndPreview(rootPageTwo, '全部文档第二页');
  assert.ok(rootPageTwo.previous, '全部文档第二页必须提供上一页');
  assert.equal(rootPageTwo.previous.search, '', '全部文档第二页的上一页必须回到无 query 的根地址');

  await page.goBack();
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 1 });
  const rootBack = await finderState(page);
  assert.equal(rootBack.marker, rootMarker, '浏览器后退必须在同一 Document 中恢复全部文档第一页');
  assert.deepEqual(rootBack.postKeys, rootPageOne.postKeys, '浏览器后退必须恢复全部文档第一页内容');

  await page.goForward();
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 2, queryPage: 2 });
  const rootForward = await finderState(page);
  assert.equal(rootForward.marker, rootMarker, '浏览器前进必须在同一 Document 中恢复全部文档第二页');
  assert.deepEqual(rootForward.postKeys, rootPageTwo.postKeys, '浏览器前进必须恢复全部文档第二页内容');

  const directRootPageTwoResponse = await page.goto(absoluteUrl(`${categoriesBasePath}?page=2`), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(directRootPageTwoResponse?.status(), 200, '全部文档 query 第二页必须可直接访问');
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 2, queryPage: 2 });
  assert.deepEqual((await finderState(page)).postKeys, rootPageTwo.postKeys, '直达 query 第二页必须得到相同文档集合');

  const rootOverflowResponse = await page.goto(absoluteUrl(`${categoriesBasePath}?page=999999`), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(rootOverflowResponse?.status(), 200, '全部文档越界 query 必须返回可恢复空态');
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 999999, queryPage: 999999 });
  const rootOverflow = await finderState(page);
  assert.equal(rootOverflow.emptyVisible, true, '全部文档越界 query 必须展示空态');
  assert.equal(rootOverflow.postKeys.length, 0, '全部文档越界 query 不得伪造文档');
  assert.ok(rootOverflow.recovery.some((link) => withoutTrailingSlash(link.pathname) === categoriesBasePath && !link.search), '全部文档越界空态必须可返回第一页');
  assert.ok(
    rootOverflow.recovery.some((link) => new URLSearchParams(link.search).get('page') === String(rootOverflow.totalPages)),
    '全部文档越界空态必须可返回最后一个有效 query 页'
  );

  let candidate = null;
  for (const categoryPath of rootTreePaths) {
    const response = await page.goto(absoluteUrl(categoryPath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    assert.equal(response?.status(), 200, `分类详情必须可直接访问：${categoryPath}`);
    await waitForFinder(page, { pathname: categoryPath, scope: 'category', pageNumber: 1 });
    const state = await finderState(page);
    if (state.next) {
      candidate = { pathname: categoryPath, categoryName: state.categoryName, firstPage: state };
      break;
    }
  }
  assert.ok(candidate, '真页样本必须至少有一个存在下一页的分类，才能验证分类原生分页');

  assertFinderCore(candidate.firstPage, 'category');
  assert.deepEqual(candidate.firstPage.treePaths.map(withoutTrailingSlash), rootTreePaths, '分类详情必须保留根页同一棵完整分类树');
  assert.deepEqual(candidate.firstPage.currentTreePaths.map(withoutTrailingSlash), [candidate.pathname], '分类详情必须且只能激活当前分类');
  assertPostsAndPreview(candidate.firstPage, '分类详情第一页');
  assert.equal(
    withoutTrailingSlash(candidate.firstPage.next.pathname),
    categoryPagePath(candidate.pathname, 2),
    '分类下一页必须使用 /categories/:slug/page/2 原生路径'
  );
  assert.equal(candidate.firstPage.next.search, '', '分类原生分页不得混用根页 query');

  await page.goto(absoluteUrl(categoriesBasePath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFinder(page, { pathname: categoriesBasePath, scope: 'all', pageNumber: 1 });
  await waitForPjax(page);
  const categoryMarker = `category-detail-${Date.now()}`;
  await page.evaluate((value) => { document.documentElement.dataset.categoryVerifyMarker = value; }, categoryMarker);
  await clickCategoryPath(page, candidate.pathname);
  await waitForFinder(page, {
    pathname: candidate.pathname,
    scope: 'category',
    categoryName: candidate.categoryName,
    pageNumber: 1
  });
  const categoryPageOne = await finderState(page);
  assert.equal(categoryPageOne.marker, categoryMarker, '从全部分类选择分类必须走 PJAX 并保留当前 Document');
  assert.deepEqual(categoryPageOne.postKeys, candidate.firstPage.postKeys, 'PJAX 分类详情必须与直达结果一致');

  await page.locator('[data-category-next]').click();
  const categorySecondPath = categoryPagePath(candidate.pathname, 2);
  await waitForFinder(page, {
    pathname: categorySecondPath,
    scope: 'category',
    categoryName: candidate.categoryName,
    pageNumber: 2
  });
  const categoryPageTwo = await finderState(page);
  assert.equal(categoryPageTwo.marker, categoryMarker, '分类下一页必须走 PJAX 并保留当前 Document');
  assert.deepEqual(categoryPageTwo.currentTreePaths.map(withoutTrailingSlash), [candidate.pathname], '分类第二页必须保持当前分类选中');
  assert.deepEqual(categoryPageTwo.postKeys.filter((key) => categoryPageOne.postKeys.includes(key)), [], '分类第二页不得重复第一页文档');
  assertPostsAndPreview(categoryPageTwo, '分类详情第二页');

  await page.goBack();
  await waitForFinder(page, { pathname: candidate.pathname, scope: 'category', categoryName: candidate.categoryName, pageNumber: 1 });
  const categoryBack = await finderState(page);
  assert.equal(categoryBack.marker, categoryMarker, '浏览器后退必须在同一 Document 中恢复分类第一页');
  assert.deepEqual(categoryBack.postKeys, categoryPageOne.postKeys, '浏览器后退必须恢复分类第一页内容');

  await page.goForward();
  await waitForFinder(page, { pathname: categorySecondPath, scope: 'category', categoryName: candidate.categoryName, pageNumber: 2 });
  const categoryForward = await finderState(page);
  assert.equal(categoryForward.marker, categoryMarker, '浏览器前进必须在同一 Document 中恢复分类第二页');
  assert.deepEqual(categoryForward.postKeys, categoryPageTwo.postKeys, '浏览器前进必须恢复分类第二页内容');

  const directCategoryPageTwoResponse = await page.goto(absoluteUrl(categorySecondPath), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(directCategoryPageTwoResponse?.status(), 200, '分类原生第二页必须可直接访问');
  await waitForFinder(page, { pathname: categorySecondPath, scope: 'category', categoryName: candidate.categoryName, pageNumber: 2 });
  assert.deepEqual((await finderState(page)).postKeys, categoryPageTwo.postKeys, '直达分类原生第二页必须得到相同文档集合');

  const categoryOverflowPath = categoryPagePath(candidate.pathname, 999999);
  const categoryOverflowResponse = await page.goto(absoluteUrl(categoryOverflowPath), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  assert.equal(categoryOverflowResponse?.status(), 200, '分类越界分页必须返回可恢复空态');
  await waitForFinder(page, {
    pathname: categoryOverflowPath,
    scope: 'category',
    categoryName: candidate.categoryName,
    pageNumber: 999999
  });
  const categoryOverflow = await finderState(page);
  assert.equal(categoryOverflow.emptyVisible, true, '分类越界分页必须展示空态');
  assert.equal(categoryOverflow.postKeys.length, 0, '分类越界分页不得伪造文档');
  assert.ok(categoryOverflow.recovery.some((link) => withoutTrailingSlash(link.pathname) === categoriesBasePath), '分类越界空态必须可返回全部分类');
  assert.ok(categoryOverflow.recovery.some((link) => withoutTrailingSlash(link.pathname) === candidate.pathname), '分类越界空态必须可返回分类第一页');
  assert.ok(
    categoryOverflow.recovery.some((link) => withoutTrailingSlash(link.pathname) === categoryPagePath(candidate.pathname, categoryOverflow.totalPages)),
    '分类越界空态必须可返回分类最后一个有效页'
  );

  const responsiveTargets = [
    { target: categoriesBasePath, scope: 'all', name: '分类根页' },
    { target: candidate.pathname, scope: 'category', name: '分类详情' }
  ];
  for (const target of responsiveTargets) {
    await verifyResponsive(page, target.target, {
      viewport: { width: 1280, height: 720 },
      waitFor: { pathname: target.target, scope: target.scope, pageNumber: 1 },
      columns: 3,
      previewVisible: true,
      desktopWidth: { min: 1060, max: 1100 }
    }, `1280×720（约 1086px 工作区）${target.name}`);

    await verifyResponsive(page, target.target, {
      viewport: { width: 700, height: 900 },
      waitFor: { pathname: target.target, scope: target.scope, pageNumber: 1, previewReady: false },
      columns: 2,
      previewVisible: false
    }, `700×900 ${target.name}`);

    await verifyResponsive(page, target.target, {
      viewport: { width: 390, height: 844 },
      waitFor: { pathname: target.target, scope: target.scope, pageNumber: 1, previewReady: false },
      columns: 1,
      previewVisible: false,
      touch: true
    }, `390×844 ${target.name}`);
  }

  await page.waitForTimeout(100);
  assert.deepEqual(runtimeErrors, [], `分类真页出现运行时错误：${runtimeErrors.join(' | ')}`);
  console.log(`分类真页验证通过：统一 Finder、全部文档 query 分页、${candidate.categoryName} 原生分页、PJAX/history/直达/越界与响应式契约正常`);
} finally {
  await browser.close();
}
