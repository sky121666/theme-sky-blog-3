import assert from 'node:assert/strict';

export function getDistributedDependencyNames(metadata, scopes = {}) {
  const dependencies = { ...(metadata.dependencies || {}), ...(metadata.optionalDependencies || {}) };
  const scope = scopes[metadata.name];
  if (!scope) return Object.keys(dependencies).sort();
  assert.equal(scope.version, metadata.version, `${metadata.name}: browser dependency scope needs version review`);
  assert.ok(/^https:\/\//.test(scope.source || '') && scope.reason, `${metadata.name}: dependency scope needs evidence`);
  assert.ok(Array.isArray(scope.dependencies) && scope.dependencies.every((name) => Object.hasOwn(dependencies, name)), `${metadata.name}: unknown scoped dependency`);
  return [...new Set(scope.dependencies)].sort();
}
