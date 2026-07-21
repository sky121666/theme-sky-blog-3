import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  assertPjaxLoadingSettled,
  verifyPendingPjaxLoading
} from './pjax-loading-test-helpers.mjs';

const baseUrl = String(process.env.SMOKE_BASE_URL || '').trim();
const configuredArchivePath = String(process.env.ARCHIVES_BASE_PATH || '/archives').trim();
const archivesBasePath = `/${configuredArchivePath.replace(/^\/+|\/+$/g, '') || 'archives'}`;
if (!baseUrl) {
  console.log('跳过归档真页验证：未设置 SMOKE_BASE_URL');
  process.exit(0);
}

function absoluteUrl(target) {
  return new URL(target, baseUrl).toString();
}

function pathnameOf(target) {
  return new URL(target, baseUrl).pathname;
}

async function waitForArchive(page, expected = {}) {
  await page.waitForSelector('[data-app-root="explorer-archives"] .archive-workspace', { timeout: 15_000 });
  await page.waitForFunction(({ year, monthKey }) => {
    const root = document.querySelector('[data-app-root="explorer-archives"] .archive-workspace');
    if (!root || !root._x_dataStack?.length) return false;
    if (year && root.dataset.activeYear !== year) return false;
    if (monthKey && root.dataset.activeMonthKey !== monthKey) return false;
    return true;
  }, expected, { timeout: 15_000 });
}

async function archiveState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-app-root="explorer-archives"] .archive-workspace');
    const posts = Array.from(root?.querySelectorAll('[data-archive-post-option]') || []);
    return {
      pathname: location.pathname,
      appId: document.body.dataset.pageApp || '',
      activeYear: root?.dataset.activeYear || '',
      activeMonthKey: root?.dataset.activeMonthKey || '',
      currentPage: Number(root?.dataset.currentPage || 1),
      pageSize: Number(root?.dataset.pageSize || 0),
      indexCompleteValue: root?.getAttribute('data-archive-index-complete') ?? 'absent',
      indexComplete: root?.dataset.archiveIndexComplete === 'true',
      years: Array.from(root?.querySelectorAll('[data-archive-year-option]') || []).map((node) => node.dataset.year),
      months: Array.from(root?.querySelectorAll('[data-archive-month-option]') || []).map((node) => ({
        key: node.dataset.monthKey,
        count: Number(node.dataset.monthCount || 0),
        href: node.getAttribute('href') || ''
      })),
      postKeys: posts.map((node) => node.dataset.postKey),
      nextUrl: root?.querySelector('[data-archive-loadmore]')?.dataset.nextUrl || '',
      outerPagination: Boolean(root?.querySelector('.archive-pagination')),
      completionText: Array.from(root?.querySelectorAll('.archive-load-state') || [])
        .find((node) => node.offsetParent !== null)?.textContent?.trim() || '',
      focusedPostKey: document.activeElement?.dataset?.postKey || '',
      marker: document.documentElement.dataset.archiveVerifyMarker || ''
    };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (/^Failed to load resource:/i.test(message.text())) return;
  runtimeErrors.push(`console: ${message.text()}`);
});

