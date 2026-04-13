import '../../../styles/widgets/editor.css';
import { dragMethods } from './drag.js';
import { editModeMethods } from './edit-mode.js';
import { installDesktopDebugBridge } from '../../widgets/debug-bridge.js';

export function applyEditingRuntime(state) {
  installDesktopDebugBridge();
  const runtimeMethods = {
    ...dragMethods,
    ...editModeMethods
  };
  Object.assign(state, runtimeMethods);
  return runtimeMethods;
}
