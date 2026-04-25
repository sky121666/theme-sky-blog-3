import { readAppProps } from '../../shared/app-props.js';
import { createSteamAppState } from './state.js';

export function resolveSteamAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="steam"]');
  const props = readAppProps('steam', root);
  const state = createSteamAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'steam',
    root: appRoot,
    props,
    state
  };
}
