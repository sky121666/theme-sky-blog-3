import assert from 'node:assert/strict';
import esbuild from 'esbuild';

// Build the real Shell entry in memory so this follows resolved imports rather
// than relying on source text or a potentially stale templates/assets build.
const entry = 'src/shell/desktop-shell/entry-main.js';
const client = 'src/shell/desktop-shell/runtime/shared/theme-config-client.js';
const { metafile } = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  loader: { '.css': 'empty' },
  logLevel: 'silent'
});

const staticInputs = new Set();
const visitStatic = (input) => {
  if (staticInputs.has(input)) return;
  staticInputs.add(input);
  for (const dependency of metafile.inputs[input]?.imports || []) {
    if (dependency.kind === 'import-statement' && metafile.inputs[dependency.path]) {
      visitStatic(dependency.path);
    }
  }
};
visitStatic(entry);

assert.ok(metafile.inputs[client], 'Shell 的按需操作仍须能访问主题配置客户端');
assert.equal(staticInputs.has(client), false,
  '普通页面启动 Shell 时不应静态等待仅供设置和桌面编辑使用的主题配置客户端');
assert.ok([...staticInputs].some((input) =>
  metafile.inputs[input]?.imports.some((dependency) =>
    dependency.kind === 'dynamic-import' && dependency.path === client
  )), '主题配置客户端必须从 Shell 可达的按需加载入口导入');

console.log('Shell theme config import boundary passed');
