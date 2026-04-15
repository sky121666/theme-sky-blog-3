import { readAppProps } from '../../shared/app-props.js';
import { createReaderAppState } from './state.js';

export function resolveReaderAppProtocol(root = document) {
  const appRoot = root.querySelector('[data-app-root="reader"]');
  const props = readAppProps('reader', root);
  const state = createReaderAppState();

  if (props?.data?.contentType) {
    state.contentType = props.data.contentType;
  }

  return {
    appId: 'reader',
    root: appRoot,
    props,
    state
  };
}
