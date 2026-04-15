import { readAppProps } from '../../shared/app-props.js';
import { createPhotosAppState } from './state.js';

export function resolvePhotosAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="photos"]');
  const props = readAppProps('photos', root);
  const state = createPhotosAppState();

  if (props?.data?.view) {
    state.view = props.data.view;
  }

  return {
    appId: 'photos',
    root: appRoot,
    props,
    state
  };
}
