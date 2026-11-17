/**
 * Bound transport AND body consumption to one owner. The callback only reads
 * the response; callers retain generation checks and all business/UI commits.
 * A timed-out write is not retried: its result may need authoritative readback.
 */
export async function withRequestDeadline(work, { signal, timeoutMs = 15_000 } = {}) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000;
  const abortFromOwner = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abortFromOwner, { once: true });
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = globalThis.setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, duration);
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }),
      aborted
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromOwner);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
