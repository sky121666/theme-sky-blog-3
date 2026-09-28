import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';

// Execute the real smoke collector/catch/report functions without main(),
// Playwright, network or filesystem writes. No mirrored reporting implementation.
const source = fs.readFileSync(new URL('./smoke-playwright.mjs', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `smoke source boundary missing: ${start}`);
  return source.slice(a, b);
};
const common = section('const smokeFailureSnapshots =', 'async function main()');
const policy = section('function isExternalUploadResourceError(', 'function buildOptionalRoute(');
const collector = section('  function createRuntimeErrorCollector(', '  async function navigate(');
const functions = {
  navigate: section('  async function navigate(', '  async function validateRoute('),
  validateRoute: section('  async function validateRoute(', '  async function validateLinksInteractions('),
  validateLinksInteractions: section('  async function validateLinksInteractions(', '  async function validateBangumiInvalidPage('),
  validateSearchInteraction: section('  async function validateSearchInteraction(', '  function assertSearchState('),
  discoverHref: section('  async function discoverHref(', '  const failures = []')
};
const recorder = section('  async function recordCaseFailure(', '\n  for (const route of routes)');
const captureHelper = vm.runInNewContext(`${section('async function captureFailure(', 'async function writeReport(')}; captureFailure`, {
  fs: { mkdir: async () => {} }, path, outputDir: '/tmp/smoke-fixture'
});
const feedPagingBlock = section('      // Fixture pagination must follow the rendered cards after refresh.', '      const sourceFilterButton =');
function harness(functionName, overrides = {}) {
  const functionNames = Array.isArray(functionName) ? functionName : [functionName].filter(Boolean);
  const page = new EventEmitter();
  page.route = async (pattern, handler) => {
    assert.equal(pattern, '**/*');
    page.ssrOnlyRoute = handler;
  };
  page.unroute = async (pattern, handler) => {
    assert.equal(pattern, '**/*');
    assert.equal(handler, page.ssrOnlyRoute);
    delete page.ssrOnlyRoute;
  };
  const routeResults = [], failures = [], discoveryErrors = [], expectedRuntimeErrors = [];
  const context = vm.createContext({ page, routeResults, failures, discoveryErrors, expectedRuntimeErrors,
    URL, Date, structuredClone, runtimeErrorMessages, baseUrl: 'https://example.test', requirePluginRoutes: false,
    appLoadedFlagName: () => null,
    knownStaleContentUrls: new Set(), toAbsoluteUrl: (target) => new URL(target, 'https://example.test').href,
    captureFailure: async () => 'output/fixture-failure.png', ...overrides });
  const api = vm.runInContext(`${common}\n${policy}\n${collector}\n${functionNames.map((name) => functions[name]).join('\n')}\n${recorder}
    ;({ createRuntimeErrorCollector, waitForLinksHistoryNavigation, smokeFailureResult, recordCaseFailure, ${functionNames.join(',')} })`, context);
  return { page, routeResults, failures, discoveryErrors, expectedRuntimeErrors, api };
}
const request = (url, errorText = '') => ({ method: () => 'GET', resourceType: () => 'script',
  url: () => url, failure: () => ({ errorText }) });
