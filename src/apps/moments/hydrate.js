import { registerPageAppLifecycle } from '../../shared/page-app-bridge.js';
import { resolveMomentsAppProtocol } from './protocol.js';

function setupMomentsScrollChrome(root = document) {
  const appRoot = root && typeof root === 'object' ? root : document;
  const win = appRoot.closest?.('.moments-window')
    || appRoot.querySelector?.('.moments-window')
    || document.querySelector('.moments-window');
  if (!win) return null;

  const body = appRoot.closest?.('.moments-body')
    || win.querySelector('.moments-body');
  const bar = win.querySelector('.window-titlebar');
  if (!body || !bar) return null;

  if (body._momentsScrollFn) {
    body.removeEventListener('scroll', body._momentsScrollFn);
    body._momentsScrollFn = null;
  }

  const isFeed = !!body.querySelector('.moments-app--feed');
  if (!isFeed) {
    bar.classList.remove('scrolled');
    return () => {
      bar.classList.remove('scrolled');
    };
  }

  function onScroll() {
    const cover = body.querySelector('.moments-cover');
    const threshold = cover ? cover.offsetHeight - 48 : 200;
    bar.classList.toggle('scrolled', body.scrollTop > threshold);
  }

  body._momentsScrollFn = onScroll;
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
    if (body._momentsScrollFn) {
      body.removeEventListener('scroll', body._momentsScrollFn);
      body._momentsScrollFn = null;
    }
    bar.classList.remove('scrolled');
  };
}

if (typeof window !== 'undefined') {
  window.__momentsScrollSetup = () => setupMomentsScrollChrome(document);
}

registerPageAppLifecycle('moments', {
  resolveProtocol: resolveMomentsAppProtocol,
  hydrate(root) {
    return setupMomentsScrollChrome(root);
  },
  getDocumentState(_root, context) {
    const isDetail = context.state?.scene === 'detail';
    return {
      title: context.documentTitle || document.title,
      windowTitle: isDetail ? '详情' : (context.documentTitle || document.title),
      windowVariant: 'moments'
    };
  }
});
