/**
 * 文章大纲导航
 */

import { extractTextPreview } from '../../../shell/desktop-shell/runtime/shared/utils.js';

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
  const mobileTrigger = document.querySelector('[data-post-outline-trigger]');
  const mobileSheet = document.querySelector('[data-post-outline-mobile-sheet]');
  const mobileBackdrop = document.querySelector('[data-post-outline-mobile-backdrop]');
  const mobileList = document.querySelector('[data-post-outline-mobile-list]');
  const mobileHandle = document.querySelector('[data-post-outline-mobile-handle]');

  if (!frame || !article || !outline || !list) return;

  const mobileManaged = !!(mobileTrigger && mobileSheet && mobileBackdrop && mobileList && mobileHandle);

  const headings = Array.from(article.querySelectorAll('h2, h3, h4'))
    .filter((heading) => extractTextPreview(heading.textContent || ''));

  list.innerHTML = '';
  if (mobileManaged) {
    mobileList.innerHTML = '';
  }

  const closeMobileOutline = () => {
    if (!mobileManaged) return;
    mobileSheet.style.removeProperty('transform');
    mobileBackdrop.style.removeProperty('opacity');
    mobileSheet.hidden = true;
    mobileBackdrop.hidden = true;
    mobileSheet.removeAttribute('data-open');
    mobileBackdrop.removeAttribute('data-open');
    mobileSheet.removeAttribute('data-dragging');
    document.body.classList.remove('post-outline-mobile-open');
  };

  const openMobileOutline = () => {
    if (!mobileManaged) return;
    window.dispatchEvent(new CustomEvent('reader:outline-open'));
    mobileSheet.hidden = false;
    mobileBackdrop.hidden = false;
    requestAnimationFrame(() => {
      mobileSheet.style.removeProperty('transform');
      mobileBackdrop.style.removeProperty('opacity');
      mobileSheet.setAttribute('data-open', '');
      mobileBackdrop.setAttribute('data-open', '');
    });
    document.body.classList.add('post-outline-mobile-open');
  };

  if (!headings.length) {
    outline.hidden = true;
    if (mobileManaged) {
      mobileTrigger.hidden = true;
      closeMobileOutline();
    }
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

    const buttonClass = `post-outline-link post-outline-link--${heading.tagName.toLowerCase()}`;
    const buttonText = extractTextPreview(heading.textContent || '');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = buttonClass;
    button.dataset.targetId = headingId;
    button.textContent = buttonText;
    list.appendChild(button);

    if (mobileManaged) {
      const mobileButton = document.createElement('button');
      mobileButton.type = 'button';
      mobileButton.className = buttonClass;
      mobileButton.dataset.targetId = headingId;
      mobileButton.textContent = buttonText;
      mobileList.appendChild(mobileButton);
    }
  });

  outline.hidden = false;
  if (mobileManaged) {
    mobileTrigger.hidden = false;
  }

  const buttons = [
    ...Array.from(list.querySelectorAll('.post-outline-link')),
    ...(mobileManaged ? Array.from(mobileList.querySelectorAll('.post-outline-link')) : [])
  ];

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
    closeMobileOutline();
  };

  list.addEventListener('click', handleClick);
  let mobileDragActive = false;
  let mobileDragStartY = 0;
  let mobileDragPointerId = null;
  const mobileCloseThreshold = 64;

  const applyMobileDrag = (offset) => {
    const safeOffset = Math.max(0, offset);
    const ratio = Math.max(0, 1 - Math.min(safeOffset / 220, 0.72));
    mobileSheet.style.transform = `translateY(${safeOffset}px)`;
    mobileBackdrop.style.opacity = ratio.toFixed(3);
  };

  const resetMobileDrag = () => {
    mobileDragActive = false;
    mobileDragStartY = 0;
    mobileDragPointerId = null;
    mobileSheet.removeAttribute('data-dragging');
    mobileSheet.style.removeProperty('transform');
    mobileBackdrop.style.removeProperty('opacity');
  };

  const handleMobileDragMove = (event) => {
    if (!mobileManaged || !mobileDragActive) return;
    if (mobileDragPointerId !== null && event.pointerId !== mobileDragPointerId) return;

    const offset = Math.max(0, event.clientY - mobileDragStartY);
    applyMobileDrag(offset);
  };

  const handleMobileDragEnd = (event) => {
    if (!mobileManaged || !mobileDragActive) return;
    if (mobileDragPointerId !== null && event.pointerId !== mobileDragPointerId) return;

    const offset = Math.max(0, event.clientY - mobileDragStartY);
    if (offset >= mobileCloseThreshold) {
      resetMobileDrag();
      closeMobileOutline();
      return;
    }

    resetMobileDrag();
  };

  const handleMobileDragStart = (event) => {
    if (!mobileManaged) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    mobileDragActive = true;
    mobileDragStartY = event.clientY;
    mobileDragPointerId = event.pointerId ?? null;
    mobileSheet.setAttribute('data-dragging', '');
    if (typeof mobileHandle.setPointerCapture === 'function' && event.pointerId != null) {
      try {
        mobileHandle.setPointerCapture(event.pointerId);
      } catch (_e) {
        // Ignore capture errors on unsupported browsers.
      }
    }
  };

  if (mobileManaged) {
    mobileList.addEventListener('click', handleClick);
    mobileTrigger.addEventListener('click', openMobileOutline);
    mobileBackdrop.addEventListener('click', closeMobileOutline);
    mobileHandle.addEventListener('pointerdown', handleMobileDragStart);
    window.addEventListener('pointermove', handleMobileDragMove);
    window.addEventListener('pointerup', handleMobileDragEnd);
    window.addEventListener('pointercancel', handleMobileDragEnd);
  }

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeMobileOutline();
    }
  };
  window.addEventListener('keydown', handleEscape);

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
    if (mobileManaged) {
      mobileList.removeEventListener('click', handleClick);
      mobileTrigger.removeEventListener('click', openMobileOutline);
      mobileBackdrop.removeEventListener('click', closeMobileOutline);
      mobileHandle.removeEventListener('pointerdown', handleMobileDragStart);
      window.removeEventListener('pointermove', handleMobileDragMove);
      window.removeEventListener('pointerup', handleMobileDragEnd);
      window.removeEventListener('pointercancel', handleMobileDragEnd);
      resetMobileDrag();
      closeMobileOutline();
    }
    window.removeEventListener('keydown', handleEscape);
    if (observer) observer.disconnect();
  };
}
