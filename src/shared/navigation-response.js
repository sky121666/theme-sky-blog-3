// Authentication documents own a separate runtime and must never hydrate the
// still-active desktop while a PJAX response is being prepared.
export function isAuthenticationResponse({ url, appId = '', pageMode = '' } = {}) {
  if (appId === 'auth' || pageMode === 'auth') return true;
  try {
    const pathname = new URL(url).pathname;
    return /^\/(?:login|logout|signup|password-reset)(?:\/|$)/.test(pathname);
  } catch { return false; }
}
