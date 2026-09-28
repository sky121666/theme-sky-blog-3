import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT_DOCUMENT = 'docs/插件适配契约.md';
export const TARGET_DOCUMENT = 'docs/2026-09-25-插件适配核验.md';
const CURRENT_COLUMNS = ['ID', 'Plugin', 'Surface', 'Contract version', 'Tested version', 'Status', 'Hosts', 'Files', 'Test record', 'Scope', 'Exclusions', 'Evidence'];
const TEST_COLUMNS = ['ID', 'Plugin', 'Surface', 'Tested version', 'Result', 'Kind', 'Date', 'Site', 'Halo', 'Inventory', 'Theme revision', 'Hosts', 'Scope', 'Scenarios', 'Evidence', 'Exclusions'];
const EXCLUSION_COLUMNS = ['Plugin', 'Surface', 'Status', 'Reason'];
const MARKER_KEYS = ['plugin-contract', 'surface', 'contract-version', 'status', 'source'];
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const EMPTY = new Set(['', '—']);
const clean = (value) => value.trim().replace(/^`([^`]+)`$/, '$1');
const list = (value) => EMPTY.has(clean(value)) ? [] : value.split(';').map(clean).filter(Boolean);
const key = (plugin, surface) => `${plugin}\0${surface}`;
const sameSet = (left, right) => [...left].sort().join('\0') === [...right].sort().join('\0');
const isNonportableEvidence = (file) => file.startsWith('output/') || /\.log$/i.test(file)
  || /^docs\/evidence\/.*\.(?:json|txt|png|jpe?g|webp|har|zip)$/i.test(file);

function region(document, name) {
  const start = `<!-- plugin-contract-${name}:start -->`;
  const end = `<!-- plugin-contract-${name}:end -->`;
  assert.equal(document.split(start).length, 2, `${name}: expected exactly one start boundary`);
  assert.equal(document.split(end).length, 2, `${name}: expected exactly one end boundary`);
  const from = document.indexOf(start) + start.length;
  const to = document.indexOf(end);
  assert.ok(to > from, `${name}: invalid boundary order`);
  return document.slice(from, to);
}

function table(document, columns) {
  const lines = document.split(/\r?\n/);
  const split = (line) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(clean);
  const matches = lines.flatMap((line, index) => line.trim().startsWith('|')
    && JSON.stringify(split(line)) === JSON.stringify(columns) ? [index] : []);
  assert.equal(matches.length, 1, `expected exactly one table: ${columns.join(', ')}`);
  const at = matches[0];
  assert.ok(/^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[at + 1]), 'missing table separator');
  const rows = [];
  for (let index = at + 2; index < lines.length && lines[index].trim().startsWith('|'); index += 1) {
    const cells = split(lines[index]);
    assert.equal(cells.length, columns.length, `table row has ${cells.length} columns: ${lines[index]}`);
    rows.push(Object.fromEntries(columns.map((column, offset) => [column, cells[offset]])));
  }
  return rows;
}

function targetTable(document, title) {
  const at = document.indexOf(title);
  assert.ok(at >= 0, `target section missing: ${title}`);
  const end = document.indexOf('\n## ', at + title.length);
  const section = document.slice(at, end < 0 ? undefined : end);
  const lines = section.split(/\r?\n/).filter((line) => line.startsWith('|'));
  assert.ok(lines.length >= 2, `target table missing: ${title}`);
  const columns = lines[0].slice(1, -1).split('|').map(clean);
  return table(section, columns);
}

export function parseContract(document, targetsDocument) {
  const current = region(document, 'current');
  const rows = table(current, CURRENT_COLUMNS).map((row) => {
    const id = row.ID.match(/^<a id="([a-z0-9-]+)"><\/a>`([^`]+)`$/);
    assert.ok(id && id[1] === id[2], `row ID requires matching explicit anchor: ${row.ID}`);
    return { ...row, ID: id[1] };
  });
  const tests = table(region(current, 'tests'), TEST_COLUMNS);
  const exclusions = table(region(current, 'exclusions'), EXCLUSION_COLUMNS);
  const targets = targetTable(targetsDocument, '## 已纳入主题契约的 24 个插件').map((row) => {
    const identity = row['插件（环境名）'].match(/^`([^`]+)`（`([^`]+)`）$/);
    assert.ok(identity, `target canonical environment ID missing: ${row['插件（环境名）']}`);
    return { alias: identity[1], plugin: identity[2], version: row['本轮目标'] };
  });
  const excludedTargets = [
    ...targetTable(targetsDocument, '## 已安装但不进入本主题契约的 21 个插件'),
    ...targetTable(targetsDocument, '## 未安装但历史契约或决策中出现的插件')
  ].map((row) => row['插件']);
  return { rows, tests, exclusions, targets, excludedTargets };
}

