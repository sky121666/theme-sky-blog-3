import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { readingHintFilter, summarizePairs } from './lib/reading-preload-ab.mjs';

test('Both proxy arms preserve HTML size and ordinary bytes across arbitrary network boundaries', async () => {
  const hint = '<link rel="modulepreload" data-reading-navigation-preload="" href="/themes/sky/assets/js/a.js?v=1&amp;r=abc" />';
  const before = '<!doctype html><head>中文<link rel="stylesheet" href="/a.css">';
  const after = '</head><body>文章🙂</body></html>';
  const input = Buffer.from(before + hint + after);
  for (const variant of ['with','without']) {
    const hints = [];
    const actual = await buffer(Readable.from([...input].map(byte => Buffer.from([byte])))
      .pipe(readingHintFilter(variant, href => hints.push(href))));
    assert.deepEqual(hints, ['/themes/sky/assets/js/a.js?v=1&r=abc']);
    assert.equal(actual.byteLength, input.byteLength);
    assert.equal(actual.toString(), before + (variant === 'with' ? hint : ' '.repeat(hint.length)) + after);
  }
});

test('Retired hint is reproducible without deploying it; both arms get identical byte lengths', async () => {
  const src = '<html><head><link rel="stylesheet" data-app-css="docsme" href="/docs.css"></head></html>';
  const href = '/assets/js/chunks/navigation.js?v=1&r=test';
  const arms = [];
  for (const arm of ['with','without']) {
    const hints = [];
    arms.push((await buffer(Readable.from([src]).pipe(readingHintFilter(arm, u => hints.push(u), href)))).toString());
    assert.deepEqual(hints,[href]);
  }
  assert.match(arms[0], /data-reading-navigation-preload/);
  assert.doesNotMatch(arms[1], /modulepreload/); assert.equal(arms[0].length,arms[1].length);
});

test('Qualification requires full pairs and enforces title tail as well as both interactiveness medians', () => {
  const pair = { with: {interactive:950,title:450}, without:{interactive:1000,title:400} };
  const pairs = Array(20).fill(pair);
  assert.equal(summarizePairs(pairs).passed, true);
  assert.equal(summarizePairs(pairs.slice(1)).passed, false);
  assert.equal(summarizePairs(pairs.map(p => ({ ...p, with:{...p.with,title:451} }))).passed, false);
  assert.equal(summarizePairs(pairs.map(p => ({ ...p, with:{...p.with,interactive:951} }))).passed, false);
});
