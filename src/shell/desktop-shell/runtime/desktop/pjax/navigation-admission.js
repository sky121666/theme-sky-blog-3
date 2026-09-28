/**
 * @theme-navigation-contract v1
 * Synchronous leave votes and deferred, single-use cleanup. Navigation ownership
 * stays in the existing PJAX coordinator; permits never allocate a generation.
 */
export function createNavigationAdmission({ eventTarget = globalThis.window, now = Date.now } = {}) {
  const guards = new Map();
  const permits = new WeakSet();
  let revision = 0;
  let handoff = null;
  let handoffListenersInstalled = false;

  const revokeNativeHandoff = () => { handoff = null; };
  const unchanged = (permit) => permit.revision === revision
    && permit.receipts.every(({ guard, snapshot }) => guard.isUnchanged(snapshot));

  function registerNavigationGuard(guard) {
    if (guards.has(guard.id)) throw new Error(`Duplicate navigation guard: ${guard.id}`);
    guards.set(guard.id, guard);
    revision++;
    return () => {
      if (guards.get(guard.id) !== guard) return;
      guards.delete(guard.id);
      revision++;
    };
  }

  function prepareNavigation(context) {
    try {
      const capturedRevision = revision;
      // Capture clean participants too: they can acquire a draft during fetch.
      const priority = (id) => id === 'desktop-layout' ? 0 : id === 'theme-settings' ? 1 : 2;
      const receipts = [...guards.values()]
        .sort((a, b) => priority(a.id) - priority(b.id))
        .map((guard) => ({ guard, snapshot: guard.capture() }));
      for (const { guard, snapshot } of receipts) {
        if (!guard.allow(snapshot, context)) return { kind: 'cancelled', reason: 'guard-veto' };
      }
      const event = new CustomEvent('theme:before-pjax-navigation', {
        cancelable: true, detail: { url: String(context.url || '') }
      });
      if (eventTarget && !eventTarget.dispatchEvent(event)) {
        return { kind: 'cancelled', reason: 'external-veto' };
      }
      const permit = { receipts, revision: capturedRevision, state: 'pending' };
      if (!unchanged(permit)) return { kind: 'cancelled', reason: 'draft-changed' };
      permits.add(permit);
      revokeNativeHandoff();
      return { kind: 'accepted', permit };
    } catch (error) {
      return { kind: 'cancelled', reason: 'guard-error', error };
    }
  }

  function check(permit, isCurrent) {
    if (!isCurrent()) return 'stale';
    if (!permits.has(permit) || permit.state === 'cancelled') return 'cancelled';
    if (permit.state === 'failed' || permit.state === 'committing') return 'failed';
    if (permit.state === 'committed') return 'committed';
    try {
      if (unchanged(permit)) return 'pending';
    } catch (error) { permit.error = error; }
    permit.state = 'cancelled';
    return 'cancelled';
  }

  function commitNavigation(permit, isCurrent) {
    const result = check(permit, isCurrent);
    if (result !== 'pending') return result;
    permit.state = 'committing';
    try {
      for (const { guard, snapshot } of permit.receipts) guard.commit(snapshot);
      permit.receipts = permit.receipts.map(({ guard }) => ({ guard, snapshot: guard.capture() }));
      permit.state = 'committed';
      return 'committed';
    } catch (error) {
      permit.error = error;
      permit.state = 'failed';
      return 'failed';
    }
  }

  function abandonNavigation(permit) {
    if (permits.has(permit) && permit.state === 'pending') permit.state = 'cancelled';
  }

  function prepareNativeHandoff(permit, isCurrent) {
    const result = check(permit, isCurrent);
    if (result !== 'pending' && result !== 'committed') return result;
    try { if (!unchanged(permit)) return 'cancelled'; } catch { return 'cancelled'; }
    if (!handoffListenersInstalled) {
      for (const type of ['pointerdown', 'keydown', 'pageshow']) {
        eventTarget?.addEventListener(type, revokeNativeHandoff, true);
      }
      handoffListenersInstalled = true;
    }
    handoff = { permit, isCurrent, expires: now() + 1500, event: null };
    return 'allowed';
  }

  function isCoveredNativeBeforeUnload(event, guardId) {
    if (!handoff || now() > handoff.expires || !handoff.isCurrent()
      || (handoff.event && handoff.event !== event)) return false;
    const result = check(handoff.permit, handoff.isCurrent);
    if (result !== 'pending' && result !== 'committed') return false;
    try { if (!unchanged(handoff.permit)) return false; } catch { return false; }
    if (!handoff.permit.receipts.some(({ guard }) => guard.id === guardId)) return false;
    handoff.event = event;
    return true;
  }

  return { registerNavigationGuard, prepareNavigation, commitNavigation, abandonNavigation,
    prepareNativeHandoff, isCoveredNativeBeforeUnload, revokeNativeHandoff };
}

const admission = createNavigationAdmission();
export const { registerNavigationGuard, prepareNavigation, commitNavigation, abandonNavigation,
  prepareNativeHandoff, isCoveredNativeBeforeUnload, revokeNativeHandoff } = admission;
