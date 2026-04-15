import { readAppProps } from '../../../shared/app-props.js';
import { createExplorerTagsState } from './state.js';

export function resolveExplorerTagsProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="explorer-tags"]');
  const props = readAppProps('explorer-tags', root);
  const state = createExplorerTagsState();

  if (props?.data?.view) {
    state.view = props.data.view;
  }

  return {
    appId: 'explorer-tags',
    root: appRoot,
    props,
    state
  };
}
