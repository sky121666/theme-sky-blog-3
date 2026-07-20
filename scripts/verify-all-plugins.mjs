import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

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

const fileEnv = readEnvFile(path.join(root, '.env.local'));
const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const explicitBaseUrls = [
  ['HALO_BASE_URL', process.env.HALO_BASE_URL],
  ['SMOKE_BASE_URL', process.env.SMOKE_BASE_URL],
  ['AUDIT_BASE_URL', process.env.AUDIT_BASE_URL],
  ['PERF_BASE_URL', process.env.PERF_BASE_URL]
].filter(([, value]) => normalizeBaseUrl(value));
const haloBaseUrl = normalizeBaseUrl(
  explicitBaseUrls[0]?.[1]
    || fileEnv.HALO_BASE_URL
    || 'http://localhost:8090'
);

const conflictingBaseUrls = explicitBaseUrls
  .filter(([, value]) => normalizeBaseUrl(value) !== haloBaseUrl)
  .map(([name, value]) => `${name}=${normalizeBaseUrl(value)}`);
if (conflictingBaseUrls.length > 0) {
  throw new Error(`全插件门禁必须验证同一个 Halo 实例；基准 ${haloBaseUrl}，冲突 ${conflictingBaseUrls.join(', ')}`);
}

const childEnv = {
  ...process.env,
  HALO_BASE_URL: haloBaseUrl,
  SMOKE_BASE_URL: haloBaseUrl,
  AUDIT_BASE_URL: haloBaseUrl,
  PERF_BASE_URL: haloBaseUrl,
  SMOKE_REQUIRE_PLUGIN_ROUTES: 'true',
  AUDIT_REQUIRE_PLUGIN_ROUTES: 'true'
};
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const steps = [
  'check',
  'audit:plugins:strict',
  'verify:reload',
  'verify:docsme',
  'verify:moments',
  'verify:moments-lifecycle',
  'verify:seo-contract',
  'verify:shiki-adaptation',
  'verify:plugins:live',
  'smoke:playwright',
  'audit:real-pages',
  'verify:performance',
  'verify:pjax-cold-assets',
  'verify:pjax-lifecycle'
];

for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  const result = spawnSync(pnpmCommand, ['run', step], {
    cwd: root,
    env: childEnv,
    stdio: 'inherit'
  });
  if (result.error) {
    throw new Error(`${step} 无法执行: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`\n全插件兼容门禁通过（${haloBaseUrl}）`);
