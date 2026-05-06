/**
 * SEO head tag synchronization for Pjax navigation
 *
 * After Pjax replaces #pjax-container, the <head> meta/link tags remain stale.
 * This module parses the response HTML and replays relevant SEO tags.
 */

const SEO_HEAD_SELECTORS = [
  "meta[name='description']",
  "meta[name='keywords']",
  "meta[name='robots']",
  "meta[name='google-site-verification']",
  "meta[name='baidu-site-verification']",
  "meta[name='msvalidate.01']",
  "meta[name='360-site-verification']",
  "meta[name='sogou_site_verification']",
  "meta[name='shenma-site-verification']",
  "meta[name='bytedance-verification-code']",
  "meta[name='yandex-verification']",
  "meta[name='p:domain_verify']",
  "meta[name='naver-site-verification']",
  "link[rel='canonical']",
  "link[rel='icon']",
  "link[rel='shortcut icon']",
  "link[rel='apple-touch-icon']",
  "meta[property^='og:']",
  "meta[property='og:type']",
  "meta[property='og:url']",
  "meta[property='og:site_name']",
  "meta[property='og:title']",
  "meta[property='og:description']",
  "meta[property='og:image']",
  "meta[property^='article:']",
  "meta[property='article:published_time']",
  "meta[property='article:modified_time']",
  "meta[property='article:author']",
  "meta[property='article:tag']",
  "meta[name^='twitter:']",
  "meta[name='twitter:card']",
  "meta[name='twitter:creator']",
  "meta[name='twitter:title']",
  "meta[name='twitter:description']",
  "meta[name='twitter:image']",
  "script[type='application/ld+json']"
];

function resolveSeoUrl(doc) {
  return doc.querySelector("link[rel='canonical']")?.href
    || doc.querySelector("meta[property='og:url']")?.content
    || window.location.href;
}

export function syncSeoHeadFromResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return;

  const parser = new DOMParser();
  const nextDoc = parser.parseFromString(responseText, 'text/html');
  const currentHead = document.head;
  const nextHead = nextDoc.head;

  if (!currentHead || !nextHead) return;

  if (nextDoc.title) {
    document.title = nextDoc.title;
  }

  SEO_HEAD_SELECTORS.forEach((selector) => {
    currentHead.querySelectorAll(selector).forEach((node) => node.remove());
    nextHead.querySelectorAll(selector).forEach((node) => {
      currentHead.appendChild(node.cloneNode(true));
    });
  });

  const title = nextDoc.title || document.title;
  const url = resolveSeoUrl(nextDoc);
  document.dispatchEvent(new CustomEvent('pjax:seo-updated', {
    detail: { title, url }
  }));
}
