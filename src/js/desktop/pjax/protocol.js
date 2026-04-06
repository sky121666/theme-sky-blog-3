/**
 * Pjax Protocol Sync
 * Parses body dataset attributes from Pjax response text and synchronizes them to the current document body.
 */

export function syncBodyDatasetFromResponse(responseText) {
  if (!responseText) return;

  try {
    // We extract the <body ...> tag and parse its data attributes
    const bodyTagMatch = responseText.match(/<body[^>]*>/i);
    if (!bodyTagMatch) return;
    
    const bodyString = bodyTagMatch[0];
    
    // Create a dummy element to let browser parse attributes natively
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = bodyString.replace('<body', '<div').replace('>', '></div>');
    
    const dummyNode = tempDiv.firstElementChild;
    if (!dummyNode) return;
    
    // List of dataset properties we want to sync
    const attrsToSync = ['errorPage', 'pageMode', 'pageApp', 'windowVariant', 'windowMetricsKey'];
    
    attrsToSync.forEach(key => {
      const val = dummyNode.dataset[key];
      if (val !== undefined && val !== null) {
        document.body.dataset[key] = val;
      } else {
        delete document.body.dataset[key];
      }
    });

  } catch (error) {
    console.warn('[pjax:protocol] failed to sync body dataset', error);
  }
}
