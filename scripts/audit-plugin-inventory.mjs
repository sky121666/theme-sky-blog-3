import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

// This is the exact plugin fixture used by the theme's strict local audit.
// It is intentionally separate from the theme's minimum compatibility contract:
// optional plugins remain optional unless --strict-theme is explicitly enabled.
export const THEME_PLUGIN_MANIFEST = Object.freeze([
  { id: 'plugin-bilibili-bangumi', expectedVersion: '1.4.1', aliases: [] },
  { id: 'plugin-docsme', expectedVersion: '1.7.0', aliases: [] },
  { id: 'PluginPhotos', expectedVersion: '2.1.2', aliases: [] },
  { id: 'PluginMoments', expectedVersion: '1.16.1', aliases: [] },
  { id: 'PluginLinks', expectedVersion: '2.2.1', aliases: ['plugin-links'] },
  { id: 'halo-plugin-steam', expectedVersion: '1.0.0', aliases: ['steam', 'PluginSteam', 'plugin-steam'] },
  { id: 'plugin-equipment', expectedVersion: '1.1.1', aliases: ['equipment'] },
  { id: 'PluginCommentWidget', expectedVersion: '3.1.2', aliases: ['plugin-comment-widget'] },
  { id: 'PluginSearchWidget', expectedVersion: '1.7.1', aliases: ['plugin-search-widget'] },
  { id: 'auth-passkey', expectedVersion: '1.0.4', aliases: [] },
  { id: 'plugin-shiki', expectedVersion: '1.4.1', aliases: ['shiki'] },
  { id: 'plugin-katex', expectedVersion: '3.0.0', aliases: [] },
  { id: 'text-diagram', expectedVersion: '1.5.2', aliases: [] },
  { id: 'seo-tools', expectedVersion: '1.9.5', aliases: ['plugin-seo-tools'] },
  { id: 'PluginLightGallery', expectedVersion: '1.2.1', aliases: ['plugin-lightgallery'] },
  { id: 'plugin-online', expectedVersion: '1.0.5', aliases: ['online'] },
  { id: 'plugin-douban', expectedVersion: '1.2.5', aliases: [] },
  { id: 'PluginFeed', expectedVersion: '1.5.0', aliases: ['plugin-feed'] },
  { id: 'PluginContactForm', expectedVersion: '1.6.4', aliases: ['plugin-contact-form'] },
  { id: 'editor-hyperlink-card', expectedVersion: '1.9.2', aliases: ['plugin-editor-hyperlink-card'] },
  { id: 'lottery', expectedVersion: '1.0.2', aliases: ['plugin-lottery'] },
  { id: 'restricted-reading', expectedVersion: '1.8.1', aliases: ['plugin-restricted-reading'] },
  { id: 'vote', expectedVersion: '1.1.3', aliases: ['plugin-vote'] },
  { id: 'ai-assistant', expectedVersion: '2.2.4', aliases: ['plugin-ai-assistant'] }
].map((entry) => Object.freeze({
  ...entry,
  aliases: Object.freeze([...entry.aliases])
})));

const COMPATIBILITY_PINS = new Map([
  ['PluginLinks', '2.2.1']
]);

function nameKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildPluginAliasIndex(manifest = THEME_PLUGIN_MANIFEST) {
  const index = new Map();
  for (const entry of manifest) {
    for (const candidate of [entry.id, ...(entry.aliases || [])]) {
      const key = nameKey(candidate);
      const existing = index.get(key);
      if (existing && existing !== entry.id) {
        throw new Error(`插件别名冲突: ${candidate} -> ${existing} / ${entry.id}`);
      }
      index.set(key, entry.id);
    }
  }
  return index;
}

export function resolvePluginId(value, manifest = THEME_PLUGIN_MANIFEST) {
  const original = String(value || '').trim();
  if (!original) return '';
  return buildPluginAliasIndex(manifest).get(nameKey(original)) || original;
}

export function normalizePhase(plugin) {
  if (plugin.status?.phase) return String(plugin.status.phase).toUpperCase();
  const ready = (plugin.status?.conditions || []).find((condition) => condition.type === 'Ready');
  return ready?.status === 'True' ? 'READY' : 'UNKNOWN';
}

export function normalizePluginInventory(plugins, manifest = THEME_PLUGIN_MANIFEST) {
  return (Array.isArray(plugins) ? plugins : [])
    .map((plugin) => {
      const name = String(plugin.metadata?.name || '').trim();
      return {
        name,
        canonicalName: resolvePluginId(name, manifest),
        version: String(plugin.spec?.version || '').trim(),
        enabled: plugin.spec?.enabled === true,
        phase: normalizePhase(plugin)
      };
    })
    .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
}

