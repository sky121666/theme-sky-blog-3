import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  assertPjaxLoadingSettled,
  verifyPendingPjaxLoading
} from './pjax-loading-test-helpers.mjs';

const baseUrl = String(process.env.SMOKE_BASE_URL || '').trim();
const configuredTagsPath = String(process.env.TAGS_BASE_PATH || '/tags').trim();
const tagsBasePath = `/${configuredTagsPath.replace(/^\/+|\/+$/g, '') || 'tags'}`;

if (!baseUrl) {
  console.log('跳过标签真页验证：未设置 SMOKE_BASE_URL');
  process.exit(0);
}

const absoluteUrl = (target) => new URL(target, baseUrl).toString();
const withoutTrailingSlash = (pathname) => pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
const tagPagePath = (tagPath, pageNumber) => `${withoutTrailingSlash(tagPath)}/page/${pageNumber}`;

async function waitForPjax(page) {
  await page.waitForFunction(() => Boolean(window.pjax), null, { timeout: 15_000 });
}

async function waitForFinder(page, expected = {}) {
  await page.waitForSelector('[data-app-root="explorer-tags"] .tag-workspace', { timeout: 15_000 });
  await page.waitForFunction(({ pathname, scope, pageNumber, tagName, queryPage, previewReady }) => {
    const workspace = document.querySelector('[data-app-root="explorer-tags"] .tag-workspace');
    const normalize = (value) => value?.length > 1 ? value.replace(/\/+$/, '') : value;
    if (!workspace || document.body?.dataset.pageApp !== 'explorer-tags') return false;
    if (pathname && normalize(location.pathname) !== normalize(pathname)) return false;
    if (scope && workspace.dataset.tagScope !== scope) return false;
    if (pageNumber && Number(workspace.dataset.tagCurrentPage || 0) !== pageNumber) return false;
    if (tagName && workspace.dataset.tagName !== tagName) return false;
    if (queryPage && Number(new URLSearchParams(location.search).get('page') || 0) !== queryPage) return false;
    if (previewReady === false) return true;

    const firstPost = workspace.querySelector('[data-tag-post-option]');
    if (!firstPost) return true;
    const activePost = workspace.querySelector('[data-tag-post-option].is-active');
    return activePost?.dataset.postKey === firstPost.dataset.postKey
      && Boolean(workspace.querySelector('.tag-preview-panel'));
  }, expected, { timeout: 15_000 });
}

