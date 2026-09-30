// Self-contained: the build emits this same tested function into the optional
// SSR startup fragment, before either the Shell or Auth bundles can be ready.
export function installStartupController(win, doc, config = {}, { preview = false } = {}) {
  const inactive = (reason) => ({ active: false, ready() {}, finish() {}, dispose() {}, finished: Promise.resolve(reason) });
  const scene = config.scene;
  if (config.mode !== 'boot' || !['desktop', 'app', 'login'].includes(scene)) return inactive('disabled');
  const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (motion?.matches) return inactive('reduced-motion');
  if (!preview && scene === 'login') {
    const url = new URL(win.location.href);
    if (url.pathname !== '/login' || url.searchParams.has('error')) return inactive('authentication-step');
  }
  if (!doc.body || doc.body.dataset.errorPage === 'true') return inactive('unavailable');
  if (!preview && win.__THEME_STARTUP__?.active) return win.__THEME_STARTUP__;

  const playedKey = 'theme:startup:played:v1';
  const recoveryKey = 'theme:startup:recovery:v1';
  if (!preview) {
    try {
      const storage = win.sessionStorage;
      const type = win.performance?.getEntriesByType?.('navigation')?.[0]?.type || 'navigate';
      const recoveryValue = storage.getItem(recoveryKey);
      if (recoveryValue) {
        storage.removeItem(recoveryKey);
        let recovery;
        try { recovery = JSON.parse(recoveryValue); } catch (_) { /* Expired or invalid visual metadata is ignored. */ }
        if (recovery?.target === win.location.pathname + win.location.search
          && Date.now() >= recovery.at && Date.now() - recovery.at < 30000) {
          storage.setItem(playedKey, '1');
          return inactive('recovery');
        }
      }
      if (type === 'back_forward') return inactive('history');
      const played = storage.getItem(playedKey) === '1';
      if (played && !(config.frequency === 'every_reload' && type === 'reload')) return inactive('already-played');
      storage.setItem(playedKey, '1');
    } catch (_) {
      return inactive('storage-unavailable');
    }
  }

  const priorFocus = doc.activeElement;
  const startedAt = Date.now();
  let resolveFinished;
  let active = true;
  let leaving = false;
  let deadline;
  let exitTimer;
  const parts = new Set();
  const required = scene === 'desktop' ? ['shell', 'surface'] : scene === 'app' ? ['shell', 'app'] : ['auth'];
  const layer = doc.createElement('div');
  layer.className = 'theme-startup-layer';
  layer.dataset.themeStartupLayer = preview ? 'preview' : 'entry';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', preview ? '开机效果演示' : '正在进入页面');
  // The fallback keyframe also releases pointer hit testing if JS stops after
  // mounting. No inert/scroll lock is applied to the document underneath.
  const style = doc.createElement('style');
  style.textContent = `
    .theme-startup-layer{position:fixed;inset:0;z-index:2147483600;background:#080808;color:#f5f5f7;display:grid;place-items:center;font-family:system-ui,sans-serif;isolation:isolate;animation:theme-startup-enter 120ms ease-out,theme-startup-release 1ms step-end 1999ms forwards}
    .theme-startup-center{display:flex;flex-direction:column;align-items:center;gap:28px;transform:translateY(-12px)}
    .theme-startup-logo{position:relative;width:88px;height:88px;display:grid;place-items:center}
    .theme-startup-logo svg,.theme-startup-logo img{width:100%;height:100%;object-fit:contain;grid-area:1/1}
    .theme-startup-logo img{position:absolute;inset:0}
    .theme-startup-track{height:3px;width:160px;border-radius:9px;overflow:hidden;background:#ffffff30}
    .theme-startup-track span{display:block;height:100%;width:32%;border-radius:inherit;background:#f5f5f7;animation:theme-startup-progress 1.1s ease-in-out infinite;transition:width 120ms ease}
    .theme-startup-layer[data-startup-leaving] .theme-startup-track span{animation:none;width:100%}
    .theme-startup-skip{position:absolute;right:max(24px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));min-width:72px;min-height:44px;padding:8px 16px;border:1px solid #ffffff38;border-radius:999px;background:#ffffff0d;color:#dedee3;font:13px/1.4 system-ui;cursor:pointer}
    .theme-startup-skip:focus-visible{outline:2px solid #fff;outline-offset:4px}
    .theme-startup-layer[data-startup-leaving]{opacity:0;transition:opacity 180ms ease;pointer-events:none}
    @keyframes theme-startup-enter{from{opacity:0}to{opacity:1}}
    @keyframes theme-startup-progress{0%{transform:translateX(-110%)}100%{transform:translateX(420%)}}
    @keyframes theme-startup-release{to{opacity:0;visibility:hidden;pointer-events:none}}
    @media(max-width:640px){.theme-startup-logo{width:72px;height:72px}.theme-startup-center{transform:translateY(-6px)}}
    @media(prefers-reduced-motion:reduce){.theme-startup-layer{display:none}}
  `;
  const center = doc.createElement('div');
  center.className = 'theme-startup-center';
  const logo = doc.createElement('div');
  logo.className = 'theme-startup-logo';
  logo.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M17.05 12.54c.03 3.15 2.76 4.2 2.79 4.21-.02.07-.44 1.5-1.44 2.98-.87 1.28-1.77 2.56-3.19 2.59-1.39.03-1.84-.83-3.43-.83-1.58 0-2.08.8-3.39.86-1.37.05-2.41-1.38-3.29-2.65-1.79-2.61-3.15-7.38-1.31-10.6a5.1 5.1 0 0 1 4.34-2.62c1.35-.03 2.63.92 3.45.92.82 0 2.36-1.14 3.98-.98.68.03 2.59.27 3.82 2.07-.1.06-2.29 1.34-2.27 4.05M14.45 4.6c.73-.89 1.23-2.13 1.1-3.36-1.06.04-2.34.7-3.1 1.59-.68.79-1.27 2.05-1.11 3.26 1.18.09 2.38-.6 3.11-1.49');
  svg.append(path);
  logo.append(svg);
  const rawImage = config.logoMode === 'custom' ? config.logoUrl : config.logoMode === 'site' ? config.siteLogo : '';
  if (rawImage) {
    try {
      const url = new URL(String(rawImage), win.location.href);
      if (['http:', 'https:'].includes(url.protocol)) {
        const img = doc.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.addEventListener('load', () => { if (active) svg.style.visibility = 'hidden'; }, { once: true });
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = url.href;
        logo.append(img);
      }
    } catch (_) { /* Keep the built-in mark for an unavailable image. */ }
  }
  const track = doc.createElement('div');
  track.className = 'theme-startup-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', preview ? '开机效果演示' : '正在准备页面交互');
  const progress = doc.createElement('span');
  track.append(progress);
  center.append(logo, track);
  const skip = doc.createElement('button');
  skip.className = 'theme-startup-skip';
  skip.type = 'button';
  skip.textContent = preview ? '结束演示' : '跳过';
  layer.append(style, center, skip);

  function cleanup(reason) {
    if (!active) return;
    active = false;
    win.clearTimeout(deadline);
    win.clearTimeout(exitTimer);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus, true);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
    motion?.removeEventListener?.('change', onMotion);
    layer.remove();
    if (doc.activeElement === doc.body || doc.activeElement === skip || layer.contains(doc.activeElement)) {
      if (priorFocus?.isConnected && priorFocus !== doc.body) priorFocus.focus?.({ preventScroll: true });
      else if (scene === 'login') doc.querySelector('.halo-form input:not([type="hidden"]):not([disabled]), [data-app-root="auth"] input:not([type="hidden"]):not([disabled])')?.focus?.({ preventScroll: true });
    }
    resolveFinished(reason);
  }
  function finish(reason = 'skipped') {
    if (!active || leaving) return;
    leaving = true;
    if (reason === 'interactive' && Date.now() - startedAt < 1820) {
      layer.dataset.startupLeaving = 'true';
      exitTimer = win.setTimeout(() => cleanup(reason), 180);
    } else cleanup(reason);
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('skipped'); }
    else if (event.key === 'Tab' && active && !leaving) { event.preventDefault(); skip.focus({ preventScroll: true }); }
  }
  function onFocus(event) {
    if (active && !leaving && !layer.contains(event.target)) skip.focus({ preventScroll: true });
  }
  function onPageHide() { cleanup('navigation'); }
  function onPageShow(event) { if (event.persisted) cleanup('history'); }
  function onMotion(event) { if (event.matches) cleanup('reduced-motion'); }
  const controller = {
    get active() { return active; },
    ready(part) {
      if (!active || preview) return;
      parts.add(part);
      if (required.every((name) => parts.has(name))) finish('interactive');
    },
    finish,
    dispose() { cleanup('cancelled'); },
    finished: new Promise((resolve) => { resolveFinished = resolve; })
  };
  if (!preview) win.__THEME_STARTUP__ = controller;
  // The watchdog is installed before the layer is mounted or focus is changed.
  deadline = win.setTimeout(() => cleanup('timeout'), 2000);
  skip.addEventListener('click', () => finish('skipped'));
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus, true);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  motion?.addEventListener?.('change', onMotion);
  doc.body.append(layer);
  skip.focus({ preventScroll: true });
  return controller;
}
