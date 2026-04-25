import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function readThemeName() {
  const themeYaml = fs.readFileSync(path.join(root, 'theme.yaml'), 'utf8');
  const match = themeYaml.match(/^\s*name:\s*(.+)$/m);
  if (!match) {
    throw new Error('无法从 theme.yaml 解析主题名');
  }
  return match[1].trim();
}

function normalizeBaseUrl(value) {
  return String(value || 'http://localhost:8090').replace(/\/+$/, '');
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} 缺少字段: ${needle}`);
  }
}

async function verifyRoute(baseUrl, route) {
  const url = new URL(route.path, `${baseUrl}/`).toString();
  const { response, text } = await fetchText(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  if (route.optional && response.status === 404) {
    return { name: route.name, path: route.path, status: 404, skipped: true };
  }

  if (!response.ok) {
    throw new Error(`${route.path} 返回 ${response.status}`);
  }

  assertIncludes(text, `data-page-mode="${route.pageMode}"`, route.path);
  assertIncludes(text, `data-window-variant="${route.windowVariant}"`, route.path);

  if (route.appId) {
    assertIncludes(text, `data-app-id="${route.appId}"`, route.path);
  }

  let detail = '';
  if (route.verifyFirstGroup) {
    const groupHref = text.match(/href="([^"]*\/equipments\?group=[^"]+)"/)?.[1];
    if (groupHref) {
      const groupUrl = new URL(groupHref.replace(/&amp;/g, '&'), `${baseUrl}/`).toString();
      const { response: groupResponse, text: groupText } = await fetchText(groupUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml'
        }
      });
      if (!groupResponse.ok) {
        throw new Error(`${new URL(groupUrl).pathname}${new URL(groupUrl).search} 返回 ${groupResponse.status}`);
      }
      assertIncludes(groupText, `data-page-mode="${route.pageMode}"`, groupUrl);
      assertIncludes(groupText, `data-window-variant="${route.windowVariant}"`, groupUrl);
      assertIncludes(groupText, `data-app-id="${route.appId}"`, groupUrl);
      detail = ' + group';
    }
  }

  return { name: route.name, path: route.path, status: response.status, skipped: false, detail };
}

async function waitForHome(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { response, text } = await fetchText(`${baseUrl}/`, {
        headers: {
          Accept: 'text/html,application/xhtml+xml'
        }
      });

      if (response.ok && text.includes('data-page-mode=')) {
        return;
      }
      lastError = new Error(`首页状态 ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`重载后首页未恢复: ${lastError?.message || 'unknown error'}`);
}

async function main() {
  const envFileVars = readEnvFile(path.join(root, '.env.local'));
  const token = process.env.FIVEEE_PAT || envFileVars.FIVEEE_PAT || '';
  if (!token) {
    throw new Error('缺少 FIVEEE_PAT，请先在 .env.local 或环境变量中配置');
  }

  const baseUrl = normalizeBaseUrl(process.env.HALO_BASE_URL || envFileVars.HALO_BASE_URL || 'http://localhost:8090');
  const themeName = readThemeName();
  const reloadUrl = `${baseUrl}/apis/api.console.halo.run/v1alpha1/themes/${themeName}/reload`;

  console.log(`Reloading theme: ${themeName}`);
  console.log(`Base URL: ${baseUrl}`);

  const reloadResponse = await fetch(reloadUrl, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });

  if (!reloadResponse.ok) {
    const body = await reloadResponse.text().catch(() => '');
    throw new Error(`reload 接口失败: ${reloadResponse.status} ${body.slice(0, 200)}`.trim());
  }

  await waitForHome(baseUrl);

  const routes = [
    { name: 'home', path: '/', pageMode: 'browser-home', windowVariant: 'none', appId: '' },
    { name: 'archives', path: '/archives', pageMode: 'browser-list', windowVariant: 'browser', appId: 'explorer-archives' },
    { name: 'moments', path: '/moments', pageMode: 'browser-moments', windowVariant: 'moments', appId: 'moments', optional: true },
    { name: 'friends', path: '/friends', pageMode: 'browser-friends', windowVariant: 'friends', appId: 'friends', optional: true },
    { name: 'links', path: '/links', pageMode: 'browser-links', windowVariant: 'links', appId: 'links', optional: true },
    { name: 'bangumis', path: '/bangumis', pageMode: 'browser-bangumis', windowVariant: 'bangumis', appId: 'bangumis', optional: true },
    { name: 'steam', path: '/steam', pageMode: 'browser-steam', windowVariant: 'steam', appId: 'steam', optional: true },
    { name: 'equipments', path: '/equipments', pageMode: 'browser-equipments', windowVariant: 'equipments', appId: 'equipments', optional: true, verifyFirstGroup: true },
    { name: 'docsme', path: '/docs', pageMode: 'browser-docsme', windowVariant: 'docsme', appId: 'docsme', optional: true },
    { name: 'photos', path: '/photos', pageMode: 'browser-list', windowVariant: 'photos', appId: 'photos', optional: true }
  ];

  const results = [];
  for (const route of routes) {
    results.push(await verifyRoute(baseUrl, route));
  }

  console.log('\nReload verify result:');
  for (const result of results) {
    const suffix = result.skipped ? ' (skipped)' : '';
    console.log(`- ${result.name}: ${result.status}${result.detail || ''}${suffix}`);
  }
}

main().catch((error) => {
  console.error(`verify:reload failed: ${error.message}`);
  process.exit(1);
});
