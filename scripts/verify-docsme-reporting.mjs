import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createDocsmeNavigationDiagnostics } from './lib/docsme-navigation-diagnostics.mjs';
import { inspectDocsCandidates, normalizeDocsPath, DOCSME_INSPECTION_LIMIT } from './lib/docsme-sample-discovery.mjs';

const timeout = new Error('page.goto: Timeout 20000ms exceeded');
const page = new EventEmitter();
page.url = () => 'https://example.test/docs/project?private=value';
page.mainFrame = () => null;
page.evaluate = async () => ({ readyState: 'interactive', navigationTiming: { domContentLoadedEventStart: 0 } });
let gotoCalls = 0;
page.goto = async (_url, options) => { gotoCalls++; assert.equal(options.timeout, 20000); throw timeout; };
const observer = createDocsmeNavigationDiagnostics(page, { snapshotTimeoutMs: 5 });
const request = { url: () => 'https://example.test/plugins/example/panel.js?token=private', method: () => 'GET', resourceType: () => 'script', failure: () => null };
page.emit('request', request);
page.emit('response', { request: () => request, url: request.url, status: () => 200,
  headers: () => ({ 'content-type': 'text/javascript', 'content-length': '123', 'set-cookie': 'private' }) });
await assert.rejects(observer.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 20000 }), (error) => error === timeout);
assert.equal(gotoCalls, 1, '诊断不能重试或放宽原导航');
assert.equal(observer.failures[0].diagnostic.pendingRequests[0].status, 200, '收到 headers 但未完成的脚本必须保留');
assert.deepEqual(observer.failures[0].diagnostic.pendingRequests[0].headers, { 'content-type': 'text/javascript', 'content-length': '123' });
assert.equal(observer.failures[0].diagnostic.documentState.readyState, 'interactive');
assert.equal(observer.failures[0].diagnostic.events.some((event) => event.event === 'domcontentloaded'), false);
assert.equal(JSON.stringify(observer.failures).includes('token=private'), false, '被动 URL 诊断必须去除查询凭据');
page.emit('requestfinished', request);
assert.equal((await observer.snapshot()).pendingCount, 0);
page.evaluate = () => new Promise(() => {});
assert.equal((await observer.snapshot()).documentState.evaluationTimedOut, true, 'DOM 诊断本身也必须有界');
observer.stop();
assert.equal(page.eventNames().length, 0, '诊断结束必须移除监听器');

const source = fs.readFileSync(new URL('./verify-docsme.mjs', import.meta.url), 'utf8');
const mainSource = source.slice(source.indexOf('async function main()'), source.indexOf('\nmain().catch'));
const baseUrl = 'https://example.test';
const discovery = { documents: ['/docs/project/a', '/docs/project/b', '/docs/project/c'], catalogs: [], visited: ['/docs'], remaining: [], responses: [], navigationErrors: [], limit: 30 };
const richResult = {
  preRenderedUntouched: true, authorTitlePreserved: true,
  tocHistory: { state: { uid: 'pjax-state', scrollPos: [12, 34] }, hash: '#history-contract' },
  katexCalls: [{ displayMode: false }, { displayMode: true }], mermaidRuns: 2,
  lightSnapshot: { svgCount: 1, renderedTheme: 'default' }, darkSnapshot: { svgCount: 1, renderedTheme: 'dark' },
  sharedJob: true, dedupeRuns: 1, dedupeSvgCount: 1,
  changedDuringJob: { promisesDiffer: true, runs: 2, firstSvgCount: 1, lateSvgCount: 1 },
  continuationRace: { maxConcurrent: 1, runs: 3, nodeIdTrace: [['continuation-first'], ['continuation-queued'], ['continuation-final']], svgCounts: [1, 1, 1] },
  thrownFallback: { katex: true, mermaid: true }, unavailableFallback: { katex: true, mermaid: true },
  unavailable: { katex: { pending: 0 }, mermaid: { pending: 0 } },
  actualPluginRuntime: { katexVersion: 'fixture', mermaidAvailable: true,
    runtimeSources: ['/plugins/plugin-katex/assets/static/katex.min.js?version=3.0.0', '/plugins/text-diagram/assets/static/mermaid.min.js?version=1.5.2'],
    first: { katex: { rendered: 2 } }, light: { katex: 2, math: 2, svg: 1, mermaidTheme: 'default' }, dark: { svg: 1, mermaidTheme: 'dark' } }
};

