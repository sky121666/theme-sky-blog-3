import { isCompleteHtmlDocument, isHtmlDocumentResponse } from '../../../../../shared/html-document.js';
const SDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
const SDK_DEADLINE_MS = 15000;
const DATA_SLOT = '__SIGNED_SHARE_DATA__';
// SEO Tools 1.11.1 SignatureContext.generateScript(). This is a data envelope
// recognizer, never executable input. Reject unknown envelopes rather than eval.
const SHARE_ENVELOPE = `(function () {
    if (!/MicroMessenger|QQ\\//i.test(navigator.userAgent)) return;
    var data = ${DATA_SLOT};
    function configure() {
        wx.config(data.config);
        wx.ready(function () {
            wx.updateAppMessageShareData(data.share);
            wx.updateTimelineShareData(data.share);
        });
        wx.error(function (error) {
            console.error("Wechat JS-SDK config error:", error);
        });
    }
    if (window.wx) {
        configure();
    } else {
        var sdk = document.createElement("script");
        sdk.src = "${SDK_URL}";
        sdk.async = true;
        sdk.onload = configure;
        document.head.appendChild(sdk);
    }
})();`;

let desired = null;
let generation = 0;
let phase = 'idle';
let sdkLoading = null;
let initialized = false;
let readyTimer = 0;
let localPreparationGeneration = 0;

function isShareBrowser() {
  return /MicroMessenger|QQ\//i.test(window.navigator.userAgent);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function httpUrl(value, allowEmpty = false) {
  if (allowEmpty && value === '') return true;
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch (_error) {
    return false;
  }
}

function validShareData(data) {
  if (!exactKeys(data, ['config', 'share'])
    || !exactKeys(data.config, ['appId', 'debug', 'timestamp', 'nonceStr', 'signature', 'jsApiList'])
    || !exactKeys(data.share, ['title', 'desc', 'link', 'imgUrl'])) return false;
  const { config, share } = data;
  return typeof config.appId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(config.appId)
    && typeof config.debug === 'boolean'
    && Number.isSafeInteger(config.timestamp) && config.timestamp > 0
    && typeof config.nonceStr === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(config.nonceStr)
    && typeof config.signature === 'string' && /^[a-f\d]{40}$/i.test(config.signature)
    && Array.isArray(config.jsApiList) && config.jsApiList.length === 2
    && new Set(config.jsApiList).size === 2
    && config.jsApiList.includes('updateAppMessageShareData')
    && config.jsApiList.includes('updateTimelineShareData')
    && typeof share.title === 'string' && share.title.length > 0 && share.title.length <= 16384
    && typeof share.desc === 'string' && share.desc.length <= 32768
    && httpUrl(share.link) && httpUrl(share.imgUrl, true);
}

function readShareData(doc) {
  let found = null;
  for (const script of doc?.head?.querySelectorAll('script:not([src])') || []) {
    const source = (script.textContent || '').replace(/\r\n/g, '\n').trim();
    const start = source.indexOf('    var data = ');
    if (start < 0) continue;
    const dataStart = start + '    var data = '.length;
    const dataEnd = source.indexOf(';\n    function configure()', dataStart);
    if (dataEnd < 0 || source.slice(0, dataStart) + DATA_SLOT + source.slice(dataEnd) !== SHARE_ENVELOPE) continue;
    try {
      const data = JSON.parse(source.slice(dataStart, dataEnd));
      if (!validShareData(data) || found) return null;
      found = { data, key: JSON.stringify(data) };
    } catch (_error) { return null; }
  }
  return found;
}

function availableSdk() {
  const sdk = window.wx;
  return sdk && ['config', 'ready', 'error', 'updateAppMessageShareData', 'updateTimelineShareData']
    .every((name) => typeof sdk[name] === 'function') ? sdk : null;
}

