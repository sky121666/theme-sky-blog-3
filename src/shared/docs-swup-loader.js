// The docs pilot stays outside the desktop's static resource closure.
let pending;
function load() {
  if (!pending) {
    const request = import('./docs-swup.js').then(adapter => {
      adapter.initializeDocsSwup();
      return adapter;
    });
    pending = request;
    request.catch(() => { if (pending === request) pending = null; });
  }
  return pending;
}
export function initializeDocsSwup() {
  void load()
    .catch(error => console.warn('[theme] Docs preloading unavailable:', error));
}
export async function fetchDocsPage(url, options) {
  let adapter;
  try { adapter = await load(); }
  catch {
    const headers = new Headers(options?.headers);
    headers.set('X-Requested-With', 'XMLHttpRequest');
    const [response, { validateDocsFallback }] = await Promise.all([
      fetch(url, { ...options, headers }), import('./docs-html.js')
    ]);
    return validateDocsFallback(response);
  }
  return adapter.fetchDocsPage(url, options);
}
