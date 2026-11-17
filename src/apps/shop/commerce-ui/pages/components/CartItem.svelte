<script>
import { onDestroy } from "svelte";
import { fade } from "svelte/transition";
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
let { item, onBusyChange = () => {}, removalReview, onRemovalReview = () => {} } = $props();
let isDeleting = $state(false);
let quantityFeedback = $state('idle');
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
async function handleDelete() {
  if (isBusy || !lifecycle.isActive()) return;
  isDeleting = true;
  quantityFeedback = 'idle';
  try {
    // Once DELETE was acknowledged, "check again" is only a GET. A timeout or
    // failure can also mean the server removed the item; always reconcile first.
    if (removalReview !== 'check') {
      try {
        await ky.delete(`/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items/${item.id}`, { signal: lifecycle.signal, retry: 0 });
        if (lifecycle.isActive()) onRemovalReview(item.id, 'check');
      } catch {
        if (lifecycle.isActive()) onRemovalReview(item.id, 'retry');
      }
    }
    if (lifecycle.isActive()) await queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
  } finally {
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
    onSuccess: async (_data, quantity) => {
      if (!lifecycle.isActive()) return;
      // Keep the same submission gate until the server's cart read confirms the
      // quantity. A successful PUT alone must not acknowledge a stale amount.
      await queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
      if (!lifecycle.isActive()) return;
      const currentItems = queryClient.getQueryData(["shop:cart:items"]);
      const readSucceeded = queryClient.getQueryState(["shop:cart:items"])?.status === 'success';
      quantityFeedback = readSucceeded && currentItems?.some((current) => current.id === item.id && current.quantity === quantity)
        ? 'confirmed' : 'error';
    },
    onError: async () => {
      if (!lifecycle.isActive()) return;
      toast.error(get(i18n).t("cartItem.updateQuantityFailed"));
      await queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
      if (lifecycle.isActive()) quantityFeedback = 'error';
    }
  }),
  () => queryClient
);
const fetchingCount = useIsFetching({ queryKey: ["shop:cart:items"] }, queryClient);
let isBusy = $derived(fetchingCount.current > 0 || updateQuantityMutation.isPending || isDeleting || quantityFeedback === 'pending');
let operationState = $derived(isDeleting || quantityFeedback === 'pending' ? 'pending'
  : removalReview || quantityFeedback === 'error' ? 'error' : quantityFeedback);
$effect(() => onBusyChange(item.id, isDeleting || updateQuantityMutation.isPending || quantityFeedback === 'pending'));
onDestroy(() => onBusyChange(item.id, false));
let maxQuantity = $derived(getVariantQuantityLimit(item.productVariant));
let canIncreaseQuantity = $derived((item.quantity || 1) < maxQuantity);
function requestQuantityUpdate(quantity) {
  if (isBusy || removalReview || !lifecycle.isActive()) return;
  quantityFeedback = 'pending';
  updateQuantityMutation.mutate(quantity);
}
function handleQuantityInput(event) {
  const quantity = readPurchaseQuantityInput(event.currentTarget, { max: maxQuantity });
  // Native editing already changed the DOM. Keep the displayed value, subtotal
  // and form on the confirmed quantity until the cart read supplies a new one.
  event.currentTarget.value = String(item.quantity || 1);
  if (quantity > 0 && quantity !== item.quantity) requestQuantityUpdate(quantity);
}
let canDecreaseQuantity = $derived.by(() => {
  return (item.quantity || 1) > 1;
});
function exitDuration() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 140;
}
</script>

<div class="shop-cart-item" data-operation-state={operationState} aria-busy={isDeleting || quantityFeedback === 'pending'} out:fade={{ duration: exitDuration() }}>
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
        onclick={() => requestQuantityUpdate((item.quantity ?? 1) - 1)}
        disabled={isBusy || !!removalReview || !canDecreaseQuantity}
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
        disabled={isBusy || !!removalReview}
        aria-describedby={`shop-cart-item-feedback-${item.id}`}
      />
      <button
        type="button"
        class="shop-quantity__btn"
        aria-label={$i18n.t('cartItem.increaseQuantity')}
        onclick={() => requestQuantityUpdate((item.quantity ?? 1) + 1)}
        disabled={isBusy || !!removalReview || !canIncreaseQuantity}
      >
        {@html MingcuteAddLine}
      </button>
    </div>
    <div class="shop-cart-item__total">{formatPrice(total || 0)}</div>
  {/if}
  <div class="shop-cart-item__actions">
    <button type="button" class="shop-cart-item__remove" onclick={handleDelete} disabled={isBusy} aria-busy={isDeleting}>
      {isDeleting ? $i18n.t('common.loading') : removalReview === 'check' ? $i18n.t('cartItem.recheck') : removalReview ? $i18n.t('common.retry') : $i18n.t('cartItem.remove')}
    </button>
    {#if removalReview && !isDeleting}
      <button type="button" class="shop-btn shop-btn-secondary shop-btn-sm" disabled={isBusy} onclick={() => onRemovalReview(item.id, null)}>{$i18n.t('cartItem.keep')}</button>
    {/if}
  </div>
  <div class="shop-cart-item__feedback" id={`shop-cart-item-feedback-${item.id}`} role={operationState === 'error' ? 'alert' : 'status'} aria-live={operationState === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
    {#if isDeleting || quantityFeedback === 'pending'}
      <span class="shop-cart-item__feedback-mark" aria-hidden="true">…</span>
      <span>{$i18n.t('common.loading')}</span>
    {:else if removalReview === 'check'}
      <span class="shop-cart-item__error">{$i18n.t('cartItem.stillInCart')}</span>
    {:else if removalReview}
      <span class="shop-cart-item__error">{$i18n.t('cartItem.removeFailed')}</span>
    {:else if quantityFeedback === 'error'}
      <span class="shop-cart-item__error">{$i18n.t('cartItem.updateQuantityFailed')}</span>
    {:else if quantityFeedback === 'confirmed'}
      <span class="shop-cart-item__feedback-mark" aria-hidden="true">✓</span>
      <span>{$i18n.t('cartItem.quantity')} · {item.quantity}</span>
    {/if}
  </div>
</div>
