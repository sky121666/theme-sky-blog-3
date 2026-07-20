/**
 * Client-side SEO head synchronization for initial load and Pjax navigation.
 *
 * When SEO Tools is installed, its raw server response remains authoritative.
 * After theme JavaScript starts, this module fills configured missing tags and
 * removes semantic duplicates without replacing valid plugin output.
 */

const THEME_FALLBACK_ATTR = 'data-theme-seo-fallback';
const FALLBACK_CONFIG_SELECTOR = 'script[data-theme-seo-fallback-config]';

// Keep these selectors non-overlapping. Pjax replays every matching node, so a
// broad selector plus a specific child selector would clone the same tag twice.
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
  "meta[property^='article:']",
  "meta[name^='twitter:']",
  "script[type='application/ld+json']",
  FALLBACK_CONFIG_SELECTOR
];

const CRITICAL_SEO_TAGS = [
  {
    key: 'description',
    selector: "meta[name='description']",
    tagName: 'meta',
    identityAttribute: 'name',
    identityValue: 'description',
    fallback: (config) => config.hasMetaFallback ? config.description : ''
  },
  {
    key: 'canonical',
    selector: "link[rel='canonical']",
    tagName: 'link',
    identityAttribute: 'rel',
    identityValue: 'canonical',
    valueAttribute: 'href',
    fallback: (config) => config.canonical
  },
  {
    key: 'og:url',
    selector: "meta[property='og:url']",
    tagName: 'meta',
    identityAttribute: 'property',
    identityValue: 'og:url',
    fallback: (config) => config.canonical
  },
  {
    key: 'og:site_name',
    selector: "meta[property='og:site_name']",
    tagName: 'meta',
    identityAttribute: 'property',
    identityValue: 'og:site_name',
    fallback: (config) => config.canonical ? config.siteName : ''
  },
  {
    key: 'og:title',
    selector: "meta[property='og:title']",
    tagName: 'meta',
    identityAttribute: 'property',
    identityValue: 'og:title',
    fallback: (config) => config.hasSocialFallback ? config.title : ''
  },
  {
    key: 'og:type',
    selector: "meta[property='og:type']",
    tagName: 'meta',
    identityAttribute: 'property',
    identityValue: 'og:type',
    fallback: (config) => config.hasSocialFallback ? config.pageType : ''
  },
  {
    key: 'og:description',
    selector: "meta[property='og:description']",
    tagName: 'meta',
    identityAttribute: 'property',
    identityValue: 'og:description',
    fallback: (config) => config.hasSocialFallback ? config.description : ''
  },
  {
    key: 'og:image',
    selector: "meta[property='og:image']",
    tagName: 'meta',
    identityAttribute: 'property',
    identityValue: 'og:image',
    allowMultiple: true,
    fallback: (config) => config.hasSocialFallback ? config.image : ''
  },
  {
    key: 'twitter:card',
    selector: "meta[name='twitter:card']",
    tagName: 'meta',
    identityAttribute: 'name',
    identityValue: 'twitter:card',
    fallback: (config) => config.hasSocialFallback
      ? (config.image ? 'summary_large_image' : 'summary')
      : ''
  },
  {
    key: 'twitter:title',
    selector: "meta[name='twitter:title']",
    tagName: 'meta',
    identityAttribute: 'name',
    identityValue: 'twitter:title',
    fallback: (config) => config.hasSocialFallback ? config.title : ''
  },
  {
    key: 'twitter:description',
    selector: "meta[name='twitter:description']",
    tagName: 'meta',
    identityAttribute: 'name',
    identityValue: 'twitter:description',
    fallback: (config) => config.hasSocialFallback ? config.description : ''
  },
  {
    key: 'twitter:image',
    selector: "meta[name='twitter:image']",
    tagName: 'meta',
    identityAttribute: 'name',
    identityValue: 'twitter:image',
    fallback: (config) => config.hasSocialFallback ? config.image : ''
  }
];

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readFallbackConfig(doc) {
  const configNodes = Array.from(doc.head?.querySelectorAll(FALLBACK_CONFIG_SELECTOR) || []);
  const configNode = configNodes.at(-1);
  configNodes.slice(0, -1).forEach((node) => node.remove());

  const mode = normalizeValue(configNode?.dataset.mode).toLowerCase();
  return {
    mode,
    hasMetaFallback: mode === 'meta' || mode === 'full',
    hasSocialFallback: mode === 'full',
    title: normalizeValue(configNode?.dataset.title || doc.title),
    description: normalizeValue(configNode?.dataset.description),
    canonical: normalizeValue(configNode?.dataset.canonical),
    image: normalizeValue(configNode?.dataset.image),
    pageType: normalizeValue(configNode?.dataset.pageType) || 'website',
    siteName: normalizeValue(configNode?.dataset.siteName)
  };
}

