import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const exceptions = JSON.parse(
  fs.readFileSync(path.join(root, 'security/audit-exceptions.json'), 'utf8')
).exceptions || [];
const blockingSeverities = new Set(['high', 'critical']);

function runAudit(args, label) {
  const result = spawnSync('pnpm', ['audit', ...args, '--audit-level', 'high', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`${label} 无法执行: ${result.error.message}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout || '{}');
  } catch (error) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${label} 返回了无法解析的 JSON: ${error.message}; ${detail.slice(0, 400)}`);
  }

  if (report.error || report.message) {
    throw new Error(`${label} 失败: ${report.error?.summary || report.message || JSON.stringify(report.error)}`);
  }
  if (![0, 1].includes(result.status)) {
    const detail = String(result.stderr || '').trim();
    throw new Error(`${label} 失败 (exit ${result.status}): ${detail.slice(0, 400)}`);
  }

  return report;
}

function normalizeAdvisories(report) {
  if (report.advisories && typeof report.advisories === 'object') {
    return Object.entries(report.advisories).map(([key, advisory]) => ({
      id: String(advisory.github_advisory_id || advisory.id || key),
      severity: String(advisory.severity || '').toLowerCase(),
      package: advisory.module_name || advisory.name || 'unknown',
      title: advisory.title || advisory.overview || ''
    }));
  }

  if (report.vulnerabilities && typeof report.vulnerabilities === 'object') {
    return Object.entries(report.vulnerabilities).flatMap(([name, vulnerability]) => {
      const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
      const detailed = via.filter((item) => item && typeof item === 'object');
      if (detailed.length) {
        return detailed.map((item) => ({
          id: String(item.source || item.url || `${name}:${item.title || item.severity || 'unknown'}`),
          severity: String(item.severity || vulnerability.severity || '').toLowerCase(),
          package: name,
          title: item.title || ''
        }));
      }
      return [{
        id: `${name}:${vulnerability.severity || 'unknown'}`,
        severity: String(vulnerability.severity || '').toLowerCase(),
        package: name,
        title: ''
      }];
    });
  }

  const counts = report.metadata?.vulnerabilities;
  if (counts && Object.values(counts).every((value) => Number(value) === 0)) {
    return [];
  }
  throw new Error('漏洞报告结构未知，按失败处理');
}

function activeException(id) {
  return exceptions.find((entry) => {
    if (String(entry.id) !== String(id)) return false;
    if (!entry.reason || !entry.owner || !entry.expires) return false;
    const expiresAt = Date.parse(entry.expires);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  });
}

function evaluate(report, label) {
  const advisories = normalizeAdvisories(report);
  const blocked = [];
  const waived = [];
  const observed = [];

  for (const advisory of advisories) {
    if (!advisory.severity) {
      throw new Error(`${label} 中 ${advisory.id} 缺少 severity`);
    }
    const exception = activeException(advisory.id);
    if (exception) {
      waived.push(advisory);
    } else if (blockingSeverities.has(advisory.severity)) {
      blocked.push(advisory);
    } else {
      observed.push(advisory);
    }
  }

  console.log(`${label}: ${advisories.length} 条（阻塞 ${blocked.length} / 豁免 ${waived.length} / 记录 ${observed.length}）`);
  for (const advisory of blocked) {
    console.error(`- [${advisory.severity}] ${advisory.id} ${advisory.package}: ${advisory.title}`.trim());
  }
  if (blocked.length) {
    throw new Error(`${label} 存在 high/critical 漏洞`);
  }
}

evaluate(runAudit(['--prod'], '生产依赖漏洞扫描'), '生产依赖图');
evaluate(runAudit([], '完整依赖漏洞扫描'), '完整依赖图');
console.log('依赖漏洞门禁通过');
