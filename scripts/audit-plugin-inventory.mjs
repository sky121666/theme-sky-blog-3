import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const COMPATIBILITY_PINS = new Map([
  ['PluginLinks', '2.0.0']
]);

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

function normalizePhase(plugin) {
  if (plugin.status?.phase) return plugin.status.phase;
  const ready = (plugin.status?.conditions || []).find((condition) => condition.type === 'Ready');
  return ready?.status === 'True' ? 'READY' : 'UNKNOWN';
}

function assertCompatibilityPins(rows) {
  const violations = rows
    .filter((row) => COMPATIBILITY_PINS.has(row.name))
    .filter((row) => row.version !== COMPATIBILITY_PINS.get(row.name));

  if (!violations.length) return;

  const details = violations
    .map((row) => `${row.name}=${row.version || 'unknown'}（要求 ${COMPATIBILITY_PINS.get(row.name)}）`)
    .join(', ');
  throw new Error(`插件兼容固定版本不匹配: ${details}`);
}

async function main() {
  const envFile = readEnvFile(path.join(root, '.env.local'));
  const token = process.env.FIVEEE_PAT || envFile.FIVEEE_PAT || '';
  if (!token) {
    throw new Error('缺少 FIVEEE_PAT，请先在 .env.local 或环境变量中配置');
  }

  const baseUrl = normalizeBaseUrl(process.env.HALO_BASE_URL || envFile.HALO_BASE_URL);
  const requestedNames = new Set(
    process.argv.slice(2)
      .map((name) => name.trim())
      .filter((name) => name && name !== '--')
  );
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
  const plugins = Array.isArray(payload.items) ? payload.items : [];
  const rows = plugins
    .filter((plugin) => !requestedNames.size || requestedNames.has(plugin.metadata?.name))
    .map((plugin) => ({
      name: plugin.metadata?.name || '',
      version: plugin.spec?.version || '',
      enabled: Boolean(plugin.spec?.enabled),
      phase: normalizePhase(plugin)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (requestedNames.size) {
    const found = new Set(rows.map((row) => row.name));
    const missing = [...requestedNames].filter((name) => !found.has(name));
    if (missing.length) {
      throw new Error(`Halo 未返回目标插件: ${missing.join(', ')}`);
    }
  }

  console.log(`Halo 插件清单：${baseUrl}`);
  console.table(rows);
  assertCompatibilityPins(rows);

  const activePins = rows
    .filter((row) => COMPATIBILITY_PINS.has(row.name))
    .map((row) => `${row.name}@${row.version}`);
  if (activePins.length) {
    console.log(`主题兼容固定版本：${activePins.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`audit-plugin-inventory failed: ${error.message}`);
  process.exitCode = 1;
});
