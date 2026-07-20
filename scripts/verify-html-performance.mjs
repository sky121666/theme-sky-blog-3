import { gzipSync } from 'node:zlib';

const KIB = 1024;
const DEFAULT_BASE_URL = 'http://localhost:8090';
const MAX_RAW_BYTES = 512 * KIB;
const MAX_GZIP_BYTES = 100 * KIB;
const REQUEST_TIMEOUT_MS = 20_000;
const PLUGIN_BUDGET_ENV = 'PERF_MAX_PLUGIN_RESOURCES';
const PLUGIN_REFERENCE_BUDGET_ENV = 'PERF_MAX_PLUGIN_RESOURCE_REFS';
const IMAGE_BUDGET_ENV = 'PERF_MAX_IMAGES';
const ROUTES_ENV = 'PERF_ROUTES';
const OPTIONAL_ROUTES_ENV = 'PERF_OPTIONAL_ROUTES';
const DEFAULT_PLUGIN_RESOURCE_BUDGET = 30;
const DEFAULT_PLUGIN_REFERENCE_BUDGET = 60;
const DEFAULT_IMAGE_BUDGET = 120;
const DEFAULT_ROUTES = ['/', '/categories', '/moments'];

function parseBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL).trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`PERF_BASE_URL 仅支持 http/https，当前为 ${url.protocol}`);
  }
  return url;
}

function parseBudget(value, envName, defaultValue) {
  const input = String(value || '').trim();
  if (!input) return defaultValue;
  if (!/^\d+$/.test(input)) {
    throw new Error(`${envName} 必须是非负整数，当前为 ${JSON.stringify(input)}`);
  }
  return Number.parseInt(input, 10);
}

function parseRoutes(value) {
  const input = String(value || '').trim();
  const routes = input ? input.split(',').map((route) => route.trim()).filter(Boolean) : DEFAULT_ROUTES;
  if (!routes.length) throw new Error(`${ROUTES_ENV} 至少需要一个路由`);
  for (const route of routes) {
    if (!route.startsWith('/') || route.startsWith('//')) {
      throw new Error(`${ROUTES_ENV} 只接受站内绝对路径，当前为 ${JSON.stringify(route)}`);
    }
  }
  return [...new Set(routes)];
}

function parseOptionalRoutes(value, routes) {
  const input = String(value || '').trim();
  if (!input) return [];
  const optionalRoutes = parseRoutes(input);
  for (const route of optionalRoutes) {
    if (!routes.includes(route)) {
      throw new Error(`${OPTIONAL_ROUTES_ENV} 只能包含 ${ROUTES_ENV} 中的路由，当前为 ${JSON.stringify(route)}`);
    }
  }
  return optionalRoutes;
}

function formatBytes(bytes) {
  return `${bytes} B (${(bytes / KIB).toFixed(1)} KiB)`;
}

function readAttribute(source, name) {
  const pattern = new RegExp(
    String.raw`(?:^|[\t\n\f\r ])${name}[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'=<>]+))`,
    'i'
  );
  const match = source.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_match, hex, decimal) => {
      const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return '';
      }
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}

function isUnsafeImageSource(value) {
  const normalized = decodeHtmlAttribute(value)
    .trim()
    .replace(/[\u0000-\u0020\u007f]+/g, '');
  return /^(?:data|blob|javascript):/i.test(normalized);
}

function extractImages(html) {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const images = [];
  const imagePattern = /<img\b[^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(markup))) {
    const src = readAttribute(match[0], 'src');
    images.push({ tag: match[0], src });
  }

  return images;
}

function normalizeResourceUrl(value, documentUrl) {
  const decoded = decodeHtmlAttribute(value).trim();
  const absolute = new URL(decoded, documentUrl);
  const documentOrigin = new URL(documentUrl).origin;
  return {
    key: absolute.toString(),
    display: absolute.origin === documentOrigin
      ? `${absolute.pathname}${absolute.search}${absolute.hash}`
      : absolute.toString(),
    pathname: absolute.pathname
  };
}

