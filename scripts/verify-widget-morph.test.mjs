import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import morphPlugin from '@alpinejs/morph/dist/module.esm.js';

// Real morph reconciliation and the actual directive callback run below.
// These nodes supply only DOM primitives; no attributes are patched by the fixture.
class ElementFixture {
  constructor(tag, attributes = {}, children = []) {
    this.nodeType = 1;
    this.nodeName = this.tagName = tag.toUpperCase();
    this.values = new Map(Object.entries(attributes));
    this.children = children;
    this.nextSibling = null;
    this.innerHTML = '<section>previous content</section>';
    for (let index = 0; index < children.length; index += 1) {
      children[index].nextSibling = children[index + 1] || null;
    }
  }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.firstChild; }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
  get dataset() { return { widgetRenderMode: this.getAttribute('data-widget-render-mode') }; }
  get classList() { return { contains: (name) => (this.getAttribute('class') || '').split(/\s+/).includes(name) }; }
  getAttribute(name) { return this.values.get(name) ?? null; }
  hasAttribute(name) { return this.values.has(name); }
  setAttribute(name, value) { this.values.set(name, String(value)); }
  removeAttribute(name) { this.values.delete(name); }
}

test('widget morph preserves host bindings while updating reused Douban configuration and state attributes', async () => {
  const source = await fs.readFile(new URL('../src/shell/desktop-shell/entry-main.js', import.meta.url), 'utf8');
  const directiveSource = source.slice(source.indexOf("Alpine.directive('widget-content'"), source.indexOf('\n  registerComponents(Alpine);'));
  const previousGlobals = { Element: globalThis.Element, document: globalThis.document, window: globalThis.window };
  globalThis.Element = ElementFixture;
  globalThis.document = { createElement: (name) => new ElementFixture(name) };
  globalThis.window = {};
  try {
    const section = new ElementFixture('section', {
      'data-douban-showcase': '', 'data-douban-type': 'movie', 'data-douban-status': 'all',
      'data-douban-showcase-mounted': 'false', class: 'wg-douban is-error'
    });
    const host = new ElementFixture('div', {
      'x-widget-content': 'renderWidgetBody(widget)',
      'data-widget-render-mode': 'morph',
      'data-widget-appearance': 'light'
    }, [section]);
    const target = new ElementFixture('div', {}, [new ElementFixture('section', {
      'data-douban-showcase': '', 'data-douban-type': 'book', 'data-douban-status': 'done', class: 'wg-douban'
    })]);
    const engine = {};
    morphPlugin(engine);
    let directive;
    const alpine = {
      directive(_name, callback) { directive = callback; },
      // Passing the parsed target isolates HTML parsing; the installed morph
      // engine still performs every comparison and DOM attribute mutation.
      morph(from, _html, options) { engine.morph(from, target, options); }
    };
    vm.runInNewContext(directiveSource, { Alpine: alpine, shouldPreserveHydratedDoubanWidget: () => false });
    directive(host, { expression: 'fixture' }, {
      evaluateLater: () => (receive) => receive('<section data-douban-showcase data-douban-type="book" data-douban-status="done" class="wg-douban"></section>'),
      effect: (run) => run(), cleanup() {}
    });
    assert.equal(host.firstElementChild, section, 'morph should reuse the existing widget section');
    assert.equal(section.getAttribute('data-douban-type'), 'book', 'the next enhancement must read the newly selected type');
    assert.equal(section.getAttribute('data-douban-status'), 'done', 'the next enhancement must read the newly selected status');
    assert.equal(section.getAttribute('class'), 'wg-douban', 'stale error presentation must not survive new markup');
    assert.equal(section.hasAttribute('data-douban-showcase-mounted'), false, 'runtime attributes absent from fresh markup are removed');
    assert.equal(host.getAttribute('x-widget-content'), 'renderWidgetBody(widget)', 'outer Alpine bindings remain attached');
    assert.equal(host.getAttribute('data-widget-render-mode'), 'morph');
    assert.equal(host.getAttribute('data-widget-appearance'), 'light');
  } finally {
    for (const [name, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
