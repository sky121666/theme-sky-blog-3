import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { collectBrowserRuntimeErrors, runtimeErrorMessages } from './lib/browser-runtime-errors.mjs';
import './verify-smoke-failure-reporting.mjs';

const page = new EventEmitter();
const collector = collectBrowserRuntimeErrors(page, {
  expected: (kind, value) => kind === 'responseErrors' && value.status === 404 && value.url === 'https://example.test/expected-404'
});
const request = { method: () => 'GET', resourceType: () => 'fetch', url: () => 'https://example.test/api', failure: () => ({ errorText: 'failed' }) };
page.emit('response', { status: () => 500, url: request.url, request: () => request });
assert.equal(runtimeErrorMessages(collector.snapshot()).length, 1, 'an API 500 without console output must fail');
page.emit('pageerror', new Error('broken page'));
page.emit('console', { type: () => 'error', text: () => 'broken resource', location: () => ({ url: request.url() }) });
page.emit('requestfailed', request);
page.emit('response', { status: () => 404, url: () => 'https://example.test/expected-404', request: () => request });
const result = collector.snapshot();
assert.equal(runtimeErrorMessages(result).length, 4);
assert.deepEqual(result.pageErrors, ['broken page'], 'legacy pageErrors must remain strings');
assert.equal(result.pageErrorDetails[0].name, 'Error');
assert.equal(result.pageErrorDetails[0].message, 'broken page');
assert.match(result.pageErrorDetails[0].stack, /Error: broken page/);
assert.equal(result.pageErrorDetails[0].expected, false);
const opaque = new Error('Object');
opaque.stack = 'Error: Object\n    at render (https://example.test/plugins/example/runtime.js:1:42)';
page.emit('pageerror', opaque);
assert.equal(collector.snapshot().pageErrors.at(-1), 'Object');
assert.match(collector.snapshot().pageErrorDetails.at(-1).stack, /plugins\/example\/runtime.js:1:42/);
assert.equal(runtimeErrorMessages(collector.snapshot()).length, 5, 'opaque errors remain failures after adding detail');
assert.equal(result.expectedErrors.length, 1, 'expected errors remain visible in the report');
assert.equal(runtimeErrorMessages({ blockedWrites: [{ method: 'POST' }] }).length, 1);
collector.stop();
assert.equal(page.eventNames().length, 0, 'listeners must be removed between scenarios');
console.log('browser error gates passed: HTTP, JS, console, network, expected failures and cleanup');