function addPluginResource(resources, kind, value, documentUrl) {
  if (!value) return;
  try {
    const normalized = normalizeResourceUrl(value, documentUrl);
    if (!/(?:^|\/)plugins\//i.test(normalized.pathname)) return;
    resources.push({ kind, ...normalized });
  } catch {
    // 非法 URL 由浏览器自行忽略；这里只统计能够解析的插件资源。
  }
}

function extractPluginResources(html, documentUrl) {
  const resources = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const linkPattern = /<link\b([^>]*)>/gi;
  let match;

  while ((match = scriptPattern.exec(html))) {
    const [, attributes, body] = match;
    addPluginResource(resources, 'script', readAttribute(attributes, 'src'), documentUrl);

    const importPatterns = [
      /\bimport\s+(?:[^;"']{0,500}?\s+from\s+)?(["'])([^"']+)\1/g,
      /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g
    ];
    for (const importPattern of importPatterns) {
      let importMatch;
      while ((importMatch = importPattern.exec(body))) {
        addPluginResource(resources, 'script-import', importMatch[2], documentUrl);
      }
    }
  }

  while ((match = linkPattern.exec(html))) {
    addPluginResource(resources, 'link', readAttribute(match[1], 'href'), documentUrl);
  }

  const uniqueMap = new Map();
  for (const resource of resources) {
    const existing = uniqueMap.get(resource.key);
    if (existing) {
      existing.kinds.add(resource.kind);
      existing.references += 1;
      continue;
    }
    uniqueMap.set(resource.key, {
      url: resource.display,
      kinds: new Set([resource.kind]),
      references: 1
    });
  }

  return {
    references: resources,
    unique: [...uniqueMap.values()]
      .map((resource) => ({ ...resource, kinds: [...resource.kinds].sort() }))
      .sort((left, right) => left.url.localeCompare(right.url))
  };
}

async function inspectRoute(baseUrl, route) {
  const url = new URL(route, baseUrl).toString();
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const raw = Buffer.from(await response.arrayBuffer());
  const html = raw.toString('utf8');
  const gzipBytes = gzipSync(raw).byteLength;
  const images = extractImages(html);
  const unsafeImages = images.filter((image) => image.src !== null && isUnsafeImageSource(image.src));
  const pluginResources = extractPluginResources(html, response.url || url);

  return {
    route,
    url,
    finalUrl: response.url || url,
    status: response.status,
    rawBytes: raw.byteLength,
    gzipBytes,
    imageCount: images.length,
    unsafeImages,
    pluginResources
  };
}

function createFailure(route, metric, message) {
  return { route, metric, message };
}

function collectFailures(result, budgets) {
  const failures = [];
  if (result.status !== 200) {
    failures.push(createFailure(result.route, 'http-status', `${result.route} HTTP 状态应为 200，实际为 ${result.status}`));
  }
  if (result.rawBytes > MAX_RAW_BYTES) {
    failures.push(createFailure(
      result.route,
      'raw-html',
      `${result.route} 原始 HTML ${formatBytes(result.rawBytes)} 超过 ${formatBytes(MAX_RAW_BYTES)}`
    ));
  }
  if (result.gzipBytes > MAX_GZIP_BYTES) {
    failures.push(createFailure(
      result.route,
      'gzip-html',
      `${result.route} gzip HTML ${formatBytes(result.gzipBytes)} 超过 ${formatBytes(MAX_GZIP_BYTES)}`
    ));
  }
  if (result.imageCount > budgets.imageCount) {
    failures.push(createFailure(
      result.route,
      'images',
      `${result.route} HTML 图片 ${result.imageCount} 张，超过 ${IMAGE_BUDGET_ENV}=${budgets.imageCount}`
    ));
  }
  for (const image of result.unsafeImages) {
    failures.push(createFailure(
      result.route,
      'unsafe-image',
      `${result.route} 包含不允许的 img src: ${JSON.stringify(image.src)}`
    ));
  }
  if (result.pluginResources.unique.length > budgets.pluginUnique) {
    failures.push(createFailure(
      result.route,
      'plugin-unique',
      `${result.route} 唯一插件资源 ${result.pluginResources.unique.length} 个，超过 ${PLUGIN_BUDGET_ENV}=${budgets.pluginUnique}`
    ));
  }
  if (result.pluginResources.references.length > budgets.pluginReferences) {
    failures.push(createFailure(
      result.route,
      'plugin-references',
      `${result.route} 插件资源引用 ${result.pluginResources.references.length} 次，超过 ${PLUGIN_REFERENCE_BUDGET_ENV}=${budgets.pluginReferences}`
    ));
  }
  return failures;
}

function printResult(result) {
  const scriptCount = result.pluginResources.references
    .filter((resource) => resource.kind === 'script' || resource.kind === 'script-import').length;
  const linkCount = result.pluginResources.references
    .filter((resource) => resource.kind === 'link').length;

  console.log(`\n[html-performance] ${result.route}`);
  console.log(`  status: ${result.status}`);
  console.log(`  raw: ${formatBytes(result.rawBytes)}`);
  console.log(`  gzip: ${formatBytes(result.gzipBytes)}`);
  console.log(`  images: ${result.imageCount} (unsafe: ${result.unsafeImages.length})`);
  console.log(
    `  plugin resources: ${result.pluginResources.unique.length} unique / `
      + `${result.pluginResources.references.length} refs (script: ${scriptCount}, link: ${linkCount})`
  );

  if (!result.pluginResources.unique.length) {
    console.log('  plugin URLs: none');
    return;
  }

  console.log('  plugin URLs:');
  for (const resource of result.pluginResources.unique) {
    const referenceSuffix = resource.references > 1 ? ` x${resource.references}` : '';
    console.log(`    - [${resource.kinds.join('+')}] ${resource.url}${referenceSuffix}`);
  }
}

async function main() {
  const baseUrl = parseBaseUrl(process.env.PERF_BASE_URL);
  const budgets = {
    pluginUnique: parseBudget(
      process.env[PLUGIN_BUDGET_ENV],
      PLUGIN_BUDGET_ENV,
      DEFAULT_PLUGIN_RESOURCE_BUDGET
    ),
    pluginReferences: parseBudget(
      process.env[PLUGIN_REFERENCE_BUDGET_ENV],
      PLUGIN_REFERENCE_BUDGET_ENV,
      DEFAULT_PLUGIN_REFERENCE_BUDGET
    ),
    imageCount: parseBudget(
      process.env[IMAGE_BUDGET_ENV],
      IMAGE_BUDGET_ENV,
      DEFAULT_IMAGE_BUDGET
    )
  };
  const routes = parseRoutes(process.env[ROUTES_ENV]);
  const optionalRoutes = new Set(parseOptionalRoutes(process.env[OPTIONAL_ROUTES_ENV], routes));
  const failures = [];

  console.log(`HTML performance base URL: ${baseUrl}`);
  console.log(`Limits: raw <= ${formatBytes(MAX_RAW_BYTES)}, gzip <= ${formatBytes(MAX_GZIP_BYTES)}`);
  console.log(`Image budget: <= ${budgets.imageCount} images per route`);
  console.log(
    `Plugin budget: <= ${budgets.pluginUnique} unique resources / `
      + `<= ${budgets.pluginReferences} references per route`
  );
  console.log(`Routes: ${routes.join(', ')}`);
  if (optionalRoutes.size) {
    console.log(`Optional routes (404 = skipped): ${[...optionalRoutes].join(', ')}`);
  }

  for (const route of routes) {
    try {
      const result = await inspectRoute(baseUrl, route);
      printResult(result);
      if (result.status === 404 && optionalRoutes.has(route)) {
        console.log('  optional route not installed: skipped');
        continue;
      }
      failures.push(...collectFailures(result, budgets));
    } catch (error) {
      failures.push(createFailure(route, 'request', `${route} 请求失败: ${error.message}`));
      console.error(`\n[html-performance] ${route}\n  request failed: ${error.message}`);
    }
  }

  if (failures.length) {
    console.error('\nHTML performance verification failed:');
    const failedRoutes = new Set(failures.map((failure) => failure.route));
    const metricCounts = failures.reduce((counts, failure) => {
      counts.set(failure.metric, (counts.get(failure.metric) || 0) + 1);
      return counts;
    }, new Map());
    console.error(
      `失败摘要: ${failures.length} 项，影响 ${failedRoutes.size}/${routes.length} 个路由；`
      + [...metricCounts.entries()].map(([metric, count]) => `${metric}=${count}`).join(', ')
    );
    for (const failure of failures) {
      console.error(`- ${failure.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nHTML performance verification passed.');
}

main().catch((error) => {
  console.error(`verify-html-performance failed: ${error.message}`);
  process.exitCode = 1;
});
