// Small bridge shared by Shell and Auth. The visual controller is optional.
export function signalStartupReady(part, win = globalThis.window) {
  win?.__THEME_STARTUP__?.ready(part);
}

export function signalStartupFailure(win = globalThis.window) {
  win?.__THEME_STARTUP__?.finish('failed');
}

export function markStartupRecoveryReload(win = globalThis.window) {
  try {
    win.sessionStorage.setItem('theme:startup:recovery:v1', JSON.stringify({
      target: win.location.pathname + win.location.search,
      at: Date.now()
    }));
  } catch (_) { /* Startup also falls back to direct display when storage is unavailable. */ }
}

let previewGeneration = 0;
let previewController = null;

export function cancelStartupPreview() {
  previewGeneration += 1;
  previewController?.dispose();
  previewController = null;
}

export async function previewStartup(config) {
  cancelStartupPreview();
  const generation = previewGeneration;
  const { installStartupController } = await import('./startup-controller.js');
  if (generation !== previewGeneration) return 'cancelled';
  previewController = installStartupController(window, document, config, { preview: true });
  const result = await previewController.finished;
  if (generation === previewGeneration) previewController = null;
  return result;
}
