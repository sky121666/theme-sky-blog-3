import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const packageJson = readJson('package.json');
const manifest = readJson('security/distributed-dependencies.json');
const outputPaths = [
  path.join(root, 'THIRD_PARTY_NOTICES.md'),
  path.join(root, 'templates/assets/licenses/THIRD_PARTY_NOTICES.md')
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function normalizeText(value) {
  return String(value).replace(/\r\n?/g, '\n').trim();
}

function escapeTableCell(value) {
  return String(value || '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function packageDirectoryFrom(startDirectory, packageName) {
  let current = path.resolve(startDirectory);
  const filesystemRoot = path.parse(current).root;

  while (true) {
    const candidate = path.join(current, 'node_modules', ...packageName.split('/'));
    const metadataPath = path.join(candidate, 'package.json');
    if (fs.existsSync(metadataPath)) {
      return fs.realpathSync(candidate);
    }
    if (current === filesystemRoot) break;
    current = path.dirname(current);
  }

  return null;
}

function licenseFileFor(packageDirectory) {
  const names = fs.readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const patterns = [
    /^licen[cs]e(?:[-._].*)?$/i,
    /^copying(?:[-._].*)?$/i,
    /^copyright(?:[-._].*)?$/i
  ];

  for (const pattern of patterns) {
    const match = names.filter((name) => pattern.test(name)).sort()[0];
    if (match) return match;
  }
  return null;
}

function readLicenseMaterial(packageName, packageDirectory, packageVersion) {
  const override = manifest.licenseOverrides?.[packageName];
  if (override) {
    assert(override.version === packageVersion, `${packageName} 许可覆盖版本 ${override.version || '?'} 与安装版本 ${packageVersion} 不一致`);
    const overridePath = path.join(root, override.file || '');
    assert(fs.existsSync(overridePath), `${packageName} 的许可覆盖文件不存在: ${override.file || '?'}`);
    const bytes = fs.readFileSync(overridePath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert(sha256 === override.sha256, `${packageName} 的许可覆盖文件 SHA-256 不匹配`);
    assert(/^https:\/\//.test(override.source || ''), `${packageName} 的许可覆盖缺少 HTTPS 上游来源`);
    return {
      licenseFile: `${override.file}（上游：${override.source}）`,
      licenseText: normalizeText(bytes.toString('utf8'))
    };
  }

  let sourcePackage = packageName;
  let sourceDirectory = packageDirectory;
  let licenseFile = licenseFileFor(sourceDirectory);

  if (!licenseFile) {
    throw new Error(`${packageName} 缺少可随包保留的 LICENSE/COPYING/COPYRIGHT 文件，且未声明固定来源许可覆盖`);
  }

  const sourceMetadata = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'package.json'), 'utf8'));
  const licenseText = normalizeText(fs.readFileSync(path.join(sourceDirectory, licenseFile), 'utf8'));
  return {
    licenseFile: sourcePackage === packageName
      ? licenseFile
      : `${sourcePackage}@${sourceMetadata.version}/${licenseFile}`,
    licenseText
  };
}

function normalizeLicense(metadata) {
  if (typeof metadata.license === 'string') return metadata.license.trim();
  if (metadata.license && typeof metadata.license.type === 'string') return metadata.license.type.trim();
  if (Array.isArray(metadata.licenses)) {
    return metadata.licenses
      .map((entry) => typeof entry === 'string' ? entry : entry?.type)
      .filter(Boolean)
      .join(' OR ');
  }
  return '';
}

function discoverPackages() {
  assert(manifest.schemaVersion === 1, 'distributed-dependencies manifest 版本无效');
  assert(manifest.roots && typeof manifest.roots === 'object' && !Array.isArray(manifest.roots), 'distributed-dependencies 缺少 roots');

  const declared = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const queue = [];
  for (const packageName of Object.keys(manifest.roots).sort()) {
    assert(declared[packageName], `分发依赖根未在 package.json 声明: ${packageName}`);
    const packageDirectory = packageDirectoryFrom(root, packageName);
    assert(packageDirectory, `分发依赖根未安装: ${packageName}`);
    queue.push({ packageName, packageDirectory });
  }

  const discovered = new Map();
  while (queue.length) {
    const { packageName, packageDirectory } = queue.shift();
    const metadataPath = path.join(packageDirectory, 'package.json');
    assert(fs.existsSync(metadataPath), `无法读取 ${packageName} 的 package.json`);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert(metadata.name === packageName, `依赖名称不匹配: ${packageName} -> ${metadata.name || '?'}`);
    assert(metadata.version, `${packageName} 缺少版本`);

    const key = `${metadata.name}@${metadata.version}`;
    if (discovered.has(key)) continue;

    const license = normalizeLicense(metadata);
    assert(license && !/^(?:UNLICENSED|UNKNOWN|NONE|SEE LICENSE IN)/i.test(license), `${key} 许可证无法自动确认: ${license || 'missing'}`);
    const { licenseFile, licenseText } = readLicenseMaterial(packageName, packageDirectory, metadata.version);
    assert(licenseText.length >= 40, `${key} 的 ${licenseFile} 内容异常`);

    discovered.set(key, {
      name: metadata.name,
      version: metadata.version,
      license,
      author: typeof metadata.author === 'string' ? metadata.author : metadata.author?.name || '',
      homepage: metadata.homepage || metadata.repository?.url || '—',
      licenseFile,
      licenseText
    });

    const childDependencies = {
      ...(metadata.dependencies || {}),
      ...(metadata.optionalDependencies || {})
    };
    for (const childName of Object.keys(childDependencies).sort()) {
      const childDirectory = packageDirectoryFrom(packageDirectory, childName);
      if (!childDirectory) {
        if (metadata.optionalDependencies?.[childName]) continue;
        throw new Error(`${key} 的依赖未安装: ${childName}`);
      }
      queue.push({ packageName: childName, packageDirectory: childDirectory });
    }
  }

  return [...discovered.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  ));
}

