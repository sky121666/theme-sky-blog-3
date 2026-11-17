const owners = new WeakMap();
const PENDING_CLASS = 'theme-navigation-pending';

export function beginNavigationFeedback(element) {
  if (!element) return () => {};

  // A newer intent on this trigger inherits its original idle state, rather
  // than capturing the pending state left by the intent it supersedes.
  const owner = {
    original: owners.get(element)?.original || {
      pending: element.classList.contains(PENDING_CLASS),
      busy: element.getAttribute('aria-busy')
    }
  };
  owners.set(element, owner);
  element.classList.add(PENDING_CLASS);
  element.setAttribute('aria-busy', 'true');

  return () => {
    if (owners.get(element) !== owner) return;
    owners.delete(element);
    if (owner.original.pending) element.classList.add(PENDING_CLASS);
    else element.classList.remove(PENDING_CLASS);
    if (owner.original.busy === null) element.removeAttribute('aria-busy');
    else element.setAttribute('aria-busy', owner.original.busy);
  };
}
