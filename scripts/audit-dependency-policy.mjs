import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageJson = readJson('package.json');
const policy = readJson('security/dependency-policy.json');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function runPnpmJson(args, label) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`${label} 无法执行: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${label} 失败 (exit ${result.status}): ${detail.slice(0, 500)}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} 返回了无法解析的 JSON: ${error.message}`);
  }
}

function matchesPackagePattern(name, pattern) {
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

function assertLicenseAllowed(license, entries, graphName) {
  if (policy.deniedLicenses.includes(license)) {
    throw new Error(`${graphName} 命中禁止许可证: ${license}`);
  }
  if (policy.allowedLicenses.includes(license)) {
    return;
  }

  const review = policy.reviewedLicenses[license];
  if (!review) {
    throw new Error(`${graphName} 出现未审查许可证: ${license}`);
  }

  for (const entry of entries) {
    const reviewed = review.packages.some((pattern) => matchesPackagePattern(entry.name, pattern));
    if (!reviewed) {
      throw new Error(`${graphName} 中 ${entry.name}@${entry.versions?.join(',') || '?'} 未获 ${license} 包级审查`);
    }
  }
}

function auditLicenseGraph(graph, graphName) {
  if (!graph || Array.isArray(graph) || typeof graph !== 'object') {
    throw new Error(`${graphName} 许可证报告结构无效`);
  }

  let records = 0;
  for (const [license, entries] of Object.entries(graph)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`${graphName} 的 ${license} 没有软件包记录`);
    }
    for (const entry of entries) {
      if (!entry?.name || !Array.isArray(entry.versions) || entry.versions.length === 0) {
        throw new Error(`${graphName} 的 ${license} 含不完整软件包元数据`);
      }
      records += entry.versions.length;
    }
    assertLicenseAllowed(license, entries, graphName);
  }
  return { licenses: Object.keys(graph).length, records };
}

function installedTopLevelPackages() {
  const modulesDir = path.join(root, 'node_modules');
  if (!fs.existsSync(modulesDir)) {
    throw new Error('缺少 node_modules，请先执行 frozen install');
  }

  const names = [];
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(modulesDir, entry.name);
      for (const scopedEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        names.push(`${entry.name}/${scopedEntry.name}`);
      }
      continue;
    }
    names.push(entry.name);
  }

  return Object.fromEntries(names.map((name) => [name, { path: path.join(modulesDir, name) }]));
}

function validateTopLevelGraph() {
  const declared = new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {})
  ]);
  const installed = installedTopLevelPackages();
  const installedNames = new Set(Object.keys(installed));
  const unexpected = [...installedNames].filter((name) => !declared.has(name)).sort();
  const missing = [...declared].filter((name) => !installedNames.has(name)).sort();

  if (unexpected.length) {
    throw new Error(`发现未声明顶层依赖: ${unexpected.join(', ')}`);
  }
  if (missing.length) {
    throw new Error(`声明但未安装的顶层依赖: ${missing.join(', ')}`);
  }

  for (const name of [...declared].sort()) {
    const packagePath = path.join(installed[name].path || '', 'package.json');
    if (!installed[name].path || !fs.existsSync(packagePath)) {
      throw new Error(`无法读取 ${name} 的已安装 package.json`);
    }
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const license = typeof metadata.license === 'string' ? metadata.license.trim() : '';
    if (!license || /^(SEE LICENSE IN|UNLICENSED|UNKNOWN|NONE)/i.test(license)) {
      throw new Error(`${name}@${metadata.version || '?'} 的许可证无法自动确认: ${license || 'missing'}`);
    }
  }

  return declared.size;
}

const topLevelCount = validateTopLevelGraph();
const production = auditLicenseGraph(
  runPnpmJson(['licenses', 'list', '--prod', '--json', '--long'], '生产依赖许可证扫描'),
  '生产依赖图'
);
const complete = auditLicenseGraph(
  runPnpmJson(['licenses', 'list', '--json', '--long'], '完整依赖许可证扫描'),
  '完整依赖图'
);

console.log('依赖许可证策略通过');
console.log(`- 顶层依赖: ${topLevelCount}`);
console.log(`- 生产依赖图: ${production.records} 条 / ${production.licenses} 类许可证`);
console.log(`- 完整依赖图: ${complete.records} 条 / ${complete.licenses} 类许可证`);
