import { getWindowAppContent, hasNavigationTitle, isAuthenticationResponse } from './navigation-response.js';
import { isCompleteHtmlDocument, isHtmlDocumentResponse } from './html-document.js';

export function assertDocsDocument(doc) {
  const frames = doc.querySelectorAll('#window-frame-root');
  if (doc.body.dataset.appId !== 'docsme' || frames.length !== 1
    || !hasNavigationTitle(doc)
    || !getWindowAppContent(doc, frames[0], 'docsme')) {
    throw new Error('Incomplete Docsme response');
  }
}

export async function validateDocsFallback(response) {
  if (response.status === 200 && /^\/docs(?:\/|$)/.test(new URL(response.url).pathname)) {
    if (!isHtmlDocumentResponse(response)) throw new Error('Expected Docsme HTML');
    const html = await response.clone().text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const { appId, pageApp, pageMode } = doc.body.dataset;
    // A protected document can return the sign-in screen at its original URL.
    // Deliver it to navigation for native handoff, never to the preload cache.
    if (!isAuthenticationResponse({ url: response.url, appId: appId || pageApp, pageMode })) {
      if (!isCompleteHtmlDocument(html)) throw new Error('Incomplete Docsme response');
      assertDocsDocument(doc);
    }
  }
  return response;
}
