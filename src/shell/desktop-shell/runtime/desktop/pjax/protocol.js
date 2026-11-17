/**
 * Pjax Protocol Sync
 * Parses body dataset attributes from Pjax response text and synchronizes them to the current document body.
 */

const ATTRS_TO_SYNC = ['errorPage', 'pageMode', 'pageApp', 'appId', 'windowVariant', 'windowMetricsKey'];

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
