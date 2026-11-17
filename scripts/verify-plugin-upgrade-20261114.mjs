import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

// Opt-in diagnostic: requires the official exact-tag source archives in sourceDir.
// It never calls a provider, a plugin write API, or the site's administration API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = process.env.PLUGIN_UPGRADE_REPORT_DIR || path.join(root, 'output/plugin-upgrade-20261114');
const sourceDir = process.env.PLUGIN_UPGRADE_SOURCE_DIR || path.join(reportDir, 'sources');
const pluginDir = process.env.PLUGIN_UPGRADE_JAR_DIR || path.resolve(root, '../../plugins');
await mkdir(reportDir, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
  startedAt: new Date().toISOString(), node: process.version, passed: false,
  scope: 'Installed JAR static inspection plus exact-tag source logic simulations. No provider, administration, import, publishing, or site writes.',
  plugins: {}, checks: [],
};
const check = async (name, kind, run) => {
  await run();
  report.checks.push({ name, kind, passed: true });
};
const source = (plugin, filename) => path.join(sourceDir, plugin, filename);
const importCode = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const bundleFile = async (filename) => {
  const result = await build({ entryPoints: [filename], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return importCode(result.outputFiles[0].text);
};
function extractFunction(text, name) {
  const start = text.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `missing source function ${name}`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated source function ${name}`);
}
const javap = async (id, version, classes) => {
  const jar = path.join(pluginDir, `${id}-${version}.jar`);
  const manifest = execFileSync('unzip', ['-p', jar, 'plugin.yaml']).toString();
  assert.ok(manifest.includes(`name: "${id}"`), `wrong plugin ID in ${jar}`);
  assert.ok(manifest.includes(`version: "${version}"`), `wrong plugin version in ${jar}`);
  const text = execFileSync('javap', ['-classpath', jar, '-p', '-c', ...classes], { maxBuffer: 6 * 1024 * 1024 }).toString();
  const filename = `${id}-${version}-bytecode.txt`;
  await writeFile(path.join(reportDir, filename), text);
  report.plugins[id] = { version, jar, sha256: sha256(await readFile(jar)), bytecode: filename, sourceVersionClaim: 'Official exact-tag source checked separately; the JAR has no verified source commit attestation.' };
  return text;
};

try {
  const negativeDir = path.join(reportDir, 'shiki-negative-fixtures');
  await mkdir(negativeDir, { recursive: true });
  execFileSync('python3', ['-c', `import sys, pathlib, zipfile
source, target = sys.argv[1:]
with zipfile.ZipFile(source) as original:
 manifest = original.read('plugin.yaml')
 module = original.read('static/shiki-code.js')
for filename, descriptor, payload in [
 ('wrong-version.jar', manifest.replace(b'version: "1.5.2"', b'version: "0.0.0"'), module),
 ('wrong-bytes.jar', manifest, b'/* deliberately mismatched fixture bytes */')]:
 with zipfile.ZipFile(pathlib.Path(target) / filename, 'w') as archive:
  archive.writestr('plugin.yaml', descriptor)
  archive.writestr('static/shiki-code.js', payload)
`, path.join(pluginDir, 'shiki-1.5.2.jar'), negativeDir]);
  for (const [filename, message] of [
    ['wrong-version.jar', 'the live script version must match the installed JAR manifest'],
    ['wrong-bytes.jar', 'the live Shiki module must match the installed JAR bytes'],
  ]) await check(`Shiki rejects ${filename}`, 'isolated corrupted-JAR regression, real read-only discovery/module', async () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-shiki-adaptation.mjs')], {
      cwd: root, env: { ...process.env, SHIKI_PLUGIN_JAR: path.join(negativeDir, filename), SHIKI_EXPECTED_VERSION: '1.5.2' },
      encoding: 'utf8', timeout: 30_000,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    await writeFile(path.join(negativeDir, `${filename}.log`), output);
    assert.equal(result.status, 1, 'a mismatched artifact must fail before browser launch');
    assert.ok(output.includes(message), output);
  });
  const mcp = await javap('mcp-server', '1.4.0', ['run.halo.mcpserver.tools.SinglePageTools', 'run.halo.mcpserver.tools.ContentPayloads']);
  await check('MCP single-page schemas, metadata update, and payload expose excerpt/autoGenerateExcerpt', 'installed-JAR static bytecode + exact-tag source', async () => {
    for (const text of ['String excerpt', 'String autoGenerateExcerpt', 'SinglePage$SinglePageSpec.setExcerpt', 'Post$Excerpt.setRaw', 'Post$Excerpt.setAutoGenerate']) assert.ok(mcp.includes(text), `MCP JAR missing ${text}`);
    const src = await readFile(source('plugin-mcp-server-1.4.0', 'src/main/java/run/halo/mcpserver/tools/SinglePageTools.java'), 'utf8');
    assert.ok(src.includes('spec.setExcerpt(excerpt(arguments, null))'));
    assert.ok(src.includes('spec.setExcerpt(excerpt(arguments, spec.getExcerpt()))'));
    report.plugins['mcp-server'].limits = 'No tools/list, query, create, update, publishing, or server-side excerpt persistence executed; no credentials used.';
  });

  const ai = await javap('ai-foundation', '1.4.0', ['run.halo.aifoundation.decision.DecisionRequest', 'run.halo.aifoundation.decision.DecisionAnswer', 'run.halo.aifoundation.endpoint.DecisionConsoleEndpoint', 'run.halo.aifoundation.provider.typesafe.TypeSafeDecisionClient', 'run.halo.aifoundation.provider.aihubmix.AiHubMixDecisionClient']);
  await check('AI decision request/answer, console endpoint, TypeSafe and AIHubMix clients shipped', 'installed-JAR static bytecode', async () => {
    for (const text of ['getQuestions', 'getProbability', 'getChoice', 'getScore', 'TypeSafeDecisionClient', 'AiHubMixDecisionClient', 'testDecision']) assert.ok(ai.includes(text), `AI JAR missing ${text}`);
  });
  const sdk = await bundleFile(source('plugin-ai-foundation-1.4.0', 'ui/packages/sdk/src/decision.ts'));
  const request = {
    state: { comment: 'local fixture' },
    questions: {
      spam: { type: 'YES_NO', instructions: 'Spam?' },
      route: { type: 'CHOICE', instructions: 'Route?', options: { a: 'A', b: 'B' } },
      rating: { type: 'SCORE', instructions: 'Rating?', levels: ['low', 'high'] },
    },
  };
  const result = {
    model: 'local-fixture',
    answers: {
      spam: { type: 'YES_NO', probability: 0.1 },
      route: { type: 'CHOICE', choice: 'b', probabilities: { a: 0.2, b: 0.8 }, confidence: 0.7 },
      rating: { type: 'SCORE', score: 0.8, probabilities: { 0: 0.2, 1: 0.8 }, legend: { 0: 'low', 1: 'high' } },
    },
    usage: { inputTokens: 10, outputTokens: null },
  };
  const client = (response) => sdk.createDecisionClient({ api: '/local-fixture-only', fetch: async () => response });
  await check('Decision client preserves all three answer types and request envelope', 'exact-tag SDK source simulation, intercepted fetch', async () => {
    const controller = new AbortController();
    const actual = await sdk.createDecisionClient({ api: '/local-fixture-only', credentials: 'same-origin', headers: { 'X-Test': 'fixture' }, fetch: async (url, options) => {
      assert.equal(url, '/local-fixture-only');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), request);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.headers.get('Content-Type'), 'application/json');
      return Response.json(result);
    } }).decide(request, { signal: controller.signal });
    assert.deepEqual(actual, result);
  });
  const invalid = [
    ['missing question IDs', (r) => { delete r.answers.spam; }],
    ['invalid probability', (r) => { r.answers.spam.probability = 2; }],
    ['unknown choice', (r) => { r.answers.route.choice = 'unknown'; }],
    ['incomplete distribution', (r) => { r.answers.route.probabilities = { a: 1 }; }],
    ['distribution sum', (r) => { r.answers.rating.probabilities = { 0: 0.1, 1: 0.1 }; }],
    ['score out of range', (r) => { r.answers.rating.score = 2; }],
    ['negative usage', (r) => { r.usage.inputTokens = -1; }],
  ];
  for (const [name, mutate] of invalid) await check(`Decision client rejects ${name}`, 'exact-tag SDK source simulation, intercepted fetch', async () => {
    const payload = structuredClone(result); mutate(payload);
    await assert.rejects(client(Response.json(payload)).decide(request), { name: 'AIUIProtocolError' });
  });
  await check('Decision client reports HTTP 429 and malformed JSON', 'exact-tag SDK source simulation, intercepted fetch', async () => {
    await assert.rejects(client(new Response('', { status: 429 })).decide(request), { name: 'AIUIError', status: 429 });
    await assert.rejects(client(new Response('{bad')).decide(request), { name: 'AIUIProtocolError' });
  });
  await check('Decision client validates submitted snapshot after request mutation', 'exact-tag SDK source simulation, intercepted fetch', async () => {
    const input = structuredClone(request);
    const pending = client(Response.json(result)).decide(input);
    delete input.questions.spam;
    input.questions.route.options.c = 'C';
    input.questions.rating.levels.push('highest');
    assert.deepEqual(await pending, result);
  });

  const selector = await readFile(source('plugin-ai-foundation-1.4.0', 'ui/src/formkit/AiModelSelector.vue'), 'utf8');
  const groups = selector.match(/const groups = computed\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1];
  assert.ok(groups, 'missing selector groups computed callback');
  const groupSource = source('plugin-ai-foundation-1.4.0', 'ui/src/utils/model-options.ts');
  const groupBundle = await build({ stdin: { contents: `import { groupModelOptionsByProvider } from ${JSON.stringify(groupSource)}; export function filterGroups(items, provider) { const fuseResults = { value: items.map(item => ({ item })) }; const providerFilter = { value: provider }; ${groups} }`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const { filterGroups } = await importCode(groupBundle.outputFiles[0].text);
  const models = [
    { name: 'a1', provider: { name: 'alpha', displayName: 'Alpha' } },
    { name: 'b1', provider: { name: 'beta', displayName: 'Beta' } },
    { name: 'a2', provider: { name: 'alpha', displayName: 'Alpha' } },
  ];
  await check('Model selector intersects provider rail with search results and preserves grouping', 'exact-tag computed callback source simulation; no mounted UI', async () => {
    assert.deepEqual(filterGroups(models, null).map(g => [g.key, g.models.map(m => m.name)]), [['alpha', ['a1', 'a2']], ['beta', ['b1']]]);
    assert.deepEqual(filterGroups(models, 'beta').map(g => g.models.map(m => m.name)), [['b1']]);
    assert.deepEqual(filterGroups([models[0]], 'beta'), []);
    assert.deepEqual(filterGroups([], null), []);
  });
  const aiEntries = execFileSync('unzip', ['-Z1', path.join(pluginDir, 'ai-foundation-1.4.0.jar')]).toString().split('\n');
  const selectorEntry = aiEntries.find(e => /^ui\/chunks\/AiModelSelector\.[^/]+\.js$/.test(e));
  const selectorBytes = execFileSync('unzip', ['-p', path.join(pluginDir, 'ai-foundation-1.4.0.jar'), selectorEntry]);
  report.plugins['ai-foundation'].selector = { entry: selectorEntry, sha256: sha256(selectorBytes) };
  report.plugins['ai-foundation'].limits = 'No provider request, billing, real model selector mounting, Console configuration, capability sync, or persisted decision executed. SDK and computed callback are exact-tag source simulations.';

  const contentJar = path.join(pluginDir, 'content-tools-1.9.1.jar');
  const contentEntries = execFileSync('unzip', ['-Z1', contentJar]).toString().split('\n');
  const importEntry = contentEntries.find(e => /^console\/chunks\/JsonImport\.[^/]+\.js$/.test(e));
  const importBytes = execFileSync('unzip', ['-p', contentJar, importEntry]);
  const contentManifest = execFileSync('unzip', ['-p', contentJar, 'plugin.yaml']).toString();
  assert.ok(contentManifest.includes('name: "content-tools"'));
  assert.ok(contentManifest.includes('version: "1.9.1"'));
  report.plugins['content-tools'] = { version: '1.9.1', jar: contentJar, sha256: sha256(await readFile(contentJar)), importEntry, importSha256: sha256(importBytes) };
  await check('JSON import JAR omits owner and publishes the created draft name', 'installed-JAR static compiled JavaScript', async () => {
    const text = importBytes.toString();
    assert.match(text, /delete\s+\w+\.post\.spec\.owner/);
    assert.match(text, /publishPost\(\{name:\w+\.metadata\.name\}\)/);
  });
  const jsonImport = await readFile(source('plugin-content-tools-1.9.1', 'ui/src/views/tabs/JsonImport.vue'), 'utf8');
  const importHarnessCode = `export function createHarness(utils, consoleApiClient, publishAfterImport) { ${extractFunction(jsonImport, 'preparePostRequestForImport')}\n${extractFunction(jsonImport, 'createPost')}\nreturn { preparePostRequestForImport, createPost }; }`;
  const { code } = await transform(importHarnessCode, { loader: 'ts', format: 'esm' });
  const { createHarness } = await importCode(code);
  const imported = () => ({ post: { metadata: { name: 'old' }, spec: { owner: 'old-owner', publish: true, publishTime: 'old-time', categories: ['old'], tags: ['old'], headSnapshot: 'old' }, status: { phase: 'PUBLISHED' } }, content: { raw: 'test body', content: '<p>test body</p>', rawType: 'markdown' } });
  await check('JSON import source clears owner and old state; publish uses authoritative draft response', 'exact-tag source functions simulation, intercepted API', async () => {
    const calls = [];
    const api = { content: { post: { draftPost: async ({ postRequest }) => {
      assert.equal(Object.hasOwn(postRequest.post.spec, 'owner'), false);
      assert.equal(postRequest.post.spec.publish, false);
      assert.equal(postRequest.post.spec.headSnapshot, '');
      assert.equal(postRequest.content.raw, 'test body');
      calls.push('draft');
      return { data: { metadata: { name: 'server-draft-name' } } };
    }, publishPost: async ({ name }) => { assert.equal(name, 'server-draft-name'); calls.push('publish'); } } } };
    const harness = createHarness({ id: { uuid: () => 'new-local-id' } }, api, { value: true });
    await harness.createPost(imported());
    assert.deepEqual(calls, ['draft', 'publish']);
  });
  await check('JSON import source retains draft when publish is disabled', 'exact-tag source functions simulation, intercepted API', async () => {
    let drafts = 0;
    const harness = createHarness({ id: { uuid: () => 'draft-only-id' } }, { content: { post: { draftPost: async () => { drafts++; return { data: { metadata: { name: 'draft-only' } } }; }, publishPost: async () => { assert.fail('draft-only import must not publish'); } } } }, { value: false });
    await harness.createPost(imported());
    assert.equal(drafts, 1);
  });
  report.plugins['content-tools'].limits = 'No real ZIP upload, attachments, database owner fill, reconciler, import, or publishing executed. Only extracted exact-tag functions run against local API fixtures.';

  const contact = await javap('PluginContactForm', '2.1.1', ['run.halo.contact.form.FormTrackingHeadProcessor', 'run.halo.contact.form.AutoContactFormWidget']);
  report.plugins.PluginContactForm.lifecycleReport = 'contact-form-2.1.1.json';
  report.plugins.PluginContactForm.limits = 'Real frontend JAR fixture lifecycle tested separately. Backend cache invalidation, concurrent rebuild, soft-delete change and stop cleanup only statically inspected; not exercised with live configuration writes.';
  await check('ContactForm backend contains cached tracking/display configuration and lifecycle hooks', 'installed-JAR static bytecode', async () => {
    for (const text of ['cache', 'dispose', 'DeletionTimestamp']) assert.ok(contact.toLowerCase().includes(text.toLowerCase()), `ContactForm bytecode missing ${text}`);
  });
  report.passed = true;
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(reportDir, 'upgraded-plugin-contracts.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, report: path.join(reportDir, 'upgraded-plugin-contracts.json') }, null, 2));
}
