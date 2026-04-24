import { readAppProps } from '../../shared/app-props.js';
import { createLinksAppState } from './state.js';

export function resolveLinksAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="links"]');
  const props = readAppProps('links', root);
  const state = createLinksAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'links',
    root: appRoot,
    props,
    state
  };
}
