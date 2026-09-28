import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';

const source = fs.readFileSync(new URL('./lib/live-build-context.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');

function fixture() {
  const files = new Map(Object.entries({
    'src/index.js': 'export const app = 1;',
    'templates/layout.html': '<main>fixture</main>',
    'theme.yaml': 'version: 1', 'settings.yaml': '[]', 'package.json': '{}',
    'pnpm-lock.yaml': '{}', 'pnpm-workspace.yaml': '{}', 'vite.config.ts': '// fixture', 'tsconfig.json': '{}',
    'annotation-setting.yaml': '[]',
    'templates/assets/js/shell-core/index.js': 'export const shell = 1;',
    'templates/assets/css/shell-core/index.css': 'body{color:black}',
    '.env.local': 'HALO_BASE_URL=https://example.test\nFIVEEE_PAT=fixture-only-secret'
  }));
  const hash = crypto.createHash('sha256');
  for (const name of [...files.keys()].filter((name) => !name.startsWith('templates/assets/')
    && !['annotation-setting.yaml', '.env.local'].includes(name)).sort((a, b) => a.localeCompare(b))) {
    hash.update(name).update('\0').update(files.get(name)).update('\0');
  }
  const revision = hash.digest('hex').slice(0, 12);
  const assets = '/themes/theme-sky-blog-3/assets/';
  const manifest = {
    __meta: { version: '1', revision, query: `v=1&r=${revision}` },
    'shell-core': { js: [`${assets}js/shell-core/index.js`], css: [`${assets}css/shell-core/index.css`] }
  };
  files.set('templates/assets/asset-manifest.json', JSON.stringify(manifest));
  const requests = [];
  const scenario = { badAsset: false, truncated: false };
  const missing = () => Object.assign(new Error('missing fixture file'), { code: 'ENOENT' });
  const context = vm.createContext({
    assert, path, crypto, URL, AbortSignal, Date, Map, JSON,
    process: { cwd: () => '/fixture', env: {} },
    fs: {
      readFile: async (name) => { const key = path.relative('/fixture', name); if (!files.has(key)) throw missing(); return files.get(key); },
      readdir: async (name) => {
        const prefix = path.relative('/fixture', name) + '/';
        const children = [...new Set([...files.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length).split('/')[0]))];
        if (!children.length) throw missing();
        return children.map((child) => ({ name: child, isFile: () => files.has(prefix + child), isDirectory: () => !files.has(prefix + child) }));
      }
    },
    fetch: async (url, options) => {
      requests.push({ url: url.href, options });
      let value;
      if (url.pathname === '/') value = `<script src="${assets}js/shell-core/index.js"></script>`;
      else if (url.pathname === '/actuator/info') value = { build: { version: '2.26.1' } };
      else if (url.pathname.startsWith('/apis/')) value = { items: [{ metadata: { name: 'PluginFixture' }, spec: { version: '1.2.3', enabled: true }, status: { phase: 'STARTED' } }], total: scenario.truncated ? 2 : 1, hasNext: scenario.truncated };
      else if (url.pathname.endsWith('asset-manifest.json')) value = manifest;
      else {
        const key = `templates/assets/${url.pathname.slice(url.pathname.indexOf('/assets/') + 8)}`;
        value = scenario.badAsset ? 'wrong served bytes' : files.get(key);
      }
      return { ok: true, status: 200, json: async () => value, text: async () => value };
    }
  });
  vm.runInContext(source, context);
  return { files, requests, scenario, run: (base = 'https://example.test') => context.readLiveBuildContext(base) };
}

