import { readAppProps } from '../../shared/app-props.js';
import { createAuthAppState } from './state.js';

export function resolveAuthAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="auth"]');
  const props = readAppProps('auth', root);
  const state = createAuthAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'auth',
    root: appRoot,
    props,
    state
  };
}