async function finderState(page) {
  return page.evaluate(() => {
    const workspace = document.querySelector('[data-app-root="explorer-tags"] .tag-workspace');
    const isVisible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
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
    const tagNodes = Array.from(workspace?.querySelectorAll('[data-tag-link]') || []);
    const currentTagNode = tagNodes.find((node) => node.getAttribute('aria-current') === 'page') || null;
    const tagNavigation = workspace?.querySelector('.tags-sidebar-nav');
    const postNodes = Array.from(workspace?.querySelectorAll('[data-tag-post-option]') || []);
    const firstPost = postNodes[0];
    const previewPanel = workspace?.querySelector('.tag-preview-panel');
    const previewAction = workspace?.querySelector('.tag-preview-action');
    const paneSelectors = ['.tags-sidebar', '.tag-posts-pane', '.tag-preview-pane'];
    const paneVisibility = Object.fromEntries(paneSelectors.map((selector) => [selector, isVisible(workspace?.querySelector(selector))]));
    const paneRects = paneSelectors
      .map((selector) => workspace?.querySelector(selector))
      .filter(isVisible)
      .map((node) => node.getBoundingClientRect());

    return {
      pathname: location.pathname,
      search: location.search,
      appId: document.body?.dataset.pageApp || '',
      scope: workspace?.dataset.tagScope || '',
      tagName: workspace?.dataset.tagName || '',
      currentPage: Number(workspace?.dataset.tagCurrentPage || 0),
      totalPages: Number(workspace?.dataset.tagTotalPages || 0),
      totalPosts: Number(workspace?.dataset.tagTotalPosts || 0),
      pageSize: Number(workspace?.dataset.tagPageSize || 0),
      allLinks: describeLinks('[data-tag-all-link]'),
      tagLinks: describeLinks('[data-tag-link]'),
      currentTagPaths: tagNodes
        .filter((node) => node.getAttribute('aria-current') === 'page')
        .map((node) => new URL(node.getAttribute('href') || '', location.href).pathname),
      currentTagVisible: !currentTagNode || !tagNavigation || (() => {
        const currentRect = currentTagNode.getBoundingClientRect();
        const navigationRect = tagNavigation.getBoundingClientRect();
        return currentRect.top >= navigationRect.top - 1
          && currentRect.bottom <= navigationRect.bottom + 1
          && currentRect.left >= navigationRect.left - 1
          && currentRect.right <= navigationRect.right + 1;
      })(),
      postKeys: postNodes.map((node) => node.dataset.postKey || ''),
      firstPost: firstPost ? {
        key: firstPost.dataset.postKey || '',
        title: firstPost.dataset.postTitle || '',
        href: firstPost.href || '',
        parentName: firstPost.dataset.postParentName || ''
      } : null,
      activePostKeys: postNodes.filter((node) => node.classList.contains('is-active')).map((node) => node.dataset.postKey || ''),
      previewVisible: isVisible(previewPanel),
      previewTitle: workspace?.querySelector('.tag-preview-title')?.textContent?.trim() || '',
      previewPath: workspace?.querySelector('.tag-preview-path')?.textContent?.trim() || '',
      previewActionHref: previewAction?.href || '',
      next: describeLinks('[data-tag-next], [data-tag-all-next]')[0] || null,
      previous: describeLinks('[data-tag-prev], [data-tag-all-prev]')[0] || null,
      emptyVisible: isVisible(workspace?.querySelector('[data-tag-empty]')),
      recovery: describeLinks('[data-tag-return-root], [data-tag-return-first], [data-tag-return-last]'),
      gridColumnCount: workspace
        ? getComputedStyle(workspace).gridTemplateColumns.split(/\s+/).filter(Boolean).length
        : 0,
      paneVisibility,
      panesContained: paneRects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      marker: document.documentElement.dataset.tagVerifyMarker || ''
    };
  });
}

function assertFinderCore(state, expectedScope) {
  assert.equal(state.appId, 'explorer-tags', '标签 Finder 必须由 explorer-tags 接管');
  assert.equal(state.scope, expectedScope, `标签 Finder scope 必须为 ${expectedScope}`);
  assert.equal(state.allLinks.length, 1, '必须且只能有一个“全部标签”入口');
  assert.equal(state.allLinks[0].tagName, 'A', '“全部标签”必须使用真实 a[href]');
  assert.equal(state.allLinks[0].sameOrigin, true, '“全部标签”必须为站内地址');
  assert.equal(state.allLinks[0].pjaxApp, 'explorer-tags', '“全部标签”必须声明 explorer-tags');
  assert.equal(withoutTrailingSlash(state.allLinks[0].pathname), tagsBasePath, '“全部标签”必须返回标签根路由');
  assert.ok(state.tagLinks.length > 0, '标签 Finder 必须展示标签列表');
  assert.equal(new Set(state.tagLinks.map((link) => withoutTrailingSlash(link.pathname))).size, state.tagLinks.length, '标签链接不得重复');
  for (const link of state.tagLinks) {
    assert.equal(link.tagName, 'A', '标签节点必须使用真实 a[href]');
    assert.equal(link.sameOrigin, true, `标签节点必须为站内地址：${link.href}`);
    assert.equal(link.pjaxApp, 'explorer-tags', `标签节点必须声明 explorer-tags：${link.href}`);
    assert.ok(withoutTrailingSlash(link.pathname).startsWith(`${tagsBasePath}/`), `标签节点必须位于标签根路径下：${link.pathname}`);
  }
}

