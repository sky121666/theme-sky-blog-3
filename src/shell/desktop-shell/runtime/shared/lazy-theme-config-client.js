const MODULE_LOAD_TIMEOUT_MS = 10_000;

function moduleLoadError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

export function showThemeConfigRecovery() {
  if (typeof document === 'undefined' || document.getElementById('theme-config-load-recovery')) return;

  const notice = document.createElement('div');
  notice.id = 'theme-config-load-recovery';
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:2147483647;max-width:480px;margin:auto;padding:14px 16px;border-radius:10px;background:#202532;color:#fff;box-shadow:0 8px 24px #0005;display:flex;align-items:center;gap:12px;font:14px/1.5 system-ui,sans-serif';

  const message = document.createElement('span');
  message.textContent = '主题配置功能加载失败或超时，请刷新重试。';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '刷新重试';
  retry.style.cssText = 'flex:none;padding:6px 10px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit';
  retry.addEventListener('click', () => window.location.reload());
  notice.append(message, retry);
  (document.body || document.documentElement).appendChild(notice);
}

export function createBoundedModuleLoader(importModule, {
  timeoutMs = MODULE_LOAD_TIMEOUT_MS,
  label = '模块',
  onFailure = null
} = {}) {
  let loadPromise = null;
  return () => {
    if (loadPromise) return loadPromise;

    // Native import() cannot be aborted. Keep one settled result for this page
    // so a stalled URL is never re-imported and a late arrival cannot resume
    // an action that has already failed visibly.
    loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(moduleLoadError(
        'module-load-timeout', `${label}加载超时，请刷新页面后重试。`
      )), timeoutMs);
      Promise.resolve().then(importModule).then(
        (module) => { clearTimeout(timer); resolve(module); },
        (cause) => {
          clearTimeout(timer);
          reject(moduleLoadError('module-load-failed', `${label}加载失败，请刷新页面后重试。`, cause));
        }
      );
    }).catch((error) => {
      try { onFailure?.(error); } catch (_error) { /* Preserve the module error. */ }
      throw error;
    });
    return loadPromise;
  };
}

export const loadThemeConfigClient = createBoundedModuleLoader(
  () => import('./theme-config-client.js'),
  { label: '主题配置功能', onFailure: showThemeConfigRecovery }
);