try {
  const response = await page.goto(absoluteUrl(archivesBasePath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(response?.status(), 200, '归档根路由必须返回 200');
  await waitForArchive(page);

  const marker = `archive-${Date.now()}`;
  await page.evaluate((value) => { document.documentElement.dataset.archiveVerifyMarker = value; }, marker);
  const rootState = await archiveState(page);
  assert.equal(rootState.appId, 'explorer-archives', '归档根路由必须激活 explorer-archives');
  assert.ok(rootState.years.length > 0, '归档根路由必须展示年份索引');
  assert.equal(new Set(rootState.years).size, rootState.years.length, '年份索引不得重复');
  assert.equal(rootState.outerPagination, false, '归档工作区不得保留全局上一页/下一页');
  assert.ok(rootState.pageSize > 0, '归档页大小必须来自 Halo 配置');
  assert.equal(rootState.indexComplete, true, `归档年月索引不得因统计/分页漂移而截断（实际 ${rootState.indexCompleteValue || 'missing'}）`);

  let candidate = null;
  for (const year of rootState.years) {
    await page.goto(absoluteUrl(`${archivesBasePath}/${year}`), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForArchive(page, { year });
    const state = await archiveState(page);
    const overflowMonth = state.months.find((month) => month.count > state.pageSize);
    if (overflowMonth && state.months.length > 1) {
      candidate = { year, month: overflowMonth, months: state.months };
      break;
    }
    if (!candidate && overflowMonth) candidate = { year, month: overflowMonth, months: state.months };
  }
  assert.ok(candidate, '需要至少一个超过 archivePageSize 的月份样本');

  await page.goto(absoluteUrl(archivesBasePath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForArchive(page);
  await page.evaluate((value) => { document.documentElement.dataset.archiveVerifyMarker = value; }, marker);

  await verifyPendingPjaxLoading({
    page,
    targetUrl: absoluteUrl(`${archivesBasePath}/${candidate.year}`),
    action: () => page.locator(`[data-archive-year-option][data-year="${candidate.year}"]`).click(),
    preservedSelector: '[data-app-root="explorer-archives"] .archive-workspace',
    expectWindowOverlay: false,
    label: '归档年份切换'
  });
  await page.waitForFunction((path) => location.pathname === path, `${archivesBasePath}/${candidate.year}`);
  await waitForArchive(page, { year: candidate.year });
  await assertPjaxLoadingSettled(page, '归档年份切换');
  assert.equal((await archiveState(page)).marker, marker, '年份切换必须走 PJAX，不能整页刷新');

  const monthKey = candidate.month.key;
  const monthPath = pathnameOf(candidate.month.href);
  await verifyPendingPjaxLoading({
    page,
    targetUrl: absoluteUrl(candidate.month.href),
    action: () => page.locator(`[data-archive-month-option][data-month-key="${monthKey}"]`).click(),
    preservedSelector: '[data-app-root="explorer-archives"] .archive-workspace',
    expectWindowOverlay: false,
    label: '归档月份切换'
  });
  await page.waitForFunction((path) => location.pathname === path, monthPath);
  await waitForArchive(page, { year: candidate.year, monthKey });
  await assertPjaxLoadingSettled(page, '归档月份切换');

  const firstMonthState = await archiveState(page);
  assert.equal(firstMonthState.marker, marker, '月份切换必须走 PJAX，不能整页刷新');
  assert.deepEqual(firstMonthState.years, rootState.years, '月份页必须保留完整年份索引');
  assert.equal(firstMonthState.postKeys.length, firstMonthState.pageSize, '超量月份第一页必须遵循 Halo archivePageSize');
  assert.equal(new Set(firstMonthState.postKeys).size, firstMonthState.postKeys.length, '第一页文章不得重复');
  assert.equal(pathnameOf(firstMonthState.nextUrl), `${monthPath}/page/2`, '继续加载必须使用原生月内 /page/2 路由');

  const alternateMonth = firstMonthState.months.find((month) => month.key !== monthKey);
  if (alternateMonth) {
    const alternatePath = pathnameOf(alternateMonth.href);
    await page.locator(`[data-archive-month-option][data-month-key="${alternateMonth.key}"]`).click();
    await page.waitForFunction((path) => location.pathname === path, alternatePath);
    await waitForArchive(page, { monthKey: alternateMonth.key });
    await page.goBack();
    await page.waitForFunction((path) => location.pathname === path, monthPath);
    await waitForArchive(page, { monthKey });
    await page.goForward();
    await page.waitForFunction((path) => location.pathname === path, alternatePath);
    await waitForArchive(page, { monthKey: alternateMonth.key });
    await page.goBack();
    await page.waitForFunction((path) => location.pathname === path, monthPath);
    await waitForArchive(page, { monthKey });
    assert.equal((await archiveState(page)).marker, marker, '后退/前进必须保持同一文档与归档激活状态');
  }

  const yearsBeforeAppend = (await archiveState(page)).years;
  const monthsBeforeAppend = (await archiveState(page)).months.map((month) => `${month.key}:${month.count}`);
  const firstNextUrl = (await archiveState(page)).nextUrl;
  let previousCount = (await archiveState(page)).postKeys.length;

  for (let pageGuard = 0; pageGuard < 50; pageGuard += 1) {
    const trigger = page.locator('[data-archive-loadmore]');
    if (!await trigger.isVisible()) break;
    await trigger.click();
    await page.waitForFunction((count) => (
      document.querySelectorAll('[data-archive-post-option]').length > count
    ), previousCount, { timeout: 15_000 });
    const state = await archiveState(page);
    assert.ok(state.postKeys.length > previousCount, '每次继续加载都必须追加新文章');
    previousCount = state.postKeys.length;
  }

  const appendedState = await archiveState(page);
  const finalPage = Math.ceil(candidate.month.count / appendedState.pageSize);
  assert.equal(appendedState.pathname, `${monthPath}/page/${finalPage}`, '继续加载后必须同步可刷新的原生月分页深链');
  assert.equal(appendedState.postKeys.length, candidate.month.count, '继续加载后必须得到该月全部文章');
  assert.equal(new Set(appendedState.postKeys).size, appendedState.postKeys.length, '继续加载后文章不得重复');
  assert.deepEqual(appendedState.years, yearsBeforeAppend, '继续加载不得替换年份索引');
  assert.deepEqual(appendedState.months.map((month) => `${month.key}:${month.count}`), monthsBeforeAppend, '继续加载不得替换月份索引');
  assert.equal(appendedState.marker, marker, '继续加载不得触发 Document 刷新');
  assert.match(appendedState.completionText, new RegExp(`${candidate.month.count}\\s*篇`), '完成状态必须播报正确的本月总数');
  assert.ok(appendedState.focusedPostKey, '继续加载后焦点必须移动到第一篇新增文章');

  const archivePreviewAction = page.locator('.archive-preview-action');
  assert.equal(await archivePreviewAction.count(), 1, '归档必须提供唯一预览打开入口');
  const archivePostHref = await archivePreviewAction.getAttribute('href');
  assert.ok(archivePostHref, '归档预览必须提供真实文章地址');
  await verifyPendingPjaxLoading({
    page,
    targetUrl: absoluteUrl(archivePostHref),
    action: () => archivePreviewAction.click(),
    preservedSelector: '[data-app-root="explorer-archives"] .archive-workspace',
    expectWindowOverlay: true,
    label: '归档进入正文'
  });
  await page.waitForFunction(() => document.body?.dataset.pageApp === 'reader');
  await assertPjaxLoadingSettled(page, '归档进入正文');
  await page.goBack();
  await waitForArchive(page, { year: candidate.year, monthKey });
  const restoredState = await archiveState(page);
  assert.equal(restoredState.postKeys.length, candidate.month.count, '打开文章后返回必须恢复已加载的累计文章');
  assert.equal(restoredState.pathname, `${monthPath}/page/${finalPage}`, '打开文章后返回必须恢复累计分页深链');

  const pageTwoResponse = await page.goto(absoluteUrl(firstNextUrl), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  assert.equal(pageTwoResponse?.status(), 200, '月内第二页必须可直接访问');
  await waitForArchive(page, { year: candidate.year, monthKey });
  const pageTwoState = await archiveState(page);
  assert.equal(pageTwoState.appId, 'explorer-archives', '月内第二页必须仍由 explorer-archives 接管');
  assert.equal(pageTwoState.currentPage, 2, '月内第二页协议页码必须为 2');
  assert.equal(pageTwoState.postKeys.length, Math.min(pageTwoState.pageSize * 2, candidate.month.count), '月内第二页直达必须累计恢复前两页文章');
  if (candidate.month.count <= pageTwoState.pageSize * 2) {
    assert.match(pageTwoState.completionText, new RegExp(`${candidate.month.count}\\s*篇`), '月内第二页直达完成文案必须使用全月数量');
  } else {
    assert.equal(pathnameOf(pageTwoState.nextUrl), `${monthPath}/page/3`, '未加载完成的月内第二页必须继续指向第 3 页');
  }
  assert.deepEqual(pageTwoState.years, rootState.years, '月内第二页直达必须保留完整年份索引');

  const invalidMonthResponse = await page.goto(
    absoluteUrl(`${archivesBasePath}/${candidate.year}/13`),
    { waitUntil: 'domcontentloaded', timeout: 20_000 }
  );
  assert.equal(invalidMonthResponse?.status(), 200, 'Halo 非法月份路由当前应返回可渲染空态');
  await page.waitForSelector('[data-app-root="explorer-archives"] .archive-empty');

  const overflowResponse = await page.goto(
    absoluteUrl(`${monthPath}/page/999999`),
    { waitUntil: 'domcontentloaded', timeout: 20_000 }
  );
  assert.equal(overflowResponse?.status(), 200, 'Halo 越界月分页当前应返回可渲染空态');
  await page.waitForSelector('[data-app-root="explorer-archives"] .archive-empty');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(absoluteUrl(monthPath), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForArchive(page, { year: candidate.year, monthKey });
  const mobileState = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    yearHeight: document.querySelector('[data-archive-year-option]')?.getBoundingClientRect().height || 0,
    monthHeight: document.querySelector('[data-archive-month-option]')?.getBoundingClientRect().height || 0,
    loadMoreHeight: document.querySelector('[data-archive-loadmore]')?.getBoundingClientRect().height || 0
  }));
  assert.equal(mobileState.overflow, false, '390px 移动端归档不得横向溢出');
  assert.ok(mobileState.yearHeight >= 44, '移动端年份触控目标不得低于 44px');
  assert.ok(mobileState.monthHeight >= 44, '移动端月份触控目标不得低于 44px');
  assert.ok(mobileState.loadMoreHeight >= 44, '移动端继续加载触控目标不得低于 44px');

  assert.deepEqual(runtimeErrors, [], `归档真页出现运行时错误：${runtimeErrors.join(' | ')}`);
  console.log(`归档真页验证通过：${candidate.month.key} ${candidate.month.count} 篇，分页大小 ${rootState.pageSize}`);
} finally {
  await browser.close();
}
