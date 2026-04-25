import { readAppProps } from '../../shared/app-props.js';
import { createEquipmentsAppState } from './state.js';

export function resolveEquipmentsAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="equipments"]');
  const props = readAppProps('equipments', root);
  const state = createEquipmentsAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  }

  return {
    appId: 'equipments',
    root: appRoot,
    props,
    state
  };
}
