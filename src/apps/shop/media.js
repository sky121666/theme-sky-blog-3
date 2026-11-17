// Halo renders the original src and adds a srcset only when the storage provider
// supports thumbnails. Never derive URLs from the attachment path on the client.
function gallerySlot(image) {
  const width = Math.ceil(image.getBoundingClientRect().width);
  return width > 0 ? width + 'px' : image.dataset.shopGallerySizes;
}

export function selectShopImage(image, button) {
  const preview = button.querySelector('img');
  const candidates = preview?.getAttribute('srcset');
  if (candidates) {
    const sizes = gallerySlot(image);
    if (sizes) image.sizes = sizes;
    image.srcset = candidates;
  } else {
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
  }
  image.src = button.dataset.shopThumbnail;
}

export function hydrateShopMedia(app, signal) {
  const catalog = [...app.querySelectorAll('[data-shop-catalog] .shop-catalog-card > img[srcset]')];
  const gallery = app.querySelector('[data-shop-gallery-main]');
  if (gallery?.sizes) gallery.dataset.shopGallerySizes = gallery.sizes;
  const hero = app.querySelector('.shop-hero-image[srcset]');

  // The shop window can resize independently of the viewport. The SSR slot and
  // native lazy auto-sizing also work without this enhancement. One catalog
  // measurement covers the entire uniform grid, including layout/size changes.
  const Resize = app.ownerDocument.defaultView.ResizeObserver;
  const observer = Resize && new Resize(entries => {
    for (const { target, contentRect: { width } } of entries) {
      if (!(width > 0)) continue;
      const px = Math.ceil(width) + 'px';
      if (target === catalog[0]) {
        for (const img of catalog) {
          if (img.hasAttribute('srcset') && img.sizes !== 'auto, ' + px) img.sizes = 'auto, ' + px;
        }
      } else if (target.hasAttribute('srcset') && target.sizes !== px) target.sizes = px;
    }
  });
  for (const img of [catalog[0], gallery, hero]) if (img) observer?.observe(img);

  // src is the original asset. Dropping the failed candidate group gives it
  // one independent chance, including when the error preceded app hydration.
  const productMedia = 'img[srcset][src]:is([data-shop-media], [data-shop-gallery-main], [data-shop-thumbnail] img, .shop-catalog-card > img, .shop-product-identity-image, .shop-product-preview-image)';
  const restoreOriginal = img => {
    if (img?.matches?.(productMedia) && img.complete && !img.naturalWidth && img.currentSrc) {
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
    }
  };
  app.addEventListener('error', event => restoreOriginal(event.target), { capture: true, signal });
  app.querySelectorAll(productMedia).forEach(restoreOriginal);
  return () => observer?.disconnect();
}
