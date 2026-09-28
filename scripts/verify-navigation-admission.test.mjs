import test from 'node:test';
import assert from 'node:assert/strict';

// Removing deferred commit, stamp validation or single-use handoff must fail these tests.
const moduleUrl = new URL('../src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js', import.meta.url);
let createNavigationAdmission;
try { ({ createNavigationAdmission } = await import(moduleUrl)); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

function setup() {
  assert.equal(typeof createNavigationAdmission, 'function', 'navigation admission implementation is required');
  const events = new EventTarget();
  let now = 0;
  const admission = createNavigationAdmission({ eventTarget: events, now: () => now });
  const makeGuard = (id, allowed = true) => {
    const state = { version: 0, saving: false, visible: true, cleanups: 0, allowed };
    const capture = () => `${state.version}:${state.saving}:${state.visible}`;
    const unregister = admission.registerNavigationGuard({
      id, capture,
      allow: () => state.allowed && !state.saving,
      isUnchanged: (snapshot) => capture() === snapshot,
      commit: () => { state.cleanups++; }
    });
    return { state, unregister };
  };
  const prepare = () => admission.prepareNavigation({ url: 'https://theme.test/links', source: 'click' });
  return { admission, events, makeGuard, prepare, advance: (ms) => { now += ms; } };
}

test('one guard veto leaves all drafts intact', () => {
  const f = setup(), a = f.makeGuard('desktop'), b = f.makeGuard('settings', false);
  assert.equal(f.prepare().kind, 'cancelled');
  assert.equal(a.state.cleanups + b.state.cleanups, 0);
});
test('accepted navigation waits for commit and abandoned fetch never cleans up', () => {
  const f = setup(), a = f.makeGuard('desktop'), result = f.prepare();
  assert.equal(result.kind, 'accepted');
  assert.equal(a.state.cleanups, 0);
  f.admission.abandonNavigation(result.permit);
  assert.equal(f.admission.commitNavigation(result.permit, () => true), 'cancelled');
  assert.equal(a.state.cleanups, 0);
});
test('every snapshot is checked before any cleanup', () => {
  const f = setup(), a = f.makeGuard('desktop'), b = f.makeGuard('settings'), { permit } = f.prepare();
  b.state.version++;
  assert.equal(f.admission.commitNavigation(permit, () => true), 'cancelled');
  assert.equal(a.state.cleanups + b.state.cleanups, 0);
});
test('a save started while fetching revokes permission', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  a.state.saving = true;
  assert.equal(f.admission.commitNavigation(permit, () => true), 'cancelled');
  assert.equal(a.state.cleanups, 0);
});
test('fallback commits the same permit only once', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  assert.equal(f.admission.commitNavigation(permit, () => true), 'committed');
  assert.equal(f.admission.commitNavigation(permit, () => true), 'committed');
  assert.equal(a.state.cleanups, 1);
});
test('superseded intent cannot clean up even an already committed permit', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  assert.equal(f.admission.commitNavigation(permit, () => false), 'stale');
  assert.equal(a.state.cleanups, 0);
});
test('rejected later attempt does not revoke an earlier permit', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  a.state.allowed = false;
  assert.equal(f.prepare().kind, 'cancelled');
  assert.equal(f.admission.commitNavigation(permit, () => true), 'committed');
});
test('guard registry changes while fetching revoke old permit', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  f.makeGuard('settings');
  assert.equal(f.admission.commitNavigation(permit, () => true), 'cancelled');
  assert.equal(a.state.cleanups, 0);
});
test('duplicate guard id cannot silently install a second owner', () => {
  const f = setup(); f.makeGuard('desktop');
  assert.throws(() => f.makeGuard('desktop'), /duplicate/i);
});
test('unregister is idempotent and new component can register same id', () => {
  const f = setup(), a = f.makeGuard('desktop'); a.unregister(); a.unregister();
  const b = f.makeGuard('desktop'), { permit } = f.prepare();
  assert.equal(f.admission.commitNavigation(permit, () => true), 'committed');
  assert.equal(a.state.cleanups, 0); assert.equal(b.state.cleanups, 1);
});
test('external veto retains url contract and prevents cleanup', () => {
  const f = setup(), a = f.makeGuard('desktop');
  f.events.addEventListener('theme:before-pjax-navigation', (event) => {
    assert.equal(event.detail.url, 'https://theme.test/links'); event.preventDefault();
  });
  assert.equal(f.prepare().kind, 'cancelled'); assert.equal(a.state.cleanups, 0);
});
test('commit error is terminal and does not rerun successful cleanup', () => {
  const f = setup(), a = f.makeGuard('desktop');
  f.admission.registerNavigationGuard({ id: 'broken', capture: () => 1, allow: () => true,
    isUnchanged: () => true, commit: () => { throw new Error('fixture cleanup'); } });
  const { permit } = f.prepare();
  assert.equal(f.admission.commitNavigation(permit, () => true), 'failed');
  assert.equal(f.admission.commitNavigation(permit, () => true), 'failed');
  assert.equal(a.state.cleanups, 1);
});
test('native handoff covers both guards on one beforeunload without discarding drafts', () => {
  const f = setup(), a = f.makeGuard('desktop'), b = f.makeGuard('settings'), { permit } = f.prepare();
  assert.equal(f.admission.prepareNativeHandoff(permit, () => true), 'allowed');
  const event = new Event('beforeunload');
  assert.equal(f.admission.isCoveredNativeBeforeUnload(event, 'desktop'), true);
  assert.equal(f.admission.isCoveredNativeBeforeUnload(event, 'settings'), true);
  assert.equal(f.admission.isCoveredNativeBeforeUnload(new Event('beforeunload'), 'desktop'), false);
  assert.equal(a.state.cleanups + b.state.cleanups, 0);
});
test('expired handoff or new input restores ordinary beforeunload protection', () => {
  const f = setup(); f.makeGuard('desktop'); const { permit } = f.prepare();
  f.admission.prepareNativeHandoff(permit, () => true); f.advance(1501);
  assert.equal(f.admission.isCoveredNativeBeforeUnload(new Event('beforeunload'), 'desktop'), false);
  f.admission.prepareNativeHandoff(permit, () => true);
  f.events.dispatchEvent(new Event('pointerdown'));
  assert.equal(f.admission.isCoveredNativeBeforeUnload(new Event('beforeunload'), 'desktop'), false);
});
test('mutated draft or superseded intent cannot use native handoff permission', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  f.admission.prepareNativeHandoff(permit, () => true); a.state.version++;
  assert.equal(f.admission.isCoveredNativeBeforeUnload(new Event('beforeunload'), 'desktop'), false);
  const next = f.prepare().permit;
  assert.equal(f.admission.prepareNativeHandoff(next, () => false), 'stale');
});
test('new changes after a DOM commit still block native recovery', () => {
  const f = setup(), a = f.makeGuard('desktop'), { permit } = f.prepare();
  assert.equal(f.admission.commitNavigation(permit, () => true), 'committed');
  a.state.version++;
  assert.equal(f.admission.prepareNativeHandoff(permit, () => true), 'cancelled');
});
