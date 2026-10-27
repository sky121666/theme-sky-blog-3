<svelte:options
  customElement={{
    tag: 'shop-buy-box',
    shadow: 'none',
    props: {
      id: { reflect: true, type: 'Number', attribute: 'id' },
      csrfToken: { reflect: true, type: 'String', attribute: 'csrftoken' },
    },
  }}
/>

<script>
import { createCommerceScope } from "../lifecycle.js";
import {
  ProductResponseProductTypeEnum
} from "../api-contract.js";
import { createQuery, QueryClient } from "@tanstack/svelte-query";
import ky from "ky";
import { plusIcon as MingcuteAddLine } from "../icons.js";
import { minusIcon as MingcuteMinimizeLine } from "../icons.js";
import { formatPrice } from "../utils/price";
import { fade } from "svelte/transition";
import SpecButton from "./SpecButton.svelte";
import SubscriptionBuyBox from "./SubscriptionBuyBox.svelte";
import { getVariantQuantityLimit, normalizePurchaseQuantity, readPurchaseQuantityInput } from "../utils/purchase.js";
import i18n from "../i18n";
let { id, csrfToken } = $props();
const currentUrl = $host().closest('[data-pjax-target-url]')?.dataset.pjaxTargetUrl || window.location.href;
const queryClient = new QueryClient();
const lifecycle = createCommerceScope(queryClient);
const productQuery = createQuery(
  () => ({
    queryKey: ["shop:product", id],
    queryFn: async ({ signal }) => {
      return await ky.get(
        `/apis/uc.api.ecommerce.halo.run/v1alpha1/products/${id}?includeVariants=true`, { signal }).json();
    }
  }),
  () => queryClient
);
const shopConfigQuery = createQuery(
  () => ({
    queryKey: ["shop:config"],
    queryFn: async ({ signal }) => {
      return await ky.get("/apis/uc.api.ecommerce.halo.run/v1alpha1/ecommerceconfigs/shop", { signal }).json();
    }
  }),
  () => queryClient
);
const isSubscription = $derived(productQuery.data?.productType === ProductResponseProductTypeEnum.Subscription);
const subscriptionQuery = createQuery(
  () => ({
    queryKey: ["shop:subscription-product", id],
    queryFn: async ({ signal }) => ky.get(
      `/apis/uc.api.ecommerce.halo.run/v1alpha1/subscription-products/${id}`, { signal }
    ).json(),
    enabled: isSubscription,
  }),
  () => queryClient
);
let variants = $derived(productQuery.data?.productVariants || []);
let specDefinitions = $derived(
  (productQuery.data?.specDefinition || []).filter(
    (spec) => spec.usedForSku
  )
);
let isExternal = $derived(
  productQuery.data?.productType === ProductResponseProductTypeEnum.External
);
let externalLinkUrl = $derived(productQuery.data?.externalLinkUrl);
let hasExternalLink = $derived(!!externalLinkUrl && externalLinkUrl.length > 0);
let externalLinkButtonText = $derived(productQuery.data?.externalLinkButtonText);
const getInitialSelectedSpecs = () => {
  const initial = {};
  if (specDefinitions.length > 0 && variants?.length) {
    const firstAvailableVariant = variants.find((variant) => variant.stock && variant.stock > 0) || variants[0];
    if (firstAvailableVariant) {
      specDefinitions.forEach((spec) => {
        const specValue = firstAvailableVariant.specValues?.find(
          (sv) => sv.name === spec.name
        );
        if (specValue && spec.name && specValue.value) {
          initial[spec.name] = specValue.value;
        }
      });
    }
  }
  return initial;
};
let selectedSpecs = $state({});
let quantity = $state(1);
$effect(() => {
  if (variants.length) {
    const initial = getInitialSelectedSpecs();
    if (Object.keys(initial).length > 0) {
      selectedSpecs = initial;
    }
  }
});
let selectedVariant = $derived(
  variants.find((variant) => {
    return specDefinitions.every((spec) => {
      const specValue = variant.specValues?.find((sv) => sv.name === spec.name);
      return specValue && spec.name && specValue.value === selectedSpecs?.[spec.name];
    });
  })
);
let isSelectedVariantAvailable = $derived.by(() => {
  if (!selectedVariant) {
    return false;
  }
  if (!selectedVariant.trackInventory) {
    return true;
  }
  return getVariantQuantityLimit(selectedVariant) > 0;
});
let isInquiry = $derived(selectedVariant?.pricingType === "INQUIRY");
let contactSalesUrl = $derived(shopConfigQuery.data?.inquiryRedirectUrl || null);
let contacts = $derived(shopConfigQuery.data?.contacts || []);
function isSpecValueAvailable(specName, specValue) {
  if (!specName || !specValue) {
    return false;
  }
  const tempSelected = { ...selectedSpecs, [specName]: specValue };
  const hasAvailableVariant = variants.some((variant) => {
    const matches = Object.entries(tempSelected).every(([name, value]) => {
      const sv = variant.specValues?.find((s) => s.name === name);
      return sv && sv.value === value;
    });
    if (!matches) {
      return false;
    }
    if (!variant.trackInventory) {
      return true;
    }
    return !!variant.stock;
  });
  return hasAvailableVariant;
}
function selectSpec(specName, specValue) {
  if (!specName || !specValue) {
    return;
  }
  if (selectedSpecs[specName] === specValue) {
    selectedSpecs = {};
    return;
  }
  selectedSpecs = { ...selectedSpecs, [specName]: specValue };
}
let maxQuantity = $derived(getVariantQuantityLimit(selectedVariant));
let maxPerOrderLimit = $derived(selectedVariant?.maxPerOrder > 0 ? selectedVariant.maxPerOrder : undefined);
let canIncreaseQuantity = $derived(quantity < maxQuantity);
$effect(() => {
  quantity = normalizePurchaseQuantity(quantity, { max: maxQuantity });
});
function handleQuantityInput(event) {
  quantity = readPurchaseQuantityInput(event.currentTarget, { max: maxQuantity });
}
let canDecreaseQuantity = $derived.by(() => {
  return quantity > 1;
});
function increaseQuantity() {
  if (canIncreaseQuantity) {
    quantity++;
  }
}
function decreaseQuantity() {
  if (canDecreaseQuantity) {
    quantity--;
  }
}
function handleContactSales() {
  if (contactSalesUrl) {
    window.open(contactSalesUrl, "_blank");
  }
}
</script>

