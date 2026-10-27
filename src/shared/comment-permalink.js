// Halo 2.27: docs/developer-guide/comment-permalinks.md.
// The theme opens its containers; the comment component owns subject validation,
// reply lookup, visibility checks and precise positioning inside its Shadow DOM.
export function parseCommentPermalink(hash = '') {
  const fragment = String(hash).replace(/^#/, '');
  const params = new URLSearchParams(fragment);
  if (params.getAll('halo-comment').length !== 1 || params.getAll('reply').length > 1) return null;
  // URLSearchParams tolerates malformed escapes. Reject them before handing the
  // fragment to a component, while decoding valid parameter values only once.
  try { decodeURIComponent(fragment.replace(/\+/g, ' ')); } catch { return null; }
  const comment = params.get('halo-comment');
  const reply = params.get('reply');
  const validName = (value) => Boolean(value) && !/[\s\u0000-\u001f\u007f\ufffd]/.test(value);
  if (!validName(comment) || (reply !== null && !validName(reply))) return null;
  return { comment, reply };
}

function pageKey(location) {
  return `${location.pathname || ''}${location.search || ''}`;
}

export function watchCommentPermalink(root, onChange) {
  const host = window;
  const ownerDocument = root?.ownerDocument || document;
  // Same-variant PJAX hydrates the new root before committing History. Its
  // ancestor marker already identifies the destination and is removed later.
  let destination;
  const pendingHref = root?.closest?.('[data-pjax-target-url]')?.dataset?.pjaxTargetUrl;
  if (pendingHref) {
    try {
      const currentHref = host.location.href
        || `${host.location.origin}${pageKey(host.location)}${host.location.hash || ''}`;
      const pending = new URL(pendingHref, currentHref);
      if (pending.origin === host.location.origin) destination = pending;
    } catch {
      // An invalid marker cannot change this root's current page ownership.
    }
  }
  const page = pageKey(destination || host.location);
  let awaitingAddress = destination ? `${page}#${destination.hash}` : null;
  let previous;
  let previousTarget = parseCommentPermalink(host.location.hash || '');
  let cleanupChange;
  let disposed = false;
  const sync = (event) => {
    if (disposed) return;
    const hash = host.location.hash || '';
    const current = `${pageKey(host.location)}#${hash}`;
    // Do not apply the outgoing page's fragment, including hash-only moves.
    if (awaitingAddress && current !== awaitingAddress) return;
    awaitingAddress = null;
    if (current === previous) return;
    previous = current;
    cleanupChange?.();
    cleanupChange = null;
    if (root?.isConnected === false || pageKey(host.location) !== page) return;
    const target = parseCommentPermalink(hash);
    const notifyWidget = event?.type === 'theme:navigation-settled' && (target || previousTarget);
    previousTarget = target;
    cleanupChange = onChange(target) || null;
    // CommentWidget 3.4 observes native location events. PJAX commits History
    // after hydration, so an already mounted widget also needs the final URL.
    // `previous` is committed above to avoid repeating our own container work.
    if (notifyWidget) host.dispatchEvent(new Event('hashchange'));
  };
  host.addEventListener('hashchange', sync);
  host.addEventListener('popstate', sync);
  // PJAX commits via History API, which does not emit hashchange.
  ownerDocument.addEventListener?.('theme:navigation-settled', sync);
  sync();
  return () => {
    disposed = true;
    cleanupChange?.();
    cleanupChange = null;
    host.removeEventListener('hashchange', sync);
    host.removeEventListener('popstate', sync);
    ownerDocument.removeEventListener?.('theme:navigation-settled', sync);
  };
}

export function scrollCommentContainer(section, root = section) {
  const host = window;
  const address = `${pageKey(host.location)}#${host.location.hash || ''}`;
  let frame = 0;
  let attempts = 0;
  let disposed = false;
  const cleanup = () => {
    disposed = true;
    host.cancelAnimationFrame(frame);
    host.removeEventListener('wheel', cleanup);
    host.removeEventListener('touchstart', cleanup);
    host.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cleanup();
  };
  const position = () => {
    if (disposed) return;
    if (root?.isConnected === false || section?.isConnected === false
      || `${pageKey(host.location)}#${host.location.hash || ''}` !== address) {
      cleanup();
      return;
    }
    const rect = section?.getBoundingClientRect?.();
    if (rect?.width > 0 && rect?.height > 0) {
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
      cleanup();
    } else if (++attempts < 60) {
      frame = host.requestAnimationFrame(position);
    } else cleanup();
  };
  host.addEventListener('wheel', cleanup, { passive: true });
  host.addEventListener('touchstart', cleanup, { passive: true });
  host.addEventListener('keydown', onKeyDown);
  frame = host.requestAnimationFrame(position);
  return cleanup;
}