export function markerFor(row) {
  return `<!-- plugin-contract: ${row.Plugin}; surface: ${row.Surface}; contract-version: ${row['Contract version']}; status: ${row.Status}; source: ${CONTRACT_DOCUMENT}#${row.ID} -->`;
}

export function suggestedMarkers(rows) {
  const result = {};
  for (const row of rows) {
    for (const host of list(row.Hosts)) (result[host] ||= []).push(markerFor(row));
  }
  return result;
}

export function validateContract(provider, { matrixOnly = false, expectedTargetCount = 24 } = {}) {
  const errors = [];
  const report = (code, location, detail) => errors.push({ code, location, detail });
  const document = provider.read(CONTRACT_DOCUMENT);
  let parsed;
  try {
    parsed = parseContract(document, provider.read(TARGET_DOCUMENT));
  } catch (error) {
    return { ok: false, mode: matrixOnly ? 'matrix-only' : 'complete', errors: [{ code: 'SCHEMA', location: CONTRACT_DOCUMENT, detail: error.message }] };
  }
  const { rows, tests, exclusions, targets, excludedTargets } = parsed;
  const ids = new Map();
  const surfaces = new Map();
  const targetById = new Map();
  const testById = new Map();
  const excludedById = new Map();
  const anchors = [...document.matchAll(/<a\s+id="([^"]+)"\s*><\/a>/g)].map((match) => match[1]);
  for (const anchor of new Set(anchors)) {
    if (anchors.filter((entry) => entry === anchor).length !== 1) report('DUPLICATE_ANCHOR', CONTRACT_DOCUMENT, anchor);
  }
  const reference = (ref, location, allowDirectory = false) => {
    const [filename, anchor, ...extra] = ref.split('#');
    if (!filename || path.isAbsolute(filename) || filename.split('/').includes('..') || extra.length) {
      report('INVALID_PATH', location, ref);
      return;
    }
    if (filename.endsWith('/')) {
      if (!allowDirectory || anchor || !provider.files(filename).length) report('MISSING_DIRECTORY', location, ref);
      return;
    }
    const source = provider.read(filename);
    if (source === undefined) report('MISSING_FILE', location, ref);
    else if (anchor && !source.includes(`<a id="${anchor}"></a>`)) report('MISSING_ANCHOR', location, ref);
  };
  const evidenceReference = (ref, location) => {
    const filename = ref.split('#', 1)[0];
    if (isNonportableEvidence(filename) || provider.isTracked?.(filename) === false) {
      report('NONPORTABLE_EVIDENCE', location, ref);
    }
    reference(ref, location);
  };
  if (targets.length !== expectedTargetCount) report('TARGET_COUNT', TARGET_DOCUMENT, `${targets.length}, expected ${expectedTargetCount}`);
  for (const target of targets) {
    if (targetById.has(target.plugin)) report('DUPLICATE_TARGET', TARGET_DOCUMENT, target.plugin);
    if (!VERSION.test(target.version)) report('TARGET_VERSION', TARGET_DOCUMENT, `${target.plugin}: ${target.version}`);
    targetById.set(target.plugin, target);
  }
  for (const row of exclusions) {
    if (excludedById.has(row.Plugin)) report('DUPLICATE_EXCLUSION', CONTRACT_DOCUMENT, row.Plugin);
    if (!['not-adapted', 'not-applicable'].includes(row.Status) || !row.Surface || !row.Reason) report('INVALID_EXCLUSION', CONTRACT_DOCUMENT, row.Plugin);
    if (targetById.has(row.Plugin)) report('TARGET_EXCLUDED', CONTRACT_DOCUMENT, row.Plugin);
    excludedById.set(row.Plugin, row);
  }
  for (const plugin of excludedTargets) if (!excludedById.has(plugin)) report('MISSING_EXCLUSION', CONTRACT_DOCUMENT, plugin);
  for (const plugin of excludedById.keys()) if (!excludedTargets.includes(plugin)) report('UNKNOWN_EXCLUSION', CONTRACT_DOCUMENT, plugin);
  for (const row of rows) {
    const location = `${CONTRACT_DOCUMENT}#${row.ID}`;
    if (ids.has(row.ID)) report('DUPLICATE_ID', location, row.ID);
    if (surfaces.has(key(row.Plugin, row.Surface))) report('DUPLICATE_SURFACE', location, `${row.Plugin}/${row.Surface}`);
    ids.set(row.ID, row);
    surfaces.set(key(row.Plugin, row.Surface), row);
    if (!targetById.has(row.Plugin)) report('UNKNOWN_PLUGIN', location, row.Plugin);
    if (excludedById.has(row.Plugin)) report('EXCLUDED_SURFACE', location, row.Plugin);
    if (!/^[a-z0-9][a-z0-9:.-]*$/.test(row.Surface)) report('INVALID_SURFACE', location, row.Surface);
    if (!['confirmed', 'compatible-tested', 'inferred', 'unconfirmed'].includes(row.Status)) report('INVALID_STATUS', location, row.Status);
    const contract = row['Contract version'];
    if (row.Status === 'unconfirmed' ? contract !== 'pending' : !VERSION.test(contract)) report('CONTRACT_VERSION', location, contract);
    const target = targetById.get(row.Plugin);
    if (target && VERSION.test(contract)) {
      const left = contract.split(/[.+-]/).slice(0, 3).map(Number);
      const right = target.version.split(/[.+-]/).slice(0, 3).map(Number);
      const differing = left.findIndex((number, index) => number !== right[index]);
      if (differing >= 0 && left[differing] > right[differing]) report('CONTRACT_AFTER_TARGET', location, `${contract} > target ${target.version}`);
    }
    for (const field of ['Hosts', 'Files', 'Scope', 'Exclusions', 'Evidence']) {
      if (EMPTY.has(row[field])) report('MISSING_FIELD', location, field);
    }
    const hosts = list(row.Hosts);
    if (new Set(hosts).size !== hosts.length) report('DUPLICATE_HOST', location, row.Hosts);
    for (const host of hosts) {
      if (!host.startsWith('templates/') || !host.endsWith('.html') || host.startsWith('templates/assets/')) report('INVALID_HOST', location, host);
      reference(host, location);
    }
    list(row.Files).forEach((file) => reference(file, location, true));
    list(row.Evidence).forEach((file) => evidenceReference(file, location));
  }
  for (const target of targets) if (!rows.some((row) => row.Plugin === target.plugin)) report('MISSING_PLUGIN', CONTRACT_DOCUMENT, target.plugin);
  for (const test of tests) {
    const location = `${CONTRACT_DOCUMENT}:test:${test.ID}`;
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(test.ID) || testById.has(test.ID)) report('TEST_ID', location, test.ID);
    testById.set(test.ID, test);
    for (const field of TEST_COLUMNS) if (EMPTY.has(test[field])) report('TEST_FIELD', location, field);
    if (!surfaces.has(key(test.Plugin, test.Surface))) report('TEST_SURFACE', location, `${test.Plugin}/${test.Surface}`);
    if (!['passed', 'failed', 'skipped'].includes(test.Result)) report('TEST_RESULT', location, test.Result);
    if (!['live', 'fixture', 'static'].includes(test.Kind)) report('TEST_KIND', location, test.Kind);
    if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(test.Date) || Number.isNaN(Date.parse(test.Date))) report('TEST_DATE', location, test.Date);
    if (!VERSION.test(test['Tested version']) || !VERSION.test(test.Halo)) report('TEST_VERSION', location, test['Tested version']);
    if (/^(?:pending|unknown|待验证|未验证|HEAD|main)$/i.test(test['Theme revision'])) report('TEST_REVISION', location, test['Theme revision']);
    for (const field of ['Inventory', 'Evidence']) list(test[field]).forEach((file) => evidenceReference(file, location));
  }
  for (const row of rows) {
    const location = `${CONTRACT_DOCUMENT}#${row.ID}`;
    const tested = !EMPTY.has(row['Tested version']);
    const linked = !EMPTY.has(row['Test record']);
    if (tested !== linked || (row.Status === 'compatible-tested' && !linked)) report('TEST_REQUIRED', location, 'Tested version and Test record must be linked');
    if (!linked) continue;
    const test = testById.get(row['Test record']);
    if (!test) { report('TEST_MISSING', location, row['Test record']); continue; }
    for (const field of ['Plugin', 'Surface', 'Tested version', 'Scope', 'Exclusions']) {
      if (row[field] !== test[field]) report('TEST_MISMATCH', location, field);
    }
    if (!sameSet(list(row.Hosts), list(test.Hosts))) report('TEST_MISMATCH', location, 'Hosts');
    if (test.Result !== 'passed' || (row.Status === 'compatible-tested' && test.Kind !== 'live')) report('TEST_NOT_PASSING_LIVE', location, `${test.Result}/${test.Kind}`);
  }

  // Coverage is read from existing implementation/verification declarations, never from a second version list.
  const templateFiles = provider.files('templates/').filter((file) => file.endsWith('.html') && !file.startsWith('templates/assets/'));
  for (const manifest of provider.files('src/widgets/plugin/').filter((file) => file.endsWith('/manifest.js'))) {
    const widgetId = provider.read(manifest).match(/\bwidgetId:\s*['"]([^'"]+)['"]/);
    if (!widgetId) { report('WIDGET_ID', manifest, 'widgetId missing'); continue; }
    const matches = rows.filter((row) => row.Surface === `widget:${widgetId[1]}`);
    if (matches.length !== 1) report('WIDGET_SURFACE', manifest, widgetId[1]);
    else if (!list(matches[0].Files).some((file) => file === manifest || (file.endsWith('/') && manifest.startsWith(file)))) report('WIDGET_FILES', manifest, matches[0].ID);
  }
  for (const template of templateFiles) {
    const source = provider.read(template);
    if (/\bmomentFinder\./.test(source) && /\/author\.html$/.test(template)
      && !rows.some((row) => row.Plugin === 'PluginMoments' && row.Surface === 'author-moments' && list(row.Hosts).includes(template))) report('AUTHOR_SURFACE', template, 'PluginMoments author-moments');
    if (/<halo:comment\b/.test(source) && !rows.some((row) => row.Plugin === 'PluginCommentWidget'
      && (list(row.Hosts).includes(template) || list(row.Files).includes(template)))) report('COMMENT_SURFACE', template, 'comment host is not covered');
  }
  const lifecycleFile = 'scripts/verify-injected-plugin-lifecycle.mjs';
  const lifecycle = provider.read(lifecycleFile);
  if (lifecycle !== undefined) {
    const assets = lifecycle.match(/const globalPluginAssets\s*=\s*\{([\s\S]*?)\n\};/);
    if (!assets) report('INJECTED_DECLARATION', lifecycleFile, 'globalPluginAssets unavailable; update discovery');
    else for (const plugin of new Set([...assets[1].matchAll(/\/plugins\/([^/]+)\//g)].map((match) => match[1]))) {
      if (!surfaces.has(key(plugin, 'global-resources'))) report('INJECTED_SURFACE', lifecycleFile, plugin);
    }
  }
  let markerCount = 0;
  if (!matrixOnly) {
    const found = new Map();
    for (const template of templateFiles) {
      const source = provider.read(template);
      for (const match of source.matchAll(/<!--\s*plugin-contract\s*:([\s\S]*?)-->/g)) {
        markerCount += 1;
        const location = `${template}:${source.slice(0, match.index).split('\n').length}`;
        const fields = {};
        for (const item of `plugin-contract:${match[1]}`.split(';')) {
          const at = item.indexOf(':');
          const name = item.slice(0, at).trim();
          if (at < 0 || fields[name] !== undefined || !MARKER_KEYS.includes(name)) report('MARKER_FIELD', location, item.trim());
          fields[name] = item.slice(at + 1).trim();
        }
        for (const name of MARKER_KEYS) if (!fields[name]) report('MARKER_REQUIRED', location, name);
        const row = surfaces.get(key(fields['plugin-contract'], fields.surface));
        if (excludedById.has(fields['plugin-contract'])) report('EXCLUDED_MARKER', location, fields['plugin-contract']);
        if (!row) { report('MARKER_SURFACE', location, `${fields['plugin-contract']}/${fields.surface || '(missing)'}`); continue; }
        if (!list(row.Hosts).includes(template)) report('MARKER_HOST', location, row.ID);
        if (fields['contract-version'] !== row['Contract version']) report('MARKER_VERSION', location, `${fields['contract-version']} != ${row['Contract version']}`);
        if (fields.status !== row.Status) report('MARKER_STATUS', location, `${fields.status} != ${row.Status}`);
        if (fields.source !== `${CONTRACT_DOCUMENT}#${row.ID}`) report('MARKER_SOURCE', location, fields.source);
        const identity = `${template}\0${row.ID}`;
        found.set(identity, (found.get(identity) || 0) + 1);
      }
    }
    for (const row of rows) for (const host of list(row.Hosts)) {
      const count = found.get(`${host}\0${row.ID}`) || 0;
      if (count !== 1) report(count ? 'MARKER_DUPLICATE' : 'MARKER_MISSING', host, `${row.ID}: ${count}`);
    }
  }
  return { ok: errors.length === 0, mode: matrixOnly ? 'matrix-only' : 'complete', plugins: targetById.size, surfaces: rows.length,
    expectedMarkers: rows.reduce((sum, row) => sum + list(row.Hosts).length, 0), markers: matrixOnly ? null : markerCount,
    testRecords: tests.length, exclusions: exclusions.length, errors };
}

function fileProvider(root) {
  let tracked;
  try {
    tracked = new Set(execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
  } catch {
    // A packaged source tree has no index; path existence checks still apply.
  }
  const read = (file) => {
    try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch (error) {
      if (['ENOENT', 'EISDIR'].includes(error.code)) return undefined;
      throw error;
    }
  };
  const files = (prefix) => {
    const result = [];
    const walk = (relative) => {
      if (relative === 'templates/assets' || relative.startsWith('templates/assets/')) return;
      if (!fs.existsSync(path.join(root, relative))) return;
      for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const child = `${relative.replace(/\/$/, '')}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) result.push(child);
      }
    };
    walk(prefix);
    return result.sort();
  };
  return { read, files, isTracked: tracked ? (file) => tracked.has(file) : undefined };
}

function memoryProvider(files) {
  return {
    read: (file) => files[file],
    files: (prefix) => Object.keys(files).filter((file) => file.startsWith(prefix)).sort(),
    isTracked: (file) => Object.hasOwn(files, file)
  };
}

export function selfTest() {
  // Independent miniature contract, not a copy of the production matrix or plugin implementation.
  const fixture = {
    [TARGET_DOCUMENT]: `## 已纳入主题契约的 24 个插件\n| 插件（环境名） | 本轮目标 |\n| --- | --- |\n| \`repo-demo\`（\`Demo\`） | \`2.0.0\` |\n## 已安装但不进入本主题契约的 21 个插件\n| 插件 |\n| --- |\n| \`Other\` |\n## 未安装但历史契约或决策中出现的插件\n| 插件 |\n| --- |\n`,
    [CONTRACT_DOCUMENT]: `<!-- plugin-contract-current:start -->\n| ${CURRENT_COLUMNS.join(' | ')} |\n| ${CURRENT_COLUMNS.map(() => '---').join(' | ')} |\n| <a id="pc-demo"></a>\`pc-demo\` | Demo | widget:demo.card | 1.0.0 | — | confirmed | templates/demo.html | src/widgets/plugin/demo/ | — | Show card | No writes | docs/evidence.md |\n<!-- plugin-contract-tests:start -->\n| ${TEST_COLUMNS.join(' | ')} |\n| ${TEST_COLUMNS.map(() => '---').join(' | ')} |\n<!-- plugin-contract-tests:end -->\n<!-- plugin-contract-exclusions:start -->\n| ${EXCLUSION_COLUMNS.join(' | ')} |\n| --- | --- | --- | --- |\n| Other | outside-theme-contract | not-applicable | No theme calls |\n<!-- plugin-contract-exclusions:end -->\n<!-- plugin-contract-current:end -->`,
    'templates/demo.html': '<!-- plugin-contract: Demo; surface: widget:demo.card; contract-version: 1.0.0; status: confirmed; source: docs/插件适配契约.md#pc-demo -->',
    'src/widgets/plugin/demo/manifest.js': "export const manifest = { widgetId: 'demo.card' };",
    'docs/evidence.md': 'Reviewed implementation. No business writes tested.'
  };
  const check = (files, options = {}) => validateContract(memoryProvider(files), { expectedTargetCount: 1, ...options });
  assert.equal(check(fixture).ok, true, JSON.stringify(check(fixture)));
  let count = 1;
  const rejected = (name, mutate, code) => {
    const files = structuredClone(fixture);
    mutate(files);
    const result = check(files);
    assert.equal(result.ok, false, name);
    assert.ok(result.errors.some((error) => error.code === code), `${name}: ${JSON.stringify(result.errors)}`);
    count += 1;
  };
  rejected('wrong marker version', (files) => { files['templates/demo.html'] = files['templates/demo.html'].replace('version: 1.0.0', 'version: 2.0.0'); }, 'MARKER_VERSION');
  rejected('source omitted', (files) => { files['templates/demo.html'] = files['templates/demo.html'].replace(/; source: .*? -->/, ' -->'); }, 'MARKER_REQUIRED');
  rejected('wrong source anchor', (files) => { files['templates/demo.html'] = files['templates/demo.html'].replace('#pc-demo', '#pc-other'); }, 'MARKER_SOURCE');
  rejected('row anchor omitted', (files) => { files[CONTRACT_DOCUMENT] = files[CONTRACT_DOCUMENT].replace('<a id="pc-demo"></a>', ''); }, 'SCHEMA');
  rejected('marker missing', (files) => { files['templates/demo.html'] = ''; }, 'MARKER_MISSING');
  rejected('marker duplicated', (files) => { files['templates/demo.html'] += files['templates/demo.html']; }, 'MARKER_DUPLICATE');
  rejected('legacy tested copied', (files) => { files['templates/demo.html'] = files['templates/demo.html'].replace('; status:', '; tested-version: 2.0.0; status:'); }, 'MARKER_FIELD');
  rejected('unknown surface', (files) => { files['templates/demo.html'] = files['templates/demo.html'].replace('widget:demo.card', 'other'); }, 'MARKER_SURFACE');
  rejected('widget surface removed', (files) => { files[CONTRACT_DOCUMENT] = files[CONTRACT_DOCUMENT].replace('widget:demo.card', 'other'); }, 'WIDGET_SURFACE');
  rejected('missing evidence', (files) => { delete files['docs/evidence.md']; }, 'MISSING_FILE');
  rejected('excluded marker', (files) => { files['templates/demo.html'] = files['templates/demo.html'].replace('Demo;', 'Other;'); }, 'EXCLUDED_MARKER');
  rejected('missing exclusion', (files) => { files[CONTRACT_DOCUMENT] = files[CONTRACT_DOCUMENT].replace('| Other | outside-theme-contract | not-applicable | No theme calls |\n', ''); }, 'MISSING_EXCLUSION');
  rejected('target surface removed', (files) => { files[CONTRACT_DOCUMENT] = files[CONTRACT_DOCUMENT].replace(/^\| <a.*\n/m, ''); }, 'MISSING_PLUGIN');
  rejected('unlinked tested claim', (files) => { files[CONTRACT_DOCUMENT] = files[CONTRACT_DOCUMENT].replace('| — | confirmed |', '| 2.0.0 | compatible-tested |'); }, 'TEST_REQUIRED');
  const tested = structuredClone(fixture);
  tested[CONTRACT_DOCUMENT] = tested[CONTRACT_DOCUMENT].replace('| — | confirmed |', '| 2.0.0 | compatible-tested |').replace('| — | Show card', '| live-demo | Show card');
  const testRow = '| live-demo | Demo | widget:demo.card | 2.0.0 | passed | live | 2026-09-26 | local-fixture-site | 2.26.1 | docs/evidence.md | build:fixture-sha256 | templates/demo.html | Show card | Render then reenter | docs/evidence.md | No writes |\n';
  tested[CONTRACT_DOCUMENT] = tested[CONTRACT_DOCUMENT].replace('<!-- plugin-contract-tests:end -->', `${testRow}<!-- plugin-contract-tests:end -->`);
  tested['templates/demo.html'] = tested['templates/demo.html'].replace('status: confirmed', 'status: compatible-tested');
  assert.equal(check(tested).ok, true, JSON.stringify(check(tested)));
  count += 1;
  for (const [from, to, code] of [
    ['| passed | live |', '| passed | fixture |', 'TEST_NOT_PASSING_LIVE'],
    ['| Show card | Render', '| Other scope | Render', 'TEST_MISMATCH'],
    ['| docs/evidence.md | No writes |', '| docs/evidence.md | None |', 'TEST_MISMATCH'],
    ['| templates/demo.html | Show card | Render', '| templates/other.html | Show card | Render', 'TEST_MISMATCH'],
    ['| build:fixture-sha256 |', '| pending |', 'TEST_REVISION']
  ]) {
    const invalid = { ...tested, [CONTRACT_DOCUMENT]: tested[CONTRACT_DOCUMENT].replace(from, to) };
    assert.ok(check(invalid).errors.some((error) => error.code === code), `test record mutation: ${from}`);
    count += 1;
  }
  const localOnly = { ...tested,
    'output/evidence.json': tested['docs/evidence.md'],
    [CONTRACT_DOCUMENT]: tested[CONTRACT_DOCUMENT].replace('| docs/evidence.md | No writes |', '| output/evidence.json | No writes |')
  };
  assert.ok(check(localOnly).errors.some((error) => error.code === 'NONPORTABLE_EVIDENCE'),
    'live evidence must not depend on untracked local output');
  count += 1;
  for (const file of ['docs/evidence/run/report.json', 'docs/evidence/run/trace.txt', 'docs/evidence/run/screen.png']) {
    const raw = { ...tested,
      [file]: 'local test artifact',
      [CONTRACT_DOCUMENT]: tested[CONTRACT_DOCUMENT].replace('| docs/evidence.md | No writes |', `| ${file} | No writes |`)
    };
    assert.ok(check(raw).errors.some((error) => error.code === 'NONPORTABLE_EVIDENCE'),
      `${file}: raw local artifacts must not become contract evidence`);
    count += 1;
  }
  const untrackedSummary = memoryProvider(tested);
  untrackedSummary.isTracked = (file) => file !== 'docs/evidence.md';
  assert.ok(validateContract(untrackedSummary, { expectedTargetCount: 1 }).errors
    .some((error) => error.code === 'NONPORTABLE_EVIDENCE'),
  'contract evidence must be committed, not merely present in the local workspace');
  count += 1;
  return { ok: true, cases: count, boundary: 'validator consistency only; no plugin runtime or business verification' };
}

function main(args) {
  assert.ok(args.length <= 1 && args.every((arg) => ['--matrix-only', '--self-test', '--print-markers'].includes(arg)), 'usage: node scripts/verify-plugin-contract-markers.mjs [--matrix-only|--self-test|--print-markers]');
  if (args.includes('--self-test')) { console.log(JSON.stringify(selfTest(), null, 2)); return; }
  const provider = fileProvider(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const result = validateContract(provider, { matrixOnly: args.includes('--matrix-only') || args.includes('--print-markers') });
  if (args.includes('--print-markers') && result.ok) {
    console.log(JSON.stringify(suggestedMarkers(parseContract(provider.read(CONTRACT_DOCUMENT), provider.read(TARGET_DOCUMENT)).rows), null, 2));
  } else console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
