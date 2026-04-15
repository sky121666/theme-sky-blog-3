import '../../entries/auth.css';
import { hydrateAuthApp } from './hydrate.js';

let authAppCleanup = null;

function bootAuthApp() {
  if (typeof authAppCleanup === 'function') {
    authAppCleanup();
    authAppCleanup = null;
  }

  const boot = hydrateAuthApp(document, {
    reason: 'initial-auth-load',
    documentTitle: document.title
  });

  authAppCleanup = typeof boot.cleanup === 'function' ? boot.cleanup : null;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAuthApp, { once: true });
} else {
  bootAuthApp();
}

if (typeof window !== 'undefined') {
  window.__THEME_APP_AUTH_LOADED__ = true;
}
