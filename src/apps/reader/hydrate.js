import { cleanupPostOutline, initPostOutline } from './runtime/post-outline.js';
import { registerPostComponents } from './runtime/upvote.js';
import { resolveReaderAppProtocol } from './protocol.js';
import {
  queuePageAppRegistrar,
  registerPageAppLifecycle
} from '../../shared/page-app-bridge.js';

let coldCommentAnchorGeneration = 0;
let coldCommentAnchorCleanup = null;

export function initColdCommentAnchor(root, context) {
  coldCommentAnchorCleanup?.();
  const generation = ++coldCommentAnchorGeneration;
  if (context?.reason !== 'initial-load') return () => {};

  let hash;
  try {
    hash = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return () => {};
  }
  if (hash !== 'post-comments') return () => {};
  const section = root?.querySelector?.('#post-comments');
  const scroller = section?.closest?.('.window-body');
  if (!section || !scroller || scroller.scrollTop > 0) return () => {};

  let frame = 0;
  let attempts = 0;
  let disposed = false;
  const initialHash = window.location.hash;
  const cleanup = () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    window.removeEventListener('wheel', cleanup);
    window.removeEventListener('touchstart', cleanup);
    window.removeEventListener('keydown', onKeyDown);
    if (coldCommentAnchorCleanup === cleanup) coldCommentAnchorCleanup = null;
  };
  const onKeyDown = (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cleanup();
  };
  const restore = () => {
    if (disposed || generation !== coldCommentAnchorGeneration) return;
    if (!section.isConnected || window.location.hash !== initialHash || scroller.scrollTop > 0) {
      cleanup();
      return;
    }
    const rect = section.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && scroller.clientHeight > 0) {
      // Enter the existing lazy observer's viewport; do not import the shell entry.
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
      cleanup();
      return;
    }
    if (++attempts >= 60) cleanup();
    else frame = window.requestAnimationFrame(restore);
  };
  window.addEventListener('wheel', cleanup, { passive: true });
  window.addEventListener('touchstart', cleanup, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  coldCommentAnchorCleanup = cleanup;
  frame = window.requestAnimationFrame(restore);
  return cleanup;
}

queuePageAppRegistrar((Alpine) => {
  registerPostComponents(Alpine);
});

registerPageAppLifecycle('reader', {
  resolveProtocol: resolveReaderAppProtocol,
  hydrate(root, context) {
    initPostOutline(root);
    const cleanupCommentAnchor = initColdCommentAnchor(root, context);
    return () => {
      cleanupCommentAnchor();
      cleanupPostOutline();
    };
  },
  getDocumentState(root, context) {
    const title = root?.querySelector('.post-title')?.textContent?.trim() || context.documentTitle || document.title;
    return {
      title: context.documentTitle || document.title,
      windowTitle: title,
      windowVariant: 'browser'
    };
  }
});
