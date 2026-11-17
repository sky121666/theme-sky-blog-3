import { Transform } from 'node:stream';
import assert from 'node:assert/strict';

// Work in latin1 for a byte-preserving round trip, even if TCP splits a UTF-8
// character. Hold at most an incomplete <link> (or its four-character prefix).
// Both arms use this transform; padding keeps HTML byte size and pacing equal.
export function readingHintFilter(variant, onHint, experimentalHref) {
  let pending = '';
  let inserted = false;
  const emit = (stream, value) => { if (value) stream.push(Buffer.from(value, 'latin1')); };
  return new Transform({
    transform(chunk, _, done) {
      pending += chunk.toString('latin1');
      for (;;) {
        const start = pending.toLowerCase().indexOf('<link');
        if (start < 0) {
          emit(this, pending.slice(0, -4)); pending = pending.slice(-4); break;
        }
        emit(this, pending.slice(0, start)); pending = pending.slice(start);
        const close = pending.indexOf('>');
        if (close < 0) break;
        const tag = pending.slice(0, close + 1);
        pending = pending.slice(close + 1);
        if (/^<link\s/i.test(tag) && /\sdata-reading-navigation-preload(?=[\s=/>])/i.test(tag)) {
          const href = tag.match(/\shref="([^"]+)"/i)?.[1]?.replaceAll('&amp;', '&');
          if (!/\srel="modulepreload"/i.test(tag) || !href) return done(new Error('Invalid SSR reading preload'));
          onHint(href);
          emit(this, variant === 'without' ? ' '.repeat(tag.length) : tag);
        } else {
          emit(this, tag);
          // The candidate failed its gate and is absent in shipped SSR. Recreate
          // its original position in the development proxy, without editing Halo.
          if (!inserted && experimentalHref && /\sdata-app-css="(?:reader|docsme)"/i.test(tag)) {
            inserted = true;
            const link = '<link rel="modulepreload" crossorigin="anonymous" data-reading-navigation-preload="" href="' + experimentalHref.replaceAll('&','&amp;') + '" />';
            onHint(experimentalHref);
            emit(this,variant === 'with' ? link : ' '.repeat(link.length));
          }
        }
      }
      done();
    },
    flush(done) { emit(this, pending); done(); }
  });
}

export function summarizePairs(pairs) {
  const median = xs => {
    const sorted = [...xs].sort((a,b) => a-b), mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const p75 = xs => [...xs].sort((a,b) => a-b)[Math.ceil(xs.length * .75) - 1];
  assert.ok(pairs.length && pairs.every(p => p.with && p.without), 'Missing matched visits');
  const summary = Object.fromEntries(['with', 'without'].map(key => [key, {
    interactiveMedianMs: median(pairs.map(p => p[key].interactive)),
    titleP75Ms: p75(pairs.map(p => p[key].title))
  }]));
  const pairedGainMs = median(pairs.map(p => p.without.interactive - p.with.interactive));
  const medianGainMs = summary.without.interactiveMedianMs - summary.with.interactiveMedianMs;
  const titleChangeMs = summary.with.titleP75Ms - summary.without.titleP75Ms;
  return { ...summary, pairedGainMs, medianGainMs, titleChangeMs, pairs: pairs.length,
    passed: pairs.length >= 20 && pairedGainMs >= 50 && medianGainMs >= 50 && titleChangeMs <= 50 };
}
