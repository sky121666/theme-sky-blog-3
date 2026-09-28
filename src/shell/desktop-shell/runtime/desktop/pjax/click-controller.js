import { classifyLinkClick } from '../../../../../shared/navigation-link-policy.js';

const controllers = new WeakMap();

/** @theme-navigation-contract v1 — one bubble listener, no serializable bind markers. */
export function installClickController({ document, readContext, requestNavigation }) {
  if (controllers.has(document)) return controllers.get(document);
  const onClick = (event) => {
    const path = event.composedPath?.() || [];
    const anchor = path.find((node) => node?.matches?.('a[href]'))
      || event.target?.closest?.('a[href]');
    if (!anchor?.isConnected || anchor.ownerDocument !== document) return;
    const decision = classifyLinkClick({
      ...readContext(), event,
      link: {
        rawHref: anchor.getAttribute('href'), resolvedHref: anchor.href,
        classOptIn: anchor.classList.contains('pjax-link'),
        targetPresent: anchor.hasAttribute('target'), target: anchor.getAttribute('target'),
        hasDownload: anchor.hasAttribute('download')
      }
    });
    if (decision.kind !== 'managed') return;
    // Admission can veto, but a managed click must never fall through natively.
    event.preventDefault();
    requestNavigation({ href: decision.href, source: 'click', triggerElement: anchor, options: { triggerElement: anchor } });
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('click', onClick);
    controllers.delete(document);
  };
  document.addEventListener('click', onClick);
  controllers.set(document, dispose);
  return dispose;
}
