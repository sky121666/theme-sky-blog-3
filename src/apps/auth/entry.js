import '../../entries/auth.css';
import { hydrateAuthApp } from './hydrate.js';
import { signalStartupReady, signalStartupFailure } from '../../shared/startup-signals.js';

let authAppCleanup = null;

function bootAuthApp() {
  if (typeof authAppCleanup === 'function') {
    authAppCleanup();
    authAppCleanup = null;
  }

  try {
    const boot = hydrateAuthApp(document, {
      reason: 'initial-auth-load',
      documentTitle: document.title
    });
    authAppCleanup = typeof boot.cleanup === 'function' ? boot.cleanup : null;
    signalStartupReady('auth');
  } catch (error) {
    signalStartupFailure();
    throw error;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAuthApp, { once: true });
} else {
  bootAuthApp();
}

if (typeof window !== 'undefined') {
  window.__THEME_APP_AUTH_LOADED__ = true;
}
