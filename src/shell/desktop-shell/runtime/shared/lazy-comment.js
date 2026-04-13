/**
 * Lazy comment initialization via IntersectionObserver.
 *
 * Sections with `data-lazy-comment` are observed. When they enter
 * the viewport (with 400px rootMargin), the hidden comment shell
 * inside is made visible and its children are activated.
 *
 * Two strategies are supported:
 * 1. `<template data-comment-template>` — content is cloned into the section
 * 2. `[data-comment-hidden]` — display:none is removed to reveal pre-rendered comment
 *
 * Safe to call multiple times (e.g. after pjax re-render).
 */

const OBSERVER_OPTIONS = { rootMargin: '400px 0px' };

let _observer = null;

function getObserver() {
  if (_observer) return _observer;

  _observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const section = entry.target;

      // Strategy 1: <template> clone
      const template = section.querySelector('template[data-comment-template]');
      if (template) {
        const clone = template.content.cloneNode(true);
        template.parentNode.replaceChild(clone, template);
        _observer.unobserve(section);
        continue;
      }

      // Strategy 2: remove hidden style
      const hidden = section.querySelector('[data-comment-hidden]');
      if (hidden) {
        hidden.removeAttribute('data-comment-hidden');
        hidden.style.display = '';
        _observer.unobserve(section);
        continue;
      }

      _observer.unobserve(section);
    }
  }, OBSERVER_OPTIONS);

  return _observer;
}

/**
 * Scan `root` for `[data-lazy-comment]` sections and set up lazy initialization.
 * @param {HTMLElement|Document} root
 */
export function initLazyComments(root = document) {
  const observer = getObserver();
  const sections = root.querySelectorAll('[data-lazy-comment]');
  sections.forEach((s) => observer.observe(s));
}
