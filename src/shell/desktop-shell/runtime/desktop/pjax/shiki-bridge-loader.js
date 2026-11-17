// Keep incremental code highlighting outside the desktop's static closure.
const MODULE_PATH = '/plugins/shiki/assets/static/shiki-code.js';
let pending = null;
let generation = 0;

function schedule(responseText, root, parsed) {
  const hasPlugin = responseText === undefined
    ? document.head.innerHTML.includes(MODULE_PATH)
    : String(responseText || '').includes(MODULE_PATH);
  if (!pending && !hasPlugin) return;
  const intent = ++generation;
  if (!pending) {
    const request = import('./shiki-bridge.js');
    pending = request;
    request.catch(() => { if (pending === request) pending = null; });
  }
  void pending.then((bridge) => {
    if (intent !== generation || root?.isConnected === false) return;
    bridge.initializeShikiBridge(responseText === undefined);
    if (responseText !== undefined) bridge.runShikiExtraPathRenderer(responseText, root, parsed);
  }).catch((error) => console.warn('[theme] Shiki bridge unavailable:', error));
}

export function initializeShikiBridge() {
  schedule(undefined, document);
}

export function runShikiExtraPathRenderer(responseText, root, parsed) {
  schedule(responseText, root, parsed);
}
