/**
 * Lazy media loading via IntersectionObserver.
 *
 * Images with `data-src` / `data-srcset` will have their responsive
 * sources set when they enter the viewport (with 200px rootMargin for
 * early loading).
 *
 * Safe to call multiple times (e.g. after pjax re-render).
 */

const OBSERVER_OPTIONS = { rootMargin: '200px 0px' };
const IMAGE_SELECTOR = 'img:not([data-no-lazy])';
const LAZY_IMAGE_SELECTOR = [
  'img[data-src]:not([data-no-lazy])',
  'img[data-srcset]:not([data-no-lazy])'
].join(', ');

let _observer = null;
const _observedImages = new Set();

function prepareLazyImage(el) {
  if (!el) return;
  if (!el.hasAttribute('loading')) {
    el.setAttribute('loading', 'lazy');
  }
  if (!el.hasAttribute('decoding')) {
    el.setAttribute('decoding', 'async');
  }
  if ((el.dataset.src || el.dataset.srcset) && !el.hasAttribute('fetchpriority')) {
    el.setAttribute('fetchpriority', 'low');
  }
}

function loadLazyImage(el) {
  if (!el) return;

  // `sizes` must be present before `srcset`, otherwise the browser can select
  // a candidate against the default 100vw and start an unnecessary request.
  const sizes = el.dataset.sizes;
  if (sizes) {
    el.setAttribute('sizes', sizes);
  }

  const srcset = el.dataset.srcset;
  if (srcset) {
    el.setAttribute('srcset', srcset);
  }

  const src = el.dataset.src;
  if (src) {
    el.setAttribute('src', src);
  }

  el.removeAttribute('data-sizes');
  el.removeAttribute('data-srcset');
  el.removeAttribute('data-src');
}

function stopObserving(el) {
  if (!el) return;
  _observer?.unobserve(el);
  _observedImages.delete(el);
}

function getObserver() {
  if (_observer) return _observer;

  _observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      prepareLazyImage(el);
      loadLazyImage(el);
      stopObserving(el);
    }
  }, OBSERVER_OPTIONS);

  return _observer;
}

/**
 * Scan `root` for responsive lazy images and set up lazy loading.
 * @param {HTMLElement|Document} root
 */
export function initLazyImages(root = document) {
  if (!root?.querySelectorAll) return;

  const allImages = Array.from(root.querySelectorAll(IMAGE_SELECTOR));
  if (root.matches?.(IMAGE_SELECTOR)) {
    allImages.unshift(root);
  }
  allImages.forEach(prepareLazyImage);

  const lazyImages = allImages.filter((img) => img.matches?.(LAZY_IMAGE_SELECTOR)
    || img.dataset.src
    || img.dataset.srcset);

  if (typeof IntersectionObserver === 'undefined') {
    lazyImages.forEach(loadLazyImage);
    return;
  }

  const observer = getObserver();
  lazyImages.forEach((img) => {
    if (_observedImages.has(img)) return;
    _observedImages.add(img);
    observer.observe(img);
  });
}

/**
 * Stop observing lazy images owned by a page root before PJAX replaces it.
 * Other page/shell roots keep their pending observations.
 * @param {HTMLElement|Document} root
 */
export function disposeLazyImages(root = document) {
  if (!root) return;

  Array.from(_observedImages).forEach((img) => {
    const belongsToRoot = img === root
      || (typeof root.contains === 'function' && root.contains(img));
    if (belongsToRoot) {
      stopObserving(img);
    }
  });
}
