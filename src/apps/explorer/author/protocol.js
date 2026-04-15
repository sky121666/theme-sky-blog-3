import { readAppProps } from '../../../shared/app-props.js';
import { createExplorerAuthorState } from './state.js';

export function resolveExplorerAuthorProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="explorer-author"]');
  const props = readAppProps('explorer-author', root);
  const state = createExplorerAuthorState();

  if (props?.data?.view) {
    state.view = props.data.view;
  }

  return {
    appId: 'explorer-author',
    root: appRoot,
    props,
    state
  };
}
