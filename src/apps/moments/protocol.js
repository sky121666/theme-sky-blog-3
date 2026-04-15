import { readAppProps } from '../../shared/app-props.js';
import { createMomentsAppState } from './state.js';

export function resolveMomentsAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="moments"]');
  const props = readAppProps('moments', root);
  const state = createMomentsAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'moments',
    root: appRoot,
    props,
    state
  };
}
