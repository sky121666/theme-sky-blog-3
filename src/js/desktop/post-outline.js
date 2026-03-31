/**
 * 文章大纲导航
 */

import { extractTextPreview } from '../shared/utils.js';

let postOutlineCleanup = null;

function slugifyHeading(text, index) {
  const normalized = String(text || '').trim().toLowerCase();
  const ascii = normalized
    .replace(/&/g, ' and ')
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return ascii || `section-${index + 1}`;
}

export function initPostOutline(root = document) {
  if (typeof postOutlineCleanup === 'function') {
    postOutlineCleanup();
    postOutlineCleanup = null;
  }

  const frame = root.querySelector('.post-reader-frame');
  const article = root.querySelector('#article-content');
  const outline = root.querySelector('[data-post-outline]');
  const list = root.querySelector('[data-post-outline-list]');

  if (!frame || !article || !outline || !list) return;

  const headings = Array.from(article.querySelectorAll('h2, h3, h4'))
    .filter((heading) => extractTextPreview(heading.textContent || ''));

  list.innerHTML = '';

  if (!headings.length) {
    outline.hidden = true;
    return;
  }

  const usedIds = new Set();
  headings.forEach((heading, index) => {
    let headingId = heading.id || slugifyHeading(heading.textContent, index);

    while (usedIds.has(headingId) || document.querySelectorAll(`#${CSS.escape(headingId)}`).length > 1) {
      headingId = `${headingId}-${index + 1}`;
    }

    usedIds.add(headingId);
    heading.id = headingId;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `post-outline-link post-outline-link--${heading.tagName.toLowerCase()}`;
    button.dataset.targetId = headingId;
    button.textContent = extractTextPreview(heading.textContent || '');
    list.appendChild(button);
  });

  outline.hidden = false;

  const buttons = Array.from(list.querySelectorAll('.post-outline-link'));

  const setActive = (id) => {
    buttons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.targetId === id);
    });
  };

  const handleClick = (event) => {
    const button = event.target.closest('.post-outline-link');
    if (!button) return;

    const target = article.querySelector(`#${CSS.escape(button.dataset.targetId || '')}`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(button.dataset.targetId || '');
    history.replaceState(history.state, '', `#${button.dataset.targetId}`);
  };

  list.addEventListener('click', handleClick);

  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

      if (visible.length > 0) {
        setActive(visible[0].target.id);
      }
    }, {
      rootMargin: '-20% 0px -65% 0px',
      threshold: [0, 1]
    });

    headings.forEach((heading) => observer.observe(heading));
  }

  const hash = decodeURIComponent(window.location.hash || '').replace(/^#/, '');
  if (hash && usedIds.has(hash)) {
    setActive(hash);
  } else {
    setActive(headings[0].id);
  }

  postOutlineCleanup = () => {
    list.removeEventListener('click', handleClick);
    if (observer) observer.disconnect();
  };
}
