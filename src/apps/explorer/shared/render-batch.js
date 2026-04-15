const BATCH_SIZE = 8;

export function renderBatch(container, htmlItems, options = {}) {
  const { onComplete, batchSize = BATCH_SIZE } = options;
  if (!container || !htmlItems.length) {
    onComplete?.();
    return;
  }

  let offset = 0;
  const range = document.createRange();

  function buildFragment(slice) {
    const tmpRange = document.createRange();
    tmpRange.selectNodeContents(document.createElement('div'));
    return tmpRange.createContextualFragment(slice.join(''));
  }

  function appendNextBatch() {
    const slice = htmlItems.slice(offset, offset + batchSize);
    if (!slice.length) {
      onComplete?.();
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
      requestAnimationFrame(appendNextBatch);
    } else {
      onComplete?.();
    }
  }

  requestAnimationFrame(appendNextBatch);
}
