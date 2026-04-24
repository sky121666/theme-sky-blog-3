import { readAppProps } from '../../shared/app-props.js';
import { createBangumisAppState } from './state.js';

export function resolveBangumisAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="bangumis"]');
  const props = readAppProps('bangumis', root);
  const state = createBangumisAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'bangumis',
    root: appRoot,
    props,
    state
  };
}
