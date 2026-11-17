import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile, compileModule } from 'svelte/compiler';

// Exercise the current component sources without rebuilding the theme or touching its generated assets.
export async function bundleCommerceFixture(contents, overrides = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'browser',
    conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'],
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: root, sourcefile: 'commerce-fixture.js', contents },
    plugins: [{ name: 'commerce-fixture-svelte', setup(builder) {
      builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
        const source = overrides[path.relative(root, filename)] ?? await readFile(filename, 'utf8');
        const result = compile(source, { filename, generate: 'client', css: 'injected', customElement: filename.includes('/src/apps/shop/commerce-ui/') });
        if (filename.startsWith(path.join(root, 'src'))) assert.deepEqual(result.warnings, [], `Unexpected Svelte warnings in ${filename}`);
        return { contents: result.js.code, loader: 'js', resolveDir: path.dirname(filename) };
      });
      builder.onLoad({ filter: /\.svelte\.js$/ }, async ({ path: filename }) => ({
        contents: compileModule(await readFile(filename, 'utf8'), { filename, generate: 'client' }).js.code,
        loader: 'js', resolveDir: path.dirname(filename),
      }));
    } }],
  });
  return bundle.outputFiles[0].text;
}