export function assertCompatibilityPins(rows) {
  const violations = rows
    .filter((row) => COMPATIBILITY_PINS.has(row.canonicalName || row.name))
    .filter((row) => row.version !== COMPATIBILITY_PINS.get(row.canonicalName || row.name));

  if (!violations.length) return;

  const details = violations
    .map((row) => `${row.name}=${row.version || 'unknown'}（要求 ${COMPATIBILITY_PINS.get(row.canonicalName || row.name)}）`)
    .join(', ');
  throw new Error(`插件兼容固定版本不匹配: ${details}`);
}

export function assertStrictThemeInventory(rows, manifest = THEME_PLUGIN_MANIFEST) {
  const rowsByCanonicalName = new Map();
  for (const row of rows) {
    const bucket = rowsByCanonicalName.get(row.canonicalName) || [];
    bucket.push(row);
    rowsByCanonicalName.set(row.canonicalName, bucket);
  }

  const violations = [];
  for (const expected of manifest) {
    const matches = rowsByCanonicalName.get(expected.id) || [];
    if (matches.length === 0) {
      violations.push(`${expected.id}: missing`);
      continue;
    }
    if (matches.length > 1) {
      violations.push(`${expected.id}: duplicate manifests (${matches.map((row) => row.name).join(', ')})`);
      continue;
    }

    const [actual] = matches;
    if (!actual.enabled) violations.push(`${expected.id}: disabled`);
    if (actual.phase !== 'STARTED') violations.push(`${expected.id}: phase=${actual.phase || 'UNKNOWN'}（要求 STARTED）`);
    if (actual.version !== expected.expectedVersion) {
      violations.push(`${expected.id}: version=${actual.version || 'unknown'}（要求 ${expected.expectedVersion}）`);
    }
  }

  if (violations.length) {
    throw new Error(`主题严格插件清单不匹配:\n- ${violations.join('\n- ')}`);
  }
}

export function parseCliArgs(args) {
  const requestedNames = [];
  let strictTheme = false;
  for (const rawArg of args) {
    const arg = String(rawArg || '').trim();
    if (!arg || arg === '--') continue;
    if (arg === '--strict-theme') {
      strictTheme = true;
      continue;
    }
    requestedNames.push(arg);
  }
  return { strictTheme, requestedNames };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const variables = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    variables[match[1]] = value;
  }
  return variables;
}

function normalizeBaseUrl(value) {
  return String(value || 'http://localhost:8090').replace(/\/+$/, '');
}

function selectRows(rows, requestedNames) {
  if (!requestedNames.length) return rows;
  const requested = new Set(requestedNames.map((name) => nameKey(resolvePluginId(name))));
  return rows.filter((row) => requested.has(nameKey(row.canonicalName)) || requested.has(nameKey(row.name)));
}

function assertRequestedNames(rows, requestedNames) {
  if (!requestedNames.length) return;
  const found = new Set(rows.flatMap((row) => [nameKey(row.name), nameKey(row.canonicalName)]));
  const missing = requestedNames.filter((name) => {
    const canonicalName = resolvePluginId(name);
    return !found.has(nameKey(name)) && !found.has(nameKey(canonicalName));
  });
  if (missing.length) {
    throw new Error(`Halo 未返回目标插件: ${missing.join(', ')}`);
  }
}

async function main() {
  const envFile = readEnvFile(path.join(root, '.env.local'));
  const token = process.env.FIVEEE_PAT || envFile.FIVEEE_PAT || '';
  if (!token) {
    throw new Error('缺少 FIVEEE_PAT，请先在 .env.local 或环境变量中配置');
  }

  const baseUrl = normalizeBaseUrl(process.env.HALO_BASE_URL || envFile.HALO_BASE_URL);
  const { strictTheme, requestedNames } = parseCliArgs(process.argv.slice(2));
  const response = await fetch(`${baseUrl}/apis/plugin.halo.run/v1alpha1/plugins`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`插件清单接口失败: ${response.status} ${detail.slice(0, 200)}`.trim());
  }

  const payload = await response.json();
  const allRows = normalizePluginInventory(payload.items);
  assertRequestedNames(allRows, requestedNames);
  const rows = selectRows(allRows, requestedNames);

  console.log(`Halo 插件清单：${baseUrl}`);
  console.table(rows);
  assertCompatibilityPins(rows);

  const activePins = rows
    .filter((row) => COMPATIBILITY_PINS.has(row.canonicalName))
    .map((row) => `${row.canonicalName}@${row.version}`);
  if (activePins.length) {
    console.log(`主题兼容固定版本：${activePins.join(', ')}`);
  }

  if (strictTheme) {
    assertStrictThemeInventory(allRows);
    console.log(`主题严格插件清单通过（${THEME_PLUGIN_MANIFEST.length} 个插件）`);
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`audit-plugin-inventory failed: ${error.message}`);
    process.exitCode = 1;
  });
}
