const chromeCleanups = new WeakMap();

export function hydrateShopChrome(root) {
  const app = root?.matches?.('[data-app-root="shop"]') ? root : root?.querySelector('[data-app-root="shop"]');
  const main = app?.querySelector('.shop-main');
  const bar = app?.querySelector('[data-shop-titlebar]');
  const title = bar?.querySelector('[data-shop-titlebar-title]');
  if (!main || !bar || !title) return () => {};
  chromeCleanups.get(app)?.();

  const win = app.ownerDocument.defaultView;
  const controller = new win.AbortController();
  let frame = 0;
  let disposed = false;
  const returnLink = app.dataset.shopScene === 'product' ? main.querySelector('[data-shop-return]') : null;
  const returnParent = returnLink?.parentNode;
  const returnNext = returnLink?.nextSibling;
  if (returnLink) {
    bar.append(returnLink);
    bar.dataset.hasReturn = 'true';
  }

  function render() {
    if (disposed || !app.isConnected) return;
    const heading = main.querySelector('.shop-page-title, .shop-product-title, .shop-entry__title');
    const label = heading?.textContent.trim() || app.dataset.shopChromeTitle || '';
    if (title.textContent !== label) title.textContent = label;
    const scrolled = main.scrollTop > 0;
    const barHeight = bar.getBoundingClientRect().height;
    const passedHeading = heading
      ? heading.getBoundingClientRect().bottom <= main.getBoundingClientRect().top + barHeight
      : main.scrollTop >= barHeight;
    bar.dataset.scrolled = String(scrolled);
    bar.dataset.titleVisible = String(scrolled && Boolean(label) && passedHeading);
  }

  function schedule() {
    if (disposed || frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  main.addEventListener('scroll', schedule, { passive: true, signal: controller.signal });
  win.addEventListener('resize', schedule, { passive: true, signal: controller.signal });
  app.ownerDocument.addEventListener('theme:pjax-ready', (event) => {
    if (event.detail?.appId === 'shop') schedule();
  }, { signal: controller.signal });
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null;
  observer?.observe(main);
  observer?.observe(bar);
  const heading = main.querySelector('.shop-page-title, .shop-product-title, .shop-entry__title');
  if (heading) observer?.observe(heading);
  render();

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    observer?.disconnect();
    win.cancelAnimationFrame(frame);
    frame = 0;
    if (returnLink && returnParent) {
      returnParent.insertBefore(returnLink, returnNext?.parentNode === returnParent ? returnNext : null);
      delete bar.dataset.hasReturn;
    }
    if (chromeCleanups.get(app) === cleanup) chromeCleanups.delete(app);
  };
  chromeCleanups.set(app, cleanup);
  return cleanup;
}