{#if productQuery.isLoading}
  {$i18n.t('common.loading')}
{:else if productQuery.isError}
  {$i18n.t('buyBox.loadFailed', { message: productQuery.error.message })}
{:else if isSubscription}
  {#if subscriptionQuery.isLoading}
    {$i18n.t('common.loading')}
  {:else if subscriptionQuery.isError}
    {$i18n.t('buyBox.loadFailed', { message: subscriptionQuery.error.message })}
  {:else if subscriptionQuery.data}
    <SubscriptionBuyBox
      {csrfToken}
      {currentUrl}
      plans={subscriptionQuery.data.plans ?? []}
      subscriptions={subscriptionQuery.data.subscriptions ?? []}
      singleSubscription={subscriptionQuery.data.singleSubscription ?? true}
    />
  {/if}
{:else}
  <div class="buy-box" transition:fade={{ duration: 200 }}>
    {#if isExternal}
      <div class="buy-box__external-hint">
        {$i18n.t('buyBox.externalRedirectHint')}
      </div>

      <div class="buy-box__actions">
        {#if hasExternalLink}
          <a
            class="shop-btn shop-btn-primary shop-btn-lg"
            href={externalLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {externalLinkButtonText || $i18n.t('buyBox.externalBuyNow')}
          </a>
        {:else}
          <button
            class="shop-btn shop-btn-primary shop-btn-lg"
            type="button"
            disabled
            aria-disabled="true"
          >
            {externalLinkButtonText || $i18n.t('buyBox.externalBuyNow')}
          </button>
        {/if}
      </div>
    {:else}
      {#each specDefinitions as spec}
        <div class="buy-box__spec">
          <div class="buy-box__spec-label">{spec.name}</div>
          <div class="buy-box__spec-options">
            {#each spec.values as specValueObj}
              {@const value = specValueObj.value}
              {@const imageUrl = specValueObj.imageUrl}
              {@const isSelected = !!spec.name && selectedSpecs[spec.name] === value}
              {@const isAvailable = isSpecValueAvailable(spec.name, value)}

              <SpecButton
                {isSelected}
                {isAvailable}
                {imageUrl}
                {value}
                onclick={() => selectSpec(spec.name, value)}
              ></SpecButton>
            {/each}
          </div>
        </div>
      {/each}

      {#if isInquiry}
        {#if contactSalesUrl}
          <div class="buy-box__external-hint">
            {$i18n.t('buyBox.contactSales')}
          </div>
          <div class="buy-box__actions">
            <button class="shop-btn shop-btn-primary shop-btn-lg" onclick={handleContactSales}>
              {$i18n.t('buyBox.contactSales')}
            </button>
          </div>
        {:else if contacts.length > 0}
          <div class="buy-box__contacts">
            {#each contacts as contact}
              <div class="buy-box__contact-item">
                <span class="buy-box__contact-label">
                  {#if contact.icon}
                    <iconify-icon icon={contact.icon}></iconify-icon>
                  {/if}
                  {contact.label}
                </span>
                <div class="buy-box__contact-content">
                  {#if contact.type === 'LINK' && contact.linkUrl}
                    <a
                      class="buy-box__contact-link"
                      href={contact.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {contact.linkLabel || contact.linkUrl}
                    </a>
                  {:else if contact.type === 'IMAGE' && contact.image}
                    {#if contact.imageHref}
                      <a href={contact.imageHref} target="_blank" rel="noopener noreferrer">
                        <img
                          class="buy-box__contact-image"
                          src={contact.image}
                          alt={contact.label}
                        />
                      </a>
                    {:else}
                      <img class="buy-box__contact-image" src={contact.image} alt={contact.label} />
                    {/if}
                  {/if}
                  {#if contact.help}
                    <span class="buy-box__contact-help">{contact.help}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="buy-box__external-hint">
            {$i18n.t('buyBox.contactSales')}
          </div>
          <div class="buy-box__actions">
            <button class="shop-btn shop-btn-primary shop-btn-lg" disabled>
              {$i18n.t('buyBox.contactSales')}
            </button>
          </div>
        {/if}
      {:else}
        <div class="buy-box__price">
          <div class="buy-box__price-label">{$i18n.t('buyBox.price')}</div>
          <div class="buy-box__price-value">
            {#if selectedVariant}
              {formatPrice(selectedVariant.price || 0)}
            {:else if variants.length > 0}
              {[
                formatPrice(productQuery.data?.minPrice || 0),
                formatPrice(productQuery.data?.maxPrice || 0),
              ].join(' - ')}
            {:else}
              {formatPrice(0)}
            {/if}
            {#if selectedVariant?.originalPrice}
              <del>{formatPrice(selectedVariant.originalPrice)}</del>
            {/if}
          </div>
        </div>

        {#if selectedVariant && selectedVariant.trackInventory}
          <div class="buy-box__stock">
            <span class="buy-box__stock-value">
              {$i18n.t('buyBox.stock', { count: selectedVariant.stock || 0 })}
            </span>
          </div>
        {/if}

        <div class="buy-box__quantity">
          <span class="buy-box__quantity-label">{$i18n.t('buyBox.quantity')}</span>
          <div class="shop-quantity">
            <button
              class="shop-quantity__btn"
              aria-label={$i18n.t('buyBox.decreaseQuantity')}
              onclick={decreaseQuantity}
              disabled={!canDecreaseQuantity}
            >
              {@html MingcuteMinimizeLine}
            </button>
            <input
              type="number"
              class="shop-quantity__input"
              aria-label={$i18n.t('buyBox.quantity')}
              value={quantity}
              oninput={handleQuantityInput}
              min="1"
              max={Number.isFinite(maxQuantity) ? maxQuantity : undefined}
            />
            <button
              class="shop-quantity__btn"
              aria-label={$i18n.t('buyBox.increaseQuantity')}
              onclick={increaseQuantity}
              disabled={!canIncreaseQuantity}
            >
              {@html MingcuteAddLine}
            </button>
          </div>
        </div>

        {#if maxPerOrderLimit}
          <span class="buy-box__limit-hint">{$i18n.t('buyBox.perOrderLimit', { count: maxPerOrderLimit })}</span>
        {/if}
        <div class="buy-box__actions">
          <form action={`/shop/cart?redirect_uri=${encodeURIComponent(currentUrl)}`} method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="productVariantId" value={selectedVariant?.id} />
            <input type="hidden" name="quantity" value={quantity} />
            <button
              class="shop-btn shop-btn-primary shop-btn-lg"
              type="submit"
              disabled={!isSelectedVariantAvailable}
            >
              {$i18n.t('buyBox.addToCart')}
            </button>
          </form>
          <form
            action={`/shop/checkout/prepare?redirect_uri=${encodeURIComponent(currentUrl)}`}
            method="post"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="source" value="BUY_NOW" />
            <input type="hidden" name="items[0].productVariantId" value={selectedVariant?.id} />
            <input type="hidden" name="items[0].quantity" value={quantity} />
            <button
              class="shop-btn shop-btn-secondary shop-btn-lg"
              type="submit"
              disabled={!isSelectedVariantAvailable}
            >
              {$i18n.t('buyBox.buyNow')}
            </button>
          </form>
        </div>
      {/if}
    {/if}
  </div>
{/if}
