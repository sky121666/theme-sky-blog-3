import assert from 'node:assert/strict';
import test from 'node:test';

const module = await import('./lib/distributed-dependency-scope.mjs').catch(() => ({}));
const metadata = { name: 'svelte', version: '5.53.10', dependencies: { 'esm-env': '1', clsx: '2', 'is-reference': '3' } };
const scopes = { svelte: { version: '5.53.10', dependencies: ['clsx', 'esm-env'], source: 'https://github.com/sveltejs/svelte', reason: 'Browser runtime imports verified from installed source.' } };

test('没有范围声明的包保留完整依赖', () => {
  assert.equal(typeof module.getDistributedDependencyNames, 'function');
  assert.deepEqual(module.getDistributedDependencyNames(metadata, {}), ['clsx', 'esm-env', 'is-reference']);
});
test('明确核验的浏览器范围只收集实际运行依赖', () => {
  assert.equal(typeof module.getDistributedDependencyNames, 'function');
  assert.deepEqual(module.getDistributedDependencyNames(metadata, scopes), ['clsx', 'esm-env']);
});
test('升级版本、未知依赖或缺少来源必须失败', () => {
  assert.equal(typeof module.getDistributedDependencyNames, 'function');
  for (const change of [{ version: '6.0.0' }, { dependencies: ['unknown'] }, { source: '' }]) {
    assert.throws(() => module.getDistributedDependencyNames(metadata, { svelte: { ...scopes.svelte, ...change } }));
  }
});
