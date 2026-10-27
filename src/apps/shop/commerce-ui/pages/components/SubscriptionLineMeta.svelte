<script>
import { createCommerceScope } from "../../lifecycle.js";
import "../../styles/subscription.css";
import { createQuery, getQueryClientContext, QueryClient } from "@tanstack/svelte-query";
import ky from "ky";
import i18n from "../../i18n";
import { resolveSubscriptionLine } from "../../utils/subscription-line";
let {
  productId,
  variantId,
  snapshot,
  enabled = true
} = $props();
let ownsQueryClient = false;
function resolveQueryClient() {
  try {
    return getQueryClientContext();
  } catch {
    ownsQueryClient = true;
    return new QueryClient();
  }
}
const queryClient = resolveQueryClient();
createCommerceScope(ownsQueryClient ? queryClient : undefined);
const query = createQuery(
  () => ({
    queryKey: ["shop:subscription-product", productId],
    queryFn: async ({ signal }) => {
      return await ky.get(
        `/apis/uc.api.ecommerce.halo.run/v1alpha1/subscription-products/${productId}`, { signal }
      ).json();
    },
    enabled: enabled && !!productId && !snapshot?.planName,
    retry: false
  }),
  () => queryClient
);
const line = $derived(resolveSubscriptionLine(query.data, variantId, snapshot));
const periodLabel = $derived.by(() => {
  if (!line) return "";
  const modeLabel = line.billingMode ? String(
    $i18n.t("subscription.billingMode." + line.billingMode, {
      defaultValue: line.billingMode
    })
  ) : "";
  const period = line.billingPeriod ? String(
    $i18n.t("subscription.billingPeriod." + line.billingPeriod, {
      defaultValue: line.billingPeriod
    })
  ) : "";
  if (!period || line.billingMode === "LIFETIME") {
    return modeLabel;
  }
  if (line.billingMode === "ONE_TIME") {
    return [modeLabel, period].filter(Boolean).join(" ");
  }
  return period;
});
</script>

{#if line}
  <span class="shop-subscription-line">
    {line.name}
    {#if periodLabel}
      <span class="shop-subscription-line__period">{periodLabel}</span>
    {/if}
  </span>
{/if}
