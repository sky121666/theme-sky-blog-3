import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';

// Exercise the smoke script's real navigation and route gate with a controlled
// browser boundary. A plugin request can remain pending after the DOM parses.
const source = readFileSync(new URL('./smoke-playwright.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `smoke source boundary missing: ${start}`);
  return source.slice(from, to);
}

function fixture({ status = 200, alpineStarted = true, bootstrapCancelled = false, onSelector } = {}) {
  const page = new EventEmitter();
  const calls = [];
  const pluginRequest = {
    method: () => 'GET', resourceType: () => 'script',
    url: () => 'https://example.test/plugins/ai-assistant/assets/static/button.js',
    failure: () => ({ errorText: 'net::ERR_ABORTED' })
  };
  const document = {
    readyState: 'interactive',
    body: { dataset: { appId: 'explorer-archives', pageMode: 'browser-list', windowVariant: 'browser' } }
  };
  const window = {
    __THEME_SHELL_CORE_LOADED__: true,
    __THEME_MAIN_LOADED__: true,
    __THEME_ALPINE_STARTED__: alpineStarted,
    __THEME_BOOTSTRAP_CANCELLED__: bootstrapCancelled,
    __THEME_APP_EXPLORER_ARCHIVES_LOADED__: true
  };
  page.goto = async (_url, options) => {
    calls.push(options.waitUntil);
    if (options.waitUntil !== 'commit') {
      throw Object.assign(new Error(`waiting until ${options.waitUntil}`), { name: 'TimeoutError' });
    }
    page.emit('request', pluginRequest);
    return { status: () => status };
  };
  page.waitForFunction = async (predicate, argument) => {
    if (!predicate(argument)) throw Object.assign(new Error('readiness timed out'), { name: 'TimeoutError' });
  };
  page.waitForTimeout = async () => {};
  page.evaluate = async (callback, argument) => callback(argument);
  page.locator = (selector) => ({
    waitFor: async () => {},
    count: async () => {
      onSelector?.({ selector, page, pluginRequest });
      return 1;
    }
  });
  const context = vm.createContext({
    page, document, window, URL, Date, structuredClone, runtimeErrorMessages,
    baseUrl: 'https://example.test', requirePluginRoutes: false,
    knownStaleContentUrls: new Set(), expectedRuntimeErrors: [], skipped: [],
    toAbsoluteUrl: (target) => new URL(target, 'https://example.test').href
  });
  const api = vm.runInContext([
    section('function appLoadedFlagName(', 'function isExternalUploadResourceError('),
    section('function isExternalUploadResourceError(', 'function buildOptionalRoute('),
    section('const smokeFailureSnapshots =', 'async function main()'),
    section('  function createRuntimeErrorCollector(', '  async function navigate('),
    section('  async function navigate(', '  async function validateRoute('),
    section('  async function validateRoute(', '  async function validateLinksInteractions('),
    ';({ navigate, validateRoute, smokeFailureResult })'
  ].join('\n'), context);
  const route = {
    name: 'archives', target: '/archives', optional: false,
    requireShellLoaded: true, expectedAppId: 'explorer-archives',
    expectedPageMode: 'browser-list', expectedWindowVariant: 'browser',
    appRootSelector: '[data-app-root="explorer-archives"]'
  };
  return { api, page, calls, route, pluginRequest };
}

test('parsed theme page passes after one commit while global plugin script holds DCL', async () => {
  const { api, page, calls, route } = fixture();
  const result = await api.validateRoute(route);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['commit']);
  assert.equal(result.domContentLoaded, false);
  assert.equal(result.documentReadyState, 'interactive');
  assert.equal(result.pluginResources.pending.length, 1);
  assert.equal(result.pluginResources.pending[0].url, 'https://example.test/plugins/ai-assistant/assets/static/button.js');
  assert.deepEqual(Array.from(result.pageErrors), []);
  assert.equal(page.eventNames().length, 0, 'all navigation listeners detach after validation');
});

test('plugin HTTP 500 and module export error still fail if emitted during selector validation', async () => {
  let emitted = false;
  const { api, page, route, pluginRequest } = fixture({ onSelector: ({ selector }) => {
    if (selector !== route.appRootSelector || emitted) return;
    emitted = true;
    page.emit('response', {
      request: () => pluginRequest, status: () => 500, url: () => pluginRequest.url()
    });
    page.emit('pageerror', new Error('comment-widget.js does not provide an export named init'));
  } });
  let caught;
  try { await api.validateRoute(route); } catch (error) { caught = error; }
  assert.match(caught?.message || '', /HTTP 500|export named init/);
  const result = api.smokeFailureResult('archives', '/archives', caught, null);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.responseErrors[0].status, 500);
  assert.match(result.pageErrors[0], /export named init/);
  assert.equal(page.eventNames().length, 0);
});

test('loaded module flag does not pass Shell ready when bootstrap is cancelled or Alpine has not started', async () => {
  for (const state of [{ bootstrapCancelled: true }, { alpineStarted: false }]) {
    const { api, route } = fixture(state);
    await assert.rejects(api.validateRoute(route), /readiness timed out|shell.*未就绪/i);
  }
});

test('discovered theme routes require Shell ready without an explicit route flag', async () => {
  const { api, route } = fixture({ bootstrapCancelled: true });
  delete route.requireShellLoaded;
  await assert.rejects(api.validateRoute(route), /readiness timed out|shell.*未就绪/i);
});

test('plugin completion is not claimed without an observed HTTP response', async () => {
  const { api, route } = fixture({ onSelector: ({ selector, page, pluginRequest }) => {
    if (selector === route.appRootSelector) page.emit('requestfinished', pluginRequest);
  } });
  const result = await api.validateRoute(route);
  assert.equal(result.pluginResources.completed.length, 0);
});
