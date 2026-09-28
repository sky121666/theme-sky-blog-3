import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Offline regression checks for the comment-related Thymeleaf condition subset.
// This is not a Thymeleaf renderer: real template compilation remains a reload gate.
// Halo v2.26.1 CommentEnabledVariableProcessor combines the global switch, the
// request's ENABLE_COMMENT_ATTRIBUTE and the enabled CommentWidget extension.
// https://docs.halo.run/developer-guide/theme/plugin-integration.md
const files = {
  post: 'templates/modules/browser-reader/post.html',
  page: 'templates/modules/browser-reader/page.html',
  photo: 'templates/photo.html',
  photoWindow: 'templates/modules/photos-app/window.html',
  moment: 'templates/modules/moments-app/detail.html',
  moments: 'templates/modules/moments-app/list.html',
  links: 'templates/modules/links-app/list.html',
  docs: 'templates/modules/docsme-app/content.html'
};
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parseTemplate(source) {
  const nodes = [];
  const stack = [];
  const markup = source.replace(/<!--[^]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[^]*?(<\/script>)/gi, '$1$2');
  for (const match of markup.matchAll(/<\/?[\w:-]+\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
    const tag = match[0];
    const name = tag.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex((node) => node.name === name);
      if (index >= 0) stack.length = index;
      continue;
    }
    const attrs = {};
    const body = tag.slice(name.length + 1).replace(/\/?\s*>$/, '');
    for (const attr of body.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    const node = { name, attrs, parents: [...stack] };
    nodes.push(node);
    if (!voidTags.has(name) && !/\/\s*>$/.test(tag)) stack.push(node);
  }
  return nodes;
}

const templates = Object.fromEntries(Object.entries(files).map(([name, file]) => (
  [name, parseTemplate(fs.readFileSync(file, 'utf8'))]
)));
const find = (name, predicate) => {
  const node = templates[name].find(predicate);
  assert.ok(node, `${files[name]}: expected comment-related element`);
  return node;
};
const byClass = (name) => (node) => (node.attrs.class || '').split(/\s+/).includes(name);
const dynamicAttributes = (node) => [...(node.attrs['th:attr'] || '').matchAll(/([\w:-]+)=\$\{([^}]+)\}/g)];

function evaluate(expression, context) {
  const body = expression.replace(/^\$\{|\}$/g, '').replace(/\band\b/g, '&&').replace(/\bor\b/g, '||');
  return vm.runInNewContext(`(${body})`, context);
}

function contextFor(node, state) {
  const context = {
    haloCommentEnabled: state.halo,
    pluginFinder: { available: (id) => {
      assert.equal(id, 'PluginCommentWidget');
      return state.official;
    } },
    commentCount: 3,
    upvoteCount: 5,
    momentName: 'moment-fixture',
    momentDetailUrl: '/moments/moment-fixture',
    post: { metadata: { name: 'post-fixture' } },
    singlePage: { metadata: { name: 'page-fixture' } },
    photo: { metadata: { name: 'photo-fixture' } },
    docTree: { metadata: { name: 'doc-fixture' } },
    pluginName: 'PluginLinks'
  };
  for (const ancestor of [...node.parents, node]) {
    for (const attribute of ['th:if', 'th:unless']) {
      const condition = ancestor.attrs[attribute];
      if (!condition || !/haloCommentEnabled|officialComments|PluginCommentWidget/.test(condition)) continue;
      const enabled = Boolean(evaluate(condition, context));
      if (attribute === 'th:if' ? !enabled : enabled) return null;
    }
    const binding = ancestor.attrs['th:with']?.match(/officialComments=\$\{([^}]+)\}/);
    if (binding) context.officialComments = evaluate(binding[1], context);
  }
  return context;
}

function attributesFor(node, state) {
  const context = contextFor(node, state);
  if (!context) return null;
  const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([name]) => !name.startsWith('th:')));
  for (const [, name, expression] of dynamicAttributes(node)) {
    const value = evaluate(expression, context);
    if (value == null) delete attrs[name];
    else attrs[name] = String(value);
  }
  if (node.attrs['th:style']) {
    const style = evaluate(node.attrs['th:style'], context);
    if (style == null) delete attrs.style;
    else attrs.style = style;
  }
  if (node.attrs['th:hidden']) {
    if (evaluate(node.attrs['th:hidden'], context)) attrs.hidden = '';
    else delete attrs.hidden;
  }
  return attrs;
}

