import { readCommentPageUrl } from '../../../../../shared/comment-page-url.js';

const ENTRY_KEY = '__themeCommentEntry';
const histories = new WeakMap();
const installations = new WeakMap();
const AUDITED_SYNC = 'syncPageToUrl(){let e=new URL(location.href),t=e.searchParams.get("comment-page"),n=this.comments.page>1?String(this.comments.page):null;if(t===n){this.pageChangeShouldPush=!1;return}null===n?e.searchParams.delete("comment-page"):e.searchParams.set("comment-page",n),this.pageChangeShouldPush?history.pushState(history.state,"",e):history.replaceState(history.state,"",e),this.pageChangeShouldPush=!1}';

function knownEntry(history, state, href) {
  const marker = state?.[ENTRY_KEY];
  if (!history || marker?.session !== history.session || String(state?.uid) !== history.uid) return null;
  const entry = history.entries.get(marker.entry);
  return entry?.href === href ? entry : null;
}

// Scope the wrapper to the exact audited 3.5.1 method. The original method
// performs every URL change; these replaceState calls only identify the real
// entries immediately before/after its actual push, without global patching.
export function installCommentPageHistory(host = window) {
  if (installations.has(host)) return installations.get(host);
  const registry = host.customElements;
  if (typeof registry?.whenDefined !== 'function') return Promise.resolve(false);
  const pending = registry.whenDefined('comment-list').then(() => {
    const List = registry.get('comment-list');
    const descriptor = Object.getOwnPropertyDescriptor(List?.prototype || {}, 'syncPageToUrl');
    const original = descriptor?.value;
    if (!descriptor?.writable || typeof original !== 'function'
      || Function.prototype.toString.call(original).replace(/\s+/g, '') !== AUDITED_SYNC.replace(/\s+/g, '')) return false;
    Object.defineProperty(List.prototype, 'syncPageToUrl', { ...descriptor, value(...args) {
      const before = readCommentPageUrl(host.location.href);
      const state = host.history.state;
      const page = this.comments?.page;
      const next = before && new URL(before.href);
      if (next && Number.isSafeInteger(page) && page > 0) {
        if (page > 1) next.searchParams.set('comment-page', String(page));
        else next.searchParams.delete('comment-page');
      }
      if (!(this instanceof List) || !this.isConnected || !this.pageChangeShouldPush
        || !before || !Number.isSafeInteger(page) || page < 1 || next.href === before.href
        || new URL(before.href).searchParams.get('comment-page') === (page > 1 ? String(page) : null)
        || !state?.uid || !Number.isSafeInteger(state.__browserNavIndex) || state.__browserNavIndex < 0
        || readCommentPageUrl(state.url)?.documentUrl !== before.documentUrl) return original.apply(this, args);
      let history = histories.get(host);
      let source = history?.length === host.history.length && history.documentUrl === before.documentUrl
        && history.index === state.__browserNavIndex
        ? knownEntry(history, state, before.href) : null;
      if (!source) {
        history = { session: host.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
          uid: String(state.uid), index: state.__browserNavIndex, documentUrl: before.documentUrl,
          entries: new Map(), next: 0, length: host.history.length };
        source = { entry: history.next++, position: 0, href: before.href };
        history.entries.set(source.entry, source);
      }
      const sourceState = { ...state, url: before.href, [ENTRY_KEY]: { session: history.session, entry: source.entry } };
      try { host.history.replaceState(sourceState, '', before.href); }
      catch { return original.apply(this, args); }
      history.active = source;
      histories.set(host, history);
      const result = original.apply(this, args);
      // An unknown/reentrant mutation must never earn a known entry position.
      if (host.location.href !== next.href || String(host.history.state?.uid) !== history.uid) return result;
      const target = { entry: history.next++, position: source.position + 1, href: next.href };
      const targetState = { ...host.history.state, url: next.href,
        [ENTRY_KEY]: { session: history.session, entry: target.entry } };
      try { host.history.replaceState(targetState, '', next.href); }
      catch { histories.delete(host); return result; }
      // A push after Back replaces the actual browser's forward branch too.
      for (const [id, entry] of history.entries) if (entry.position > source.position) history.entries.delete(id);
      history.entries.set(target.entry, target);
      history.active = target;
      history.length = host.history.length;
      return result;
    } });
    return true;
  });
  installations.set(host, pending);
  return pending;
}

export function prepareCommentPageHistoryView({ state, sourceUrl, committedEntry, readIndex, applyState, host = window, doc = document }) {
  const source = readCommentPageUrl(sourceUrl);
  const target = readCommentPageUrl(host.location.href);
  const entry = readCommentPageUrl(state?.url);
  if (!source || !target || !entry || !state?.uid
    || String(state.uid) !== String(committedEntry?.uid)
    || readIndex(state) === null
    || source.documentUrl !== target.documentUrl || entry.documentUrl !== target.documentUrl) return null;
  const Widget = host.customElements?.get('comment-widget');
  const List = host.customElements?.get('comment-list');
  if (!Widget || !List) return null;
  const lists = Array.from(doc.querySelectorAll('comment-widget'))
    .filter(widget => widget instanceof Widget && widget.isConnected)
    .map(widget => widget.shadowRoot?.querySelector('comment-list'))
    .filter(list => list instanceof List && list.isConnected);
  if (!lists.length) return null;
  // The rendered pagination remains on the accepted page while a newer
  // request is pending; comments.page itself changes before that request.
  const pages = lists.map(list => list.shadowRoot?.querySelector('comment-pagination')?.page ?? list.comments?.page);
  const currentPage = pages[0];
  if (!Number.isSafeInteger(currentPage) || currentPage < 1 || !pages.every(page => page === currentPage)
    || (source.href === target.href && entry.href === target.href && currentPage === target.page)) return null;
  const history = histories.get(host);
  const trackedTarget = knownEntry(history, state, target.href);
  const trackedSource = history?.active;
  if (history && (!trackedTarget || history.length !== host.history.length
    || history.index !== readIndex(state) || history.index !== readIndex(committedEntry)
    || history.documentUrl !== target.documentUrl || readCommentPageUrl(trackedSource?.href)?.page !== currentPage)) return null;
  const sourceHref = new URL(source.href);
  if (currentPage > 1) sourceHref.searchParams.set('comment-page', String(currentPage));
  else sourceHref.searchParams.delete('comment-page');
  const root = doc.querySelector('[data-window-content-root]') || doc;
  return {
    root,
    sourceHref: trackedSource?.href || sourceHref.href,
    sourceState: trackedSource ? { ...committedEntry, url: trackedSource.href,
      [ENTRY_KEY]: { session: history.session, entry: trackedSource.entry } } : undefined,
    rollbackDelta: trackedTarget ? trackedSource.position - trackedTarget.position : undefined,
    commit() {
      if (host.location.href !== target.href || root.isConnected === false) return false;
      const restored = { ...state, url: target.href };
      host.history.replaceState(restored, restored.title || doc.title, target.href);
      applyState(restored);
      if (trackedTarget) history.active = trackedTarget;
      return true;
    }
  };
}
