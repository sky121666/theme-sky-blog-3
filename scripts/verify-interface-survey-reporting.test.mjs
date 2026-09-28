import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// Run the survey's actual final reporting block with only the live identity
// read replaced. The report is written to a real temporary file.
const source = readFileSync(new URL('./verify-interface-survey.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  const final = await readLiveBuildContext(baseUrl)');
const end = source.indexOf('\n} finally { await browser.close(); }', start);
assert.ok(start >= 0 && end > start, 'interface survey final reporting block is available');
const finalReporting = source.slice(start, end);

test('final identity timeout writes all 46 page results as a failed survey', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'interface-survey-report-'));
  try {
    const routes = Array.from({ length: 46 }, (_, index) => ({
      viewport: index < 23 ? 'desktop' : 'mobile',
      route: `page-${index + 1}`,
      state: { domContentLoadedAt: index === 10 ? 0 : 100 },
      externalResourceFindings: index === 9 ? [{ url: 'https://example.test/poster.jpg' }] : []
    }));
    const report = { routes, failures: ['mobile/bangumis: navigation timeout'] };
    const processState = { exitCode: 0 };
    const logs = [];
    const context = vm.createContext({
      report, initial: { sourceFingerprint: 'same-source' }, baseUrl: 'https://example.test',
      dir, path, fs, process: processState,
      readLiveBuildContext: async () => { throw new Error('final identity fetch timed out'); },
      console: { log: (line) => logs.push(JSON.parse(line)) }
    });

    await vm.runInContext(`(async () => {${finalReporting}\n})()`, context);

    const saved = JSON.parse(await fs.readFile(path.join(dir, 'interface-survey.json'), 'utf8'));
    assert.equal(saved.routes.length, 46);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.pendingDomContentLoaded, 1);
    assert.equal(saved.externalResourceFindings, 1);
    assert.deepEqual(saved.failures[0], 'mobile/bangumis: navigation timeout');
    assert.match(saved.failures[1], /final.*identity.*final identity fetch timed out/i);
    assert.match(saved.finalIdentityError, /final identity fetch timed out/);
    assert.equal(saved.finalIdentity, undefined);
    assert.equal(processState.exitCode, 1);
    assert.deepEqual(logs, [{ status: 'failed', routes: 46, failures: 2 }]);

    report.failures = [];
    processState.exitCode = 0;
    await vm.runInContext(`(async () => {${finalReporting}\n})()`, context);
    const identityOnlyFailure = JSON.parse(await fs.readFile(path.join(dir, 'interface-survey.json'), 'utf8'));
    assert.equal(identityOnlyFailure.status, 'failed', 'a final identity error alone must fail the survey');
    assert.equal(identityOnlyFailure.routes.length, 46);
    assert.equal(identityOnlyFailure.failures.length, 1);
    assert.equal(processState.exitCode, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