async function verifyMainFailure({ environmentFailure = false, browserClosed = false } = {}) {
  const saved = [];
  const visits = [];
  let closed = false;
  const runtime = { snapshot: () => ({ responseErrors: [{ url: `${baseUrl}/docs/123`, status: 404 }] }), stop() {} };
  const diagnostics = { attempts: [], failures: [], snapshot: async () => ({ documentState: { readyState: 'interactive' } }), stop() {} };
  const fakePage = { isClosed: () => browserClosed };
  const browser = { newContext: async () => ({ newPage: async () => fakePage }), isConnected: () => !browserClosed, close: async () => { closed = true; } };
  const currentBuild = { build: { revision: 'current-build' }, sourceFingerprint: 'current-source' };
  const processState = { pid: 1, exitCode: 0 };
  const context = vm.createContext({
    Date, Set, Array, Object, String, baseUrl, process: processState,
    fixtureOnly: false, explicitDocPath: '', explicitCodePath: '', explicitKatexPath: '', explicitMermaidPath: '',
    DOCSME_INSPECTION_LIMIT, inspectDocsCandidates, normalizeDocsPath,
    readLiveBuildContext: async () => { if (environmentFailure) throw new Error('environment unavailable'); return currentBuild; },
    chromium: { launch: async () => browser }, installReadOnlyGuard: async () => {},
    collectBrowserRuntimeErrors: () => runtime, navigationObserver: () => diagnostics,
    navigationObservers: new Map([[fakePage, diagnostics]]),
    writeReport: async (report) => { saved.push(structuredClone(report)); return '/memory/current-report.json'; },
    inspectRichContentRuntime: async () => richResult,
    runtimeErrorMessages: (result) => (result.responseErrors || []).map((error) => `response: ${error.url} (HTTP ${error.status})`),
    inspectDocsPage: async (_page, pathname) => {
      visits.push(pathname);
      if (pathname === '/docs/project/b') throw timeout;
      return { scene: pathname === '/docs' ? 'projects' : 'document', projectCards: 1,
        projectCardHover: { active: true, transform: 'none', glowFilter: 'none', verticalShift: 0 },
        templateId: 'doc', metaDescription: 'fixture', articleTextLength: 1, switchers: 0,
        shikiCode: 0, rawPreCode: 0, katexSource: 0, mermaidSource: 0 };
    },
    collectDocsLinks: async () => structuredClone(discovery),
    chooseSample: (paths, inspections, predicate) => paths.find((pathname) => predicate(inspections.get(pathname))),
    missingDocsSampleReason: () => 'bounded fixture sample',
    assertDocsProtocol: () => [], diagnosticsForCheck: () => ({}),
    skippedCheck: (name, reason) => ({ name, reason, status: 'skipped' }), printCheckHints() {},
    console: { log() {}, error() {} }
  });
  await vm.runInContext(mainSource + '\nmain()', context);
  const report = saved.at(-1);
  assert.equal(saved[0].status, 'running', '任何首次环境/浏览器调用之前必须覆盖旧报告');
  assert.equal(saved[0].buildContext, null, '初始状态不得携带旧构建');
  assert.equal(report.status, 'failed');
  assert.ok(report.startAt && report.finishedAt && report.runId);
  assert.equal(processState.exitCode, 1, '真实失败不得变为成功退出');
  if (environmentFailure) {
    assert.equal(report.buildContext, null);
    assert.equal(report.fatalError.phase, 'environment');
  } else {
    assert.equal(closed, true);
    assert.deepEqual(report.buildContext, currentBuild);
    assert.deepEqual(report.discovery, discovery, '扫描异常之前已完成的发现范围必须保留');
    assert.equal(report.checks.find((check) => check.name === 'rich-content-runtime').status, 'passed');
    assert.equal(report.checks.find((check) => check.name === 'projects').status, 'passed');
    assert.ok(report.failures.some((message) => message.includes('HTTP 404')), '123 的 404 不得豁免');
    assert.equal(report.sampleScan.failed[0].path, '/docs/project/b');
    if (browserClosed) {
      assert.equal(report.fatalError.phase, 'sample-scan');
      assert.deepEqual(report.sampleScan.inspected, ['/docs/project/a']);
      assert.deepEqual(report.sampleScan.remaining, ['/docs/project/c']);
    } else {
      assert.deepEqual(visits, ['/docs', '/docs/project/a', '/docs/project/b', '/docs/project/c'], '可用浏览器应继续独立候选，不能重试失败候选');
      assert.deepEqual(report.sampleScan.inspected, ['/docs/project/a', '/docs/project/c']);
      assert.equal(report.sampleScan.complete, true);
      assert.equal(report.fatalError, undefined);
    }
  }
}

await verifyMainFailure();
await verifyMainFailure({ browserClosed: true });
await verifyMainFailure({ environmentFailure: true });
console.log('Docsme failure-report fixtures passed: current run, fatal/finally, bounded navigation diagnostics, partial scan, HTTP errors');