function assertPostsAndPreview(state, label) {
  assert.ok(state.postKeys.length > 0, `${label}必须展示文章`);
  assert.equal(new Set(state.postKeys).size, state.postKeys.length, `${label}文章不得重复`);
  assert.deepEqual(state.activePostKeys, [state.firstPost.key], `${label}必须默认且只选中第一篇文章`);
  assert.equal(state.previewVisible, true, `${label}默认预览必须可见`);
  assert.equal(state.previewTitle, state.firstPost.title, `${label}预览标题必须对应第一篇文章`);
  assert.ok(state.previewPath.includes(state.firstPost.parentName), `${label}预览路径必须包含文章来源`);
  assert.equal(state.previewActionHref, state.firstPost.href, `${label}预览打开地址必须对应文章`);
}

async function clickTagPath(page, pathname) {
  const links = page.locator('[data-tag-link]');
  const index = await links.evaluateAll((nodes, expectedPath) => nodes.findIndex((node) => {
    const normalize = (value) => value.length > 1 ? value.replace(/\/+$/, '') : value;
    return normalize(new URL(node.getAttribute('href') || '', location.href).pathname) === normalize(expectedPath);
  }), pathname);
  assert.ok(index >= 0, `当前标签列表必须包含候选标签：${pathname}`);
  await links.nth(index).click();
}

