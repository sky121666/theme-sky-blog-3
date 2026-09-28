import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(root, 'scripts/verify-pnpm-supply-chain-policy.mjs');
const baseline = {
  packageJson: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
  workspace: fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
  policy: JSON.parse(fs.readFileSync(path.join(root, 'security/dependency-policy.json'), 'utf8'))
};

function setSetting(fixture, key, value) {
  const lines = fixture.workspace.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  assert.notEqual(index, -1, `fixture 中缺少 ${key}`);
  lines[index] = `${key}: ${value}`;
  fixture.workspace = lines.join('\n');
}

function setBuildRules(fixture, replacement) {
  const lines = fixture.workspace.split('\n');
  const start = lines.findIndex((line) => line.startsWith('allowBuilds:'));
  assert.notEqual(start, -1, 'fixture 中缺少 allowBuilds');
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end += 1;
  lines.splice(start, end - start, ...replacement, '');
  fixture.workspace = lines.join('\n');
}

function runFixture(t, mutate = () => {}) {
  // Only these three configuration files are needed; never install or copy node_modules.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'theme3-pnpm-policy-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = structuredClone(baseline);
  mutate(fixture);
  fs.mkdirSync(path.join(directory, 'security'));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(fixture.packageJson));
  fs.writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), fixture.workspace);
  fs.writeFileSync(path.join(directory, 'security/dependency-policy.json'), JSON.stringify(fixture.policy));
  const result = spawnSync(process.execPath, [verifier], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, '验证器进程不应被信号终止');
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function expectRejected(t, mutate, reason) {
  const result = runFixture(t, mutate);
  assert.equal(result.status, 1, `不安全配置未被拒绝：\n${result.output}`);
  assert.match(result.output, reason, '失败必须来自预期的政策检查');
}

test('当前真实配置在独立 fixture 中通过', (t) => {
  const result = runFixture(t);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /pnpm 供应链策略通过/);
});

test('拒绝额外批准依赖构建脚本', (t) => {
  expectRejected(t, (fixture) => {
    setBuildRules(fixture, ['allowBuilds:', '  esbuild: true', '  unreviewed-package: true']);
  }, /allowBuilds/);
});

test('拒绝用通配符批准所有依赖构建', (t) => {
  expectRejected(t, (fixture) => {
    setBuildRules(fixture, ['allowBuilds:', '  "*": true']);
  }, /allowBuilds/);
});

test('拒绝返回 pnpm 已移除的 onlyBuiltDependencies', (t) => {
  expectRejected(t, (fixture) => {
    fixture.workspace += '\nonlyBuiltDependencies:\n  - esbuild\n';
  }, /旧版构建白名单/);
});

test('拒绝 pnpm 12 会忽略的 package.json#pnpm 配置', (t) => {
  expectRejected(t, (fixture) => {
    fixture.packageJson.pnpm = { overrides: { 'fixture-package': '1.0.0' } };
  }, /package.json#pnpm/);
});

const weakenedSettings = [
  ['minimumReleaseAge', '0', /minimumReleaseAge/],
  ['minimumReleaseAgeStrict', 'false', /minimumReleaseAgeStrict/],
  ['minimumReleaseAgeIgnoreMissingTime', 'true', /缺少发布时间/],
  ['trustPolicy', 'off', /trustPolicy/],
  ['blockExoticSubdeps', 'false', /blockExoticSubdeps/],
  ['strictDepBuilds', 'false', /未批准的依赖构建脚本/],
  ['strictPeerDependencies', 'false', /peer 冲突/],
  ['engineStrict', 'false', /Node engine 冲突/],
  ['pmOnFail', 'download', /pnpm 版本不匹配/]
];

for (const [key, value, reason] of weakenedSettings) {
  test(`拒绝放宽 ${key}`, (t) => {
    expectRejected(t, (fixture) => setSetting(fixture, key, value), reason);
  });
}

test('packageManager 必须固定稳定版本，不允许版本范围', (t) => {
  expectRejected(t, (fixture) => {
    fixture.packageJson.packageManager = 'pnpm@12.x';
  }, /packageManager/);
});

test('packageManager 不允许预发布版本', (t) => {
  expectRejected(t, (fixture) => {
    fixture.packageJson.packageManager = 'pnpm@12.0.0-rc.1';
  }, /packageManager/);
});

test('拒绝没有配套审查记录的精确版本年龄例外', (t) => {
  expectRejected(t, (fixture) => {
    fixture.workspace += '\nminimumReleaseAgeExclude:\n  - policy-fixture@1.0.0\n';
    fixture.policy.minimumReleaseAgeExceptions = [];
  }, /缺少有期限审查记录/);
});

test('保留精确版本、有负责人和期限的年龄例外机制', (t) => {
  const result = runFixture(t, (fixture) => {
    fixture.workspace += '\nminimumReleaseAgeExclude:\n  - policy-fixture@1.0.0\n';
    fixture.policy.minimumReleaseAgeExceptions = [{
      packages: ['policy-fixture'],
      version: '1.0.0',
      reason: 'Only a temporary isolated fixture; this does not approve any project dependency.',
      owner: 'policy-regression-test',
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }];
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /1 个有期限精确版本例外/);
});

test('注释中的旧值不能让关闭的 peer 检查通过', (t) => {
  expectRejected(t, (fixture) => {
    setSetting(fixture, 'strictPeerDependencies', 'false');
    fixture.workspace += '\n# strictPeerDependencies: true\n';
  }, /peer 冲突/);
});

test('拒绝绕过 esbuild 白名单的全局构建开关', (t) => {
  expectRejected(t, (fixture) => {
    fixture.workspace += '\ndangerouslyAllowAllBuilds: true\n';
  }, /不得绕过 esbuild 构建白名单/);
});
