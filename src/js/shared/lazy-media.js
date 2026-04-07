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

function getObserver() {
  if (_observer) return _observer;

  _observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
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
  const images = root.querySelectorAll('img[data-src]');
  images.forEach((img) => observer.observe(img));
}
