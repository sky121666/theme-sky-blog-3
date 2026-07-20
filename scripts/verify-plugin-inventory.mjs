import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  THEME_PLUGIN_MANIFEST,
  assertCompatibilityPins,
  assertStrictThemeInventory,
  buildPluginAliasIndex,
  normalizePluginInventory,
  parseCliArgs,
  resolvePluginId
} from './audit-plugin-inventory.mjs';

const root = process.cwd();

function pluginFixture(entry, override = {}) {
  const fixtureAliases = {
    'halo-plugin-steam': 'steam',
    'plugin-equipment': 'equipment',
    'plugin-online': 'online',
    'plugin-shiki': 'shiki'
  };
  return {
    metadata: { name: fixtureAliases[entry.id] || entry.id },
    spec: {
      enabled: true,
      version: entry.expectedVersion
    },
    status: { phase: 'STARTED' },
    ...override
  };
}

const aliasIndex = buildPluginAliasIndex();
assert.equal(aliasIndex.size >= THEME_PLUGIN_MANIFEST.length, true);
assert.equal(resolvePluginId('steam'), 'halo-plugin-steam');
assert.equal(resolvePluginId('PLUGIN-EQUIPMENT'), 'plugin-equipment');
assert.equal(resolvePluginId('online'), 'plugin-online');
assert.equal(resolvePluginId('shiki'), 'plugin-shiki');
assert.equal(resolvePluginId('PluginFeed'), 'PluginFeed');
assert.deepEqual(parseCliArgs(['--strict-theme', '--', 'steam']), {
  strictTheme: true,
  requestedNames: ['steam']
});

const passingPlugins = THEME_PLUGIN_MANIFEST.map((entry) => pluginFixture(entry));
const passingRows = normalizePluginInventory(passingPlugins);
assert.doesNotThrow(() => assertCompatibilityPins(passingRows));
assert.doesNotThrow(() => assertStrictThemeInventory(passingRows));

const missingRows = passingRows.filter((row) => row.canonicalName !== 'PluginFeed');
assert.throws(() => assertStrictThemeInventory(missingRows), /PluginFeed: missing/);

const disabledRows = passingRows.map((row) => row.canonicalName === 'PluginFeed'
  ? { ...row, enabled: false }
  : row);
assert.throws(() => assertStrictThemeInventory(disabledRows), /PluginFeed: disabled/);

const stoppedRows = passingRows.map((row) => row.canonicalName === 'PluginFeed'
  ? { ...row, phase: 'STOPPED' }
  : row);
assert.throws(() => assertStrictThemeInventory(stoppedRows), /PluginFeed: phase=STOPPED/);

const wrongVersionRows = passingRows.map((row) => row.canonicalName === 'PluginFeed'
  ? { ...row, version: '1.4.9' }
  : row);
assert.throws(() => assertStrictThemeInventory(wrongVersionRows), /PluginFeed: version=1\.4\.9/);

const wrongLinksRows = passingRows.map((row) => row.canonicalName === 'PluginLinks'
  ? { ...row, version: '2.2.1' }
  : row);
assert.throws(() => assertCompatibilityPins(wrongLinksRows), /PluginLinks=2\.2\.1/);
assert.throws(() => assertStrictThemeInventory(wrongLinksRows), /PluginLinks: version=2\.2\.1/);

const duplicateAliasRows = normalizePluginInventory([
  ...passingPlugins,
  {
    metadata: { name: 'halo-plugin-steam' },
    spec: { enabled: true, version: '1.0.0' },
    status: { phase: 'STARTED' }
  }
]);
assert.throws(() => assertStrictThemeInventory(duplicateAliasRows), /halo-plugin-steam: duplicate manifests/);

const layout = fs.readFileSync(path.join(root, 'templates/modules/shell/layout.html'), 'utf8');
const rssTags = layout.match(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\btype=["']application\/rss\+xml["'])[^>]*>/gi) || [];
assert.equal(rssTags.length, 1, 'layout should define one RSS alternate tag');
assert.match(rssTags[0], /th:if=["']\$\{pluginFinder\.available\('PluginFeed'\)\}["']/);
assert.match(rssTags[0], /th:href=["']@\{\/rss\.xml\}["']/);
assert.match(layout, /plugin-contract: PluginFeed; contract-version: 1\.5\.0; tested-version: 1\.5\.0/);

console.log(`plugin inventory contract passed (${THEME_PLUGIN_MANIFEST.length} strict fixture plugins)`);
