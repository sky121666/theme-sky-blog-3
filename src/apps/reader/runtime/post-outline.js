/**
 * 文章大纲导航
 */

import { extractTextPreview } from '../../../shared/utils.js';

let postOutlineCleanup = null;

export function cleanupPostOutline() {
  if (typeof postOutlineCleanup === 'function') {
    postOutlineCleanup();
    postOutlineCleanup = null;
  }
}

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
  cleanupPostOutline();

  const frame = root.querySelector('.post-reader-frame');
  const article = root.querySelector('#article-content');
  const outline = root.querySelector('[data-post-outline]');
  const list = root.querySelector('[data-post-outline-list]');
  const mobileTrigger = document.querySelector('[data-post-outline-trigger]');
  const mobileSheet = document.querySelector('[data-post-outline-mobile-sheet]');
  const mobileBackdrop = document.querySelector('[data-post-outline-mobile-backdrop]');
  const mobileList = document.querySelector('[data-post-outline-mobile-list]');
  const mobileHandle = document.querySelector('[data-post-outline-mobile-handle]');

  if (!frame || !article || !outline || !list) {
    if (mobileTrigger) mobileTrigger.hidden = true;
    return;
  }

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

  const existingIdOwners = new Map();
  document.querySelectorAll('[id]').forEach((element) => {
    if (!element.id) return;
    const existing = existingIdOwners.get(element.id);
    if (existing) existing.count += 1;
    else existingIdOwners.set(element.id, { owner: element, count: 1 });
  });
  const usedIds = new Set();
  headings.forEach((heading, index) => {
    const baseId = heading.id || slugifyHeading(heading.textContent, index);
    let headingId = baseId;
    const originalOwners = existingIdOwners.get(baseId);
    const keepExplicitId = Boolean(heading.id)
      && (!originalOwners || originalOwners.count === 1 && originalOwners.owner === heading);

    let suffix = index + 1;
    while (usedIds.has(headingId)
      || (existingIdOwners.has(headingId) && !(headingId === baseId && keepExplicitId))) {
      headingId = `${baseId}-${suffix++}`;
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
  let cancelHashScrollRestore = () => {};

  const handleClick = (event) => {
    const button = event.target.closest('.post-outline-link');
    if (!button) return;

    const target = article.querySelector(`#${CSS.escape(button.dataset.targetId || '')}`);
    if (!target) return;

    cancelHashScrollRestore();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    setActive(button.dataset.targetId || '');
    history.replaceState(history.state, '', `#${button.dataset.targetId}`);
    closeMobileOutline();
  };

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

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeMobileOutline();
    }
  };
  let observer = null;
  // Register cleanup before attaching anything so partial initialization can unwind.
  postOutlineCleanup = () => {
    cancelHashScrollRestore();
    list.removeEventListener('click', handleClick);
    if (mobileManaged) {
      mobileList.removeEventListener('click', handleClick);
      mobileTrigger.removeEventListener('click', openMobileOutline);
      mobileBackdrop.removeEventListener('click', closeMobileOutline);
      mobileHandle.removeEventListener('click', closeMobileOutline);
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

  try {
    list.addEventListener('click', handleClick);
    if (mobileManaged) {
      mobileList.addEventListener('click', handleClick);
      mobileTrigger.addEventListener('click', openMobileOutline);
      mobileBackdrop.addEventListener('click', closeMobileOutline);
      mobileHandle.addEventListener('click', closeMobileOutline);
      mobileHandle.addEventListener('pointerdown', handleMobileDragStart);
      window.addEventListener('pointermove', handleMobileDragMove);
      window.addEventListener('pointerup', handleMobileDragEnd);
      window.addEventListener('pointercancel', handleMobileDragEnd);
    }
    window.addEventListener('keydown', handleEscape);

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

    const rawHash = String(window.location.hash || '').replace(/^#/, '');
    let hash = usedIds.has(rawHash) ? rawHash : '';
    if (!hash && rawHash.includes('%')) {
      const normalizeEscapes = (value) => value.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
      const normalizedHash = normalizeEscapes(rawHash);
      hash = headings.find((heading) => heading.id.includes('%')
        && normalizeEscapes(heading.id) === normalizedHash)?.id || '';
    }
    if (!hash && rawHash) {
      try {
        const decodedHash = decodeURIComponent(rawHash);
        if (usedIds.has(decodedHash)) hash = decodedHash;
      } catch (_error) {
        // An invalid URL escape has no matching heading; keep the first heading active.
      }
    }
    setActive(hash && usedIds.has(hash) ? hash : headings[0].id);

    const hashTarget = hash ? headings.find((heading) => heading.id === hash) : null;
    const scroller = hashTarget?.closest?.('[data-window-scroll]');
    if (hashTarget && scroller && scroller.scrollTop <= 1) {
      const initialHash = window.location.hash;
      let frame = 0;
      let attempts = 0;
      let canceled = false;
      const cancel = () => {
        if (canceled) return;
        canceled = true;
        if (frame) window.cancelAnimationFrame(frame);
        window.removeEventListener('wheel', cancel, { capture: true });
        window.removeEventListener('touchstart', cancel, { capture: true });
        window.removeEventListener('keydown', cancelOnScrollKey, { capture: true });
      };
      const cancelOnScrollKey = (event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel();
      };
      const restore = () => {
        frame = 0;
        if (canceled) return;
        if (window.location.hash !== initialHash || hashTarget.isConnected === false
          || scroller.isConnected === false || scroller.scrollTop > 1) {
          cancel();
          return;
        }
        const rect = hashTarget.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && scroller.clientHeight > 0) {
          hashTarget.scrollIntoView({ behavior: 'auto', block: 'start' });
          cancel();
          return;
        }
        if (++attempts >= 60) cancel();
        else frame = window.requestAnimationFrame(restore);
      };
      cancelHashScrollRestore = cancel;
      window.addEventListener('wheel', cancel, { capture: true, passive: true });
      window.addEventListener('touchstart', cancel, { capture: true, passive: true });
      window.addEventListener('keydown', cancelOnScrollKey, { capture: true });
      frame = window.requestAnimationFrame(restore);
    }
  } catch (error) {
    cleanupPostOutline();
    throw error;
  }
}
