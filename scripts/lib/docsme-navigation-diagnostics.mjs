// Passive, bounded diagnostics. This never retries a navigation or changes its deadline.
export function createDocsmeNavigationDiagnostics(page, { snapshotTimeoutMs = 2000 } = {}) {
  const attempts = [];
  const failures = [];
  const events = [];
  const pending = new Map();
  const listeners = [];
  const safeUrl = (value) => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch { return String(value || ''); }
  };
  const remember = (event) => {
    events.push({ at: new Date().toISOString(), ...event });
    if (events.length > 100) events.shift();
  };
  const on = (event, listener) => { page.on(event, listener); listeners.push([event, listener]); };
  on('request', (request) => {
    const value = { url: safeUrl(request.url()), method: request.method(), type: request.resourceType(), startedAt: Date.now() };
    pending.set(request, value);
    remember({ event: 'request', ...value });
  });
  on('response', (response) => {
    const value = pending.get(response.request());
    const rawHeaders = response.headers();
    const headers = Object.fromEntries(['content-type', 'content-length', 'content-encoding', 'transfer-encoding', 'cache-control']
      .filter((key) => rawHeaders[key] !== undefined).map((key) => [key, rawHeaders[key]]));
    if (value) { value.status = response.status(); value.headersAt = Date.now(); value.headers = headers; }
    remember({ event: 'response', url: safeUrl(response.url()), status: response.status(), headers });
  });
  for (const event of ['requestfinished', 'requestfailed']) on(event, (request) => {
    pending.delete(request);
    remember({ event, url: safeUrl(request.url()), error: request.failure()?.errorText || '' });
  });
  for (const event of ['domcontentloaded', 'load']) on(event, () => remember({ event, url: safeUrl(page.url()) }));
  on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) remember({ event: 'framenavigated', url: safeUrl(frame.url()) });
  });

  async function snapshot() {
    const pendingAtFailure = [...pending.values()].map((value) => ({ ...value, elapsedMs: Date.now() - value.startedAt }));
    const eventsAtFailure = structuredClone(events);
    let timer;
    const documentState = await Promise.race([
      Promise.resolve().then(() => page.evaluate(() => {
        const cleanUrl = (value) => { const url = new URL(value, location.href); return `${url.origin}${url.pathname}`; };
        const navigation = performance.getEntriesByType('navigation')[0];
        return {
          url: cleanUrl(location.href), readyState: document.readyState,
          appId: document.body?.dataset.appId || '',
          scene: document.querySelector('[data-app-root="docsme"]')?.dataset.docsmeScene || '',
          bootstrapError: window.__THEME_BOOTSTRAP_ERROR__ || '',
          shellLoaded: Boolean(window.__THEME_SHELL_CORE_LOADED__),
          alpineStarted: Boolean(window.__THEME_ALPINE_STARTED__),
          navigationTiming: navigation ? {
            responseStart: navigation.responseStart, responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventStart: navigation.domContentLoadedEventStart,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventStart: navigation.loadEventStart, loadEventEnd: navigation.loadEventEnd
          } : null,
          scripts: [...document.scripts].filter((node) => node.src).slice(0, 100)
            .map((node) => ({ src: cleanUrl(node.src), type: node.type, async: node.async, defer: node.defer })),
          styles: [...document.querySelectorAll('link[rel="stylesheet"]')].slice(0, 100)
            .map((node) => ({ href: cleanUrl(node.href), disabled: node.disabled, media: node.media, sheet: Boolean(node.sheet) }))
        };
      })).catch((error) => ({ evaluationError: error.message })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ evaluationTimedOut: true }), snapshotTimeoutMs); })
    ]).finally(() => clearTimeout(timer));
    return {
      observedAt: new Date().toISOString(), url: safeUrl(page.url()), documentState,
      pendingCount: pendingAtFailure.length, pendingRequests: pendingAtFailure.slice(-100),
      pendingTruncated: pendingAtFailure.length > 100, events: eventsAtFailure
    };
  }

  return {
    attempts, failures, snapshot,
    async goto(url, options) {
      const attempt = { url: safeUrl(url), startedAt: new Date().toISOString(), waitUntil: options.waitUntil, timeoutMs: options.timeout, status: 'running' };
      attempts.push(attempt);
      try {
        const response = await page.goto(url, options);
        Object.assign(attempt, { status: 'completed', httpStatus: response?.status() ?? null, finishedAt: new Date().toISOString() });
        return response;
      } catch (error) {
        Object.assign(attempt, { status: 'failed', error: error.message, finishedAt: new Date().toISOString() });
        const diagnostic = await snapshot();
        failures.push({ attempt: { ...attempt }, diagnostic });
        error.docsmeNavigationDiagnostic = diagnostic;
        throw error;
      }
    },
    stop() { for (const [event, listener] of listeners) page.off(event, listener); }
  };
}
