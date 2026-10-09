import { readAppProps } from '../../shared/app-props.js';

export function resolveShopAppProtocol(root = document) {
  const appRoot = root.matches?.('[data-app-root="shop"]') ? root : root.querySelector('[data-app-root="shop"]');
  return {
    appId: 'shop',
    root: appRoot,
    props: readAppProps('shop', root),
    state: { scene: appRoot?.dataset.shopScene || 'products' }
  };
}
