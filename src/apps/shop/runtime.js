import { buildShopBrowseUrl, isShopDescriptionVisible } from './model.js';
import { hydrateShopDisplay } from './display-runtime.js';
import { hydrateShopChrome } from './chrome.js';
import { createShopBrowseContext, getShopProductIdentity, readShopBrowseContext, readShopBrowseSourceContext, saveShopBrowseContext, sanitizeShopBrowseSource } from './browse-context.js';

const shopCleanups = new WeakMap();
const browseNavigationStates = new WeakMap();

export function hydrateShop(root) {
  const app = root?.matches?.('[data-app-root="shop"]') ? root : root?.querySelector('[data-app-root="shop"]');
  if (!app) return () => {};
  shopCleanups.get(app)?.();
  const controller = new AbortController();
  const disposeDisplay = hydrateShopDisplay(app);
  const disposeChrome = hydrateShopChrome(app);
  const markNavigationLinks = (node) => {
    if (!node?.querySelectorAll) return;
    const links = [...node.querySelectorAll('a[href]')];
    if (node.matches?.('a[href]')) links.push(node);
    for (const link of links) {
      if (link.target && link.target !== '_self') continue;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || link.hasAttribute('download')) continue;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin && (/^\/(shop|uc)(\/|$)/.test(url.pathname)
          || (url.pathname === '/login' && link.hasAttribute('data-shop-account-login')))) link.classList.add('pjax-link');
      } catch { /* Invalid or non-HTTP links retain their original behavior. */ }
    }
  };
  markNavigationLinks(app);
  const linkObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') markNavigationLinks(record.target);
      else record.addedNodes.forEach(markNavigationLinks);
    }
  });
  linkObserver.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  const options = { signal: controller.signal };
  const win = app.ownerDocument.defaultView;
  const doc = app.ownerDocument;
  const main = app.querySelector('.shop-main');
  // Same-app PJAX initializes the destination before committing history.
  const pageHref = app.closest('[data-pjax-target-url]')?.dataset.pjaxTargetUrl || win.location.href;
  const entryId = () => String(win.history.state?.uid || '');
  const navigationState = browseNavigationStates.get(win) || { candidate: null, returning: null };
  browseNavigationStates.set(win, navigationState);
  const storage = () => { try { return win.sessionStorage; } catch { return null; } };
  const navigationHref = (href) => { try { return new URL(href, win.location.href).href; } catch { return ''; } };
  let pendingSubmission = null;
  function releaseSubmission(submission = pendingSubmission) {
    if (!submission || submission !== pendingSubmission) return;
    for (const [button, disabled] of submission.buttons) button.disabled = disabled;
    pendingSubmission = null;
  }
  function getCommerceSubmission(event) {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof win.HTMLFormElement) || typeof win.pjax?.loadUrl !== 'function') return null;
    const submitter = event.submitter;
    const attribute = (name) => submitter?.getAttribute(`form${name}`) ?? form.getAttribute(name);
    const method = (attribute('method') || 'get').toUpperCase();
    const target = attribute('target') || doc.querySelector('base[target]')?.target || '_self';
    const enctype = (attribute('enctype') || 'application/x-www-form-urlencoded').toLowerCase();
    if (method !== 'POST' || target !== '_self'
      || !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(enctype)) return null;
    let url;
    try { url = new URL(attribute('action') || win.location.href, doc.baseURI); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== win.location.origin
      || !(/^\/shop\/(cart|checkout\/prepare)$/.test(url.pathname) || /^\/shop\/checkout\/[^/]+\/submit$/.test(url.pathname))) return null;
    const fields = new win.FormData(form, submitter);
    const requestOptions = { requestMethod: 'POST' };
    if (enctype === 'multipart/form-data') requestOptions.formData = fields;
    else requestOptions.requestParams = [...fields].map(([name, value]) => ({
      name: encodeURIComponent(name), value: encodeURIComponent(value instanceof win.File ? value.name : value)
    }));
    return { form, href: url.href, requestOptions };
  }
  function canHandleClick(event, link) {
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download')) return false;
    const target = link.target || doc.querySelector('base[target]')?.target || '_self';
    if (target !== '_self') return false;
    try {
      const url = new URL(link.href, win.location.href);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === win.location.origin;
    } catch { return false; }
  }
  let returnContext = null;
  let restoreFrame = 0;
  let restoreContext = null;
  const currentProduct = getShopProductIdentity(pageHref);
  if (app.dataset.shopScene === 'product' && currentProduct) {
    const candidate = navigationState.candidate;
    if (candidate?.accepted && candidate.record.productId === currentProduct.productId
      && candidate.record.productPath === currentProduct.productPath) {
      returnContext = { ...candidate.record, detailEntryId: pageHref === win.location.href ? entryId() : '' };
      saveShopBrowseContext(storage(), returnContext);
    } else {
      const saved = readShopBrowseContext(storage(), pageHref, pageHref === win.location.href ? entryId() : '') || readShopBrowseContext(storage(), pageHref);
      const referrerSource = sanitizeShopBrowseSource(pageHref, doc.referrer);
      const navigationType = win.performance.getEntriesByType('navigation')[0]?.type;
      if (saved && ((pageHref === win.location.href && saved.detailEntryId && saved.detailEntryId === entryId())
        || (!saved.detailEntryId && referrerSource === saved.href)
        || (!saved.detailEntryId && navigationType === 'reload'))) {
        returnContext = { ...saved, detailEntryId: entryId() };
        saveShopBrowseContext(storage(), returnContext);
      }
    }
    navigationState.candidate = null;
    if (returnContext) app.querySelectorAll('[data-shop-return]').forEach((link) => {
      link.href = returnContext.href;
      link.textContent = `‹ 返回${returnContext.label || '商品目录'}`;
    });
  } else if (app.dataset.shopScene === 'products') {
    const returning = navigationState.returning;
    if (returning?.accepted && returning.record.href === sanitizeShopBrowseSource(pageHref, pageHref)) {
      restoreContext = returning.record;
      navigationState.returning = null;
    } else if (entryId() && (navigationState.activeProduct?.sourceEntryId === entryId() || navigationState.activeProduct?.sourceEntryIds?.includes(entryId()))
      && navigationState.activeProduct.href === sanitizeShopBrowseSource(pageHref, pageHref)) {
      restoreContext = navigationState.activeProduct;
    } else if (pageHref === win.location.href) {
      restoreContext = readShopBrowseSourceContext(storage(), pageHref, entryId());
    }
  }
  if (returnContext) navigationState.activeProduct = returnContext;

  function restoreBrowseScroll() {
    if (!restoreContext || !main) return;
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(() => {
        if (!controller.signal.aborted) main.scrollTop = restoreContext.scrollTop;
      });
    });
  }
  restoreBrowseScroll();
  doc.addEventListener('theme:pjax-ready', (event) => {
    if (event.detail?.appId !== 'shop' || !doc.contains(app)) return;
    if (returnContext && getShopProductIdentity(event.detail.url)?.productPath === returnContext.productPath) {
      returnContext.detailEntryId = entryId();
      saveShopBrowseContext(storage(), returnContext);
    }
    if (restoreContext && app.dataset.shopScene === 'products' && restoreContext.href === sanitizeShopBrowseSource(win.location.href, win.location.href) && entryId()) {
      restoreContext.sourceEntryIds = [...new Set([restoreContext.sourceEntryId, ...(restoreContext.sourceEntryIds || []), entryId()].filter(Boolean))];
      saveShopBrowseContext(storage(), restoreContext);
    }
    restoreBrowseScroll();
  }, options);
  doc.addEventListener('theme:navigation-accepted', (event) => {
    const href = navigationHref(event.detail?.url);
    if (pendingSubmission?.href === href) pendingSubmission.intentId = event.detail?.intentId;
    for (const key of ['candidate', 'returning']) {
      const pending = navigationState[key];
      if (pending && pending.targetHref === href) pending.accepted = true;
      else navigationState[key] = null;
    }
  }, options);
  doc.addEventListener('theme:navigation-settled', (event) => {
    if (pendingSubmission?.intentId != null && pendingSubmission.intentId === event.detail?.intentId
      && pendingSubmission.href === navigationHref(event.detail?.url)) releaseSubmission();
    if (['ready', 'native'].includes(event.detail?.outcome)) return;
    const href = navigationHref(event.detail?.url);
    for (const key of ['candidate', 'returning']) {
      if (navigationState[key]?.targetHref === href) navigationState[key] = null;
    }
  }, options);
  win.addEventListener('popstate', () => {
    if (returnContext?.href === sanitizeShopBrowseSource(win.location.href, win.location.href)) {
      navigationState.returning = { record: returnContext, targetHref: returnContext.href, accepted: true };
    }
  }, options);
  win.addEventListener('pagehide', () => {
    const candidate = navigationState.candidate;
    if (candidate && (candidate.accepted || candidate.native)) saveShopBrowseContext(storage(), { ...candidate.record, detailEntryId: '' });
    const returning = navigationState.returning;
    if (returning && (returning.accepted || returning.native)) saveShopBrowseContext(storage(), { ...returning.record, returnRequested: true });
  }, options);
  const toggle = app.querySelector('[data-shop-menu-toggle]');
  const sidebar = app.querySelector('.shop-sidebar');
  const fallbackIdentityImage = (avatar) => {
    if (!avatar?.matches?.('img[data-shop-account-avatar], img[data-shop-category-image]')) return;
    avatar.hidden = true;
    const fallback = avatar.closest('.shop-account-picture')?.querySelector('[data-shop-account-fallback]');
    if (fallback) fallback.hidden = false;
  };
  app.addEventListener('error', (event) => fallbackIdentityImage(event.target), { ...options, capture: true });
  app.querySelectorAll('img[data-shop-account-avatar], img[data-shop-category-image]').forEach((avatar) => {
    if (avatar.complete && !avatar.naturalWidth) fallbackIdentityImage(avatar);
  });
  const mobile = window.matchMedia('(max-width: 767px)');
  let previousFocus = null;
  let menuFocusFrame = 0;

  function menuFields() {
    return [...(sidebar?.querySelectorAll('input, a, button, summary') || [])].filter((item) =>
      !item.disabled && !item.matches(':disabled') && (!item.closest('details:not([open])') || item.matches('summary'))
      && item.getClientRects().length && win.getComputedStyle(item).visibility === 'visible');
  }

  function setMenu(open, restoreFocus = true) {
    cancelAnimationFrame(menuFocusFrame);
    app.dataset.menuOpen = String(open);
    toggle?.setAttribute('aria-expanded', String(open));
    if (sidebar) sidebar.inert = mobile.matches && !open;
    if (open) {
      previousFocus = document.activeElement;
      menuFocusFrame = requestAnimationFrame(() => {
        if (app.dataset.menuOpen === 'true' && !controller.signal.aborted) menuFields()[0]?.focus();
      });
    } else if (restoreFocus) previousFocus?.focus();
  }

  function browse(changes) {
    const href = buildShopBrowseUrl(window.location.href, changes);
    if (typeof window.pjax?.loadUrl === 'function') window.pjax.loadUrl(href);
    else window.location.assign(href);
  }

  app.querySelectorAll('.shop-product-description').forEach((node) => {
    node.hidden = !isShopDescriptionVisible(app.dataset.shopDescriptions);
  });
  setMenu(false, false);
  mobile.addEventListener('change', () => setMenu(false, false), options);
  app.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-shop-search], [data-shop-filter]');
    if (!form) {
      const submission = getCommerceSubmission(event);
      if (!submission) return;
      event.preventDefault();
      if (pendingSubmission) return;
      const buttons = [...submission.form.elements].filter((element) => ['submit', 'image'].includes(element.type));
      pendingSubmission = { ...submission, intentId: null, buttons: buttons.map((button) => [button, button.disabled]) };
      const pending = pendingSubmission;
      buttons.forEach((button) => { button.disabled = true; });
      try {
        Promise.resolve(win.pjax.loadUrl(submission.href, { triggerElement: submission.form, requestOptions: submission.requestOptions }))
          .then((result) => { if (result === false || result?.kind === 'cancelled') releaseSubmission(pending); }, () => releaseSubmission(pending));
      } catch { releaseSubmission(pending); }
      return;
    }
    event.preventDefault();
    const fields = new FormData(form);
    const changes = {};
    for (const key of ['keyword', 'categoryId', 'sort', 'view']) {
      if (fields.has(key)) changes[key] = fields.get(key);
    }
    browse(changes);
  }, options);
  app.addEventListener('change', (event) => {
    const field = event.target.closest('[data-shop-filter] select');
    if (!field) return;
    browse({ [field.name]: field.value });
  }, options);
  app.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button?.hasAttribute('data-shop-menu-toggle')) setMenu(app.dataset.menuOpen !== 'true');
    if (button?.hasAttribute('data-shop-menu-close')) setMenu(false);
    if (button?.dataset.shopCarousel) {
      const carousel = document.getElementById(button.dataset.shopCarousel);
      if (carousel && app.contains(carousel)) carousel.scrollBy({
        left: carousel.clientWidth * (button.dataset.shopDirection === 'previous' ? -1 : 1),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
      });
    }
    if (button?.dataset.shopThumbnail) {
      const image = app.querySelector('[data-shop-gallery-main]');
      if (image) image.src = button.dataset.shopThumbnail;
      app.querySelectorAll('[data-shop-thumbnail]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    }
    const navigationLink = event.target.closest('a[href]');
    if (canHandleClick(event, navigationLink)) {
      const targetHref = navigationHref(navigationLink.href);
      if (navigationLink.hasAttribute('data-shop-return') && returnContext) {
        navigationState.returning = { record: returnContext, targetHref, accepted: false, native: typeof win.pjax?.loadUrl !== 'function' };
      } else if (app.dataset.shopScene === 'products') {
        const record = createShopBrowseContext({ sourceUrl: pageHref, productUrl: targetHref, scrollTop: main?.scrollTop, sourceEntryId: entryId(), label: app.querySelector('.shop-page-title')?.textContent.trim() || app.dataset.shopChromeTitle });
        if (record) navigationState.candidate = { record, targetHref, accepted: false, native: typeof win.pjax?.loadUrl !== 'function' };
      }
    }
    const link = event.target.closest('a[data-shop-browse]');
    if (!canHandleClick(event, link)) return;
    event.preventDefault();
    const changes = {};
    for (const key of ['keyword', 'category', 'sort', 'view', 'page']) {
      const datasetKey = `shop${key[0].toUpperCase()}${key.slice(1)}`;
      if (Object.hasOwn(link.dataset, datasetKey)) changes[key === 'category' ? 'categoryId' : key] = link.dataset[datasetKey];
    }
    browse(changes);
  }, options);
  app.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.dataset.menuOpen === 'true') {
      event.preventDefault();
      setMenu(false);
    }
    if (event.key !== 'Tab' || !mobile.matches || app.dataset.menuOpen !== 'true') return;
    const fields = menuFields();
    const first = fields[0];
    const last = fields.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }, options);
  const cleanup = () => {
    releaseSubmission();
    linkObserver.disconnect();
    disposeDisplay();
    disposeChrome();
    cancelAnimationFrame(menuFocusFrame);
    cancelAnimationFrame(restoreFrame);
    controller.abort();
    if (sidebar) sidebar.inert = false;
    for (const key of ['candidate', 'returning']) {
      if (navigationState[key] && !navigationState[key].accepted) navigationState[key] = null;
    }
    if (shopCleanups.get(app) === cleanup) shopCleanups.delete(app);
  };
  shopCleanups.set(app, cleanup);
  return cleanup;
}
