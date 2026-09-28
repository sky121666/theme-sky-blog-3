/** @theme-navigation-contract v1 — pure click-time eligibility, no DOM state. */
export function classifyLinkClick({ event = {}, link, currentUrl, baseTarget = '', runtimeReady }) {
  const native = (reason) => ({ kind: 'native', reason });
  if (event.defaultPrevented) return native('component-owned');
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return native('browser-gesture');
  }
  if (!runtimeReady || !link?.classOptIn || !String(link.rawHref || '').trim()) return native('not-opted-in');
  const target = String(link.targetPresent ? link.target : baseTarget).trim().toLowerCase();
  if (link.hasDownload || (target && target !== '_self')) return native('browser-target');
  try {
    const current = new URL(currentUrl);
    const url = new URL(link.resolvedHref, current);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== current.origin) return native('external');
    if (url.pathname === current.pathname && url.search === current.search
      && String(link.resolvedHref).includes('#')) return native('same-document-anchor');
    return { kind: 'managed', href: url.href };
  } catch { return native('invalid-url'); }
}
