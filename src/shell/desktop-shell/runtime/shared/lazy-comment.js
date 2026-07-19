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
const COMMENT_SECTION_SELECTOR = '[data-lazy-comment]';

let _observer = null;
const _observedSections = new Set();

function revealCommentSection(section) {
  if (!section?.querySelector) return false;

  // Strategy 1: <template> clone
  const template = section.querySelector('template[data-comment-template]');
  if (template) {
    const clone = template.content.cloneNode(true);
    template.parentNode.replaceChild(clone, template);
    return true;
  }

  // Strategy 2: remove hidden style
  const hidden = section.querySelector('[data-comment-hidden]');
  if (hidden) {
    hidden.removeAttribute('data-comment-hidden');
    hidden.style.display = '';
    return true;
  }

  return false;
}

function hasPendingComment(section) {
  return Boolean(
    section?.querySelector?.('template[data-comment-template]')
    || section?.querySelector?.('[data-comment-hidden]')
  );
}

function stopObserving(section) {
  if (!section) return;

  const observer = _observer;
  observer?.unobserve(section);
  _observedSections.delete(section);

  if (_observedSections.size === 0 && observer) {
    observer.disconnect();
    if (_observer === observer) {
      _observer = null;
    }
  }
}

function getObserver() {
  if (_observer) return _observer;

  _observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const section = entry.target;
      revealCommentSection(section);
      stopObserving(section);
    }
  }, OBSERVER_OPTIONS);

  return _observer;
}

/**
 * Scan `root` for `[data-lazy-comment]` sections and set up lazy initialization.
 * @param {HTMLElement|Document} root
 */
export function initLazyComments(root = document) {
  if (!root?.querySelectorAll) return;

  const sections = Array.from(root.querySelectorAll(COMMENT_SECTION_SELECTOR));
  if (root.matches?.(COMMENT_SECTION_SELECTOR)) {
    sections.unshift(root);
  }

  const pendingSections = sections.filter((section) => (
    section?.isConnected !== false
    && hasPendingComment(section)
    && !_observedSections.has(section)
  ));
  if (pendingSections.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    pendingSections.forEach(revealCommentSection);
    return;
  }

  const observer = getObserver();
  pendingSections.forEach((section) => {
    _observedSections.add(section);
    observer.observe(section);
  });
}

/**
 * Stop observing comments owned by a page root before PJAX replaces it.
 * Disconnected sections are also pruned so the observer cannot retain stale DOM.
 * @param {HTMLElement|Document} root
 */
export function disposeLazyComments(root = document) {
  if (!root) return;

  Array.from(_observedSections).forEach((section) => {
    const belongsToRoot = section === root
      || (typeof root.contains === 'function' && root.contains(section));
    if (belongsToRoot || !section.isConnected) {
      stopObserving(section);
    }
  });
}
