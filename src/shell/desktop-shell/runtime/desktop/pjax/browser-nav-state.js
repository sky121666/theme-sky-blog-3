const INDEX_KEY = '__browserNavIndex';
const CHROME_KEY = '__browserNavChrome';
const WINDOW_SCROLL_KEY = '__browserWindowScroll';
const STORAGE_KEY = 'sky_browser_nav_entries_v1';
const MAX_ENTRIES = 80;

function snapshot(state) {
  if (!state || typeof state !== 'object' || state.uid == null) return null;
  if (!Number.isFinite(state[INDEX_KEY]) || state[INDEX_KEY] < 0) return null;
  return {
    uid: String(state.uid),
    url: String(state.url || ''),
    index: state[INDEX_KEY],
    chrome: state[CHROME_KEY] && typeof state[CHROME_KEY] === 'object'
      ? {
          windowTitle: String(state[CHROME_KEY].windowTitle || ''),
          windowSubtitle: String(state[CHROME_KEY].windowSubtitle || '')
        }
      : null,
    windowScroll: Array.isArray(state[WINDOW_SCROLL_KEY])
      ? state[WINDOW_SCROLL_KEY].slice(0, 2).map((value) => Math.max(0, Number(value) || 0))
      : [0, 0],
    scrollPos: Array.isArray(state.scrollPos)
      ? state.scrollPos.slice(0, 2).map((value) => Math.max(0, Number(value) || 0))
      : null
  };
}

/** Pjax 0.2.8 replaces the old history entry without preserving theme fields. */
export function createBrowserNavStateStore(storageProvider = () => globalThis.window?.sessionStorage) {
  const entries = new Map();
  let hydrated = false;

  const storage = () => {
    try {
      return storageProvider?.() || null;
    } catch (_error) {
      return null;
    }
  };

  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    try {
      const stored = JSON.parse(storage()?.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored)) return;
      stored.slice(-MAX_ENTRIES).forEach((candidate) => {
        const entry = snapshot({
          uid: candidate?.uid,
          url: candidate?.url,
          [INDEX_KEY]: candidate?.index,
          [CHROME_KEY]: candidate?.chrome,
          [WINDOW_SCROLL_KEY]: candidate?.windowScroll,
          scrollPos: candidate?.scrollPos
        });
        if (entry) entries.set(entry.uid, entry);
      });
    } catch (_error) {
      // Private browsing and restricted storage still work within this page.
    }
  };

  const remember = (state) => {
    hydrate();
    const entry = snapshot(state);
    if (!entry) return;
    entries.delete(entry.uid);
    entries.set(entry.uid, entry);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(Array.from(entries.values())));
    } catch (_error) {
      // The in-memory copy remains usable if sessionStorage is unavailable.
    }
  };

  const recover = (state) => {
    hydrate();
    if (!state || typeof state !== 'object' || state.uid == null) return state;
    const entry = entries.get(String(state.uid));
    if (!entry || entry.url !== String(state.url || '')) return state;
    return {
      ...state,
      [INDEX_KEY]: Number.isFinite(state[INDEX_KEY]) ? state[INDEX_KEY] : entry.index,
      [CHROME_KEY]: state[CHROME_KEY] && typeof state[CHROME_KEY] === 'object'
        ? state[CHROME_KEY]
        : entry.chrome,
      [WINDOW_SCROLL_KEY]: entry.windowScroll,
      scrollPos: entry.scrollPos || state.scrollPos
    };
  };

  return { remember, recover };
}
