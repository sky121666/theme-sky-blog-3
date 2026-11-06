import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Exercise the current scrollbar implementation and real early-surface handoff
// in native DOM, without booting unrelated shell services or loading built assets.
const shell = await readFile(new URL('../src/shell/desktop-shell/runtime/desktop/shell.js', import.meta.url), 'utf8');
const early = await readFile(new URL('../src/shell/desktop-shell/runtime/desktop/surface/early-surface.js', import.meta.url), 'utf8');
const shellEnd = shell.indexOf('export function registerShellComponents(');
const reconcileStart = early.indexOf('export function reconcileEarlyDesktopSurface(');
assert.ok(shellEnd > 0 && reconcileStart > 0, 'Locate the current production functions');
const source = shell.slice(0, shellEnd).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const reconcile = early.slice(reconcileStart).replace(/^export /gm, '');
const script = `${source}\n${reconcile}\nwindow.scrollbarHandoff = { initFloatingScrollbars, reconcileEarlyDesktopSurface };`;
const browser = await chromium.launch({ headless: true });
const failures = [];
let passed = 0;

try {
  for (const platform of ['MacIntel', 'Win32']) for (const isHome of [false, true]) {
    const name = `${platform} ${isHome ? 'home' : 'app route'}`;
    const context = await browser.newContext();
    await context.addInitScript(platform => Object.defineProperty(navigator, 'platform', { get: () => platform }), platform);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    try {
      await page.setContent(`<!doctype html><html><body><div id="surface">
        <div data-early-desktop-surface aria-hidden="true" ${isHome ? '' : 'hidden'}>
          <div class="desktop-widgets-grid-shell" data-early-desktop-grid-shell>
            <span data-early-desktop-key="fixture-icon">Placeholder</span>
          </div>
        </div>
        <section id="layer"><div id="live-shell" class="desktop-widgets-grid-shell" style="width:200px;height:100px;overflow:auto">
          <div id="grid" style="height:500px"><div class="desktop-node-slot" data-desktop-key="fixture-icon" style="left:0px;top:0px;width:64px;height:64px"><div class="desktop-icon"></div></div></div>
        </div></section>
      </div></body></html>`);
      await page.addScriptTag({ content: script });
      const result = await page.evaluate(async isHome => {
        const { initFloatingScrollbars, reconcileEarlyDesktopSurface } = window.scrollbarHandoff;
        const earlyShell = document.querySelector('[data-early-desktop-grid-shell]');
        const liveShell = document.querySelector('#live-shell');
        initFloatingScrollbars();
        initFloatingScrollbars();
        const earlyRegisteredInitially = earlyShell.classList.contains('floating-scrollbar-host');
        // Registration can also happen through delegated native event paths.
        for (const type of ['scroll', 'pointerover', 'focusin', 'load']) {
          earlyShell.firstElementChild.dispatchEvent(new Event(type, { bubbles: true }));
        }
        const before = {
          snapshot: window.__THEME_FLOATING_SCROLLBAR_DEBUG__.snapshot(),
          earlyRegisteredInitially,
          earlyRegisteredAfterEvents: earlyShell.classList.contains('floating-scrollbar-host'),
          earlyOverlays: earlyShell.querySelectorAll('.window-scrollbar-overlay').length,
          liveRegistered: liveShell.classList.contains('floating-scrollbar-host'),
          liveOverlays: liveShell.querySelectorAll(':scope > .window-scrollbar-overlay').length
        };
        // Handoff happens after initial registration, as it does during startup.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const complete = reconcileEarlyDesktopSurface({
          $refs: { grid: document.querySelector('#grid'), layer: document.querySelector('#layer'), surface: document.querySelector('#surface') },
          lastGridShellWidth: 200, widgetsDisposed: false, enabled: true, isHome,
          placedDesktopNodes: [{ key: 'fixture-icon', kind: 'icon' }],
          visibleDesktopNodeKeys: ['fixture-icon'],
          getDesktopNodeStyle: () => 'left:0px;top:0px;width:64px;height:64px;'
        });
        return {
          before, complete, earlyConnected: earlyShell.isConnected,
          after: window.__THEME_FLOATING_SCROLLBAR_DEBUG__.snapshot(),
          domHosts: document.querySelectorAll('.floating-scrollbar-host').length,
          liveRegisteredAfterHandoff: liveShell.classList.contains('floating-scrollbar-host')
        };
      }, isHome);
      assert.deepEqual(errors, [], 'No unhandled native DOM errors');
      assert.equal(result.before.liveRegistered, true, 'The real desktop grid remains registered');
      assert.equal(result.before.earlyRegisteredInitially, false, 'The early placeholder must never become a floating scrollbar host');
      assert.equal(result.before.earlyRegisteredAfterEvents, false, 'Delegated events must not register the early placeholder');
      assert.equal(result.before.earlyOverlays, 0, 'The early placeholder must not receive an overlay');
      assert.equal(result.before.liveOverlays, platform === 'Win32' ? 1 : 0, 'Normal platform overlay behavior remains intact without duplicates');
      assert.deepEqual(result.before.snapshot, { initialized: 1, connected: 1, disconnected: 0 });
      assert.equal(result.complete, true, 'The actual production handoff completes');
      assert.equal(result.earlyConnected, false, 'The actual handoff removes the early DOM');
      assert.deepEqual(result.after, { initialized: 1, connected: 1, disconnected: 0 }, 'Handoff must leave no disconnected scrollbar containers');
      assert.equal(result.domHosts, 1);
      assert.equal(result.liveRegisteredAfterHandoff, true);
      passed++;
      console.log(`PASS ${name}: early excluded, normal grid retained, handoff leaves 0 disconnected containers`);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${name}: ${error.message}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
if (failures.length) throw new AggregateError(failures, `${failures.length} floating scrollbar handoff scenarios failed`);
console.log(`PASS floating scrollbar handoff: ${passed} native Chromium scenarios`);
