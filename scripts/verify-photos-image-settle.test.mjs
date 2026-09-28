import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPhotosExplorer } from '../src/apps/photos/runtime/explorer.js';

let createExplorer;
registerPhotosExplorer({
  data(name, factory) {
    assert.equal(name, 'photosExplorer');
    createExplorer = factory;
  }
});

function imageFixture({ lazy = false, placeholderOnly = false, naturalWidth = 0, complete = true } = {}) {
  const imageClasses = new Set();
  const cardClasses = new Set();
  const listeners = new Map();
  const image = {
    dataset: lazy ? { src: '/upload/photo.jpg' } : {},
    classList: {
      add: (name) => imageClasses.add(name),
      remove: (name) => imageClasses.delete(name),
      contains: (name) => imageClasses.has(name)
    },
    closest: () => ({
      classList: {
        add: (name) => cardClasses.add(name),
        remove: (name) => cardClasses.delete(name),
        contains: (name) => cardClasses.has(name)
      }
    }),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    complete,
    naturalWidth,
    src: lazy || placeholderOnly ? '/themes/theme-sky-blog-3/assets/images/transparent.svg' : '/upload/photo.jpg',
    currentSrc: lazy || placeholderOnly ? '/themes/theme-sky-blog-3/assets/images/transparent.svg' : '/upload/photo.jpg'
  };
  return {
    image,
    imageClasses,
    cardClasses,
    emit: (name) => listeners.get(name)?.()
  };
}

test('transparent lazy placeholder stays pending until the real image loads', () => {
  const explorer = createExplorer();
  const { image, imageClasses, cardClasses, emit } = imageFixture({ lazy: true, naturalWidth: 1 });

  explorer.bindImg(image);
  assert.equal(imageClasses.has('ph-loaded'), false);
  assert.equal(cardClasses.has('ph-loaded'), false);
  assert.equal(image.dataset.settled, undefined);

  delete image.dataset.src;
  image.src = '/upload/photo.jpg';
  image.currentSrc = '/upload/photo.jpg';
  image.naturalWidth = 400;
  emit('load');
  assert.equal(imageClasses.has('ph-loaded'), true);
  assert.equal(cardClasses.has('ph-loaded'), true);
});

test('failed real image ends loading in a visible error state', () => {
  const explorer = createExplorer();
  const { image, imageClasses, cardClasses, emit } = imageFixture({ lazy: true, naturalWidth: 1 });

  explorer.bindImg(image);
  delete image.dataset.src;
  image.src = '/upload/photo.jpg';
  image.currentSrc = '/upload/photo.jpg';
  image.naturalWidth = 0;
  emit('error');

  assert.equal(imageClasses.has('ph-loaded'), false);
  assert.equal(cardClasses.has('ph-loaded'), false);
  assert.equal(cardClasses.has('ph-error'), true);
});

test('already failed non-lazy image does not shimmer indefinitely', () => {
  const explorer = createExplorer();
  const { image, imageClasses, cardClasses } = imageFixture({ naturalWidth: 0 });

  explorer.bindImg(image);

  assert.equal(imageClasses.has('ph-loaded'), false);
  assert.equal(cardClasses.has('ph-error'), true);
});

test('photo with no image URL does not treat transparent.svg as content', () => {
  const explorer = createExplorer();
  const { image, imageClasses, cardClasses } = imageFixture({ placeholderOnly: true, naturalWidth: 1 });

  explorer.bindImg(image);

  assert.equal(imageClasses.has('ph-loaded'), false);
  assert.equal(cardClasses.has('ph-error'), true);
});
