import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const forbiddenSegments = new Set(['.env.local', '.git', '.agents', 'node_modules']);
const requiredEntries = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'theme.yaml',
  'templates/assets/licenses/THIRD_PARTY_NOTICES.md'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseYamlScalar(value) {
  const input = value.trim();
  if (input.startsWith('"')) {
    try {
      return JSON.parse(input);
    } catch {
      throw new Error(`无法解析 theme.yaml 字符串: ${input}`);
    }
  }
  if (input.startsWith("'") && input.endsWith("'")) {
    return input.slice(1, -1).replace(/''/g, "'");
  }
  return input.replace(/\s+#.*$/, '').trim();
}

function readThemeIdentity(yaml) {
  let section = '';
  let name = '';
  let version = '';

  for (const line of yaml.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s|$)/);
    if (topLevel) {
      section = topLevel[1];
      continue;
    }
    const field = line.match(/^\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/);
    if (!field) continue;
    if (section === 'metadata' && field[1] === 'name') name = parseYamlScalar(field[2]);
    if (section === 'spec' && field[1] === 'version') version = parseYamlScalar(field[2]);
  }

  assert(name, 'theme.yaml 缺少 metadata.name');
  assert(version, 'theme.yaml 缺少 spec.version');
  return { name, version };
}

function runUnzip(args, encoding = 'utf8') {
  const result = spawnSync('unzip', args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) {
    throw new Error(`无法执行 unzip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr || result.stdout || '');
    throw new Error(`unzip ${args[0]} 失败 (exit ${result.status}): ${detail.trim().slice(0, 500)}`);
  }
  return result.stdout;
}

function readZipEntries(zipPath) {
  return String(runUnzip(['-Z1', zipPath]))
    .split(/\r?\n/)
    .filter(Boolean);
}

function readZipEntry(zipPath, entry) {
  return runUnzip(['-p', zipPath, entry], null);
}

function verifyEntryPaths(entries) {
  const seen = new Set();
  const seenCaseInsensitive = new Set();

  for (const entry of entries) {
    assert(!entry.includes('\\'), `ZIP 条目包含反斜杠: ${entry}`);
    assert(!entry.startsWith('/') && !/^[A-Za-z]:/.test(entry), `ZIP 条目使用绝对路径: ${entry}`);

    const segments = entry.split('/').filter(Boolean);
    assert(!segments.includes('.') && !segments.includes('..'), `ZIP 条目包含路径穿越片段: ${entry}`);

    const normalized = entry.replace(/\/+$/, '');
    assert(!seen.has(normalized), `ZIP 包含重复条目: ${normalized}`);
    seen.add(normalized);

    const folded = normalized.toLowerCase();
    assert(!seenCaseInsensitive.has(folded), `ZIP 包含大小写冲突条目: ${normalized}`);
    seenCaseInsensitive.add(folded);

    for (const segment of segments) {
      assert(!forbiddenSegments.has(segment.toLowerCase()), `ZIP 包含禁止路径 ${segment}: ${entry}`);
    }
  }
}

function verifyRequiredEntries(entries) {
  const entrySet = new Set(entries);
  for (const entry of requiredEntries) {
    assert(entrySet.has(entry), `ZIP 缺少必需文件: ${entry}`);
  }
  assert(entries.some((entry) => entry.startsWith('templates/') && !entry.endsWith('/')), 'ZIP 缺少 templates 文件');
}

function verifyEmbeddedFiles(zipPath, localFiles) {
  for (const [entry, localPath] of localFiles) {
    const local = fs.readFileSync(localPath);
    const embedded = readZipEntry(zipPath, entry);
    assert(embedded.equals(local), `ZIP 内 ${entry} 与工作区文件不一致`);
  }
}

function main() {
  const inputPath = process.argv[2];
  assert(inputPath, '用法: node scripts/verify-release-package.mjs <theme.zip>');

  const zipPath = path.resolve(root, inputPath);
  assert(path.extname(zipPath).toLowerCase() === '.zip', `发布包必须是 ZIP: ${zipPath}`);
  assert(fs.existsSync(zipPath), `发布包不存在: ${zipPath}`);
  assert(fs.statSync(zipPath).isFile(), `发布包不是文件: ${zipPath}`);
  assert(fs.statSync(zipPath).size > 0, `发布包为空: ${zipPath}`);

  const themePath = path.join(root, 'theme.yaml');
  const packageJsonPath = path.join(root, 'package.json');
  const licensePath = path.join(root, 'LICENSE');
  const noticePath = path.join(root, 'THIRD_PARTY_NOTICES.md');
  const packagedNoticePath = path.join(root, 'templates/assets/licenses/THIRD_PARTY_NOTICES.md');
  for (const requiredPath of [themePath, packageJsonPath, licensePath, noticePath, packagedNoticePath]) {
    assert(fs.existsSync(requiredPath), `工作区缺少发布校验文件: ${path.relative(root, requiredPath)}`);
  }

  const themeYaml = fs.readFileSync(themePath, 'utf8');
  const identity = readThemeIdentity(themeYaml);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert(packageJson.version === identity.version, `package.json ${packageJson.version} 与主题版本 ${identity.version} 不一致`);

  const releaseTag = String(process.env.RELEASE_TAG || '').trim();
  if (releaseTag) {
    const tagVersion = releaseTag.startsWith('v') ? releaseTag.slice(1) : releaseTag;
    assert(tagVersion === identity.version, `Release tag ${releaseTag} 与主题版本 ${identity.version} 不一致`);
  }

  const expectedFileName = `${identity.name}-${identity.version}.zip`;
  assert(path.basename(zipPath) === expectedFileName, `发布包文件名应为 ${expectedFileName}`);

  const entries = readZipEntries(zipPath);
  assert(entries.length > 0, 'ZIP 没有任何条目');
  verifyEntryPaths(entries);
  verifyRequiredEntries(entries);
  verifyEmbeddedFiles(zipPath, [
    ['theme.yaml', themePath],
    ['LICENSE', licensePath],
    ['THIRD_PARTY_NOTICES.md', noticePath],
    ['templates/assets/licenses/THIRD_PARTY_NOTICES.md', packagedNoticePath]
  ]);

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  console.log('发布包供应链校验通过');
  console.log(`- 文件: ${path.relative(root, zipPath)}`);
  console.log(`- 版本: ${identity.version}`);
  console.log(`- 条目: ${entries.length}`);
  console.log(`- 大小: ${fs.statSync(zipPath).size} bytes`);
  console.log(`- SHA-256: ${sha256}`);
}

try {
  main();
} catch (error) {
  console.error(`verify-release-package failed: ${error.message}`);
  process.exitCode = 1;
}
