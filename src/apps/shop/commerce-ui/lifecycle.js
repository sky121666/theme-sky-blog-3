import { onDestroy } from 'svelte';

/** Release only the transports and query cache owned by this component. */
export function createCommerceScope(queryClient) {
  const controller = new AbortController();
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    controller.abort();
    if (queryClient) {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
  };
  onDestroy(dispose);
  return { signal: controller.signal, isActive: () => active, dispose };
}
