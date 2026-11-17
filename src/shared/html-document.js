// Theme routes return complete HTML documents. DOMParser alone also accepts
// fragments and silently creates the missing body/end tags.
export function isCompleteHtmlDocument(html) {
  return typeof html === 'string' && /<html(?:\s|>)/i.test(html)
    && /<body(?:\s|>)/i.test(html) && /<\/body\s*>\s*<\/html\s*>\s*$/i.test(html);
}

export function isHtmlDocumentResponse(response) {
  return response?.status === 200
    && /^text\/html(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')
    && response.headers?.get('content-range') == null;
}
