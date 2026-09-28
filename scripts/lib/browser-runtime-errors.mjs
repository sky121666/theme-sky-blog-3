// One error model for live suites. Expected failures are retained separately,
// so a passing scenario never silently turns them into a zero-error claim.
export function runtimeErrorMessages(result = {}) {
  return [
    ...(result.pageErrors || []).map((error) => `pageerror: ${error}`),
    ...(result.consoleErrors || []).map((error) => `console.error: ${typeof error === 'string' ? error : JSON.stringify(error)}`),
    ...(result.requestFailures || []).map((error) => `requestfailed: ${error.method || ''} ${error.url || ''} (${error.errorText || error.failure || 'unknown'})`),
    ...(result.responseErrors || []).map((error) => `response: ${error.url} (HTTP ${error.status})`),
    ...(result.blockedWrites || []).map((error) => `unexpected write: ${JSON.stringify(error)}`)
  ];
}

export function collectBrowserRuntimeErrors(page, { expected = () => false } = {}) {
  const data = { pageErrors: [], pageErrorDetails: [], consoleErrors: [], requestFailures: [], responseErrors: [], expectedErrors: [], consoleWarnings: [] };
  const record = (kind, value) => {
    const isExpected = expected(kind, value);
    if (isExpected) data.expectedErrors.push({ kind, value });
    else data[kind].push(value);
    return isExpected;
  };
  const listeners = {
    pageerror: (error) => {
      const message = String(error?.message || error);
      // Keep the original string array and failure gate compatible. Details
      // explain opaque messages such as "Object" without exempting them.
      data.pageErrorDetails.push({
        name: String(error?.name || ''), message, stack: String(error?.stack || ''),
        url: page.url?.() || '', observedAt: new Date().toISOString(),
        expected: record('pageErrors', message)
      });
    },
    console: (message) => {
      if (message.type() === 'error') {
        const location = message.location() || {};
        record('consoleErrors', { text: message.text(), url: location.url || '', lineNumber: location.lineNumber ?? null, columnNumber: location.columnNumber ?? null });
      }
      else if (message.type() === 'warning') data.consoleWarnings.push(message.text());
    },
    requestfailed: (request) => record('requestFailures', {
      method: request.method(), resourceType: request.resourceType(), url: request.url(),
      errorText: request.failure()?.errorText || 'unknown request failure'
    }),
    response: (response) => {
      if (response.status() >= 400) record('responseErrors', {
        method: response.request().method(), resourceType: response.request().resourceType(),
        url: response.url(), status: response.status()
      });
    }
  };
  for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
  return {
    snapshot: () => structuredClone(data),
    stop() { for (const [event, listener] of Object.entries(listeners)) page.off(event, listener); }
  };
}

export async function installReadOnlyGuard(context, blockedWrites) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blockedWrites.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
}