function emitEvidence(page) {
  page.emit('pageerror', new Error('before-timeout page error'));
  page.emit('console', { type: () => 'error', text: () => 'before-timeout console error', location: () => ({ url: 'https://example.test/runtime.js' }) });
  const http = request('https://example.test/plugin.js');
  page.emit('request', http);
  page.emit('response', { request: () => http, status: () => 500, url: http.url });
  page.emit('requestfinished', http);
  const broken = request('https://example.test/broken.js', 'net::ERR_CONNECTION_RESET');
  page.emit('request', broken); page.emit('requestfailed', broken);
  const aborted = request('https://example.test/aborted.js', 'net::ERR_ABORTED');
  page.emit('request', aborted); page.emit('requestfailed', aborted);
  const pending = request('https://user:password@example.test/pending.js?token=private#fragment');
  page.emit('request', pending);
  const bodyPending = request('https://example.test/body-pending.js');
  page.emit('request', bodyPending);
  page.emit('response', { request: () => bodyPending, status: () => 200, url: bodyPending.url });
  return { pending, bodyPending };
}
const checks = [];
{
  let cardCount = 2;
  let clicks = 0;
  const button = { disabled: false };
  const feedApiRequests = [new URL('https://example.test/linkfeeds?beforeId=feed-2')];
  const page = {
    locator: () => ({ count: async () => cardCount, click: async () => {
      clicks += 1;
      cardCount = 3;
      feedApiRequests.push(new URL('https://example.test/linkfeeds?beforePublishedAt=2026-07-21&beforeId=feed-2'));
    } }),
    waitForFunction: async (predicate) => {
      if (!predicate()) throw new Error('fixture cards never reached three');
    }
  };
  const runPagingBlock = vm.runInNewContext(`(async () => { ${feedPagingBlock} })`, {
    page,
    feedApiRequests,
    document: {
      querySelectorAll: () => ({ length: cardCount }),
      querySelector: () => button
    },
    getComputedStyle: () => ({ display: 'block' })
  });
  await runPagingBlock();
  assert.equal(clicks, 1, 'a historical cursor request cannot replace the missing third card');
  assert.equal(cardCount, 3);
  checks.push('Links fixture pagination follows current rendered cards after refresh');
}
{
  await assert.rejects(captureHelper({ screenshot: async () => { throw new Error('screenshot failed'); } }, 'failed-case'), /screenshot failed/);
  assert.equal(await captureHelper({ screenshot: async () => {} }, 'successful-case'), '/tmp/smoke-fixture/successful-case.png');
  checks.push('the real screenshot helper returns a path only after capture succeeds');
}
for (const name of ['navigate', 'validateLinksInteractions', 'validateSearchInteraction']) {
  const error = new Error(`${name}: navigation timeout`);
  let h;
  const fail = async () => { emitEvidence(h.page); throw error; };
  h = harness(name, name === 'validateLinksInteractions' ? { validateRoute: fail }
    : name === 'validateSearchInteraction' ? { navigate: fail } : {});
  h.page.goto = fail;
  await assert.rejects(h.api[name]({ target: '/links?view=board', waitUntil: 'domcontentloaded' }), (actual) => actual === error);
  assert.equal(h.page.eventNames().length, 0, 'failure finally must detach every collector listener');
  await h.api.recordCaseFailure(name, '/links', error);
  const [result] = h.routeResults;
  assert.equal(result.status, 'failed'); assert.equal(result.runtimeSnapshotAvailable, true);
  assert.equal(result.httpStatus, null, 'no observed document response must remain unknown');
  assert.equal(result.error.message, error.message); assert.equal(h.failures.length, 1);
  assert.deepEqual(Array.from(result.pageErrors), ['before-timeout page error']);
  assert.deepEqual(Array.from(result.consoleErrors), ['before-timeout console error']);
  assert.equal(result.requestFailures.length, 2, 'unexplained aborts must remain failures');
  assert.equal(result.requestFailures[0].errorText, 'net::ERR_CONNECTION_RESET');
  assert.equal(result.requestFailures[1].errorText, 'net::ERR_ABORTED');
  assert.equal(result.responseErrors[0].status, 500);
  assert.equal(result.expectedErrors.length, 0, 'unexplained aborts must not enter expected errors');
  assert.equal(result.pendingRequests.length, 2, 'completed/failed requests are not pending');
  const pending = result.pendingRequests.find(({ url }) => url.endsWith('/pending.js'));
  assert.equal(pending.url, 'https://example.test/pending.js', 'new diagnostic URL must omit credentials/query/fragment');
  assert.equal(pending.responseState, 'unknown'); assert.equal(pending.responseStatus, null);
  assert.equal(pending.bodyCompletion, 'unknown');
  const bodyPending = result.pendingRequests.find(({ url }) => url.endsWith('/body-pending.js'));
  assert.equal(bodyPending.responseState, 'observed'); assert.equal(bodyPending.responseStatus, 200);
  assert.equal(bodyPending.bodyCompletion, 'unknown', 'headers do not prove body completion');
  h.page.emit('console', { type: () => 'error', text: () => 'later case', location: () => ({}) });
  assert.equal(result.consoleErrors.length, 1, 'later activity cannot mutate the failure snapshot');
  checks.push(`${name}: original exception and pre-failure runtime/network evidence survive cleanup and reporting`);
}
{
  const h = harness('');
  const oldRequest = request('https://example.test/previous-page.js', 'net::ERR_ABORTED');
  h.page.emit('request', oldRequest);
  const collector = h.api.createRuntimeErrorCollector();
  h.page.emit('requestfailed', oldRequest);
  h.page.emit('response', { request: () => oldRequest, status: () => 500, url: oldRequest.url });
  collector.assertEmpty('next route');
  assert.equal(collector.snapshot().requestFailures.length, 0);
  assert.equal(collector.snapshot().responseErrors.length, 0);
  collector.stop();
  checks.push('a previous route request cannot be attributed to the next route collector');
}
{
  const h = harness('');
  const collector = h.api.createRuntimeErrorCollector();
  const aborted = request('https://example.test/app.js', 'net::ERR_ABORTED');
  h.page.emit('request', aborted); h.page.emit('requestfailed', aborted);
  assert.throws(() => collector.assertEmpty('fixture'), /ERR_ABORTED/);
  assert.equal(collector.snapshot().expectedErrors.length, 0);
  collector.stop();
  checks.push('an unexplained aborted app request fails the runtime gate');
}
{
  const h = harness('discoverHref');
  const documentRequest = { method: () => 'GET', resourceType: () => 'document',
    url: () => 'https://user:password@example.test/photos?token=private' };
  const pendingRequest = { method: () => 'GET', resourceType: () => 'script',
    url: () => 'https://user:password@example.test/plugin.js?token=private' };
  h.page.goto = async (_url, options) => {
    assert.equal(options.timeout, 20_000, 'discovery timeout must stay strict');
    let continued = 0;
    let aborted = 0;
    await h.page.ssrOnlyRoute({ request: () => ({ resourceType: () => 'document' }), continue: async () => { continued += 1; }, abort: async () => { aborted += 1; } });
    await h.page.ssrOnlyRoute({ request: () => ({ resourceType: () => 'script' }), continue: async () => { continued += 1; }, abort: async () => { aborted += 1; } });
    assert.deepEqual([continued, aborted], [1, 1], 'sample discovery must fetch only the SSR document');
    h.page.emit('request', documentRequest);
    h.page.emit('response', { request: () => documentRequest, status: () => 200,
      url: () => documentRequest.url() });
    h.page.emit('request', pendingRequest);
    throw new Error('page.goto: Timeout 20000ms exceeded');
  };
  assert.equal(await h.api.discoverHref('/photos', ['a[href]'], () => false), null);
  assert.equal(h.failures.length, 1, 'a timeout must remain a failing discovery');
  assert.equal(h.discoveryErrors.length, 1);
  const [discovery] = h.discoveryErrors;
  assert.equal(discovery.phase, 'navigation');
  assert.equal(discovery.documentResponse.status, 200, 'response headers alone do not prove DCL');
  assert.equal(discovery.documentResponse.url, 'https://example.test/photos');
  assert.equal(discovery.documentResponse.bodyCompletion, 'unknown');
  assert.equal(discovery.networkSnapshot.pendingRequests.length, 2);
  assert.equal(discovery.networkSnapshot.pendingRequests[0].responseState, 'observed');
  assert.equal(discovery.networkSnapshot.pendingRequests[0].bodyCompletion, 'unknown');
  assert.equal(discovery.networkSnapshot.pendingRequests[1].url, 'https://example.test/plugin.js');
  assert.equal(h.page.eventNames().length, 0, 'discovery listeners must be detached');
  assert.equal(h.page.ssrOnlyRoute, undefined, 'sample discovery route must be removed after a failure');
  checks.push('sample-discovery timeout remains fatal and preserves sanitized network evidence');
}
{
  const h = harness('');
  const expectedUrl = 'https://example.test/links?group=expected';
  const steps = [];
  let acceptResponse, finishBody, finishSwap;
  const page = {
    waitForResponse(predicate) {
      steps.push('listen');
      assert.equal(predicate({ url: () => 'https://example.test/posts',
        request: () => ({ method: () => 'GET', resourceType: () => 'xhr' }) }), false);
      assert.equal(predicate({ url: () => expectedUrl,
        request: () => ({ method: () => 'GET', resourceType: () => 'image' }) }), false);
      assert.equal(predicate({ url: () => 'https://example.test/links',
        request: () => ({ method: () => 'GET', resourceType: () => 'xhr' }) }), true);
      return new Promise((resolve) => { acceptResponse = resolve; });
    },
    waitForFunction(_predicate, url) {
      steps.push('swap');
      assert.equal(url, expectedUrl);
      return new Promise((resolve) => { finishSwap = resolve; });
    }
  };
  let settled = false;
  const navigation = h.api.waitForLinksHistoryNavigation(page, async () => {
    steps.push('navigate');
  }, expectedUrl).then(() => { settled = true; });
  assert.deepEqual(steps, ['listen', 'navigate'], 'response listener must precede history traversal');
  acceptResponse({ ok: () => true, finished: () => new Promise((resolve) => { finishBody = resolve; }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'headers alone do not prove PJAX completion');
  finishBody(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steps, ['listen', 'navigate', 'swap']);
  assert.equal(settled, false, 'the swapped UI must settle before the next history action');
  finishSwap();
  await navigation;
  assert.equal(settled, true);
  checks.push('Links history traversal waits for its matching XHR body and PJAX swap');
}
{
  const knownStaleContentUrls = new Set(['https://example.test/old-upload.jpeg']);
  const h = harness('', { knownStaleContentUrls });
  const collector = h.api.createRuntimeErrorCollector();
  const stale = request('https://example.test/old-upload.jpeg', 'net::ERR_ABORTED');
  h.page.emit('request', stale); h.page.emit('requestfailed', stale);
  collector.assertEmpty('fixture');
  assert.equal(collector.snapshot().expectedErrors[0].reason, 'registered-stale-content-url');
  collector.stop();
  checks.push('a specifically registered stale content URL remains visible and exempt');
}
for (const phase of ['settle', 'evaluate']) {
  const error = new Error(`HTTP 200 followed by ${phase} failure`);
  const h = harness('navigate');
  h.page.goto = async () => ({ status: () => 200 });
  h.page.waitForFunction = async () => {};
  h.page.locator = () => ({ waitFor: async () => {} });
  h.page.waitForTimeout = async () => { if (phase === 'settle') throw error; };
  h.page.evaluate = async () => { throw error; };
  await assert.rejects(h.api.navigate({ target: '/observed-200', waitUntil: 'domcontentloaded' }), (actual) => actual === error);
  await h.api.recordCaseFailure(`200-${phase}`, '/observed-200', error);
  assert.equal(h.routeResults[0].httpStatus, 200);
  assert.equal(h.routeResults[0].responseErrors.length, 0, 'HTTP 200 is evidence, not an HTTP error');
  assert.equal(h.page.eventNames().length, 0);
  checks.push(`navigate preserves an observed HTTP 200 when ${phase} fails`);
}
{
  let h;
  const navigate = async () => {
    const collector = h.api.createRuntimeErrorCollector();
    const snapshot = collector.snapshot();
    collector.stop();
    return { status: 500, ...snapshot };
  };
  h = harness(['validateRoute', 'validateLinksInteractions'], { navigate });
  let caught;
  try { await h.api.validateLinksInteractions(); } catch (error) { caught = error; }
  assert.match(caught.message, /^HTTP 500$/);
  await h.api.recordCaseFailure('links-nested-500', '/links', caught);
  assert.equal(h.routeResults[0].httpStatus, 500, 'outer Links snapshot must retain inner validateRoute status');
  assert.equal(h.routeResults[0].error.message, 'HTTP 500');
  assert.equal(h.page.eventNames().length, 0);
  checks.push('nested Links/validateRoute failure retains HTTP 500 and the original exception');
}
{
  const error = new Error('inner navigate observed 200 then failed');
  const h = harness(['navigate', 'validateSearchInteraction']);
  h.page.goto = async () => ({ status: () => 200 });
  h.page.waitForFunction = async () => {};
  h.page.locator = () => ({ waitFor: async () => {} });
  h.page.waitForTimeout = async () => { throw error; };
  h.page.evaluate = async () => { throw error; };
  await assert.rejects(h.api.validateSearchInteraction(), (actual) => actual === error);
  await h.api.recordCaseFailure('search-nested-200', '/', error);
  assert.equal(h.routeResults[0].httpStatus, 200, 'outer null status must not overwrite observed inner status');
  assert.equal(h.page.eventNames().length, 0);
  checks.push('nested Search catch cannot replace the inner observed document status with null');
}
{
  const h = harness('validateSearchInteraction', { navigate: async () => ({ status: 500 }) });
  let caught;
  try { await h.api.validateSearchInteraction(); } catch (error) { caught = error; }
  assert.match(caught.message, /^HTTP 500$/);
  await h.api.recordCaseFailure('search-observed-500', '/', caught);
  assert.equal(h.routeResults[0].httpStatus, 500);
  assert.equal(h.page.eventNames().length, 0);
  checks.push('Search own HTTP assertion preserves the navigation status');
}
{
  const error = new Error('screenshot must not mask the timeout');
  const h = harness('', { captureFailure: async () => { throw new Error('screenshot unavailable'); } });
  await h.api.recordCaseFailure('unobserved-api-case', '/api-fixture', error);
  const [result] = h.routeResults;
  assert.equal(result.status, 'failed'); assert.equal(result.error.message, error.message);
  assert.equal(result.runtimeSnapshotAvailable, false);
  for (const key of ['pageErrors', 'consoleErrors', 'requestFailures', 'responseErrors', 'pendingRequests']) {
    assert.equal(result[key], null, `${key}: absence of collection is not an empty successful observation`);
  }
  assert.match(result.networkObservation, /unknown/);
  assert.equal(result.screenshotError, 'screenshot unavailable'); assert.equal(h.failures.length, 1);
  checks.push('missing snapshot stays unknown; screenshot failure cannot lose the original failed case');
}
{
  let h;
  const navigate = async () => {
    const collector = h.api.createRuntimeErrorCollector();
    emitEvidence(h.page); const snapshot = collector.snapshot(); collector.stop();
    return { ...snapshot, status: 500 };
  };
  h = harness('validateRoute', { navigate });
  let caught;
  try { await h.api.validateRoute({ target: '/failed' }); } catch (error) { caught = error; }
  assert.match(caught.message, /HTTP 500/);
  await h.api.recordCaseFailure('failed-route', '/failed', caught);
  assert.equal(h.routeResults[0].httpStatus, 500);
  assert.equal(h.routeResults[0].responseErrors[0].status, 500);
  checks.push('post-navigation route assertion failures preserve the completed navigation snapshot and HTTP status');
}
assert.equal((source.match(/await recordCaseFailure\(/g) || []).length, 5, 'every route/interaction catch must append a failed case');
assert.match(section('  if (failures.length) {', "  console.log(`Playwright smoke 通过"), /process\.exitCode = 1/);
checks.push('all five failure report sites retain the existing nonzero exit gate');
console.log(`smoke failure reporting passed: ${checks.length} cases`);
checks.forEach((check) => console.log(`- ${check}`));
