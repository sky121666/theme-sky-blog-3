// Browser-safe accumulator shared by the live sampler and independent offline fixtures.
// CLS: https://web.dev/articles/cls
// INP: https://web.dev/articles/inp
// Blocking time is clipped to FCP..sample end; it is not Lighthouse's FCP..TTI TBT.
export function createPerformanceAccumulator() {
  let cls = 0;
  let sessionValue = 0;
  let sessionStart = -Infinity;
  let sessionLast = -Infinity;
  let fcp = null;
  let lcp = null;
  let firstHidden = Infinity;
  const longTasks = [];
  const interactions = new Map();
  const supported = {};

  function observe(type, entries) {
    for (const entry of entries) {
      const start = Number(entry.startTime);
      if (!Number.isFinite(start) || start < 0 || start >= firstHidden) continue;
      if (type === 'paint' && entry.name === 'first-contentful-paint') fcp = start;
      if (type === 'largest-contentful-paint') lcp = start;
      if (type === 'layout-shift' && !entry.hadRecentInput) {
        const value = Number(entry.value);
        if (!Number.isFinite(value) || value < 0) continue;
        if (start - sessionLast < 1000 && start - sessionStart < 5000) {
          sessionValue += value;
        } else {
          sessionStart = start;
          sessionValue = value;
        }
        sessionLast = start;
        cls = Math.max(cls, sessionValue);
      }
      if (type === 'longtask' && Number.isFinite(entry.duration) && entry.duration > 50) {
        longTasks.push({ start, end: start + entry.duration });
      }
      if (type === 'event' && entry.interactionId > 0 && Number.isFinite(entry.duration) && entry.duration >= 0) {
        interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) || 0, entry.duration));
      }
    }
  }

  return {
    observe,
    setSupported(type, value) { supported[type] = value; },
    hide(at) { if (Number.isFinite(at)) firstHidden = Math.min(firstHidden, at); },
    snapshot(at, interactionCount = null) {
      const end = Math.min(at, firstHidden);
      const blockingTimeAfterFcp = supported.longtask === false || fcp === null ? null : longTasks.reduce((sum, task) => (
        sum + Math.max(0, Math.min(task.end, end) - Math.max(task.start + 50, fcp))
      ), 0);
      const observed = interactions.size;
      const count = Number.isFinite(interactionCount) ? Math.max(observed, interactionCount) : observed;
      const durations = [...interactions.values()].sort((a, b) => b - a);
      const inp = supported.event === false || !observed ? null : durations[Math.min(durations.length - 1, Math.floor(count / 50))];
      return {
        lcp: supported['largest-contentful-paint'] === false ? null : lcp,
        cls: supported['layout-shift'] === false ? null : cls,
        fcp,
        blockingTimeAfterFcp,
        inp,
        sample: {
          sampledAt: at,
          firstHiddenAt: Number.isFinite(firstHidden) ? firstHidden : null,
          blockingWindow: { start: fcp, end, definition: 'FCP to sample end (clipped at first hidden), not Lighthouse TBT' },
          interactionCount: count,
          observedInteractionCount: observed,
          interactionCountSource: Number.isFinite(interactionCount) ? 'performance.interactionCount' : 'observed-event-ids',
          inpStatus: supported.event === false ? 'unsupported' : !observed ? 'no-observed-interactions' : 'sampled-interactions-only',
          eventDurationThreshold: 16,
          supported: { ...supported }
        }
      };
    }
  };
}

// Assess the unrounded sample. A background or unpainted document cannot turn
// missing observations into a successful zero-shift laboratory result.
export function layoutStabilityFailures(pages, maxSampleCls) {
  return pages.filter((page) => page.status === 'ok').flatMap((page) => {
    const { cls, fcp, sample } = page.metrics || {};
    const available = Number.isFinite(cls) && cls >= 0 && Number.isFinite(fcp)
      && sample?.supported?.['layout-shift'] === true
      && (sample.firstHiddenAt === null || sample.firstHiddenAt > fcp);
    if (available && cls <= maxSampleCls) return [];
    return [{ page: page.name, cls: Number.isFinite(cls) ? cls : null,
      reason: available ? 'layout shift budget exceeded' : 'layout shift measurement unavailable' }];
  });
}

// Receives the factory explicitly so Playwright can serialize this without module globals.
export function installPerformanceObservers(createAccumulator) {
  const accumulator = createAccumulator();
  const observers = [];
  const types = ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask', 'event'];
  for (const type of types) {
    try {
      if (PerformanceObserver.supportedEntryTypes && !PerformanceObserver.supportedEntryTypes.includes(type)) {
        accumulator.setSupported(type, false);
        continue;
      }
      const observer = new PerformanceObserver((list) => accumulator.observe(type, list.getEntries()));
      observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
      observers.push({ type, observer });
      accumulator.setSupported(type, true);
    } catch {
      accumulator.setSupported(type, false);
    }
  }
  if (document.visibilityState === 'hidden') accumulator.hide(0);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') accumulator.hide(performance.now());
  });
  window.__themeAuditMetrics = {
    snapshot() {
      for (const { type, observer } of observers) accumulator.observe(type, observer.takeRecords());
      return accumulator.snapshot(performance.now(), performance.interactionCount);
    }
  };
}
