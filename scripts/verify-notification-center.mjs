import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'playwright');
const baseUrl = normalizeBaseUrl(process.env.NOTIFICATION_BASE_URL || process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090');
const username = (process.env.HALO_TEST_USERNAME || '').trim();
const password = (process.env.HALO_TEST_PASSWORD || '').trim();
const configEndpoint = `${baseUrl}/apis/api.console.halo.run/v1alpha1/themes/theme-sky-blog-3/json-config`;
const userApiPattern = /\/apis\/api\.console\.halo\.run\/v1alpha1\/users\/-/;
const notificationsPattern = /\/apis\/api\.notification\.halo\.run\/v1alpha1\/userspaces\/[^/]+\/notifications/;

function normalizeBaseUrl(value) {
  return String(value || 'http://localhost:8090').replace(/\/+$/, '');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function screenshot(page, name) {
  await ensureOutputDir();
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

function createRequestLog(page) {
  const hits = [];
  const handler = (request) => {
    const url = request.url();
    if (userApiPattern.test(url) || notificationsPattern.test(url)) {
      hits.push(url);
    }
  };
  page.on('request', handler);
  return {
    hits,
    stop() {
      page.off('request', handler);
    }
  };
}

async function panelState(page) {
  return page.evaluate(() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const menubar = document.querySelector('.menubar');
    const data = window.Alpine?.$data?.(menubar) || {};
    const panel = document.querySelector('#notification-center-panel');
    const rect = panel?.getBoundingClientRect();
    return {
      title: document.querySelector('.notification-center-title-stack h2')?.textContent?.trim() || '',
      ariaLabel: panel?.getAttribute('aria-label') || '',
      defaultOpen: data.notificationCenterDefaultOpen ?? null,
      authenticated: data.notificationCenterAuthenticated ?? null,
      authResolved: data.notificationCenterAuthResolved ?? null,
      status: data.notificationStatus || '',
      unreadCount: data.notificationUnreadCount ?? null,
      totalCount: data.notificationTotalCount ?? null,
      panelVisible: visible('#notification-center-panel'),
      feedVisible: visible('.notification-center-feed'),
      segmentedVisible: visible('.notification-center-segmented'),
      footerVisible: visible('.notification-center-widget-toolbar'),
      widgetVisible: visible('.notification-center-widgets'),
      refreshExists: !!document.querySelector('.notification-center-refresh'),
      currentUser: window.__THEME_DESKTOP_PROTOCOL__?.widgets?.sources?.currentUser || null,
      authorWidget: (() => {
        const card = document.querySelector(
          '.desktop-widget-card.widget--halo-author_card:not(.desktop-widget-card--preview), .notification-widget-card.widget--halo-author_card:not(.desktop-widget-card--preview)'
        );
        if (!card) return null;
        const style = getComputedStyle(card);
        const box = card.getBoundingClientRect();
        return {
          visible: style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0,
          authenticated: card.querySelector('.wg-author-compact')?.dataset?.authorAuthenticated || '',
          name: card.querySelector('.wg-author-name')?.textContent?.trim() || '',
          bio: card.querySelector('.wg-author-bio')?.textContent?.trim() || '',
          href: card.querySelector('.wg-author-head')?.getAttribute('href') || '',
          app: card.querySelector('.wg-author-head')?.getAttribute('data-pjax-app') || ''
        };
      })(),
      shellStyle: document.querySelector('link[href*="/assets/css/shell-core/index.css"]')?.href || '',
      manifestBootstrap: [...document.scripts].some((script) => script.textContent.includes('asset-manifest.json')),
      rect: rect ? {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        right: Math.round(rect.right)
      } : null
    };
  });
}

async function openSidebar(page) {
  await page.locator('.menubar-time').click();
  await page.locator('#notification-center-panel').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(1200);
}

async function verifyGuest(page, report) {
  const requests = createRequestLog(page);
  await page.goto(`${baseUrl}/?notification-guest=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await openSidebar(page);
  const state = await panelState(page);
  const shot = await screenshot(page, 'notification-center-guest');
  requests.stop();

  assert(state.manifestBootstrap, '首页缺少 asset-manifest 引导脚本');
  assert(state.shellStyle.includes('r='), 'shell 样式缺少 revision 查询参数');
  assert(state.title === '小组件', `未登录标题应为“小组件”，当前为 ${state.title}`);
  assert(state.ariaLabel === '小组件', `未登录 aria-label 应为“小组件”，当前为 ${state.ariaLabel}`);
  assert(state.authenticated === false, '未登录状态应解析为 false');
  assert(state.authResolved === true, '未登录状态应完成解析');
  assert(state.currentUser?.authenticated === false, '未登录时桌面小组件协议 currentUser.authenticated 应为 false');
  assert(state.widgetVisible, '未登录应显示小组件区域');
  assert(!state.feedVisible, '未登录不应显示通知列表');
  assert(!state.segmentedVisible, '未登录不应显示未读/全部切换');
  assert(!state.footerVisible, '未登录不应显示编辑小组件和底部关闭按钮');
  assert(!state.refreshExists, '通知中心不应保留隐藏刷新按钮');
  assert(!requests.hits.some((url) => notificationsPattern.test(url)), '未登录不应请求通知列表接口');

  report.checks.push({
    name: 'guest widgets-only sidebar',
    state,
    userApiHits: requests.hits.filter((url) => userApiPattern.test(url)).length,
    notificationApiHits: requests.hits.filter((url) => notificationsPattern.test(url)).length,
    screenshot: shot
  });
}

async function login(page) {
  const current = await page.request.get(`${baseUrl}/apis/api.console.halo.run/v1alpha1/users/-`, {
    headers: { Accept: 'application/json' }
  }).catch(() => null);
  if (current?.ok()) {
    const data = await current.json().catch(() => null);
    const currentName = data?.user?.metadata?.name || data?.metadata?.name || '';
    if (currentName && currentName !== 'anonymousUser') return;
  }

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  const usernameInput = page.locator('input[name="username"], input[autocomplete="username"], input[type="text"], input[type="email"]').first();
  if ((await usernameInput.count()) === 0) {
    const response = await page.request.get(`${baseUrl}/apis/api.console.halo.run/v1alpha1/users/-`, {
      headers: { Accept: 'application/json' }
    });
    assert(response.ok(), `登录页未显示输入框，且当前用户接口返回 ${response.status()}`);
    return;
  }
  await usernameInput.fill(username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 }),
    page.locator('button[type="submit"], input[type="submit"]').first().click()
  ]);
  const response = await page.request.get(`${baseUrl}/apis/api.console.halo.run/v1alpha1/users/-`, {
    headers: { Accept: 'application/json' }
  });
  assert(response.ok(), `登录后当前用户接口返回 ${response.status()}`);
}

async function logout(page) {
  await page.goto(`${baseUrl}/logout`, { waitUntil: 'domcontentloaded' });
  const submit = page.locator('form[action="/logout"] button[type="submit"], form button[type="submit"]').first();
  await submit.waitFor({ state: 'visible', timeout: 8000 });
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/logout'), { timeout: 15000 }).catch(() => page.waitForLoadState('domcontentloaded')),
    submit.click()
  ]);
}

async function fetchConfig(page) {
  return page.evaluate(async (url) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`GET config ${response.status}`);
    }
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error('GET config returned non-JSON response');
    }
    return response.json();
  }, configEndpoint);
}

async function putConfig(page, config) {
  return page.evaluate(async ({ url, config }) => {
    const xsrf = document.cookie.split('; ').find((row) => row.startsWith('XSRF-TOKEN='))?.split('=')[1];
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (xsrf) {
      headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);
    }
    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(config)
    });
    if (!response.ok) {
      throw new Error(`PUT config ${response.status}: ${await response.text()}`);
    }
  }, { url: configEndpoint, config });
}

function withSidebarConfig(config, patch) {
  const next = structuredClone(config);
  next.sidebar = next.sidebar || {};
  next.sidebar.notification_center = {
    ...(next.sidebar.notification_center || {}),
    ...patch
  };
  return next;
}

function withAuthorCardLayout(config) {
  const next = structuredClone(config);
  next.default_layout = next.default_layout && typeof next.default_layout === 'object' && !Array.isArray(next.default_layout)
    ? { ...next.default_layout }
    : {};
  next.default_layout.layout_json = JSON.stringify({
    version: 3,
    layoutVersion: 'v1',
    columns: 12,
    instances: [
      {
        key: 'verify-author-card-desktop',
        title: '作者卡片',
        widget: 'halo.author_card',
        size: 'small',
        appearance: 'follow',
        x: 1,
        y: 1,
        surface: 'desktop',
        order: 1,
        meta: {}
      },
      {
        key: 'verify-author-card-sidebar',
        title: '作者卡片',
        widget: 'halo.author_card',
        size: 'small',
        appearance: 'follow',
        x: 1,
        y: 1,
        surface: 'notification-center',
        order: 1,
        meta: {}
      }
    ],
    hasFullIconDefs: true,
    icons: []
  });
  return next;
}

async function verifyAuthenticated(page, report) {
  await login(page);

  const requests = createRequestLog(page);
  await page.goto(`${baseUrl}/?notification-auth=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await openSidebar(page);
  const state = await panelState(page);
  const shot = await screenshot(page, 'notification-center-authenticated');
  requests.stop();

  assert(state.authenticated === true, '登录后通知中心应解析为 authenticated');
  assert(state.authResolved === true, '登录后通知中心应完成登录态解析');
  assert(state.currentUser?.authenticated === true, '登录后桌面小组件协议 currentUser.authenticated 应为 true');
  assert(state.currentUser?.name || state.currentUser?.displayName, '登录后桌面小组件协议应包含当前用户标识');
  if (state.authorWidget?.visible) {
    const expectedName = state.currentUser.displayName || state.currentUser.name;
    assert(state.authorWidget.name === expectedName, `作者小组件登录态应显示当前用户，当前为 ${state.authorWidget.name}`);
    assert(state.authorWidget.href === '/uc', `作者小组件登录态应指向 /uc，当前为 ${state.authorWidget.href}`);
    assert(state.authorWidget.app === 'auth', `作者小组件登录态应使用 auth app，当前为 ${state.authorWidget.app}`);
    assert(state.authorWidget.authenticated === 'true', `作者小组件登录态标记应为 true，当前为 ${state.authorWidget.authenticated}`);
  }
  assert(state.title === '通知中心', `登录后标题应为“通知中心”，当前为 ${state.title}`);
  assert(state.feedVisible, '登录后应显示通知列表');
  assert(state.segmentedVisible, '登录后应显示未读/全部切换');
  assert(state.footerVisible, '登录后应显示底部小组件工具栏');
  assert(state.widgetVisible, '登录后应保留小组件区域');
  assert(requests.hits.some((url) => notificationsPattern.test(url)), '登录后应请求通知列表接口');

  report.checks.push({
    name: 'authenticated notification center',
    state,
    apiHits: requests.hits.length,
    screenshot: shot
  });
}

async function verifyAuthorCardRealLayout(page, report) {
  await login(page);
  const originalConfig = await fetchConfig(page);

  try {
    await putConfig(page, withAuthorCardLayout(originalConfig));
    await logout(page);

    await page.goto(`${baseUrl}/?author-card-guest=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await openSidebar(page);
    const guestState = await panelState(page);
    const guestShot = await screenshot(page, 'author-card-real-layout-guest');

    assert(guestState.authorWidget?.visible, '临时布局下未登录应渲染真实作者卡片');
    assert(guestState.authorWidget.authenticated === 'false', `未登录作者卡片标记应为 false，当前为 ${guestState.authorWidget.authenticated}`);
    assert(guestState.authorWidget.name && guestState.authorWidget.name !== guestState.currentUser?.displayName, '未登录作者卡片应显示默认站点作者，而不是当前用户');
    assert(guestState.authorWidget.href !== '/uc', `未登录作者卡片不应指向 /uc，当前为 ${guestState.authorWidget.href}`);

    await login(page);
    await page.goto(`${baseUrl}/?author-card-auth=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await openSidebar(page);
    const authState = await panelState(page);
    const authShot = await screenshot(page, 'author-card-real-layout-authenticated');
    const expectedName = authState.currentUser?.displayName || authState.currentUser?.name || '';

    assert(authState.authorWidget?.visible, '临时布局下登录后应渲染真实作者卡片');
    assert(authState.currentUser?.authenticated === true, '登录后 currentUser.authenticated 应为 true');
    assert(authState.authorWidget.authenticated === 'true', `登录后作者卡片标记应为 true，当前为 ${authState.authorWidget.authenticated}`);
    assert(authState.authorWidget.name === expectedName, `登录后作者卡片应显示当前用户，当前为 ${authState.authorWidget.name}`);
    assert(authState.authorWidget.bio === authState.currentUser.bio, `登录后作者卡片简介应显示当前用户简介，当前为 ${authState.authorWidget.bio}`);
    assert(authState.authorWidget.href === '/uc', `登录后作者卡片应指向 /uc，当前为 ${authState.authorWidget.href}`);
    assert(authState.authorWidget.app === 'auth', `登录后作者卡片应使用 auth app，当前为 ${authState.authorWidget.app}`);

    report.checks.push({
      name: 'real layout author card guest/auth switch',
      guestState,
      authState,
      screenshots: [guestShot, authShot]
    });
  } finally {
    await login(page);
    await putConfig(page, originalConfig);
    await logout(page);
  }
}

async function verifyDefaultOpen(page, report) {
  await login(page);
  const originalConfig = await fetchConfig(page);
  try {
    await putConfig(page, withSidebarConfig(originalConfig, {
      title: '侧边栏测试',
      guest_title: '访客组件',
      default_open: true
    }));
    await page.goto(`${baseUrl}/archives?notification-default-open=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#notification-center-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);
    const state = await panelState(page);
    const shot = await screenshot(page, 'notification-center-default-open');

    assert(state.defaultOpen === true, '默认展开运行时状态应为 true');
    assert(state.panelVisible, '默认展开开启后归档页应自动打开侧边栏');
    assert(state.title === '侧边栏测试', `默认展开标题应使用后台配置，当前为 ${state.title}`);

    report.checks.push({
      name: 'configured title and default open',
      state,
      screenshot: shot
    });
  } finally {
    await putConfig(page, originalConfig);
  }
}

async function verifyLogoutGuest(page, report) {
  await logout(page);
  const requests = createRequestLog(page);
  await page.goto(`${baseUrl}/?notification-logout=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await openSidebar(page);
  const state = await panelState(page);
  const shot = await screenshot(page, 'notification-center-logout-guest');
  requests.stop();

  assert(state.authenticated === false, '退出登录后应恢复访客态');
  assert(state.authResolved === true, '退出登录后应完成访客态解析');
  assert(state.currentUser?.authenticated === false, '退出登录后桌面小组件协议 currentUser.authenticated 应为 false');
  assert(state.title === '小组件', `退出登录后标题应为“小组件”，当前为 ${state.title}`);
  assert(state.widgetVisible, '退出登录后应显示小组件区域');
  assert(!state.feedVisible, '退出登录后不应显示通知列表');
  assert(!state.segmentedVisible, '退出登录后不应显示未读/全部切换');
  assert(!state.footerVisible, '退出登录后不应显示底部工具栏');
  assert(!requests.hits.some((url) => notificationsPattern.test(url)), '退出登录后不应请求通知列表接口');

  report.checks.push({
    name: 'logout returns to guest sidebar',
    state,
    notificationApiHits: requests.hits.filter((url) => notificationsPattern.test(url)).length,
    screenshot: shot
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleIssues = [];
  const report = {
    baseUrl,
    checks: [],
    skipped: []
  };

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });

  try {
    await verifyGuest(page, report);

    if (username && password) {
      await verifyAuthenticated(page, report);
      await verifyAuthorCardRealLayout(page, report);
      await verifyDefaultOpen(page, report);
      await verifyLogoutGuest(page, report);
    } else {
      report.skipped.push('未设置 HALO_TEST_USERNAME/HALO_TEST_PASSWORD，跳过登录态、默认展开和退出登录验证');
    }

    report.consoleIssues = consoleIssues.filter((line) => !/favicon|Failed to load resource.*404/i.test(line));
    assert(report.consoleIssues.length === 0, `存在相关 console issue: ${report.consoleIssues.join(' | ')}`);
  } finally {
    await browser.close();
  }

  await ensureOutputDir();
  const reportFile = path.join(outputDir, 'notification-center-report.json');
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('通知中心验证通过');
  console.log(`详细报告: ${reportFile}`);
  if (report.skipped.length) {
    console.log(`跳过: ${report.skipped.join('；')}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
