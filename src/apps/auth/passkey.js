export function initAuthPasskeyAdapter(root = document) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('method') !== 'passkey') return;

  // Only Passkey 2 has delegated link activation. Keep the native submit button
  // for older plugins, which bind their WebAuthn handler directly to that button.
  const usesDelegatedActivation = [...root.querySelectorAll('script[src]')].some((script) => {
    const source = new URL(script.getAttribute('src'), url);
    return source.origin === url.origin
      && source.pathname === '/plugins/auth-passkey/assets/static/login-context.js'
      && /^2\./.test(source.searchParams.get('v') || '');
  });
  if (!usesDelegatedActivation) return;

  const button = root.querySelector('#login-form button[type="submit"]');
  if (!button) return;

  // The 2.0.0 legacy button listener passes an Event to a function expecting an
  // element. Use the plugin's supported delegated link, removing that listener
  // with the old node even when the plugin initialized before this app.
  const link = document.createElement('a');
  link.className = button.className;
  link.href = url.pathname + url.search + url.hash;
  link.textContent = '使用通行密钥登录';
  link.dataset.authPasskeyAction = 'true';
  button.replaceWith(link);
}
