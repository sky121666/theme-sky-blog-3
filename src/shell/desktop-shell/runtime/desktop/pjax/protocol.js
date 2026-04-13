/**
 * Pjax Protocol Sync
 * Parses body dataset attributes from Pjax response text and synchronizes them to the current document body.
 */

const ATTRS_TO_SYNC = ['errorPage', 'pageMode', 'pageApp', 'windowVariant', 'windowMetricsKey'];

/**
 * Parse <body> tag from HTML response text and return a temporary element with its attributes.
 * @param {string} responseText
 * @returns {HTMLElement|null}
 */
function parseBodyTag(responseText) {
  if (!responseText) return null;
  const bodyTagMatch = responseText.match(/<body[^>]*>/i);
  if (!bodyTagMatch) return null;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = bodyTagMatch[0].replace('<body', '<div').replace('>', '></div>');
  return tempDiv.firstElementChild || null;
}

export function syncBodyDatasetFromResponse(responseText) {
  const dummyNode = parseBodyTag(responseText);
  if (!dummyNode) return;

  ATTRS_TO_SYNC.forEach(key => {
    const val = dummyNode.dataset[key];
    if (val !== undefined && val !== null) {
      document.body.dataset[key] = val;
    } else {
      delete document.body.dataset[key];
    }
  });
}

/**
 * Extract window variant from response HTML.
 * @param {string} responseText
 * @returns {string} variant name ('browser', 'moments', 'none', or '')
 */
export function parseWindowVariantFromResponse(responseText) {
  const dummyNode = parseBodyTag(responseText);
  return dummyNode?.dataset.windowVariant || '';
}

/**
 * Extract the innerHTML of a target selector from a full HTML response.
 * Returns { title, bodyDataset, contentHtml } or null on failure.
 * @param {string} responseText
 * @param {string} contentSelector - e.g. '[data-window-content-root]'
 * @returns {{ title: string, bodyDataset: DOMStringMap, contentHtml: string, fullDoc: Document } | null}
 */
export function parseContentFromResponse(responseText, contentSelector = '[data-window-content-root]') {
  if (!responseText) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(responseText, 'text/html');
    const title = doc.title || '';
    const contentRoot = doc.querySelector(contentSelector);
    if (!contentRoot) return null;
    const bodyDataset = doc.body?.dataset;
    return {
      title,
      bodyDataset: bodyDataset ? { ...bodyDataset } : {},
      contentHtml: contentRoot.innerHTML,
      fullDoc: doc
    };
  } catch (_error) {
    return null;
  }
}