const subjects = {
  post: ['content.halo.run', 'Post', 'post-fixture'],
  page: ['content.halo.run', 'SinglePage', 'page-fixture'],
  photo: ['core.halo.run', 'Photo', 'photo-fixture'],
  moment: ['moment.halo.run', 'Moment', 'moment-fixture'],
  links: ['plugin.halo.run', 'Plugin', 'PluginLinks'],
  docs: ['doc.halo.run', 'DocTree', 'doc-fixture']
};
const states = [
  { name: 'official-enabled', halo: true, official: true },
  { name: 'alternative-enabled', halo: true, official: false },
  { name: 'disabled-with-official', halo: false, official: true },
  { name: 'no-widget', halo: false, official: false },
  { name: 'missing-combined-variable', halo: undefined, official: true }
];
let subjectChecks = 0;
for (const [name, subject] of Object.entries(subjects)) {
  const nodes = templates[name].filter((node) => node.name === 'halo:comment');
  assert.equal(nodes.length, 1, `${name}: one comment subject`);
  for (const state of states) {
    const attrs = attributesFor(nodes[0], state);
    assert.equal(Boolean(attrs), Boolean(state.halo), `${name}/${state.name}: combined condition controls comments`);
    if (attrs) assert.deepEqual([attrs.group, attrs.kind, attrs.name], subject, `${name}: correct comment identity`);
    subjectChecks += 1;
  }
}

const entries = [
  find('post', (node) => node.attrs.href === '#post-comments'),
  find('photoWindow', (node) => 'data-photos-detail-comments-btn' in node.attrs),
  find('links', (node) => node.attrs.id === 'nav-board')
];
for (const node of entries) {
  for (const state of states) assert.equal(Boolean(attributesFor(node, state)), Boolean(state.halo), `${state.name}: no dead comment entry`);
}

for (const name of ['post', 'page']) {
  const section = find(name, (node) => node.attrs.id === 'post-comments');
  const shell = find(name, byClass('post-comments-shell'));
  const official = states[0];
  const alternative = states[1];
  assert.equal(attributesFor(section, official)['data-lazy-comment'], 'true');
  assert.equal(attributesFor(shell, official)['data-comment-hidden'], 'true');
  assert.equal(attributesFor(shell, official).style, 'display:none;');
  assert.equal('data-lazy-comment' in attributesFor(section, alternative), false);
  assert.equal('data-comment-hidden' in attributesFor(shell, alternative), false);
  assert.equal('style' in attributesFor(shell, alternative), false, `${name}: alternative widget is visible without theme lazy activation`);
}

const momentShell = find('moment', byClass('moment-comments-shell'));
assert.equal('hidden' in attributesFor(momentShell, states[0]), true, 'official fallback remains hidden initially');
assert.equal('hidden' in attributesFor(momentShell, states[1]), false, 'alternative moment widget is directly visible');
assert.equal('style' in attributesFor(momentShell, states[1]), false);
assert.equal('data-moment-official-comments' in attributesFor(momentShell, states[1]), false);

