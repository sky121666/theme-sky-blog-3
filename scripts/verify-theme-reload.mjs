import fs from 'node:fs';
import path from 'node:path';
import { normalizePluginInventory } from './audit-plugin-inventory.mjs';

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

function countTags(pattern, html) {
  return [...html.matchAll(pattern)].length;
}

function collectDuplicateHeadTagWarning(head, pattern, label, routePath) {
  const count = countTags(pattern, head);
  if (count > 1) {
    return `${routePath} SEO 标签重复: ${label} x${count}`;
  }
  return '';
}

function verifySeoHead(text, routePath) {
  const head = text.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  return [
    collectDuplicateHeadTagWarning(head, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi, 'canonical', routePath),
    collectDuplicateHeadTagWarning(head, /<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/gi, 'description', routePath),
    collectDuplicateHeadTagWarning(head, /<meta\b(?=[^>]*\bproperty=["']og:title["'])[^>]*>/gi, 'og:title', routePath),
    collectDuplicateHeadTagWarning(head, /<meta\b(?=[^>]*\bproperty=["']og:description["'])[^>]*>/gi, 'og:description', routePath),
    collectDuplicateHeadTagWarning(head, /<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi, 'og:url', routePath),
    collectDuplicateHeadTagWarning(head, /<meta\b(?=[^>]*\bname=["']twitter:title["'])[^>]*>/gi, 'twitter:title', routePath),
    collectDuplicateHeadTagWarning(head, /<meta\b(?=[^>]*\bname=["']twitter:description["'])[^>]*>/gi, 'twitter:description', routePath),
    collectDuplicateHeadTagWarning(head, /<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\btype=["']application\/rss\+xml["'])[^>]*>/gi, 'rss alternate', routePath)
  ].filter(Boolean);
}

function hasCanonical(text) {
  const head = text.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  return /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i.test(head);
}

function verifyRssAlternate(text, expected, routePath) {
  const head = text.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const tags = [...head.matchAll(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\btype=["']application\/rss\+xml["'])[^>]*>/gi)]
    .map((match) => match[0]);
  const expectedCount = expected ? 1 : 0;
  if (tags.length !== expectedCount) {
    throw new Error(`${routePath} RSS alternate 数量为 ${tags.length}，期望 ${expectedCount}`);
  }
  if (!expected) return;

  const href = tags[0].match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
  const pathname = new URL(href, 'http://theme.local/').pathname;
  if (pathname !== '/rss.xml') {
    throw new Error(`${routePath} RSS alternate 地址错误: ${href || 'missing'}`);
  }
}

async function verifyRoute(baseUrl, route) {
  const url = new URL(route.path, `${baseUrl}/`).toString();
  const verifyUrl = new URL(url);
  verifyUrl.searchParams.set('_theme_reload_verify', String(Date.now()));
  const { response, text } = await fetchText(verifyUrl.toString(), {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache'
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

  const seoWarnings = verifySeoHead(text, route.path);
  if (route.requireH1) {
    assertIncludes(text, '<h1', route.path);
  }
  if (route.requireCanonical && !hasCanonical(text)) {
    throw new Error(`${route.path} 缺少字段: canonical`);
  }
  if (typeof route.expectRssAvailable === 'boolean') {
    verifyRssAlternate(text, route.expectRssAvailable, route.path);
  }

  let detail = '';
  if (seoWarnings.length) {
    detail += ` + seo-warning(${seoWarnings.length})`;
  }
  if (typeof route.expectRssAvailable === 'boolean') {
    detail += ` + rss(${route.expectRssAvailable ? 'available' : 'absent'})`;
  }
  if (route.verifyFirstGroup) {
    const groupHref = text.match(/href="([^"]*\/equipments\?group=[^"]+)"/)?.[1];
    if (groupHref) {
      const groupUrl = new URL(groupHref.replace(/&amp;/g, '&'), `${baseUrl}/`).toString();
      const verifyGroupUrl = new URL(groupUrl);
      verifyGroupUrl.searchParams.set('_theme_reload_verify', String(Date.now()));
      const { response: groupResponse, text: groupText } = await fetchText(verifyGroupUrl.toString(), {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Cache-Control': 'no-cache'
        }
      });
      if (!groupResponse.ok) {
        throw new Error(`${new URL(groupUrl).pathname}${new URL(groupUrl).search} 返回 ${groupResponse.status}`);
      }
      assertIncludes(groupText, `data-page-mode="${route.pageMode}"`, groupUrl);
      assertIncludes(groupText, `data-window-variant="${route.windowVariant}"`, groupUrl);
      assertIncludes(groupText, `data-app-id="${route.appId}"`, groupUrl);
      detail += ' + group';
    }
  }

  return { name: route.name, path: route.path, status: response.status, skipped: false, detail, warnings: seoWarnings };
}

async function waitForHome(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const homeUrl = new URL('/', `${baseUrl}/`);
      homeUrl.searchParams.set('_theme_reload_verify', String(Date.now()));
      const { response, text } = await fetchText(homeUrl.toString(), {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Cache-Control': 'no-cache'
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

async function readAvailablePlugins(baseUrl, token) {
  const response = await fetch(`${baseUrl}/apis/plugin.halo.run/v1alpha1/plugins`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`读取插件状态失败: ${response.status} ${detail.slice(0, 200)}`.trim());
  }
  const payload = await response.json();
  return new Set(normalizePluginInventory(payload.items)
    .filter((row) => row.enabled && row.phase === 'STARTED')
    .map((row) => row.canonicalName));
}

async function verifyPluginFeedEndpoint(baseUrl, available) {
  if (!available) return;
  const response = await fetch(new URL('/rss.xml', `${baseUrl}/`), {
    headers: { Accept: 'application/rss+xml,application/xml,text/xml' }
  });
  if (!response.ok) {
    throw new Error(`/rss.xml 返回 ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('xml')) {
    throw new Error(`/rss.xml Content-Type 非 XML: ${contentType || 'missing'}`);
  }
  console.log(`PluginFeed endpoint: ${response.status} ${contentType}`);
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
  const availablePlugins = await readAvailablePlugins(baseUrl, token);
  const pluginFeedAvailable = availablePlugins.has('PluginFeed');

  console.log(`Reloading theme: ${themeName}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`PluginFeed RSS: ${pluginFeedAvailable ? 'available' : 'absent'}`);

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
  await verifyPluginFeedEndpoint(baseUrl, pluginFeedAvailable);

  const pluginRoute = (pluginId, route) => ({
    ...route,
    optional: !availablePlugins.has(pluginId)
  });
  const routes = [
    { name: 'home', path: '/', pageMode: 'browser-home', windowVariant: 'none', appId: '', requireH1: true, requireCanonical: true, expectRssAvailable: pluginFeedAvailable },
    { name: 'archives', path: '/archives', pageMode: 'browser-list', windowVariant: 'browser', appId: 'explorer-archives', requireH1: true, requireCanonical: true },
    { name: 'categories', path: '/categories', pageMode: 'browser-list', windowVariant: 'browser', appId: 'explorer-categories', requireH1: true, requireCanonical: true },
    { name: 'tags', path: '/tags', pageMode: 'browser-list', windowVariant: 'browser', appId: 'explorer-tags', requireH1: true, requireCanonical: true },
    pluginRoute('PluginMoments', { name: 'moments', path: '/moments', pageMode: 'browser-moments', windowVariant: 'moments', appId: 'moments', requireH1: true, requireCanonical: true }),
    pluginRoute('plugin-friends', { name: 'friends', path: '/friends', pageMode: 'browser-friends', windowVariant: 'friends', appId: 'friends' }),
    pluginRoute('PluginLinks', { name: 'links', path: '/links', pageMode: 'browser-links', windowVariant: 'links', appId: 'links' }),
    pluginRoute('plugin-bilibili-bangumi', { name: 'bangumis', path: '/bangumis', pageMode: 'browser-bangumis', windowVariant: 'bangumis', appId: 'bangumis' }),
    pluginRoute('plugin-douban', { name: 'douban', path: '/douban', pageMode: 'browser-douban', windowVariant: 'douban', appId: 'douban' }),
    pluginRoute('halo-plugin-steam', { name: 'steam', path: '/steam', pageMode: 'browser-steam', windowVariant: 'steam', appId: 'steam' }),
    pluginRoute('plugin-equipment', { name: 'equipments', path: '/equipments', pageMode: 'browser-equipments', windowVariant: 'equipments', appId: 'equipments', verifyFirstGroup: true }),
    pluginRoute('plugin-docsme', { name: 'docsme', path: '/docs', pageMode: 'browser-docsme', windowVariant: 'docsme', appId: 'docsme' }),
    pluginRoute('PluginPhotos', { name: 'photos', path: '/photos', pageMode: 'browser-list', windowVariant: 'photos', appId: 'photos', requireH1: true, requireCanonical: true })
  ];

  const results = [];
  for (const route of routes) {
    results.push(await verifyRoute(baseUrl, route));
  }

  console.log('\nReload verify result:');
  for (const result of results) {
    const suffix = result.skipped ? ' (skipped)' : '';
    console.log(`- ${result.name}: ${result.status}${result.detail || ''}${suffix}`);
    for (const warning of result.warnings || []) {
      console.warn(`  warn: ${warning}`);
    }
  }
}

main().catch((error) => {
  console.error(`verify:reload failed: ${error.message}`);
  process.exit(1);
});
