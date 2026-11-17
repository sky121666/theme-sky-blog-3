<svelte:options
  customElement={{
    tag: 'shop-page-cart',
    shadow: 'none',
    props: {
      csrfToken: { reflect: true, type: 'String', attribute: 'csrftoken' },
    },
  }}
/>

<script>
import { createCommerceScope } from "../lifecycle.js";
import { createQuery, QueryClient, setQueryClientContext } from "@tanstack/svelte-query";
import Decimal from "decimal.js";
import ky from "ky";
import CartItem from "./components/CartItem.svelte";
import { formatPrice } from "../utils/price";
import { Toaster } from "svelte-sonner";
import { fade } from "svelte/transition";
import i18n from "../i18n";
let { csrfToken } = $props();
let busyItems = $state({});
// Remember an unresolved deletion even when a cart read fails and the row unmounts.
let removalReviews = $state({});
function setRemovalReview(id, review) {
  if (review) removalReviews[id] = review;
  else delete removalReviews[id];
}
function onItemBusyChange(id, busy) {
  if (busy) busyItems[id] = true;
  else delete busyItems[id];
}
const hasPendingItem = $derived(Object.values(busyItems).some(Boolean));
const queryClient = new QueryClient();
const lifecycle = createCommerceScope(queryClient);
setQueryClientContext(queryClient);
const query = createQuery(
  () => ({
    queryKey: ["shop:cart:items"],
    retry: false,
    queryFn: async ({ signal }) => {
      return await ky.get("/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items", { signal }).json();
    }
  }),
  () => queryClient
);
const checkoutableItems = $derived((query.data ?? []).filter((item) => item.productVariant?.pricingType !== 'INQUIRY'));
const hasRemovalReview = $derived((query.data ?? []).some(item => removalReviews[item.id]));
const checkoutBlocked = $derived(!checkoutableItems.length || !query.isSuccess || query.isFetching || query.isPaused || hasPendingItem || hasRemovalReview);
$effect(() => {
  if (!query.isSuccess || query.isFetching) return;
  const present = new Set(query.data.map(item => String(item.id)));
  for (const id of Object.keys(removalReviews)) if (!present.has(id)) delete removalReviews[id];
});
const excludedCount = $derived((query.data ?? []).length - checkoutableItems.length);
function calculateItemTotal(item) {
  const price = new Decimal(item.productVariant?.price || 0);
  const quantity = new Decimal(item.quantity || 1);
  return price.times(quantity).toNumber();
}
const total = $derived.by(() => {
  let result = new Decimal(0);
  for (const item of checkoutableItems) {
    result = result.add(calculateItemTotal(item));
  }
  return result.toNumber();
});
function entryDuration() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
}
</script>

<Toaster richColors position="top-center" />

<div class="shop-entry">
  <div class="shop-entry__header">
    <h1 class="shop-entry__title">{$i18n.t('cart.title')}</h1>
    <p class="shop-entry__subtitle">
      {$i18n.t('cart.subtitle', { count: query.data?.length ?? 0 })}
    </p>
  </div>

  <div class="shop-cart">
    {#if query.isLoading}
      <span role="status">{$i18n.t('common.loading')}</span>
    {:else if query.isError}
      <div class="shop-cart__error" role="alert">
        <p>{$i18n.t('cart.loadFailed')}</p>
        <button type="button" class="shop-btn shop-btn-secondary shop-btn-sm" onclick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? $i18n.t('common.loading') : $i18n.t('common.retry')}
        </button>
      </div>
    {:else if query.data?.length === 0}
      <span>{$i18n.t('cart.empty')}</span>
    {:else}
      <div class="shop-cart__items" transition:fade={{ duration: entryDuration() }}>
        {#each query.data ?? [] as item (item.id)}
          <CartItem {item} onBusyChange={onItemBusyChange} removalReview={removalReviews[item.id]} onRemovalReview={setRemovalReview} />
        {/each}
      </div>
    {/if}

    <div class="shop-cart-summary shop-card" aria-busy={query.isFetching || hasPendingItem} data-pending={query.isFetching || hasPendingItem}>
      <h2 class="shop-card__title">{$i18n.t('cart.summaryTitle')}</h2>
      {#if excludedCount > 0}
        <p class="shop-tip" role="status">{$i18n.t('cart.inquiryExcluded', { count: excludedCount })}</p>
      {/if}
      <div class="shop-cart-summary__row">
        <span>{$i18n.t('cart.itemsTotal')}</span>
        <span class="shop-cart-summary__amount">{formatPrice(total || 0)}</span>
      </div>
      <div class="shop-cart-summary__row">
        <span>{$i18n.t('cart.shipping')}</span>
        <span>{$i18n.t('cart.pendingCalculation')}</span>
      </div>
      <div class="shop-divider"></div>
      <div class="shop-cart-summary__row shop-cart-summary__row--total">
        <span>{$i18n.t('cart.total')}</span>
        <span class="shop-cart-summary__amount">{formatPrice(total || 0)}</span>
      </div>
      <div class="shop-cart-summary__actions">
        <form action="/shop/checkout/prepare" method="POST" onsubmit={event => { if (checkoutBlocked) event.preventDefault(); }}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="source" value="CART" />
          {#each checkoutableItems as item, index}
            <input type="hidden" name="items[{index}].cartItemId" value={item.id} />
            <input type="hidden" name="items[{index}].quantity" value={item.quantity} />
          {/each}
          <button
            class="shop-btn shop-btn-primary shop-btn-lg"
            disabled={checkoutBlocked}
          >
            {$i18n.t('cart.proceedToCheckout')}
          </button>
        </form>
        <a href="/shop/products" class="shop-btn shop-btn-secondary shop-btn-lg">
          {$i18n.t('cart.continueShopping')}
        </a>
      </div>
    </div>
  </div>
</div>
