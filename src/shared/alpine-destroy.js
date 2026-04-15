function collectDestroyTargets(root, selector) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];

  const targets = [];
  if (typeof root.matches === 'function' && root.matches(selector)) {
    targets.push(root);
  }
  targets.push(...root.querySelectorAll(selector));
  return Array.from(new Set(targets));
}

function getAlpineDataScope(element) {
  const stack = element?._x_dataStack;
  if (!Array.isArray(stack) || !stack.length) return null;
  return stack[0] || null;
}

export function invokeAlpineDestroyHooks(root, selector = '[x-data]') {
  collectDestroyTargets(root, selector).forEach((element) => {
    const scope = getAlpineDataScope(element);
    if (!scope || typeof scope.destroy !== 'function') return;
    try {
      scope.destroy.call(scope);
    } catch (_error) {
      // Ignore teardown errors so page disposal never blocks navigation.
    }
  });
}
