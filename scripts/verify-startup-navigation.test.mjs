import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthenticationResponse } from '../src/shared/navigation-response.js';

test('redirected login must leave PJAX before loading authentication assets', () => {
  assert.equal(isAuthenticationResponse({ url: 'https://example.test/login?redirect_uri=%2Fposts%2F1', appId: '' }), true);
  assert.equal(isAuthenticationResponse({ url: 'https://example.test/posts/1', appId: 'auth' }), true);
  assert.equal(isAuthenticationResponse({ url: 'https://example.test/posts/1', pageMode: 'auth' }), true);
});

test('regular pages with login links or redirect parameters remain ordinary app responses', () => {
  assert.equal(isAuthenticationResponse({ url: 'https://example.test/archives?next=/login', appId: 'explorer-archives' }), false);
  assert.equal(isAuthenticationResponse({ url: 'https://example.test/posts/login', appId: 'reader' }), false);
  assert.equal(isAuthenticationResponse({ url: 'broken', appId: 'reader' }), false);
});
