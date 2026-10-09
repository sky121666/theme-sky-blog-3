<script>
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
let { item } = $props();
const queryClient = getQueryClientContext();
const lifecycle = createCommerceScope();
let imageUrl = $derived(item.productVariant?.imageUrl || item.product?.coverImageUrl);
let specValueText = $derived(
  item.productVariant?.specValues?.map((specValue) => specValue.name + ": " + specValue.value).join(" / ")
);
let total = $derived.by(() => {
  const price = new Decimal(item.productVariant?.price || 0);
  const quantity = new Decimal(item.quantity || 1);
  return price.times(quantity).toNumber();
});
async function handleDelete(item2) {
  try {
    await ky.delete(`/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items/${item2.id}`, { signal: lifecycle.signal }).json();
    if (lifecycle.isActive()) queryClient.invalidateQueries({ queryKey: ["shop:cart:items"] });
  } catch (error) {
    if (lifecycle.isActive()) throw error;
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
const fetchingCount = useIsFetching({}, queryClient);
let isBusy = $derived(fetchingCount.current > 0 || updateQuantityMutation.isPending);
let canIncreaseQuantity = $derived.by(() => {
  if (!item.productVariant?.trackInventory) {
    return true;
  }
  return (item.quantity || 1) < (item.productVariant?.stock || 0);
});
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
    <a href={`/shop/product/${item.product?.id}`} class="shop-cart-item__name">
      {item.product?.title}
    </a>
    {#if specValueText}
      <p class="shop-cart-item__variant">{specValueText}</p>
    {/if}
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
  </div>
  <div class="shop-quantity">
    <button
      class="shop-quantity__btn"
      onclick={() => updateQuantityMutation.mutate((item.quantity ?? 1) - 1)}
      disabled={isBusy || !canDecreaseQuantity}
    >
      {@html MingcuteMinimizeLine}
    </button>
    <input
      type="number"
      class="shop-quantity__input"
      value={item.quantity || 1}
      min="1"
      max={item.productVariant?.stock || 1}
      onchange={(e) =>
        updateQuantityMutation.mutate(Number(e.target?.value || 1))}
      disabled={isBusy}
    />
    <button
      class="shop-quantity__btn"
      onclick={() => updateQuantityMutation.mutate((item.quantity ?? 1) + 1)}
      disabled={isBusy || !canIncreaseQuantity}
    >
      {@html MingcuteAddLine}
    </button>
  </div>
  <div class="shop-cart-item__total">{formatPrice(total || 0)}</div>
  <button class="shop-cart-item__remove" onclick={() => handleDelete(item)} disabled={isBusy}>
    {$i18n.t('cartItem.remove')}
  </button>
</div>
