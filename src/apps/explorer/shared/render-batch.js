const BATCH_SIZE = 8;

export function renderBatch(container, htmlItems, options = {}) {
  const {
    onComplete,
    batchSize = BATCH_SIZE,
    isCurrent = null,
    signal = null,
  } = options;
  let cancelled = false;
  let completed = false;
  let frameId = 0;

  const control = {
    cancel() {
      if (cancelled || completed) return;
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    },
    get cancelled() {
      return cancelled;
    },
    get completed() {
      return completed;
    },
  };

  const canRender = () => !cancelled
    && signal?.aborted !== true
    && (typeof isCurrent !== 'function' || isCurrent());
  const complete = () => {
    if (completed || !canRender()) return;
    completed = true;
    frameId = 0;
    onComplete?.();
  };

  if (!container) {
    complete();
    return control;
  }

  if (!htmlItems.length) {
    if (canRender()) container.innerHTML = '';
    complete();
    return control;
  }

  let offset = 0;
  const range = document.createRange();

  function buildFragment(slice) {
    const tmpRange = document.createRange();
    tmpRange.selectNodeContents(document.createElement('div'));
    return tmpRange.createContextualFragment(slice.join(''));
  }

  function appendNextBatch() {
    frameId = 0;
    if (!canRender()) return;

    const slice = htmlItems.slice(offset, offset + batchSize);
    if (!slice.length) {
      complete();
      return;
    }

    if (offset === 0) {
      const frag = buildFragment(slice);
      container.innerHTML = '';
      container.appendChild(frag);
    } else {
      range.selectNodeContents(container);
      const frag = range.createContextualFragment(slice.join(''));
      container.appendChild(frag);
    }

    offset += batchSize;

    if (offset < htmlItems.length) {
      frameId = requestAnimationFrame(appendNextBatch);
    } else {
      complete();
    }
  }

  frameId = requestAnimationFrame(appendNextBatch);
  return control;
}
