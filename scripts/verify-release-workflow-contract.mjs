import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  assert(fs.existsSync(fullPath), `缺少发布契约文件：${relativePath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

function indexOfRequired(source, marker, message) {
  const index = source.indexOf(marker);
  assert(index >= 0, message);
  return index;
}

const cd = read('.github/workflows/cd.yaml');
const ci = read('.github/workflows/ci.yaml');
const recovery = read('.github/workflows/release-recovery.yaml');
const readme = read('README.md');
const rollbackGuide = read('docs/发布与回滚.md');
const releaseNotes = read('docs/发布说明.md');
const documentIndex = read('docs/文档索引.md');

const releaseJobIndex = indexOfRequired(cd, '\n  release:\n', 'CD 缺少 release job');
const releaseJob = cd.slice(releaseJobIndex);
const verifyPackageIndex = indexOfRequired(
  releaseJob,
  '      - name: Verify downloaded release archive',
  'release job 必须重新校验下载的发布包'
);
const rollbackBaselineIndex = indexOfRequired(
  releaseJob,
  '      - name: Verify rollback baseline',
  'release job 缺少上一稳定版本回滚基线门禁'
);
const prepareDraftIndex = indexOfRequired(
  releaseJob,
  '      - name: Prepare draft release and upload package',
  'release job 缺少 GitHub 草稿准备步骤'
);
const appStoreIndex = indexOfRequired(
  releaseJob,
  '      - name: Sync release to Halo App Store',
  'release job 缺少 Halo 应用市场同步步骤'
);
const publishIndex = indexOfRequired(
  releaseJob,
  '      - name: Publish GitHub Release',
  'release job 缺少 GitHub Release 公开步骤'
);

assert(
  verifyPackageIndex < rollbackBaselineIndex
    && rollbackBaselineIndex < prepareDraftIndex
    && prepareDraftIndex < appStoreIndex
    && appStoreIndex < publishIndex,
  'release job 顺序必须为：校验发布包 -> 验证回滚基线 -> GitHub 草稿 -> 应用市场 -> 公开 GitHub Release'
);

assert.match(releaseJob, /needs:\s*\n\s*- build\s*\n\s*- halo-compat/, 'release 必须等待构建和双 Halo 矩阵');
assert.match(releaseJob, /Verify rollback baseline[\s\S]*?fetch-depth: 0|fetch-depth: 0[\s\S]*?Verify rollback baseline/, '回滚基线检查需要完整标签历史');
assert.match(releaseJob, /previous_tag="\$\(git tag --sort=-version:refname --list 'v\*'/, '必须按版本顺序选择上一标签');
assert.match(releaseJob, /previous_is_draft[\s\S]*?previous_zip_count/, '回滚基线必须验证公开状态和 ZIP 制品');
assert.match(releaseJob, /previous_is_draft" != "false" \|\| "\$previous_zip_count" -lt 1/, '草稿或无 ZIP 的旧版本不得作为回滚基线');
assert.match(releaseJob, /GITHUB_STEP_SUMMARY/, '回滚基线必须写入 Actions 摘要供发布审计');

assert.match(releaseJob, /id: app-store[\s\S]*?halo-sigs\/app-store-release-action@[0-9a-f]{40}/, '应用市场 Action 必须固定提交 SHA');
assert.match(releaseJob, /max_attempts=5/, 'GitHub Release 公开必须有 5 次有界尝试');
assert.match(releaseJob, /releases\?per_page=100[\s\S]*?select\(\.tag_name == env\.RELEASE_TAG\)/, '草稿 Release 必须通过分页列表按精确标签定位');
assert.doesNotMatch(releaseJob, /releases\/tags\/\$RELEASE_TAG/, '草稿 Release 不得通过不支持草稿态的 by-tag REST 端点定位');
assert.match(releaseJob, /created_release_ids\[@\][\s\S]*?-ne 1/, '新建草稿后必须确认精确匹配唯一 Release');
assert.match(releaseJob, /releases\/\$RELEASE_ID[\s\S]*?-F draft=false[\s\S]*?\.draft[\s\S]*?\.tag_name/, '公开必须按 Release ID 执行，并复核草稿态与标签');
assert.match(
  releaseJob,
  /if: failure\(\) && steps\.app-store\.outcome == 'success' && steps\.publish\.outcome == 'failure'/,
  '应用市场成功但 GitHub 公开失败时必须进入专用恢复分支'
);
assert.match(releaseJob, /Publish the existing GitHub draft directly; do not delete it and do not rerun CD\./, '专用恢复分支必须禁止删除和重跑');
assert.doesNotMatch(
  releaseJob,
  /gh release delete|git push[^\n]*--delete|gh api[^\n]*(?:-X|--method)\s+DELETE/i,
  'CD 不得自动删除公开 Release、标签或应用市场版本'
);

assert.match(recovery, /workflow_dispatch:/, '必须由维护者手动触发 Release Recovery');
assert.match(recovery, /app_store_not_synced:[\s\S]*?type: boolean/, '恢复必须要求人工确认应用市场从未同步');
assert.match(recovery, /ref: refs\/tags\/\$\{\{ inputs\.release_tag \}\}/, '恢复必须检出精确标签引用');
assert.match(recovery, /git show-ref --verify --quiet "refs\/tags\/\$RELEASE_TAG"/, '恢复必须证明输入是实际标签');
assert.match(recovery, /source_name[\s\S]*?source_event[\s\S]*?source_branch[\s\S]*?source_sha[\s\S]*?source_conclusion/, '恢复必须读取来源 CD 的名称、事件、标签、提交和结论');
assert.match(recovery, /Sync release to Halo App Store[\s\S]*?app_store_step_conclusions\[0\][\s\S]*?skipped/, '恢复必须由 Actions 记录证明应用市场步骤未执行');
assert.match(recovery, /release_ids\[@\][\s\S]*?-ne 1[\s\S]*?release_is_draft[\s\S]*?!= "true"/, '恢复必须定位唯一且仍为草稿的 Release');
assert.match(recovery, /gh run download "\$SOURCE_RUN_ID"[\s\S]*?node scripts\/verify-release-package\.mjs/, '恢复必须下载并校验来源 CD 制品');
assert.match(recovery, /artifact_sha256[\s\S]*?release_sha256[\s\S]*?!=/, '恢复必须比较 Actions 制品和草稿附件的 SHA-256');
assert.match(recovery, /halo-sigs\/app-store-release-action@[0-9a-f]{40}/, '恢复中的应用市场 Action 必须固定提交 SHA');
assert.match(recovery, /max_attempts=5[\s\S]*?releases\/\$RELEASE_ID[\s\S]*?-F draft=false[\s\S]*?\.draft[\s\S]*?\.tag_name/, '恢复公开必须按 Release ID 有界重试并复核状态');
assert.doesNotMatch(
  recovery,
  /gh release delete|git push[^\n]*--delete|gh api[^\n]*(?:-X|--method)\s+DELETE/i,
  'Release Recovery 不得自动删除 Release、标签或应用市场版本'
);

for (const [name, workflow] of [['CI', ci], ['CD', cd]]) {
  const consentIndex = indexOfRequired(workflow, '      - name: Require explicit npm audit consent', `${name} 缺少漏洞审计授权门`);
  const auditIndex = indexOfRequired(workflow, '      - name: Audit dependency vulnerabilities', `${name} 缺少漏洞审计步骤`);
  assert(consentIndex < auditIndex, `${name} 必须先确认授权，再调用 npm 漏洞接口`);
}

for (const requiredText of [
  '已发布版本不可覆盖',
  '上一稳定 ZIP',
  '发布更高补丁版本',
  '应用市场成功、GitHub 仍为草稿',
  '禁止删除标签',
  'https://docs.halo.run/developer-guide/app-store/publish-app',
  'https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository'
]) {
  assert(rollbackGuide.includes(requiredText), `发布与回滚指南缺少关键约束：${requiredText}`);
}

assert(readme.includes('[发布与回滚](docs/发布与回滚.md)'), 'README 文档区缺少发布与回滚入口');
assert(documentIndex.includes('[/docs/发布与回滚.md](/docs/发布与回滚.md)'), '文档索引缺少发布与回滚指南');
assert(releaseNotes.includes('已发布版本不可覆盖'), 'v0.9.41 发布说明必须记录不可覆盖与补丁修复规则');

console.log('release workflow and rollback contract passed');
