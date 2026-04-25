import { readAppProps } from '../../shared/app-props.js';
import { createDocsmeAppState } from './state.js';

export function resolveDocsmeAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="docsme"]');
  const props = readAppProps('docsme', root);
  const state = createDocsmeAppState();

  if (props?.data?.scene) {
    state.scene = props.data.scene;
  } else if (appRoot?.dataset.docsmeScene) {
    state.scene = appRoot.dataset.docsmeScene;
  }

  return {
    appId: 'docsme',
    root: appRoot,
    props,
    state
  };
}
