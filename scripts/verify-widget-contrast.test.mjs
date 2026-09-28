import assert from 'node:assert/strict';
import test from 'node:test';
import { computedTextContrast } from './lib/widget-contrast.mjs';

const background = (backgroundColor, backgroundImage = 'none') => ({ backgroundColor, backgroundImage, opacity: '1' });
const body = background('rgb(233, 237, 242)');
const oldMobile = background('rgba(24, 27, 35, 0.84)', 'linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03))');
const lightMobile = background('rgba(255, 255, 255, 0.72)', 'linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.03))');
const lightText = 'rgba(18, 22, 28, 0.94)';
const darkText = 'rgba(255, 255, 255, 0.98)';

test('old mobile dark background with light-mode text fails the primary-text threshold', () => {
  const result = computedTextContrast({ layers: [body, oldMobile], color: lightText });
  assert.ok(result.minimumRatio < 4.5);
  assert.equal(result.samples.length, 2);
});

test('appearance-matched mobile surfaces pass for header and nested project link', () => {
  for (const [surface, color, panel] of [
    [lightMobile, lightText, 'rgba(0, 0, 0, 0.012)'],
    [oldMobile, darkText, 'rgba(255, 255, 255, 0.015)']
  ]) {
    for (const layers of [[body, surface], [body, surface, background(panel)]]) {
      assert.ok(computedTextContrast({ layers, color }).minimumRatio >= 4.5);
    }
  }
});

test('known opaque black/white pair has ratio 21 and alpha text is composited', () => {
  assert.equal(computedTextContrast({ layers: [background('rgb(255, 255, 255)')], color: 'rgb(0, 0, 0)' }).minimumRatio, 21);
  assert.ok(computedTextContrast({ layers: [background('rgb(255, 255, 255)')], color: 'rgba(0, 0, 0, 0.5)' }).minimumRatio < 4.5);
});

test('CSSOM/minified gradients may omit the default direction or retain endpoint stops', () => {
  for (const backgroundImage of [
    'linear-gradient(rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.03))',
    'linear-gradient(to bottom, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.03) 100%)'
  ]) {
    assert.equal(computedTextContrast({ layers: [body, { ...lightMobile, backgroundImage }], color: lightText }).minimumRatio,
      computedTextContrast({ layers: [body, lightMobile], color: lightText }).minimumRatio);
  }
});

test('observed CSSOM gradient plus an empty color-layer image keeps the same contrast', () => {
  const observed = 'linear-gradient(rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.03)), none';
  assert.deepEqual(computedTextContrast({ layers: [body, { ...lightMobile, backgroundImage: observed }], color: lightText }),
    computedTextContrast({ layers: [body, lightMobile], color: lightText }));
  assert.ok(computedTextContrast({ layers: [body, { ...oldMobile, backgroundImage: `${oldMobile.backgroundImage}, none` }], color: lightText }).minimumRatio < 4.5);
  for (const backgroundImage of [
    `${lightMobile.backgroundImage}, ${lightMobile.backgroundImage}, none`,
    `${lightMobile.backgroundImage}, url(wallpaper.png), none`,
    'linear-gradient(180deg, rgb(0, 0, 0), rgb(255, 255, 255)), none'
  ]) assert.throws(() => computedTextContrast({ layers: [body, { ...lightMobile, backgroundImage }], color: lightText }));
});

test('unsupported image, varying gradient RGB, opacity or missing backdrop cannot pass', () => {
  for (const layer of [
    background('rgb(255, 255, 255)', 'url(wallpaper.png)'),
    background('rgb(255, 255, 255)', 'linear-gradient(180deg, rgb(0, 0, 0), rgb(255, 255, 255))'),
    { ...lightMobile, opacity: '0.5' }
  ]) assert.throws(() => computedTextContrast({ layers: [body, layer], color: lightText }));
  assert.throws(() => computedTextContrast({ layers: [background('rgba(0, 0, 0, 0)')], color: lightText }));
  assert.throws(() => computedTextContrast({ layers: [background('rgb(0, 0, 0)',
    'linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 1))')], color: 'rgb(117, 117, 117)' }));
});
