import { readAppProps } from '../../shared/app-props.js';
import { createFriendsAppState } from './state.js';

export function resolveFriendsAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="friends"]');
  const props = readAppProps('friends', root);
  const state = createFriendsAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'friends',
    root: appRoot,
    props,
    state
  };
}
