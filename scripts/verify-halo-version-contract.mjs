import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const expectedMinimum = '2.25.0';
const verifiedRuntime = '2.25.4';
const expectedRequires = `>=${expectedMinimum}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  assert(fs.existsSync(fullPath), `缺少 Halo 版本契约文件：${relativePath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

const themeYaml = read('theme.yaml');
const readme = read('README.md');
const verificationMatrix = read('docs/验证与审计矩阵.md');
const cdWorkflow = read('.github/workflows/cd.yaml');

const themeRequires = themeYaml.match(/^\s*requires:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
assert(
  themeRequires === expectedRequires,
  `theme.yaml spec.requires 必须为 ${expectedRequires}，实际为 ${themeRequires || '(缺失)'}`
);

const themeAppId = themeYaml.match(
  /^\s*["']?store\.halo\.run\/app-id["']?\s*:\s*["']?([A-Za-z0-9_-]+)["']?\s*(?:#.*)?$/m
)?.[1];
assert(themeAppId, 'theme.yaml 缺少 metadata.annotations["store.halo.run/app-id"]');

const appStoreActionMatches = [...cdWorkflow.matchAll(/uses:\s*halo-sigs\/app-store-release-action@[^\s#]+/g)];
assert(appStoreActionMatches.length === 1, `CD 必须且只能声明一个 Halo App Store Action，实际为 ${appStoreActionMatches.length}`);
const appStoreStepStart = appStoreActionMatches[0].index;
const appStoreStepEnd = cdWorkflow.indexOf('\n      - name:', appStoreStepStart + 1);
const appStoreStep = cdWorkflow.slice(
  appStoreStepStart,
  appStoreStepEnd === -1 ? cdWorkflow.length : appStoreStepEnd
);
const cdAppId = appStoreStep.match(
  /^\s*app-id:\s*["']?([A-Za-z0-9_-]+)["']?\s*(?:#.*)?$/m
)?.[1];
assert(cdAppId, 'CD Halo App Store Action 缺少 app-id');
assert(
  cdAppId === themeAppId,
  `theme.yaml App ID ${themeAppId} 与 CD App ID ${cdAppId} 不一致`
);

assert(
  readme.includes(`- Halo 要求：\`>= ${expectedMinimum}\``),
  `README 顶部 Halo 要求必须为 >= ${expectedMinimum}`
);
assert(
  readme.includes(`确认 Halo 版本满足 \`>= ${expectedMinimum}\`。`),
  `README 升级检查必须为 >= ${expectedMinimum}`
);
assert(
  readme.includes(`本机 Halo \`${verifiedRuntime}\` 已通过`),
  `README 必须记录本机 Halo ${verifiedRuntime} 的已通过证据`
);
assert(
  readme.includes(`隔离 Halo \`${expectedMinimum}\` 已完成主题包安装、启用、首页 200 与 Playwright Core 回归`),
  `README 必须记录 Halo ${expectedMinimum} 的真实运行验证`
);

for (const requiredText of [
  '仓库 Secret `HALO_PAT` 已配置',
  '“版本管理”权限',
  '`theme.yaml` 的 `metadata.annotations["store.halo.run/app-id"]`',
  '`.github/workflows/cd.yaml` App Store Action 的 `app-id` 一致',
  `当前均为 \`${themeAppId}\``,
  '禁止删除该草稿或重跑 CD',
  '直接公开既有 GitHub Release 草稿'
]) {
  assert(readme.includes(requiredText), `README 缺少发布前置条件或失败恢复说明：${requiredText}`);
}

const marker = verificationMatrix.match(
  /<!-- halo-core-version-contract\s+minimum:\s*([^\s]+)\s+verified-runtime:\s*([^\s]+)\s+minimum-runtime-status:\s*([^\s]+)\s+-->/m
);
assert(marker, '验证与审计矩阵缺少 halo-core-version-contract 标记');
assert(marker[1] === expectedMinimum, `验证矩阵最低版本必须为 ${expectedMinimum}，实际为 ${marker[1]}`);
assert(marker[2] === verifiedRuntime, `验证矩阵已验证运行版本必须为 ${verifiedRuntime}，实际为 ${marker[2]}`);
assert(
  marker[3] === 'verified',
  `Halo ${expectedMinimum} 完成真实验证后，minimum-runtime-status 必须为 verified`
);

for (const requiredText of [
  `| 主题最低声明 | \`>= ${expectedMinimum}\` | 已统一 |`,
  `| 本机运行证据 | Halo \`${verifiedRuntime}\` | 已通过 |`,
  `| 最低边界实测 | Halo \`${expectedMinimum}\` | 已通过 |`,
  '`pnpm run verify:reload`',
  '`SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`',
  '`SMOKE_BASE_URL=http://127.0.0.1:8092 pnpm run smoke:playwright`'
]) {
  assert(verificationMatrix.includes(requiredText), `验证与审计矩阵缺少版本证据：${requiredText}`);
}

for (const [relativePath, content] of [
  ['theme.yaml', themeYaml],
  ['README.md', readme],
  ['docs/验证与审计矩阵.md', verificationMatrix]
]) {
  const staleMinimum = content.match(/>=\s*2\.23\.0/);
  assert(!staleMinimum, `${relativePath} 仍保留旧 Halo 最低版本 >=2.23.0`);
}

console.log(
  `Halo 版本契约检查通过：minimum=${expectedMinimum}，verifiedRuntime=${verifiedRuntime}，minimumRuntimeStatus=verified，appId=${themeAppId}`
);
