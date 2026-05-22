import { readAppProps } from '../../shared/app-props.js';
import { createDoubanAppState } from './state.js';

export function resolveDoubanAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="douban"]');
  const props = readAppProps('douban', root);
  const state = createDoubanAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'douban',
    root: appRoot,
    props,
    state
  };
}
