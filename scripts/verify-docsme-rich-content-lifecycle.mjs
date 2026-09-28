import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/apps/docsme/runtime.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../templates/modules/docsme-app/content.html', import.meta.url), 'utf8');
const checks = [];
function harness() {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const warnings = [];
  const scripts = [];
  const createScript = () => ({ dataset: {}, handlers: new Map(),
    addEventListener(type, cb) { this.handlers.set(type, cb); },
    removeEventListener(type) { this.handlers.delete(type); },
    load() { this.handlers.get('load')?.(); }, error() { this.handlers.get('error')?.(); },
    remove() { const index = scripts.indexOf(this); if (index >= 0) scripts.splice(index, 1); }
  });
  const doc = { body: { dataset: { debug: 'true' } }, documentElement: { dataset: { theme: 'light' } },
    querySelectorAll: (selector) => selector === 'script[src]' ? scripts : [], createElement: createScript,
    head: { appendChild: (script) => scripts.push(script) } };
  const win = { setTimeout(cb, ms) { const id = ++timerId; timers.set(id, { at: now + ms, cb }); return id; },
    clearTimeout: (id) => timers.delete(id), getComputedStyle: (node) => ({ visibility: node.visibility || 'visible' }),
    location: { origin: 'https://example.test' } };
  const context = vm.createContext({ window: win, document: doc, AbortController, URL,
    console: { warn: (...args) => warnings.push(args) } });
  const api = vm.runInContext(source.replace(/\bexport /g, '') + '\n({ renderDocsmeRichContent, renderMermaidNodes, hasUsableMermaidSvg, waitForDocsmeLayout, disposeDocsmeEnhancements, cancelDocsmeRichContent, bindDocsmeSearch, loadPluginRuntime })', context);
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].cb(); await flush();
    }
    now = end; await flush();
  };
  return { api, doc, win, scripts, timers, warnings, flush, advance, createScript };
}
function diagram(id, source = `flowchart LR;${id}-->Z`) {
  const attrs = new Map([['data-content', source]]);
  const classes = new Set();
  let text = source;
  return { id, dataset: {}, isConnected: true, direct: true, svg: false, errorSvg: false,
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v) },
    get textContent() { return text; }, set textContent(v) { text = v; this.svg = false; this.errorSvg = false; },
    getAttribute: (key) => attrs.get(key) ?? null, hasAttribute: (key) => attrs.has(key),
    setAttribute(key, value) { attrs.set(key, value); }, removeAttribute: (key) => attrs.delete(key),
    querySelector(selector) {
      if (selector === 'svg' || selector === ':scope > svg') {
        return this.svg && (selector === 'svg' || this.direct)
          ? { querySelector: () => this.errorSvg ? {} : null } : null;
      }
      return null;
    }
  };
}
function app(h, nodes) {
  return { nodes, dataset: {}, ownerDocument: h.doc, isConnected: true, visible: true,
    getBoundingClientRect() { return this.visible ? { width: 800, height: 500 } : { width: 0, height: 0 }; },
    closest: () => null,
    querySelectorAll(selector) { return selector.includes('text-diagram') ? this.nodes : []; },
    querySelector(selector) { return selector.includes('text-diagram') ? this.nodes[0] : null; }
  };
}
function renderer(calls, fail = '') {
  return { initialize() { calls.push('initialize'); }, async run({ nodes }) {
    assert.equal(nodes.length, 1, '每次调用只归属一个图表');
    const node = nodes[0]; calls.push(node.id); node.svg = true;
    if (node.id === fail) { node.errorSvg = true; throw new Error('fixture geometry error'); }
  } };
}
{
  const h = harness(), good = diagram('A'), bad = diagram('B'), later = diagram('C');
  const root = app(h, [good, bad, later]), calls = [];
  const result = await h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls, 'B'), allowResourceLoad: false });
  assert.deepEqual(calls, ['initialize', 'A', 'B', 'C']);
  assert.equal(result.mermaid.rendered, 2); assert.equal(result.mermaid.failed, 1);
  assert.equal(bad.dataset.docsmeMermaidState, 'error'); assert.equal(bad.svg, false);
  assert.equal(bad.textContent, bad.getAttribute('data-content'));
  assert.equal(bad.classList.contains('docsme-rich-content-fallback'), true);
  checks.push('多图中的抛错/残留错误 SVG 只归属失败图；后续图仍渲染并保留源文降级');
}
{
  const h = harness(), node = diagram('A'); node.svg = true; node.errorSvg = true;
  const calls = [], root = app(h, [node]);
  const result = await h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls), allowResourceLoad: false });
  assert.equal(result.mermaid.preRendered, 0); assert.equal(result.mermaid.rendered, 1);
  assert.deepEqual(calls, ['initialize', 'A']);
  const next = await h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls), allowResourceLoad: false });
  assert.equal(next.mermaid.preRendered, 1); assert.equal(calls.length, 2, '有效图保持幂等');
  node.direct = false;
  assert.equal(h.api.hasUsableMermaidSvg(node), false, '库的临时容器 SVG 不算完成');
  checks.push('原有错误 SVG 必须重绘；有效图保持幂等，临时 SVG 不冒充完成');
}
{
  const h = harness(), node = diagram('A'), calls = [];
  const result = await h.api.renderDocsmeRichContent(app(h, [node]), { mermaid: {
    initialize() {}, async run() { node.svg = true; throw new Error('reject with plausible residual SVG'); }
  }, allowResourceLoad: false });
  assert.equal(result.mermaid.rendered, 0); assert.equal(result.mermaid.failed, 1); assert.equal(node.svg, false);
  checks.push('run 拒绝后即使残留普通 SVG 也绝不计成功');
}
{
  const h = harness(), node = diagram('A'), calls = [], root = app(h, [node]); root.visible = false;
  const options = { mermaid: renderer(calls), allowResourceLoad: false };
  const first = h.api.renderDocsmeRichContent(root, options), duplicate = h.api.renderDocsmeRichContent(root, options);
  assert.equal(first, duplicate); await h.advance(96); assert.deepEqual(calls, []);
  root.visible = true; await h.advance(32); const result = await first;
  assert.equal(result.mermaid.rendered, 1); assert.equal(h.timers.size, 0);
  checks.push('隐藏时零初始化/渲染，显示后恰好一次；重复请求共享等待且清理计时器');
}
{
  const h = harness(), root = app(h, [diagram('A')]), calls = []; root.visible = false;
  const pending = h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls), allowResourceLoad: false });
  h.api.disposeDocsmeEnhancements(root);
  assert.equal(await pending, null); await h.advance(3000);
  assert.equal(h.timers.size, 0); assert.deepEqual(calls, []);
  assert.equal(await h.api.renderDocsmeRichContent(root), null, '迟到调用不能复活已销毁实例');
  checks.push('销毁立即取消可见性等待；无计时器/渲染残留且不复活');
}
{
  const h = harness(), root = app(h, [diagram('A')]), calls = []; root.visible = false;
  const pending = h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls), allowResourceLoad: false });
  root._docsmeRichContentSuspended = true; h.api.cancelDocsmeRichContent(root);
  assert.equal(await pending, null); root.visible = true;
  assert.equal(await h.api.renderDocsmeRichContent(root), null);
  root._docsmeRichContentSuspended = false;
  assert.equal((await h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls), allowResourceLoad: false })).mermaid.rendered, 1);
  assert.equal(h.timers.size, 0);
  checks.push('导航取消等待；失败返回后新代次可重新渲染');
}
{
  const h = harness(), node = diagram('A'), root = app(h, [node]), calls = []; root.visible = false;
  const pending = h.api.renderDocsmeRichContent(root, { mermaid: renderer(calls), allowResourceLoad: false });
  const rejected = assert.rejects(pending, /等待显示超时/);
  await h.advance(2000); await rejected;
  assert.equal(h.timers.size, 0); assert.deepEqual(calls, []);
  assert.equal(node.dataset.docsmeMermaidState, 'layout-timeout');
  assert.equal(node.classList.contains('docsme-rich-content-fallback'), true);
  checks.push('2 秒截止保留明确失败与源文，不吞超时或无限轮询');
}
{
  const h = harness(), first = app(h, [diagram('A')]), second = app(h, [diagram('B')]);
  const a = h.api.renderDocsmeRichContent(first), b = h.api.renderDocsmeRichContent(second);
  await h.flush(); assert.equal(h.scripts.length, 1, '同一个 Mermaid 资源请求复用');
  h.api.disposeDocsmeEnhancements(first);
  const calls = []; h.win.mermaid = renderer(calls); h.scripts[0].load();
  assert.equal(await a, null); assert.equal((await b).mermaid.rendered, 1);
  assert.deepEqual(calls, ['initialize', 'B']); assert.equal(h.timers.size, 0);
  checks.push('共享资源加载去重；等待资源期间销毁不会恢复旧页渲染');
}
{
  const h = harness(), existing = h.createScript();
  existing.src = 'https://example.test/plugins/text-diagram/assets/static/mermaid.min.js'; h.scripts.push(existing);
  const root = app(h, [diagram('A')]);
  const pending = h.api.renderDocsmeRichContent(root); await h.flush();
  assert.equal(h.scripts.length, 1); assert.equal(existing.handlers.size, 2);
  const calls = []; h.win.mermaid = renderer(calls); existing.load();
  assert.equal((await pending).mermaid.rendered, 1); assert.equal(existing.handlers.size, 0); assert.equal(h.timers.size, 0);
  checks.push('已有同 URL pending 插件脚本复用 load/error，不插入第二份');
}
{
  const h = harness(), src = 'https://example.test/plugins/text-diagram/assets/static/mermaid.min.js';
  const pending = h.api.loadPluginRuntime('mermaid', src, () => false);
  const rejected = assert.rejects(pending, /资源加载超时/); await h.advance(6000); await rejected;
  assert.equal(h.scripts.length, 1); assert.equal(h.scripts[0].handlers.size, 0); assert.equal(h.timers.size, 0);
  const again = h.api.loadPluginRuntime('mermaid', src, () => false);
  const secondRejected = assert.rejects(again, /资源加载失败/);
  assert.equal(h.scripts.length, 1, '超时重试复用尚在加载的脚本'); h.scripts[0].error(); await secondRejected;
  assert.equal(h.timers.size, 0); assert.equal(h.scripts.length, 0, '复用的主题自有脚本确定 error 后也可移除');
  let ready = false;
  const third = h.api.loadPluginRuntime('mermaid', src, () => ready);
  assert.equal(h.scripts.length, 1, '确定失败后允许创建一份新脚本重试'); ready = true; h.scripts[0].load(); await third;
  assert.equal(h.timers.size, 0); assert.equal(h.scripts[0].handlers.size, 0);
  checks.push('超时→复用→网络错误→重试有界且清理自有 tag/监听/计时器');
}
{
  const h = harness(), listeners = new Map(), opened = [];
  const button = { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name) => listeners.delete(name) };
  const root = app(h, []); root.querySelector = (selector) => selector === '#btn-search' ? button : null;
  root.dataset = { docsmeSearchEnabled: 'true', docsmeProject: 'project-a', docsmeVersion: 'v1', docsmeLanguage: 'zh' };
  h.win.SearchWidget = { open: (options) => opened.push(options) };
  h.api.bindDocsmeSearch(root); h.api.bindDocsmeSearch(root); assert.equal(listeners.size, 1);
  listeners.get('click')(); assert.deepEqual(Array.from(opened[0].includeCategoryNames), ['project:project-a', 'version:v1', 'language:zh']);
  h.api.disposeDocsmeEnhancements(root); assert.equal(listeners.size, 0);
  const next = app(h, []); next.querySelector = (selector) => selector === '#btn-search' ? button : null;
  next.dataset = { docsmeSearchEnabled: 'true', docsmeProject: 'project-b', docsmeVersion: 'v2', docsmeLanguage: '' };
  h.api.bindDocsmeSearch(next); listeners.get('click')();
  assert.deepEqual(Array.from(opened[1].includeCategoryNames), ['project:project-b', 'version:v2'], 'PJAX 新 root 使用新范围且排除空值');
  h.api.disposeDocsmeEnhancements(next); assert.equal(listeners.size, 0);
  checks.push('官方 SearchWidget project/version/language 过滤保持且监听可清理');
}
{
  const h = harness(), root = app(h, [diagram('continuation-first')]);
  const trace = [];
  let active = 0, maxConcurrent = 0;
  const options = { allowResourceLoad: false, mermaid: { initialize() {}, async run({ nodes }) {
    trace.push(Array.from(nodes, (node) => node.id));
    active += 1; maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise((resolve) => h.win.setTimeout(resolve, 25));
    nodes.forEach((node) => { node.svg = true; });
    active -= 1;
  } } };
  const first = h.api.renderDocsmeRichContent(root, options);
  const earlierContinuation = first.then(() => {
    root.nodes.push(diagram('continuation-final'));
    return h.api.renderDocsmeRichContent(root, options);
  });
  root.nodes.push(diagram('continuation-queued'));
  const queued = h.api.renderDocsmeRichContent(root, options);
  await h.flush(); await h.advance(200); await Promise.all([queued, earlierContinuation]);
  assert.deepEqual(trace, [['continuation-first'], ['continuation-queued'], ['continuation-final']]);
  assert.equal(maxConcurrent, 1); assert.equal(root.nodes.every((node) => h.api.hasUsableMermaidSvg(node)), true);
  assert.equal(h.timers.size, 0);

  // Execute the live verifier's actual gate, not a copied equivalent.
  const verifier = fs.readFileSync(new URL('./verify-docsme.mjs', import.meta.url), 'utf8');
  const gateSource = verifier.slice(verifier.indexOf('    const continuationRace = result.continuationRace;'), verifier.indexOf('    if (!result.thrownFallback'));
  assert.ok(gateSource.includes('continuationExpectedIds'), 'the live gate must be extracted');
  const gate = vm.runInNewContext(`(result) => { const checkFailures = []; ${gateSource}; return checkFailures; }`);
  const valid = { runs: trace.length, nodeIdTrace: trace, maxConcurrent, svgCounts: [1, 1, 1] };
  assert.equal(gate({ continuationRace: valid }).length, 0);
  for (const invalid of [
    { ...valid, nodeIdTrace: [['continuation-first'], ['continuation-first'], ['continuation-final']] },
    { ...valid, nodeIdTrace: [['continuation-first', 'continuation-queued'], ['continuation-final'], []] },
    { ...valid, nodeIdTrace: undefined },
    { ...valid, runs: 2 },
    { ...valid, maxConcurrent: 2 },
    { ...valid, svgCounts: [1, 2, 1] }
  ]) assert.equal(gate({ continuationRace: invalid }).length, 1, 'missing/duplicate/batched/concurrent/incomplete evidence must fail');
  checks.push('真实队列 continuation 三节点各一次且并发为1；live gate拒绝重复/缺失/批次/并发/重复SVG反例');
}
assert.equal(template.includes('plugin:plugin-docsme:modules/plugin-scripts'), false, '不能再引入独立 DCL renderer');
assert.equal((template.match(/modules\/docsme-app\/content :: pluginResources/g) || []).length, 2);
assert.match(template, /pluginFinder\.available\('plugin-katex'\).*docTree\.spec\.type == 'DOC'/);
assert.match(template, /href="\/plugins\/plugin-katex\/assets\/static\/katex\.min\.css"/);
checks.push('两处官方片段替换保留 DOC KaTeX 样式条件，去掉独立 DCL renderer');
console.log(`docsme rich-content lifecycle passed: ${checks.length} cases`);
checks.forEach((check) => console.log(`- ${check}`));
