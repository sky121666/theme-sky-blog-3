/**
 * Lazy media loading via IntersectionObserver.
 *
 * Images with `data-src` will have their `src` set when they enter
 * the viewport (with 200px rootMargin for early loading).
 *
 * Safe to call multiple times (e.g. after pjax re-render).
 */

const OBSERVER_OPTIONS = { rootMargin: '200px 0px' };

let _observer = null;

function prepareLazyImage(el) {
  if (!el) return;
  if (!el.hasAttribute('loading')) {
    el.setAttribute('loading', 'lazy');
  }
  if (!el.hasAttribute('decoding')) {
    el.setAttribute('decoding', 'async');
  }
  if (el.dataset.src && !el.hasAttribute('fetchpriority')) {
    el.setAttribute('fetchpriority', 'low');
  }
}

function getObserver() {
  if (_observer) return _observer;

  _observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      prepareLazyImage(el);
      const src = el.dataset.src;
      if (src) {
        el.src = src;
        el.removeAttribute('data-src');
      }
      _observer.unobserve(el);
    }
  }, OBSERVER_OPTIONS);

  return _observer;
}

/**
 * Scan `root` for `[data-src]` images and set up lazy loading.
 * @param {HTMLElement|Document} root
 */
export function initLazyImages(root = document) {
  const observer = getObserver();
  const allImages = root.querySelectorAll('img:not([data-no-lazy])');
  allImages.forEach((img) => {
    prepareLazyImage(img);
    if (img.dataset.src) {
      observer.observe(img);
    }
  });
}