const interactionsSource = fs.readFileSync('src/apps/moments/interactions.js', 'utf8');
let momentsChecks = 0;
for (const name of ['moment', 'moments']) {
  const cardNode = find(name, (node) => node.attrs['th:attr']?.includes('data-moment-card='));
  const formNode = find(name, (node) => 'data-moment-comment-form' in node.attrs);
  const toggleNode = find(name, (node) => 'data-moment-comments-toggle' in node.attrs);
  const upvoteNode = find(name, (node) => 'data-moment-upvote' in node.attrs);
  for (const state of states) {
    const official = Boolean(state.halo && state.official);
    const attrs = attributesFor(cardNode, state);
    assert.ok(attributesFor(upvoteNode, state), `${name}/${state.name}: comment state must preserve likes`);
    assert.equal(Boolean(attributesFor(formNode, state)), official, `${name}: composer is an official-widget enhancement`);
    assert.equal(Boolean(attributesFor(toggleNode, state)), official);
    assert.equal(attrs['data-comment-count'], official ? '3' : '0', `${name}: avoid native automatic comment requests`);
    const requests = [];
    const context = vm.createContext({
      URL, AbortController, Element: class Element {},
      window: { location: { origin: 'https://comments.test', hash: '' } },
      fetch: async (url) => {
        requests.push(String(url));
        return { ok: true, status: 200, json: async () => ({ items: [], page: 1, total: 0, hasNext: false }) };
      }
    });
    // Keep actual initialization, state, queue and HTTP request logic; visual DOM
    // rendering is outside this offline fixture and is replaced by no-op sinks.
    vm.runInContext(`${interactionsSource.replace('export function setupMomentInteractions', 'function setupMomentInteractions')}
      renderCard = () => {};
      renderComments = () => {};
      focusCommentsFromHash = () => {};
      globalThis.commentTest = { initCards, getState };
    `, context);
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => (
      [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]
    )));
    const card = {
      dataset, isConnected: true,
      hasAttribute: (key) => key in attrs,
      querySelector: () => null,
      matches: (selector) => selector === '[data-moment-card]'
    };
    context.commentTest.initCards({ matches: () => false, querySelectorAll: () => [card] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, official ? 1 : 0, `${name}/${state.name}: actual init must not query disabled/alternative comments`);
    for (const request of requests) {
      const url = new URL(request);
      assert.equal(url.pathname, '/apis/api.halo.run/v1alpha1/comments');
      assert.equal(url.searchParams.get('group'), 'moment.halo.run');
      assert.equal(url.searchParams.get('kind'), 'Moment');
      assert.equal(url.searchParams.get('name'), 'moment-fixture');
    }
    momentsChecks += 1;
  }
}
const alternativeMomentEntry = find('moments', (node) => node.name === 'a' && node.attrs['th:if'] === '${haloCommentEnabled and !officialComments}');
assert.ok(attributesFor(alternativeMomentEntry, states[1]), 'alternative widget retains a real detail entry');
assert.equal(attributesFor(alternativeMomentEntry, states[0]), null);
assert.equal(attributesFor(alternativeMomentEntry, states[2]), null);

const observers = [];
const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
class Observer {
  constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnects = 0; observers.push(this); }
  observe(section) { this.targets.add(section); }
  unobserve(section) { this.targets.delete(section); }
  disconnect() { this.disconnects += 1; this.targets.clear(); }
  trigger(section) { this.callback([{ target: section, isIntersecting: true }]); }
}
function lazySection() {
  const hidden = { present: true, style: { display: 'none' }, removeAttribute() { this.present = false; } };
  return {
    isConnected: true, hidden,
    querySelectorAll: () => [],
    matches: () => true,
    querySelector: (selector) => selector === '[data-comment-hidden]' && hidden.present ? hidden : null
  };
}
try {
  globalThis.IntersectionObserver = Observer;
  const { initLazyComments, disposeLazyComments } = await import(`${pathToFileURL(path.resolve('src/shell/desktop-shell/runtime/shared/lazy-comment.js')).href}?comment-integration`);
  const old = lazySection();
  const current = lazySection();
  initLazyComments(old);
  initLazyComments(old);
  assert.equal(observers.length, 1, 'repeat init keeps one observer');
  disposeLazyComments(old);
  initLazyComments(current);
  observers[0].trigger(old);
  assert.equal(old.hidden.present, true, 'queued callback must not reveal a disposed section');
  assert.equal(observers[1].targets.has(current), true, 'old callback must not change the new observer');
  observers[1].trigger(current);
  assert.equal(current.hidden.style.display, '');
  assert.equal(observers[1].disconnects, 1);

  const disconnected = lazySection();
  initLazyComments(disconnected);
  disconnected.isConnected = false;
  observers[2].trigger(disconnected);
  assert.equal(disconnected.hidden.present, true, 'detached section is never activated');
  assert.equal(observers[2].disconnects, 1);

  globalThis.IntersectionObserver = undefined;
  const fallback = lazySection();
  initLazyComments(fallback);
  assert.equal(fallback.hidden.present, false, 'no observer support reveals official comments immediately');
} finally {
  if (originalObserver) Object.defineProperty(globalThis, 'IntersectionObserver', originalObserver);
  else delete globalThis.IntersectionObserver;
}

console.log(`comment integration passed: ${subjectChecks} subject states, ${momentsChecks} actual Moments initialization states, entries, provider visibility and lazy lifecycle`);
