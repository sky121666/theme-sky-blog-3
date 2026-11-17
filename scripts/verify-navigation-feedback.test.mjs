import assert from 'node:assert/strict';
import { test } from 'node:test';

const moduleUrl = new URL('../src/shell/desktop-shell/runtime/desktop/pjax/navigation-feedback.js', import.meta.url);
const feedback = await import(moduleUrl).catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes(moduleUrl.pathname)) throw error;
  return {};
});

function begin(element) {
  assert.equal(typeof feedback.beginNavigationFeedback, 'function', 'navigation trigger feedback is not implemented');
  return feedback.beginNavigationFeedback(element);
}

function elementFixture({ classes = ['pjax-link'], busy = null } = {}) {
  const classNames = new Set(classes);
  const attributes = new Map(busy === null ? [] : [['aria-busy', busy]]);
  return {
    classList: {
      contains: value => classNames.has(value),
      add: value => classNames.add(value),
      remove: value => classNames.delete(value)
    },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name)
  };
}

test('an accepted trigger immediately shows pending feedback and cleanup restores its idle state', () => {
  const element = elementFixture();
  const cleanup = begin(element);
  assert.equal(element.classList.contains('theme-navigation-pending'), true);
  assert.equal(element.getAttribute('aria-busy'), 'true');
  assert.equal(element.classList.contains('pjax-link'), true);
  cleanup();
  cleanup();
  assert.equal(element.classList.contains('theme-navigation-pending'), false);
  assert.equal(element.getAttribute('aria-busy'), null);
  assert.equal(element.classList.contains('pjax-link'), true);
});

for (const busy of ['false', 'true', '']) {
  test(`cleanup restores an existing aria-busy attribute exactly (${JSON.stringify(busy)})`, () => {
    const element = elementFixture({ busy });
    const cleanup = begin(element);
    assert.equal(element.getAttribute('aria-busy'), 'true');
    cleanup();
    assert.equal(element.getAttribute('aria-busy'), busy);
  });
}

test('cleanup preserves an existing pending class and unrelated class changes', () => {
  const element = elementFixture({ classes: ['pjax-link', 'theme-navigation-pending'] });
  const cleanup = begin(element);
  element.classList.add('is-active');
  cleanup();
  assert.equal(element.classList.contains('theme-navigation-pending'), true);
  assert.equal(element.classList.contains('pjax-link'), true);
  assert.equal(element.classList.contains('is-active'), true);
  assert.equal(element.getAttribute('aria-busy'), null);
});

test('an older cleanup cannot clear a newer intent on the same trigger', () => {
  const element = elementFixture({ busy: 'false' });
  const oldCleanup = begin(element);
  const currentCleanup = begin(element);
  oldCleanup();
  assert.equal(element.classList.contains('theme-navigation-pending'), true);
  assert.equal(element.getAttribute('aria-busy'), 'true');
  currentCleanup();
  assert.equal(element.classList.contains('theme-navigation-pending'), false);
  assert.equal(element.getAttribute('aria-busy'), 'false');
  oldCleanup();
  assert.equal(element.getAttribute('aria-busy'), 'false');
});

test('an already settled cleanup cannot affect a later round on the same trigger', () => {
  const element = elementFixture();
  const oldCleanup = begin(element);
  oldCleanup();
  const currentCleanup = begin(element);
  oldCleanup();
  assert.equal(element.classList.contains('theme-navigation-pending'), true);
  assert.equal(element.getAttribute('aria-busy'), 'true');
  currentCleanup();
  assert.equal(element.classList.contains('theme-navigation-pending'), false);
  assert.equal(element.getAttribute('aria-busy'), null);
});

test('cleanup for one trigger leaves another trigger pending', () => {
  const first = elementFixture();
  const second = elementFixture();
  const firstCleanup = begin(first);
  const secondCleanup = begin(second);
  firstCleanup();
  assert.equal(first.classList.contains('theme-navigation-pending'), false);
  assert.equal(second.classList.contains('theme-navigation-pending'), true);
  assert.equal(second.getAttribute('aria-busy'), 'true');
  secondCleanup();
  assert.equal(second.classList.contains('theme-navigation-pending'), false);
});

test('a navigation without a trigger has a safe repeatable cleanup', () => {
  for (const element of [undefined, null]) {
    const cleanup = begin(element);
    assert.equal(typeof cleanup, 'function');
    assert.doesNotThrow(() => { cleanup(); cleanup(); });
  }
});
