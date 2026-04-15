export function readAppProps(appId, root = document) {
  if (!appId || !root?.querySelector) return null;

  const script = root.querySelector(`script[data-app-props="${appId}"]`);
  if (!script?.textContent) return null;

  try {
    const parsed = JSON.parse(script.textContent);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}