function renderNotice(packages) {
  const lines = [
    '# 第三方软件声明',
    '',
    'Sky Blog 3 的浏览器产物包含或派生自下列第三方软件。清单从',
    '`security/distributed-dependencies.json` 声明的运行时根递归解析当前已安装依赖生成；',
    '每项均随附 npm 发布包或分发清单中固定上游来源提供的完整许可文本。版本以锁文件和当前干净安装为准。',
    '',
    '| 软件包 | 版本 | 许可证 | 作者 / 上游 |',
    '| --- | ---: | --- | --- |'
  ];

  for (const entry of packages) {
    const upstream = entry.homepage && entry.homepage !== '—'
      ? `<${entry.homepage.replace(/^git\+/, '').replace(/\.git$/, '')}>`
      : entry.author || '—';
    lines.push(`| \`${entry.name}\` | ${entry.version} | ${escapeTableCell(entry.license)} | ${escapeTableCell(upstream)} |`);
  }

  lines.push(
    '',
    `共 ${packages.length} 个分发依赖记录。下列许可与版权声明保持原文；第三方软件仍分别受其自身许可证约束。`,
    ''
  );

  for (const entry of packages) {
    lines.push(
      `## ${entry.name}@${entry.version}`,
      '',
      `- 许可证：${entry.license}`,
      `- 来源文件：${entry.licenseFile}`,
      entry.author ? `- npm 作者元数据：${entry.author}` : '- npm 作者元数据：未提供',
      '',
      '```text',
      entry.licenseText.replace(/```/g, '``\u200b`'),
      '```',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

function main() {
  const packages = discoverPackages();
  const rendered = renderNotice(packages);

  if (checkOnly) {
    for (const outputPath of outputPaths) {
      assert(fs.existsSync(outputPath), `缺少第三方声明: ${path.relative(root, outputPath)}`);
      assert(fs.readFileSync(outputPath, 'utf8') === rendered, `第三方声明已过期: ${path.relative(root, outputPath)}；请运行 pnpm run notices:generate`);
    }
    console.log(`第三方声明生成一致性通过（${packages.length} 个分发依赖）`);
    return;
  }

  for (const outputPath of outputPaths) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered);
  }
  console.log(`第三方声明已生成（${packages.length} 个分发依赖）`);
}

try {
  main();
} catch (error) {
  console.error(`generate-third-party-notices failed: ${error.message}`);
  process.exitCode = 1;
}
