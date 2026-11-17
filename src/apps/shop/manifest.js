export const shopAppManifest = {
  appId: 'shop',
  windowVariant: 'shop',
  supportsSameAppPjax: true,
  sameVariantPageModes: [
    'browser-shop-products',
    'browser-shop-product',
    'browser-shop-cart',
    'browser-shop-checkout',
    'browser-shop-payments',
    'browser-shop-order'
  ],
  entry: 'src/apps/shop/entry.js',
  assetDirectory: 'shop'
};
