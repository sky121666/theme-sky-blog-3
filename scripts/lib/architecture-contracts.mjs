import path from 'node:path';

const SHELL_SHARED_SERVICES = new Set([
  'src/shell/desktop-shell/runtime/shared/debug.js',
  'src/shell/desktop-shell/runtime/shared/lazy-media.js'
]);
// Existing explicit integration seams; these do not allow arbitrary app imports.
const INTEGRATION_IMPORTS = new Map([
  ['src/apps/auth/hydrate.js', new Set(['src/entries/auth.js'])],
  ['src/widgets/plugin/steam-summary/render.js', new Set(['src/apps/steam/model.js'])]
]);

function appScope(file) {
  const parts = file.split('/');
  return parts[2] === 'explorer' ? parts.slice(0, 4).join('/') : parts.slice(0, 3).join('/');
}

export function validateModuleDependencies(modules, { exists }) {
  const errors = [];
  const graph = new Map();
  for (const { file, imports } of modules) {
    const dependencies = [];
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!exists(target)) errors.push(`${file}: missing import ${specifier}`);
      if (!target.endsWith('.js')) continue;
      dependencies.push(target);
      if (file.startsWith('src/shared/') && !target.startsWith('src/shared/')) {
        errors.push(`${file}: shared must not depend on ${target}`);
      }
      if (file.startsWith('src/apps/')) {
        const allowed = target.startsWith(`${appScope(file)}/`)
          || target.startsWith('src/apps/explorer/shared/')
          || target.startsWith('src/shared/') || SHELL_SHARED_SERVICES.has(target)
          || INTEGRATION_IMPORTS.get(file)?.has(target);
        if (!allowed) errors.push(`${file}: app implementation boundary crossed by ${target}`);
      }
      if (file.startsWith('src/widgets/') && !(target.startsWith('src/widgets/')
        || target.startsWith('src/shared/') || SHELL_SHARED_SERVICES.has(target)
        || INTEGRATION_IMPORTS.get(file)?.has(target))) {
        errors.push(`${file}: widget implementation boundary crossed by ${target}`);
      }
      if (file.startsWith('src/shell-core/runtime/') && target.startsWith('src/apps/') && !target.endsWith('/manifest.js')) {
        errors.push(`${file}: shell-core may import app manifests, not app implementation ${target}`);
      }
      if (file.startsWith('src/shell/') && target.startsWith('src/apps/')) {
        errors.push(`${file}: shell must consume app lifecycles, not ${target}`);
      }
    }
    graph.set(file, dependencies);
  }
  const complete = new Set();
  const active = new Set();
  function visit(file, trail) {
    if (active.has(file)) {
      errors.push(`circular static import: ${[...trail.slice(trail.indexOf(file)), file].join(' -> ')}`);
      return;
    }
    if (complete.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) || []) visit(target, [...trail, file]);
    active.delete(file);
    complete.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
  return errors;
}