function getTagValue(node, valueAttribute = 'content') {
  return normalizeValue(node.getAttribute(valueAttribute));
}

function reconcileCriticalTag(doc, definition, fallbackValue) {
  const head = doc.head;
  if (!head) return { added: 0, removed: 0 };

  const valueAttribute = definition.valueAttribute || 'content';
  const nodes = Array.from(head.querySelectorAll(definition.selector));
  const validNodes = nodes.filter((node) => getTagValue(node, valueAttribute));

  if (definition.allowMultiple) {
    const pluginNodes = validNodes.filter((node) => !node.hasAttribute(THEME_FALLBACK_ATTR));
    const retainedNodes = pluginNodes.length > 0 ? pluginNodes : validNodes.slice(-1);
    let removed = 0;
    nodes.forEach((node) => {
      if (!retainedNodes.includes(node)) {
        node.remove();
        removed += 1;
      }
    });

    if (retainedNodes.length > 0 || !fallbackValue) {
      return { added: 0, removed };
    }

    const node = doc.createElement(definition.tagName);
    node.setAttribute(definition.identityAttribute, definition.identityValue);
    node.setAttribute(valueAttribute, fallbackValue);
    node.setAttribute(THEME_FALLBACK_ATTR, definition.key);
    head.appendChild(node);
    return { added: 1, removed };
  }

  const preferredNode = [...validNodes].reverse().find((node) => !node.hasAttribute(THEME_FALLBACK_ATTR))
    || validNodes.at(-1);

  let removed = 0;
  nodes.forEach((node) => {
    if (node !== preferredNode) {
      node.remove();
      removed += 1;
    }
  });

  if (preferredNode || !fallbackValue) {
    return { added: 0, removed };
  }

  const node = doc.createElement(definition.tagName);
  node.setAttribute(definition.identityAttribute, definition.identityValue);
  node.setAttribute(valueAttribute, fallbackValue);
  node.setAttribute(THEME_FALLBACK_ATTR, definition.key);
  head.appendChild(node);
  return { added: 1, removed };
}

export function reconcileSeoHead(doc = document) {
  if (!doc?.head) return { added: 0, removed: 0 };

  const config = readFallbackConfig(doc);
  return CRITICAL_SEO_TAGS.reduce((summary, definition) => {
    const result = reconcileCriticalTag(doc, definition, normalizeValue(definition.fallback(config)));
    summary.added += result.added;
    summary.removed += result.removed;
    return summary;
  }, { added: 0, removed: 0 });
}

function resolveSeoUrl(doc) {
  const candidate = doc.querySelector("link[rel='canonical']")?.getAttribute('href')
    || doc.querySelector("meta[property='og:url']")?.getAttribute('content')
    || window.location.href;

  try {
    return new URL(candidate, window.location.href).href;
  } catch (_error) {
    return window.location.href;
  }
}

export function syncSeoHeadFromResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return;

  const parser = new DOMParser();
  const nextDoc = parser.parseFromString(responseText, 'text/html');
  const currentHead = document.head;
  const nextHead = nextDoc.head;

  if (!currentHead || !nextHead) return;

  reconcileSeoHead(nextDoc);

  if (nextDoc.title) {
    document.title = nextDoc.title;
  }

  SEO_HEAD_SELECTORS.forEach((selector) => {
    currentHead.querySelectorAll(selector).forEach((node) => node.remove());
    nextHead.querySelectorAll(selector).forEach((node) => {
      currentHead.appendChild(node.cloneNode(true));
    });
  });

  reconcileSeoHead(document);

  const title = nextDoc.title || document.title;
  const url = resolveSeoUrl(nextDoc);
  document.dispatchEvent(new CustomEvent('pjax:seo-updated', {
    detail: { title, url }
  }));
}
