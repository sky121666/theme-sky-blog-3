// Keep the optional SDK adapter outside the desktop's static resource closure.
let pending = null;
let latestDocument = null;
const supported = () => /MicroMessenger|QQ\//i.test(window.navigator.userAgent);
function load() {
  if (!pending) {
    const request = import('./wechat-share.js');
    pending = request;
    request.catch(() => { if (pending === request) pending = null; });
  }
  return pending;
}
function flush() {
  if (!supported()) return;
  void load().then((adapter) => {
    adapter.initializeWechatShare();
    if (latestDocument) adapter.syncWechatShareFromDocument(latestDocument);
  }).catch(() => { /* Another authoritative page or recovery can retry the optional module. */ });
}
export function initializeWechatShare() {
  latestDocument ||= document;
  flush();
}
export function syncWechatShareFromDocument(doc) {
  latestDocument = doc;
  flush();
}
export async function requiresWechatShareDocumentNavigation(doc) {
  if (!supported()) return false;
  return (await load()).requiresWechatShareDocumentNavigation(doc);
}
export async function prepareWechatShareLocalNavigation(url, options) {
  if (!supported()) return null;
  return (await load()).prepareWechatShareLocalNavigation(url, options);
}
