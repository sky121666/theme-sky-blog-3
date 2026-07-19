import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseThemeIdentity(yaml) {
  let section = '';
  let name = '';
  let version = '';

  for (const line of yaml.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s|$)/);
    if (topLevel) {
      section = topLevel[1];
      continue;
    }
    const field = line.match(/^\s+([A-Za-z][A-Za-z0-9_-]*):\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
    if (!field) continue;
    if (section === 'metadata' && field[1] === 'name') name = field[2].trim();
    if (section === 'spec' && field[1] === 'version') version = field[2].trim();
  }

  assert(name, 'theme.yaml 缺少 metadata.name');
  assert(version, 'theme.yaml 缺少 spec.version');
  return { name, version };
}

function main() {
  const themePath = path.join(root, 'theme.yaml');
  const noticePath = path.join(root, 'THIRD_PARTY_NOTICES.md');
  assert(fs.existsSync(themePath), '缺少 theme.yaml');
  assert(fs.existsSync(noticePath), '缺少 THIRD_PARTY_NOTICES.md');

  const identity = parseThemeIdentity(fs.readFileSync(themePath, 'utf8'));
  const zipPath = path.join(root, 'dist', `${identity.name}-${identity.version}.zip`);
  assert(fs.existsSync(zipPath), `主题打包器未生成 ${path.relative(root, zipPath)}`);

  const result = spawnSync('zip', ['-q', '-X', zipPath, path.basename(noticePath)], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.error) {
    throw new Error(`无法执行 zip: ${result.error.message}`);
  }
  assert(result.status === 0, `写入第三方声明失败: ${(result.stderr || result.stdout || '').trim()}`);
  console.log(`发布包已写入第三方声明: ${path.relative(root, zipPath)}`);
}

try {
  main();
} catch (error) {
  console.error(`finalize-theme-package failed: ${error.message}`);
  process.exitCode = 1;
}