const good = fixture();
const result = await good.run();
assert.equal(result.halo, '2.26.1');
assert.equal(result.plugins[0].version, '1.2.3');
assert.equal(result.buildInputRevision, result.build.revision);
assert.equal(result.verifiedAssets.length, 2);
assert.ok(result.sourceFingerprint && result.files['tsconfig.json']);
for (const { url, options } of good.requests) {
  assert.equal(options.redirect, 'error', '环境与资产请求不得跟随重定向');
  assert.equal(Boolean(options.headers.Authorization), /\/(actuator|apis)\//.test(new URL(url).pathname), 'PAT 只能用于指定站点的环境元数据');
}
assert.ok(!JSON.stringify(result).includes('fixture-only-secret'), '报告不能包含认证令牌');
const external = fixture();
await external.run('https://other.test');
assert.ok(external.requests.every(({ options }) => !options.headers.Authorization), '测试其他站点不能携带配置站点的PAT');
const stale = fixture(); stale.files.set('src/index.js', 'changed after build');
await assert.rejects(stale.run(), /local build is stale/);
const wrong = fixture(); wrong.scenario.badAsset = true;
await assert.rejects(wrong.run(), /served shell bytes differ/);
const truncated = fixture(); truncated.scenario.truncated = true;
await assert.rejects(truncated.run(), /must not be truncated/);
await assert.rejects(fixture().run('https://name:secret@example.test'), /without embedded credentials/);

let handler;
const blocked = [];
await installReadOnlyGuard({ route: async (_pattern, callback) => { handler = callback; } }, blocked);
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
  let outcome;
  await handler({ request: () => ({ method: () => method, url: () => 'https://example.test/api' }), abort: async () => { outcome = 'blocked'; }, continue: async () => { outcome = 'continued'; } });
  assert.equal(outcome, method === 'GET' ? 'continued' : 'blocked');
}
assert.equal(blocked.length, 4);

// Exercise the production smoke collector, including its narrow exceptions.
const smoke = fs.readFileSync(new URL('./smoke-playwright.mjs', import.meta.url), 'utf8');
const collectorSource = smoke.slice(smoke.indexOf('function createRuntimeErrorCollector('), smoke.indexOf('  async function navigate(route)'));
const page = new EventEmitter();
const smokeContext = vm.createContext({
  page, URL, baseUrl: 'https://example.test', expectedRuntimeErrors: [], knownStaleContentUrls: new Set(),
  toAbsoluteUrl: (value) => new URL(value, 'https://example.test').href,
  smokeDiagnosticUrl: (value) => value,
  optionalSkipReason: (route, status) => route.optional && status === 404 ? 'plugin unavailable' : '',
  isExternalUploadResourceError: () => false,
  isIgnoredRequestFailure: () => false
});
vm.runInContext(collectorSource, smokeContext);
const collector = smokeContext.createRuntimeErrorCollector({ target: '/optional', optional: true });
const http = (pathname, status, resourceType = 'fetch') => {
  const request = { method: () => 'GET', resourceType: () => resourceType,
    url: () => `https://example.test${pathname}` };
  page.emit('request', request);
  page.emit('response', { status: () => status, url: request.url, request: () => request });
};
http('/broken-api', 404); http('/private-api', 403); http('/broken-server', 500);
http('/optional', 404, 'document');
http('/apis/api.console.halo.run/v1alpha1/users/-', 401);
const aborted = { method: () => 'GET', resourceType: () => 'image', url: () => 'https://example.test/image', failure: () => ({ errorText: 'net::ERR_ABORTED' }) };
page.emit('request', aborted);
page.emit('requestfailed', aborted);
const snapshot = collector.snapshot();
assert.equal(snapshot.responseErrors.length, 3, '未经声明的 4xx 与 5xx 均必须进入失败门禁');
assert.equal(snapshot.expectedErrors.length, 2, '仅可选404与匿名身份探测属于预期错误');
assert.equal(snapshot.requestFailures.length, 1, '原因未明的ERR_ABORTED必须保留为失败');
assert.throws(() => collector.assertEmpty('fixture'), /HTTP 404/);
collector.stop();
assert.equal(page.listenerCount('response'), 0);
console.log('live build context offline contract passed: source revision, served bytes, environment identity, credentials, readonly guard');
