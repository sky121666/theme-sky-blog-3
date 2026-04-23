import { registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { resolveFriendsAppProtocol } from './protocol.js';

function setupFriendsScrollChrome(root = document) {
  const appRoot = root && typeof root === 'object' ? root : document;
  const win = appRoot.closest?.('.friends-window')
    || appRoot.querySelector?.('.friends-window')
    || document.querySelector('.friends-window');
  if (!win) return null;

  const body = appRoot.closest?.('.friends-body')
    || win.querySelector('.friends-body');
  const bar = win.querySelector('.window-titlebar');
  if (!body || !bar) return null;

  if (body._friendsScrollFn) {
    body.removeEventListener('scroll', body._friendsScrollFn);
    body._friendsScrollFn = null;
  }

  function onScroll() {
    const cover = body.querySelector('.moments-cover');
    const threshold = cover ? cover.offsetHeight - 48 : 200;
    bar.classList.toggle('scrolled', body.scrollTop > threshold);
  }

  body._friendsScrollFn = onScroll;
  body.addEventListener('scroll', onScroll, { passive: true });

  let tries = 0;
  (function poll() {
    const cover = body.querySelector('.moments-cover');
    if ((cover && cover.offsetHeight > 0) || tries > 20) {
      onScroll();
      return;
    }
    tries += 1;
    requestAnimationFrame(poll);
  })();

  return () => {
    if (body._friendsScrollFn) {
      body.removeEventListener('scroll', body._friendsScrollFn);
      body._friendsScrollFn = null;
    }
    bar.classList.remove('scrolled');
  };
}

if (typeof window !== 'undefined') {
  window.__friendsScrollSetup = () => setupFriendsScrollChrome(document);
}

registerPageAppLifecycle('friends', {
  resolveProtocol: resolveFriendsAppProtocol,
  hydrate(root) {
    return setupFriendsScrollChrome(root);
  },
  getDocumentState(root, context) {
    const shell = root?.querySelector('.friends-feed-shell');
    const friendsTitle = shell?.dataset.friendsChromeTitle || '';
    const resolvedTitle = context.documentTitle || document.title;
    return {
      title: resolvedTitle,
      windowTitle: friendsTitle || resolvedTitle,
      windowVariant: 'friends'
    };
  }
});
