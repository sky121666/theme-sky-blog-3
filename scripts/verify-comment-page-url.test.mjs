import assert from 'node:assert/strict';
import test from 'node:test';
import { isCommentPageOnlyNavigation, readCommentPageUrl } from '../src/shared/comment-page-url.js';

const page = 'https://example.test/archives/post?preview-theme=theme-sky-blog-3';

test('only a canonical positive safe page number is eligible for local comment history', () => {
  assert.equal(readCommentPageUrl(page).page, 1);
  assert.equal(readCommentPageUrl(`${page}&comment-page=23`).page, 23);
  for (const value of ['', '0', '-1', '1.5', '01', '1e2', '+2', 'x', '9007199254740992', '2&comment-page=3']) {
    assert.equal(readCommentPageUrl(`${page}&comment-page=${value}`), null, value);
  }
  assert.equal(readCommentPageUrl('not a URL'), null);
});

test('pagination retains all other query values and hash ownership', () => {
  assert.equal(isCommentPageOnlyNavigation(page, `${page}&comment-page=2`), true);
  assert.equal(isCommentPageOnlyNavigation(`${page}&comment-page=3`, page), true);
  assert.equal(isCommentPageOnlyNavigation(page, page), false);
  for (const url of [
    `${page}&other=1&comment-page=2`, `${page.replace('/post', '/other')}&comment-page=2`,
    `${page.replace('example.test', 'other.test')}&comment-page=2`, `${page}&comment-page=2#heading`, `${page}&comment-page=invalid`
  ]) assert.equal(isCommentPageOnlyNavigation(page, url), false, url);
});

test('the official URLSearchParams serialization cannot turn unchanged filter values into a route change', () => {
  assert.equal(isCommentPageOnlyNavigation(`${page}&filter=a%20b`, `${page}&filter=a+b&comment-page=2`), true);
  assert.equal(isCommentPageOnlyNavigation(`${page}&filter=a%20b`, `${page}&filter=a+c&comment-page=2`), false);
});
