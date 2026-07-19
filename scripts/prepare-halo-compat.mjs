import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const baseUrl = new URL(requiredEnv('HALO_BASE_URL'));
const username = requiredEnv('HALO_ADMIN_USERNAME');
const password = requiredEnv('HALO_ADMIN_PASSWORD');
const expectedHaloVersion = requiredEnv('HALO_EXPECTED_VERSION');
const packagePath = path.resolve(root, requiredEnv('THEME_PACKAGE_PATH'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const themeName = 'theme-sky-blog-3';
const timeoutMs = 45_000;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function urlFor(pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function responseDetail(response) {
  const body = await response.text().catch(() => '');
  return `HTTP ${response.status()}${body ? `: ${body.slice(0, 500)}` : ''}`;
}

async function setupIfNeeded(page) {
  await page.goto(urlFor('/console'), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (new URL(page.url()).pathname !== '/system/setup') return;

  await page.locator('input[name="externalUrl"]').fill(baseUrl.toString().replace(/\/$/, ''));
  await page.locator('input[name="siteTitle"]').fill(`theme-sky-blog-3 Halo ${expectedHaloVersion}`);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="email"]').fill('theme-ci@example.invalid');
  const passwordInputs = page.locator('input[type="password"]');
  assert(await passwordInputs.count() === 2, 'Halo 初始化页密码字段数量异常');
  await passwordInputs.nth(0).fill(password);
  await passwordInputs.nth(1).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((value) => ['/login', '/console'].some((prefix) => new URL(value).pathname.startsWith(prefix)), {
    timeout: timeoutMs
  });
}

async function loginIfNeeded(page) {
  if (new URL(page.url()).pathname.startsWith('/console')) return;
  if (new URL(page.url()).pathname !== '/login') {
    await page.goto(urlFor('/console'), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }
  if (!new URL(page.url()).pathname.startsWith('/login')) return;

  await page.locator('input[name="username"]:visible').fill(username);
  await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await page.waitForURL((value) => new URL(value).pathname.startsWith('/console'), { timeout: timeoutMs });
}

async function csrfHeaders(context) {
  const cookies = await context.cookies(baseUrl.toString());
  const csrf = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
  return csrf ? { 'X-XSRF-TOKEN': decodeURIComponent(csrf.value) } : {};
}

function listItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function themeIdentity(theme) {
  return {
    name: theme?.metadata?.name || theme?.name || '',
    version: theme?.spec?.version || theme?.version || ''
  };
}

async function installOrUpgradeTheme(page, context) {
  assert(fs.existsSync(packagePath) && fs.statSync(packagePath).isFile(), `主题包不存在: ${packagePath}`);
  const headers = await csrfHeaders(context);
  const listResponse = await page.request.get(urlFor('/apis/api.console.halo.run/v1alpha1/themes'), { headers });
  assert(listResponse.ok(), `读取 Halo 主题列表失败：${await responseDetail(listResponse)}`);
  const themes = listItems(await listResponse.json());
  const installed = themes.some((theme) => themeIdentity(theme).name === themeName);
  const endpoint = installed
    ? `/apis/api.console.halo.run/v1alpha1/themes/${themeName}/upgrade`
    : '/apis/api.console.halo.run/v1alpha1/themes/install';
  const uploadResponse = await page.request.post(urlFor(endpoint), {
    headers,
    multipart: {
      file: {
        name: path.basename(packagePath),
        mimeType: 'application/zip',
        buffer: fs.readFileSync(packagePath)
      }
    },
    timeout: timeoutMs
  });
  assert(uploadResponse.ok(), `${installed ? '升级' : '安装'}主题失败：${await responseDetail(uploadResponse)}`);

  const activationResponse = await page.request.put(
    urlFor(`/apis/api.console.halo.run/v1alpha1/themes/${themeName}/activation`),
    { headers, timeout: timeoutMs }
  );
  assert(activationResponse.ok(), `启用主题失败：${await responseDetail(activationResponse)}`);

  let reloadFailure = '';
  let reloaded = false;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const reloadResponse = await page.request.put(
      urlFor(`/apis/api.console.halo.run/v1alpha1/themes/${themeName}/reload`),
      { headers, timeout: timeoutMs }
    );
    if (reloadResponse.ok()) {
      reloaded = true;
      break;
    }
    reloadFailure = await responseDetail(reloadResponse);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(reloaded, `重载主题失败：${reloadFailure}`);
}

async function verifyTheme(page) {
  let lastStatus = 0;
  let html = '';
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await page.request.get(urlFor('/'), { timeout: timeoutMs });
    lastStatus = response.status();
    html = await response.text();
    if (response.ok() && html.includes('data-page-mode="browser-home"')) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assert(lastStatus === 200, `主题首页应返回 200，实际为 ${lastStatus}`);
  assert(html.includes(`content="Halo ${expectedHaloVersion}"`), `首页 generator 不是 Halo ${expectedHaloVersion}`);
  assert(html.includes('data-page-mode="browser-home"'), '首页缺少 data-page-mode="browser-home"');
  assert(html.includes('data-window-variant="none"'), '首页缺少 data-window-variant="none"');
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await setupIfNeeded(page);
    await loginIfNeeded(page);
    await installOrUpgradeTheme(page, context);
    await verifyTheme(page);
    console.log(`Halo ${expectedHaloVersion} 主题准备通过 | theme=${themeName}@${packageJson.version}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`prepare-halo-compat failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