async function verifyResponsive(page, target, waitFor, expected, label) {
  await page.setViewportSize(expected.viewport);
  const response = await page.goto(absoluteUrl(target), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(response?.status(), 200, `${label}必须可直接访问`);
  await waitForFinder(page, { ...waitFor, previewReady: expected.previewVisible });
  const state = await finderState(page);
  assert.equal(state.overflow, false, `${label}不得横向溢出`);
  assert.equal(state.panesContained, true, `${label}可见栏必须位于视口内`);
  assert.equal(state.gridColumnCount, expected.columns, `${label}必须为 ${expected.columns} 栏布局`);
  assert.equal(state.paneVisibility['.tags-sidebar'], true, `${label}标签栏必须可见`);
  assert.equal(state.paneVisibility['.tag-posts-pane'], true, `${label}文章栏必须可见`);
  assert.equal(state.paneVisibility['.tag-preview-pane'], expected.previewVisible, `${label}预览栏可见性不正确`);
  if (waitFor.scope === 'tag') {
    assert.equal(state.currentTagVisible, true, `${label}当前标签必须位于导航可视区`);
  }

  if (expected.touch) {
    const targets = await page.evaluate(() => {
      const heights = (selector) => Array.from(document.querySelectorAll(selector))
        .filter((node) => getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect().height);
      return {
        tags: heights('[data-tag-all-link], [data-tag-link]'),
        posts: heights('[data-tag-post-option]'),
        pagination: heights('[data-tag-pagination] .tag-page-btn')
      };
    });
    assert.ok(targets.tags.length > 0 && Math.min(...targets.tags) >= 44, `${label}标签触控目标不得低于 44px`);
    assert.ok(targets.posts.length > 0 && Math.min(...targets.posts) >= 44, `${label}文章触控目标不得低于 44px`);
    if (targets.pagination.length) {
      assert.ok(Math.min(...targets.pagination) >= 44, `${label}分页触控目标不得低于 44px`);
    }
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

try {
  const rootResponse = await page.goto(absoluteUrl(tagsBasePath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(rootResponse?.status(), 200, '标签根路由必须返回 200');
  await waitForFinder(page, { pathname: tagsBasePath, scope: 'all', pageNumber: 1 });
  await waitForPjax(page);

  const rootPageOne = await finderState(page);
  assertFinderCore(rootPageOne, 'all');
  assert.equal(rootPageOne.allLinks[0].current, 'page', '标签根页必须激活“全部标签”');
  assert.deepEqual(rootPageOne.currentTagPaths, [], '标签根页不得误激活某个标签');
  assert.equal(rootPageOne.currentPage, 1, '标签根页必须默认展示全部文章第一页');
  assert.ok(rootPageOne.totalPages >= 2, '真页样本必须至少有两页全部文章');
  assertPostsAndPreview(rootPageOne, '标签根页');
  assert.equal(new URLSearchParams(rootPageOne.next.search).get('page'), '2', '全部文章下一页必须使用 ?page=2');

  const tagPaths = rootPageOne.tagLinks.map((link) => withoutTrailingSlash(link.pathname));
  const rootMarker = `tags-root-${Date.now()}`;
  await page.evaluate((value) => { document.documentElement.dataset.tagVerifyMarker = value; }, rootMarker);
  await verifyPendingPjaxLoading({
    page,
    targetUrl: absoluteUrl(`${tagsBasePath}?page=2`),
    action: () => page.locator('[data-tag-all-next]').click(),
    preservedSelector: '[data-app-root="explorer-tags"] .tag-workspace',
    expectWindowOverlay: false,
    label: '标签全部文章分页'
  });
  await waitForFinder(page, { pathname: tagsBasePath, scope: 'all', pageNumber: 2, queryPage: 2 });
  await assertPjaxLoadingSettled(page, '标签全部文章分页');
  const rootPageTwo = await finderState(page);
  assert.equal(rootPageTwo.marker, rootMarker, '标签根页翻页必须走 PJAX 并保留 Document');
  assert.deepEqual(rootPageTwo.postKeys.filter((key) => rootPageOne.postKeys.includes(key)), [], '全部文章第二页不得重复第一页');
  assert.deepEqual(rootPageTwo.tagLinks.map((link) => withoutTrailingSlash(link.pathname)), tagPaths, '翻页不得改变标签列表');
  assertPostsAndPreview(rootPageTwo, '全部文章第二页');

  await page.goBack();
  await waitForFinder(page, { pathname: tagsBasePath, scope: 'all', pageNumber: 1 });
  const rootBack = await finderState(page);
  assert.equal(rootBack.marker, rootMarker, '浏览器后退必须保留同一 Document');
  assert.deepEqual(rootBack.postKeys, rootPageOne.postKeys, '浏览器后退必须恢复第一页文章');

  const overflowResponse = await page.goto(absoluteUrl(`${tagsBasePath}?page=999999`), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(overflowResponse?.status(), 200, '全部文章越界 query 必须返回 200 空态');
  await waitForFinder(page, { pathname: tagsBasePath, scope: 'all', pageNumber: 999999, queryPage: 999999 });
  const overflow = await finderState(page);
  assert.equal(overflow.emptyVisible, true, '全部文章越界必须展示可恢复空态');
  assert.ok(overflow.recovery.some((link) => withoutTrailingSlash(link.pathname) === tagsBasePath && !link.search), '越界空态必须可返回第一页');

  let candidate = null;
  for (const tagPath of tagPaths) {
    const response = await page.goto(absoluteUrl(tagPath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    assert.equal(response?.status(), 200, `标签详情必须可直接访问：${tagPath}`);
    await waitForFinder(page, { pathname: tagPath, scope: 'tag', pageNumber: 1 });
    const state = await finderState(page);
    if (state.next) {
      candidate = { pathname: tagPath, tagName: state.tagName, firstPage: state };
      break;
    }
  }
  assert.ok(candidate, '真页样本必须至少有一个存在下一页的标签');
  assertFinderCore(candidate.firstPage, 'tag');
  assert.deepEqual(candidate.firstPage.tagLinks.map((link) => withoutTrailingSlash(link.pathname)), tagPaths, '标签详情必须保留完整标签列表');
  assert.deepEqual(candidate.firstPage.currentTagPaths.map(withoutTrailingSlash), [candidate.pathname], '标签详情必须且只激活当前标签');
  assert.equal(candidate.firstPage.currentTagVisible, true, '标签详情必须把当前标签滚动到侧栏可视区');
  assertPostsAndPreview(candidate.firstPage, '标签详情第一页');
  assert.equal(withoutTrailingSlash(candidate.firstPage.next.pathname), tagPagePath(candidate.pathname, 2), '标签下一页必须使用原生 /tags/:slug/page/2');

  await page.goto(absoluteUrl(tagsBasePath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFinder(page, { pathname: tagsBasePath, scope: 'all', pageNumber: 1 });
  await waitForPjax(page);
  const detailMarker = `tag-detail-${Date.now()}`;
  await page.evaluate((value) => { document.documentElement.dataset.tagVerifyMarker = value; }, detailMarker);
  await verifyPendingPjaxLoading({
    page,
    targetUrl: absoluteUrl(candidate.pathname),
    action: () => clickTagPath(page, candidate.pathname),
    preservedSelector: '[data-app-root="explorer-tags"] .tag-workspace',
    expectWindowOverlay: false,
    label: '标签选择'
  });
  await waitForFinder(page, { pathname: candidate.pathname, scope: 'tag', tagName: candidate.tagName, pageNumber: 1 });
  await assertPjaxLoadingSettled(page, '标签选择');
  const tagPageOne = await finderState(page);
  assert.equal(tagPageOne.marker, detailMarker, '选择标签必须走 PJAX 并保留 Document');

  const tagSecondPath = tagPagePath(candidate.pathname, 2);
  await verifyPendingPjaxLoading({
    page,
    targetUrl: absoluteUrl(tagSecondPath),
    action: () => page.locator('[data-tag-next]').click(),
    preservedSelector: '[data-app-root="explorer-tags"] .tag-workspace',
    expectWindowOverlay: false,
    label: '标签文章分页'
  });
  await waitForFinder(page, { pathname: tagSecondPath, scope: 'tag', tagName: candidate.tagName, pageNumber: 2 });
  await assertPjaxLoadingSettled(page, '标签文章分页');
  const tagPageTwo = await finderState(page);
  assert.equal(tagPageTwo.marker, detailMarker, '标签下一页必须走 PJAX 并保留 Document');
  assert.deepEqual(tagPageTwo.postKeys.filter((key) => tagPageOne.postKeys.includes(key)), [], '标签第二页不得重复第一页文章');
  assert.deepEqual(tagPageTwo.currentTagPaths.map(withoutTrailingSlash), [candidate.pathname], '标签第二页必须保持标签选中');
  assert.equal(tagPageTwo.currentTagVisible, true, '标签第二页必须保持当前标签可见');
  assertPostsAndPreview(tagPageTwo, '标签详情第二页');

  const tagOverflowPath = tagPagePath(candidate.pathname, 999999);
  const tagOverflowResponse = await page.goto(absoluteUrl(tagOverflowPath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(tagOverflowResponse?.status(), 200, '标签越界分页必须返回 200 空态');
  await waitForFinder(page, { pathname: tagOverflowPath, scope: 'tag', tagName: candidate.tagName, pageNumber: 999999 });
  const tagOverflow = await finderState(page);
  assert.equal(tagOverflow.emptyVisible, true, '标签越界分页必须展示可恢复空态');
  assert.ok(tagOverflow.recovery.some((link) => withoutTrailingSlash(link.pathname) === candidate.pathname), '标签越界空态必须可返回第一页');

  for (const target of [
    { path: tagsBasePath, waitFor: { pathname: tagsBasePath, scope: 'all', pageNumber: 1 }, name: '标签根页' },
    { path: candidate.pathname, waitFor: { pathname: candidate.pathname, scope: 'tag', pageNumber: 1 }, name: '标签详情' }
  ]) {
    await verifyResponsive(page, target.path, target.waitFor, { viewport: { width: 1280, height: 720 }, columns: 3, previewVisible: true }, `1280×720 ${target.name}`);
    await verifyResponsive(page, target.path, target.waitFor, { viewport: { width: 700, height: 900 }, columns: 2, previewVisible: false }, `700×900 ${target.name}`);
    await verifyResponsive(page, target.path, target.waitFor, { viewport: { width: 390, height: 844 }, columns: 1, previewVisible: false, touch: true }, `390×844 ${target.name}`);
  }

  assert.deepEqual(runtimeErrors, [], `标签真页出现运行时错误：${runtimeErrors.join(' | ')}`);
  console.log(`标签真页验证通过：统一 Finder、全部文章 query 分页、${candidate.tagName} 原生分页、PJAX/history/越界与响应式契约正常`);
} finally {
  await browser.close();
}
