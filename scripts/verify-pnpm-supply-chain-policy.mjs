import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'security/dependency-policy.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const maximumExceptionWindowMs = 14 * 24 * 60 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readYamlList(sectionName) {
  const lines = workspace.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${sectionName}:`);
  if (start < 0) return [];

  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z]/.test(line)) break;
    const match = line.match(/^\s+-\s+(['"]?)(.+?)\1\s*$/);
    if (match) values.push(match[2]);
  }
  return values;
}

function splitPackageVersion(value) {
  const separator = value.lastIndexOf('@');
  assert(separator > 0 && separator < value.length - 1, `最小发布时间排除项必须精确到版本: ${value}`);
  return { name: value.slice(0, separator), version: value.slice(separator + 1) };
}

const excluded = readYamlList('minimumReleaseAgeExclude').map(splitPackageVersion);
const buildRules = workspace.match(/^allowBuilds:\s*\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1]
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean) || [];
const exceptions = policy.minimumReleaseAgeExceptions || [];
const approved = new Map();
const now = Date.now();

for (const exception of exceptions) {
  assert(Array.isArray(exception.packages) && exception.packages.length > 0, '最小发布时间例外缺少 packages');
  assert(/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(exception.version || ''), `最小发布时间例外版本无效: ${exception.version || '?'}`);
  assert(String(exception.reason || '').trim().length >= 20, `${exception.packages.join(', ')} 的最小发布时间例外缺少充分理由`);
  assert(String(exception.owner || '').trim(), `${exception.packages.join(', ')} 的最小发布时间例外缺少 owner`);
  const expiresAt = Date.parse(exception.expires || '');
  assert(Number.isFinite(expiresAt), `${exception.packages.join(', ')} 的最小发布时间例外 expires 无效`);
  assert(expiresAt > now, `${exception.packages.join(', ')} 的最小发布时间例外已过期`);
  assert(expiresAt - now <= maximumExceptionWindowMs, `${exception.packages.join(', ')} 的最小发布时间例外超过 14 天上限`);

  for (const packageName of exception.packages) {
    assert(!packageName.includes('*'), `最小发布时间例外禁止通配符: ${packageName}`);
    const key = `${packageName}@${exception.version}`;
    assert(!approved.has(key), `重复的最小发布时间例外: ${key}`);
    approved.set(key, exception);
  }
}

const excludedKeys = new Set(excluded.map(({ name, version }) => `${name}@${version}`));
for (const key of excludedKeys) {
  assert(approved.has(key), `pnpm minimumReleaseAgeExclude 缺少有期限审查记录: ${key}`);
}
for (const key of approved.keys()) {
  assert(excludedKeys.has(key), `依赖策略存在已不再使用的最小发布时间例外: ${key}`);
}

assert(/^minimumReleaseAge:[ \t]*10080[ \t]*(?:#.*)?$/m.test(workspace), 'pnpm minimumReleaseAge 必须保持 10080 分钟');
assert(/^minimumReleaseAgeStrict:[ \t]*true[ \t]*(?:#.*)?$/m.test(workspace), 'pnpm minimumReleaseAgeStrict 必须开启');
assert(/^trustPolicy:[ \t]*no-downgrade[ \t]*(?:#.*)?$/m.test(workspace), 'pnpm trustPolicy 必须为 no-downgrade');
assert(/^blockExoticSubdeps:[ \t]*true[ \t]*(?:#.*)?$/m.test(workspace), 'pnpm blockExoticSubdeps 必须开启');
assert(/^minimumReleaseAgeIgnoreMissingTime:[ \t]*false[ \t]*(?:#.*)?$/m.test(workspace), '缺少发布时间的依赖不得跳过最小发布时间校验');
assert(/^strictDepBuilds:[ \t]*true[ \t]*(?:#.*)?$/m.test(workspace), '未批准的依赖构建脚本必须阻止安装');
assert(/^strictPeerDependencies:[ \t]*true[ \t]*(?:#.*)?$/m.test(workspace), '依赖 peer 冲突必须阻止安装');
assert(/^engineStrict:[ \t]*true[ \t]*(?:#.*)?$/m.test(workspace), '依赖 Node engine 冲突必须阻止安装');
assert(/^pmOnFail:[ \t]*error[ \t]*(?:#.*)?$/m.test(workspace), 'pnpm 版本不匹配必须报错');
assert(!/^dangerouslyAllowAllBuilds:[ \t]*true(?:[ \t]|$)/m.test(workspace), '不得绕过 esbuild 构建白名单');
assert(/^pnpm@12\.\d+\.\d+$/.test(packageJson.packageManager || ''), 'packageManager 必须固定 pnpm 12 稳定版');
assert(!packageJson.pnpm, 'pnpm 12 已不读取 package.json#pnpm，必须迁移到 pnpm-workspace.yaml');
assert(!/^(?:onlyBuiltDependencies|neverBuiltDependencies|ignoredBuiltDependencies|onlyBuiltDependenciesFile):/m.test(workspace), '旧版构建白名单必须迁移到 allowBuilds');
assert(
  buildRules.length === 1 && /^esbuild:\s*true$/.test(buildRules[0]),
  `pnpm allowBuilds 必须且只能批准 esbuild，实际为 ${buildRules.join(', ') || '(空)'}`
);

console.log(`pnpm 供应链策略通过（${excludedKeys.size} 个有期限精确版本例外）`);
