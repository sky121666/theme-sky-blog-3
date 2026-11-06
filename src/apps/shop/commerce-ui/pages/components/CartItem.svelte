<script>
import { onDestroy } from "svelte";
import { createCommerceScope } from "../../lifecycle.js";
import { createMutation, getQueryClientContext, useIsFetching } from "@tanstack/svelte-query";
import { getThumbnailUrl } from "../../utils/thumbnail";
import Decimal from "decimal.js";
import { plusIcon as MingcuteAddLine } from "../../icons.js";
import { minusIcon as MingcuteMinimizeLine } from "../../icons.js";
import ky from "ky";
import { formatPrice } from "../../utils/price";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";
import i18n from "../../i18n";
import SubscriptionLineMeta from "./SubscriptionLineMeta.svelte";
import { getVariantQuantityLimit, readPurchaseQuantityInput, productPermalink } from "../../utils/purchase.js";
let { item, onBusyChange = () => {} } = $props();
let isDeleting = $state(false);
let deleteFailed = $state(false);
const queryClient = getQueryClientContext();
const lifecycle = createCommerceScope();
let imageUrl = $derived(item.productVariant?.imageUrl || item.product?.coverImageUrl);
let isInquiry = $derived(item.productVariant?.pricingType === 'INQUIRY');
let specValueText = $derived(
  item.productVariant?.specValues?.map((specValue) => specValue.name + ": " + specValue.value).join(" / ")
);
let total = $derived.by(() => {
  const price = new Decimal(item.productVariant?.price || 0);
  const quantity = new Decimal(item.quantity || 1);
  return price.times(quantity).toNumber();
});
async function handleDelete(item2) {
  if (isBusy || !lifecycle.isActive()) return;
  isDeleting = true;
  deleteFailed = false;
  try {
    await ky.delete(`/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items/${item2.id}`, { signal: lifecycle.signal, retry: 0 });
  } catch (error) {
    if (lifecycle.isActive()) deleteFailed = true;
  } finally {
    // A failed transport can still mean the server deleted the item. Keep the
    // submission gate closed until its state has been read again; query errors
    // remain owned by Cart's visible retry state. Never replay DELETE here.
    if (lifecycle.isActive()) await queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
    if (lifecycle.isActive()) isDeleting = false;
  }
}
const updateQuantityMutation = createMutation(
  () => ({
    mutationKey: ["shop:cart:items:update"],
    mutationFn: async (quantity) => {
      return await ky.put(`/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items/${item.id}`, {
        signal: lifecycle.signal,
        json: { quantity }
      }).json();
    },
    onSuccess: () => {
      if (!lifecycle.isActive()) return;
      queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
    },
    onError: () => {
      if (!lifecycle.isActive()) return;
      toast.error(get(i18n).t("cartItem.updateQuantityFailed"));
      queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
    }
  }),
  () => queryClient
);
const fetchingCount = useIsFetching({ queryKey: ["shop:cart:items"] }, queryClient);
let isBusy = $derived(fetchingCount.current > 0 || updateQuantityMutation.isPending || isDeleting);
$effect(() => onBusyChange(item.id, isDeleting || updateQuantityMutation.isPending));
onDestroy(() => onBusyChange(item.id, false));
let maxQuantity = $derived(getVariantQuantityLimit(item.productVariant));
let canIncreaseQuantity = $derived((item.quantity || 1) < maxQuantity);
function handleQuantityInput(event) {
  if (isBusy) return;
  const quantity = readPurchaseQuantityInput(event.currentTarget, { max: maxQuantity });
  if (quantity > 0 && quantity !== item.quantity) updateQuantityMutation.mutate(quantity);
}
let canDecreaseQuantity = $derived.by(() => {
  return (item.quantity || 1) > 1;
});
</script>

<div class="shop-cart-item">
  {#if imageUrl}
    <img
      src={getThumbnailUrl(imageUrl, 'M')}
      alt={item.product?.title}
      class="shop-cart-item__image"
    />
  {/if}
  <div class="shop-cart-item__info">
    <a href={productPermalink(item.product)} class="shop-cart-item__name">
      {item.product?.title}
    </a>
    <SubscriptionLineMeta
      productId={item.product?.id}
      variantId={item.productVariant?.id}
      enabled={item.product?.productType === 'SUBSCRIPTION'}
    />
    {#if specValueText}
      <p class="shop-cart-item__variant">{specValueText}</p>
    {/if}
    {#if isInquiry}
      <p>{$i18n.t('cartItem.inquiryBadge')}</p>
      <p class="shop-tip">{$i18n.t('cartItem.inquiryNote')}</p>
    {:else}
      <div>
        <span class="shop-cart-item__price">
          {formatPrice(item.productVariant?.price || 0)}
        </span>
        {#if item.productVariant?.originalPrice}
          <s class="shop-cart-item__price-original">
            {formatPrice(item.productVariant?.originalPrice || 0)}
          </s>
        {/if}
      </div>
    {/if}
  </div>
  {#if !isInquiry}
    <div class="shop-quantity">
      <button
        type="button"
        class="shop-quantity__btn"
        aria-label={$i18n.t('cartItem.decreaseQuantity')}
        onclick={() => updateQuantityMutation.mutate((item.quantity ?? 1) - 1)}
        disabled={isBusy || !canDecreaseQuantity}
      >
        {@html MingcuteMinimizeLine}
      </button>
      <input
        type="number"
        class="shop-quantity__input"
        aria-label={$i18n.t('cartItem.quantity')}
        value={item.quantity || 1}
        min="1"
        max={Number.isFinite(maxQuantity) ? maxQuantity : undefined}
        onchange={handleQuantityInput}
        disabled={isBusy}
      />
      <button
        type="button"
        class="shop-quantity__btn"
        aria-label={$i18n.t('cartItem.increaseQuantity')}
        onclick={() => updateQuantityMutation.mutate((item.quantity ?? 1) + 1)}
        disabled={isBusy || !canIncreaseQuantity}
      >
        {@html MingcuteAddLine}
      </button>
    </div>
    <div class="shop-cart-item__total">{formatPrice(total || 0)}</div>
  {/if}
  <div class="shop-cart-item__actions">
    <button type="button" class="shop-cart-item__remove" onclick={() => handleDelete(item)} disabled={isBusy} aria-busy={isDeleting}>
      {isDeleting ? $i18n.t('common.loading') : deleteFailed ? $i18n.t('common.retry') : $i18n.t('cartItem.remove')}
    </button>
    {#if deleteFailed}
      <p class="shop-cart-item__error" role="alert">{$i18n.t('cartItem.removeFailed')}</p>
    {/if}
  </div>
</div>

<style>
  .shop-cart-item__actions { display: grid; grid-column: 3; justify-self: end; justify-items: end; gap: 6px; min-width: 0; }
  .shop-cart-item__actions .shop-cart-item__remove { grid-column: auto; }
  .shop-cart-item__error { max-width: 15em; margin: 0; color: var(--shop-color-error); font-size: var(--shop-font-size-sm, 14px); }
  .shop-cart-item__remove:disabled { cursor: wait; opacity: 0.6; }
</style>
