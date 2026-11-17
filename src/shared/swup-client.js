import Swup from 'swup';

let client;
let preparedPageReader;

// Optional attention may still be downloading when the first link is chosen.
// A ready reader can adopt its own cache/flight; null means start the
// foreground transport now. A rejected adopted read must never be retried here.
export function registerPreparedPageReader(reader) { preparedPageReader = reader; }
export function readPreparedPage(url, options) { return preparedPageReader?.(url, options) || null; }

export function getSwupClient() {
  if (!client) {
    client = new Swup({
      containers: ['#window-frame-root'],
      linkSelector: 'a:not(*)',
      skipPopStateHandling: () => true,
      animationScope: 'containers',
      animationSelector: false,
      cache: true,
      timeout: 15_000,
      requestHeaders: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-PJAX': 'true',
        'X-PJAX-Selectors': JSON.stringify(['title', '#window-frame-root']),
        Accept: 'text/html, application/xhtml+xml'
      }
    });
    client.visit.cache.write = false;
    window.swup = client;
  }
  return client;
}
