import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function envValues(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(HALO_BASE_URL|FIVEEE_PAT)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [];
  }));
}

export async function readLiveBuildContext(base) {
  const root = process.cwd();
  const site = new URL(base);
  assert.ok(['http:', 'https:'].includes(site.protocol) && !site.username && !site.password,
    'live base must be an HTTP(S) URL without embedded credentials');
  const local = JSON.parse(await fs.readFile(path.join(root, 'templates/assets/asset-manifest.json'), 'utf8'));
  const shell = local['shell-core']?.js?.[0];
  assert.ok(shell?.includes('/assets/'), 'local manifest must identify the target shell');
  const assets = shell.slice(0, shell.indexOf('/assets/') + '/assets/'.length);
  const fileEnv = envValues(await fs.readFile(path.join(root, '.env.local'), 'utf8').catch(() => ''));
  const configuredBase = process.env.HALO_BASE_URL || fileEnv.HALO_BASE_URL || 'http://localhost:8090';
  const sameEnvironment = new URL(base).origin === new URL(configuredBase).origin;
  const token = sameEnvironment ? (process.env.FIVEEE_PAT || fileEnv.FIVEEE_PAT) : '';
  const read = async (target, json = true, authenticated = false) => {
    const url = new URL(target, site);
    assert.equal(url.origin, site.origin, 'environment reads must stay on the selected site');
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    assert.ok(response.ok, `${target}: HTTP ${response.status}; live environment identity is required`);
    return json ? response.json() : response.text();
  };
  const [remote, html, info, inventory] = await Promise.all([
    read(`${assets}asset-manifest.json`), read('/', false),
    read('/actuator/info', true, true), read('/apis/plugin.halo.run/v1alpha1/plugins?size=100', true, true)
  ]);
  assert.deepEqual(remote.__meta, local.__meta, 'served assets must match the current local build');
  assert.ok(html.replaceAll('\\/', '/').includes(new URL(shell, site).pathname), 'active page must render the target theme shell');
  assert.ok(Array.isArray(inventory.items), 'plugin inventory is not a list');
  assert.ok(!inventory.hasNext && (!inventory.total || inventory.total <= inventory.items.length), 'plugin inventory must not be truncated');
  assert.ok(inventory.items.every((item) => typeof item.metadata?.name === 'string' && item.metadata.name
    && typeof item.spec?.version === 'string' && item.spec.version), 'every installed plugin must identify its name and version');
  const halo = info.build?.version || info.version || info.git?.build?.version;
  assert.ok(typeof halo === 'string' && halo, 'actual Halo version must be observable');
  const hashes = {};
  const contents = new Map();
  const digest = (content) => crypto.createHash('sha256').update(content).digest('hex');
  async function walk(dir) {
    const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT' && dir === 'patches') return [];
      throw error;
    });
    for (const item of entries) {
      const file = `${dir}/${item.name}`;
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) {
        const content = await fs.readFile(path.join(root, file));
        hashes[file] = digest(content);
        contents.set(file, content);
      }
    }
  }
  await walk('src'); await walk('templates'); await walk('patches');
  const buildRootFiles = ['theme.yaml', 'settings.yaml', 'theme-setting.yaml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'tsconfig.json'];
  for (const file of [...buildRootFiles, 'annotation-setting.yaml']) {
    const content = await fs.readFile(path.join(root, file)).catch((error) => {
      if (error.code === 'ENOENT' && ['theme-setting.yaml', 'annotation-setting.yaml'].includes(file)) return null;
      throw error;
    });
    if (content !== null) { hashes[file] = digest(content); contents.set(file, content); }
  }
  const ordered = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
  // Mirror Vite's build input contract, excluding generated assets. A current
  // source snapshot beside an old local build must never masquerade as tested.
  const buildInputs = [...contents.keys()].filter((file) => file.startsWith('src/')
    || (file.startsWith('templates/') && !file.startsWith('templates/assets/'))
    || file.startsWith('patches/') || buildRootFiles.includes(file)).sort((a, b) => a.localeCompare(b));
  const revisionHash = crypto.createHash('sha256');
  for (const file of buildInputs) revisionHash.update(file).update('\0').update(contents.get(file)).update('\0');
  const buildInputRevision = revisionHash.digest('hex').slice(0, 12);
  assert.equal(buildInputRevision, local.__meta.revision, 'local build is stale relative to current source/configuration');
  const verifiedAssets = [];
  for (const asset of [...new Set([...(local['shell-core'].js || []), ...(local['shell-core'].css || [])])]) {
    const remoteAsset = new URL(asset, site);
    remoteAsset.search = local.__meta.query;
    const localPath = `templates/assets/${remoteAsset.pathname.slice(remoteAsset.pathname.indexOf('/assets/') + 8)}`;
    const actual = digest(await read(remoteAsset.href, false));
    assert.equal(actual, hashes[localPath], `served shell bytes differ: ${localPath}`);
    verifiedAssets.push({ path: localPath, sha256: actual });
  }
  return {
    observedAt: new Date().toISOString(), site: site.href, build: remote.__meta,
    halo,
    plugins: inventory.items.map((item) => ({
      name: item.metadata?.name, version: item.spec?.version,
      enabled: item.spec?.enabled, phase: item.status?.phase
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    buildInputRevision, verifiedAssets,
    verificationScope: 'Current local build inputs match revision; remote manifest and shell entry JS/CSS bytes match. App chunks are exercised by individual suites.',
    sourceFingerprint: digest(JSON.stringify(ordered)), files: ordered
  };
}