function loadSdk() {
  if (availableSdk()) return Promise.resolve(availableSdk());
  if (sdkLoading) return sdkLoading;
  let script = Array.from(document.querySelectorAll('script[src]'))
    .find((node) => node.src === SDK_URL);
  const created = !script;
  script ||= document.createElement('script');
  // The official inline bootstrap captures the cold page. Take over its pending
  // load handler so it cannot configure page A after Pjax has committed page B.
  script.onload = null;
  const pending = new Promise((resolve, reject) => {
    let timer = 0;
    const finish = (error) => {
      window.clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (error) {
        script.remove();
        reject(error);
      } else resolve(availableSdk());
    };
    const onLoad = () => finish(availableSdk() ? null : new Error('WeChat SDK is unavailable'));
    const onError = () => finish(new Error('WeChat SDK could not load'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    timer = window.setTimeout(() => finish(new Error('WeChat SDK load timed out')), SDK_DEADLINE_MS);
    if (created) {
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  sdkLoading = pending;
  pending.catch(() => { if (sdkLoading === pending) sdkLoading = null; });
  return pending;
}

function applyDesiredShare() {
  if (!desired || phase === 'pending' || phase === 'ready') return;
  const target = desired;
  // A retry is a new attempt even if the server-signed data is unchanged.
  const intent = ++generation;
  phase = 'pending';
  const current = () => intent === generation && desired === target;
  const failed = () => {
    if (!current()) return;
    window.clearTimeout(readyTimer);
    phase = 'failed';
  };
  loadSdk().then((sdk) => {
    if (!current()) return;
    readyTimer = window.setTimeout(failed, SDK_DEADLINE_MS);
    sdk.config(target.data.config);
    sdk.ready(() => {
      if (!current() || phase !== 'pending') return;
      window.clearTimeout(readyTimer);
      try {
        sdk.updateAppMessageShareData(target.data.share);
        sdk.updateTimelineShareData(target.data.share);
        phase = 'ready';
      } catch (_error) { failed(); }
    });
    sdk.error(failed);
  }).catch(failed);
}

export function syncWechatShareFromDocument(doc) {
  if (!isShareBrowser()) return;
  const next = readShareData(doc);
  if (desired?.key !== next?.key || (!desired && !next)) {
    generation += 1;
    window.clearTimeout(readyTimer);
    desired = next;
    phase = 'idle';
  }
  applyDesiredShare();
}

export function requiresWechatShareDocumentNavigation(doc) {
  // The SDK has no API to forget a previously configured custom share. A real
  // document navigation restores native behavior when the target has no signed
  // config; never manufacture a new signature or keep the source page's link.
  return isShareBrowser() && desired !== null && readShareData(doc) === null;
}

export async function prepareWechatShareLocalNavigation(targetUrl, { signal } = {}) {
  if (!isShareBrowser() || desired === null) return null;
  const source = desired;
  const preparation = ++localPreparationGeneration;
  const target = new URL(targetUrl, window.location.href);
  if (target.origin !== window.location.origin || !['http:', 'https:'].includes(target.protocol)
    || target.username || target.password) {
    throw new TypeError('WeChat share preparation requires a same-origin document');
  }
  target.hash = '';
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (preparation !== localPreparationGeneration || desired !== source) {
      throw new DOMException('WeChat share preparation was superseded', 'AbortError');
    }
  };
  assertCurrent();
  const response = await window.fetch(target.href, {
    method: 'GET', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'text/html' }, signal
  });
  assertCurrent();
  if (!isHtmlDocumentResponse(response) || new URL(response.url).origin !== window.location.origin) {
    throw new Error('WeChat share preparation did not return a same-origin HTML document');
  }
  const html = await response.text();
  assertCurrent();
  if (!isCompleteHtmlDocument(html)) throw new Error('Incomplete WeChat share document');
  // Merely prepare inert server HTML. The navigation owner checks the restricted
  // signed envelope with requiresWechatShareDocumentNavigation(), commits its
  // local history/UI, then passes this document to syncWechatShareFromDocument().
  // A missing signature is intentionally distinguishable from a skipped request.
  return new DOMParser().parseFromString(html, 'text/html');
}

export function initializeWechatShare() {
  if (initialized || !isShareBrowser()) return;
  initialized = true;
  syncWechatShareFromDocument(document);
  // Retry only on a real recovery signal or another authoritative response.
  // Missing server credentials are not replaced with invented client signatures.
  window.addEventListener('online', applyDesiredShare);
  window.addEventListener('pageshow', applyDesiredShare);
}
