import { readAppProps } from '../../../shared/app-props.js';
import { createExplorerArchivesState } from './state.js';

export function resolveExplorerArchivesProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="explorer-archives"]');
  const props = readAppProps('explorer-archives', root);
  const state = createExplorerArchivesState();

  if (props?.data?.view) {
    state.view = props.data.view;
  }

  return {
    appId: 'explorer-archives',
    root: appRoot,
    props,
    state
  };
}
