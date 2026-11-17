// Only native prose/figure markup is ours to enhance. Links, pictures,
// controls, gallery blocks and custom elements retain their own media policy.
function plainPostImage(img, article) {
  for (let node = img; node !== article; node = node.parentElement) {
    if (!node || !node.matches('img, p, figure, div, blockquote, li, ol, ul, span')) return false;
    if (node.matches('[role], [tabindex], [contenteditable], [hidden], [inert], [aria-hidden], [usemap], [ismap]')) return false;
    if ([...node.classList].some(name => !['column','columns'].includes(name))) return false;
    for (const attr of node.getAttributeNames()) {
      if (attr.startsWith('on')) return false;
      if (attr.startsWith('data-') && !(attr === 'data-content-type' && node.matches('figure[data-content-type="image"]'))) return false;
    }
  }
  return true;
}

export function prepareSwupPostImages(target) {
  const doc = target?.ownerDocument;
  if (!doc || doc.defaultView || doc.body.dataset.pageApp !== 'reader') return;
  const article = target.querySelector('[data-app-root="reader"] .post-reader-frame[data-post-name] #article-content.post-content');
  if (!article) return;
  article.setAttribute('data-swup-post-native-media', '');
  let first = true;
  for (const img of article.querySelectorAll('img[src]')) {
    if (!img.getAttribute('src')?.trim() || !plainPostImage(img, article)) continue;
    if (first) { first = false; continue; }
    if (!img.hasAttribute('loading') && !img.hasAttribute('fetchpriority')) img.loading = 'lazy';
  }
}
