import { readAppProps } from '../../../shared/app-props.js';
import { createExplorerCategoriesState } from './state.js';

export function resolveExplorerCategoriesProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="explorer-categories"]');
  const props = readAppProps('explorer-categories', root);
  const state = createExplorerCategoriesState();

  if (props?.data?.view) {
    state.view = props.data.view;
  }

  return {
    appId: 'explorer-categories',
    root: appRoot,
    props,
    state
  };
}
