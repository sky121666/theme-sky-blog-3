<svelte:options
  customElement={{
    tag: 'shop-page-payments',
    shadow: 'none',
    props: {
      orderCode: { reflect: true, type: 'String', attribute: 'ordercode' },
      csrfToken: { reflect: true, type: 'String', attribute: 'csrftoken' },
    },
  }}
/>

<script>
import { createCommerceScope } from "../lifecycle.js";
import { createQuery, QueryClient } from "@tanstack/svelte-query";
import ky from "ky";
import { formatPrice } from "../utils/price";
import { fade } from "svelte/transition";
import { checkIcon as MingcuteCheckLine } from "../icons.js";
import {
  OrderResponsePaymentStatusEnum,
  PaymentInitiateRequestPreferredResponseTypeEnum,
  PaymentInitiateResponsePaymentProviderEnum,
  PaymentMethodPublicResponseProviderEnum
} from "../api-contract.js";
import PaymentOrderItem from "./components/PaymentOrderItem.svelte";
import { toast, Toaster } from "svelte-sonner";
import { get } from "svelte/store";
import Manual from "./components/payment-methods/Manual.svelte";
import Alipay from "./components/payment-methods/Alipay.svelte";
import PaymentQrcode from "./components/payment-methods/PaymentQrcode.svelte";
import BankTransfer from "./components/payment-methods/BankTransfer.svelte";
import WeChat from "./components/payment-methods/WeChat.svelte";
import Stripe from "./components/payment-methods/Stripe.svelte";
import EasyPay from "./components/payment-methods/EasyPay.svelte";
import i18n from "../i18n";
let { orderCode, csrfToken } = $props();
const queryClient = new QueryClient();
const lifecycle = createCommerceScope(queryClient);
const orderQuery = createQuery(
  () => ({
    queryKey: ["shop:order", orderCode],
    queryFn: async ({ signal }) => {
      return await ky.get(`/apis/uc.api.ecommerce.halo.run/v1alpha1/orders/${orderCode}`, { signal }).json();
    }
  }),
  () => queryClient
);
let isPendingPayment = $derived(
  orderQuery.data?.paymentStatus === OrderResponsePaymentStatusEnum.Pending
);
const orderDiscountAmount = $derived(orderQuery.data?.discountAmount ?? 0);
const hasOrderDiscount = $derived(orderDiscountAmount > 0);
const orderSubtotalAmount = $derived(
  orderQuery.data?.subtotalAmount ?? orderQuery.data?.totalAmount ?? 0
);
const orderShippingAmount = $derived(orderQuery.data?.shippingAmount ?? 0);
const orderPayableAmount = $derived(
  orderQuery.data?.payableAmount ?? orderQuery.data?.totalAmount ?? 0
);
const orderDiscountLabel = $derived.by(() => {
  const order = orderQuery.data;
  if (!order?.discountName) return get(i18n).t("payments.discount");
  return order.discountCode ? `${order.discountName} (${order.discountCode})` : order.discountName;
});
const appliedCoupons = $derived(
  orderQuery.data?.appliedCoupons ?? []
);
const rejectedCoupons = $derived(
  orderQuery.data?.rejectedCoupons ?? []
);
const hasRejectedCoupons = $derived(rejectedCoupons.length > 0);
function couponLabel(c) {
  return c.couponName ?? get(i18n).t("checkout.coupons");
}
function rejectedCouponReason(coupon) {
  return coupon.reasonMessage || coupon.reasonCode || get(i18n).t("checkout.couponRejectedFallback");
}
const paymentMethodsQuery = createQuery(
  () => ({
    queryKey: ["shop:payment:methods", orderCode],
    queryFn: async ({ signal }) => {
      return await ky.get(`/apis/uc.api.ecommerce.halo.run/v1alpha1/orders/${orderCode}/payment-methods`, { signal }).json();
    },
    enabled: isPendingPayment
  }),
  () => queryClient
);
let selectedPaymentMethodId = $state();
let selectedPaymentMethod = $derived.by(() => {
  if (!selectedPaymentMethodId) {
    return void 0;
  }
  return paymentMethodsQuery.data?.find((method) => method.id === selectedPaymentMethodId);
});
$effect(() => {
  if (paymentMethodsQuery.isFetched) {
    selectedPaymentMethodId = paymentMethodsQuery.data?.[0]?.id;
  }
});
const paymentResponseQuery = createQuery(
  () => ({
    queryKey: ["shop:payment:response", orderCode, selectedPaymentMethodId],
    queryFn: async ({ signal }) => {
      let preferredResponseType = PaymentInitiateRequestPreferredResponseTypeEnum.RedirectUrl;
      if (selectedPaymentMethod?.provider === PaymentMethodPublicResponseProviderEnum.WechatPay || selectedPaymentMethod?.provider === PaymentMethodPublicResponseProviderEnum.EasyPay) {
        preferredResponseType = PaymentInitiateRequestPreferredResponseTypeEnum.QrcodeUrl;
      }
      return await ky.post(
        `/apis/uc.api.ecommerce.halo.run/v1alpha1/orders/${orderCode}/initiate-payment`,
        {
          signal,
          json: {
            paymentMethodId: selectedPaymentMethodId,
            returnUrl: window.location.href,
            preferredResponseType
          }
        }
      ).json();
    },
    enabled: !!selectedPaymentMethodId
  }),
  () => queryClient
);
const paymentStatusQuery = createQuery(
  () => ({
    queryKey: [
      "shop:payment:status",
      orderCode,
      selectedPaymentMethodId,
      paymentResponseQuery.data?.sessionCode
    ],
    queryFn: async ({ signal }) => {
      return await ky.get(
        `/apis/uc.api.ecommerce.halo.run/v1alpha1/payment-sessions/${paymentResponseQuery.data?.sessionCode}/status`, { signal }).json();
    },
    enabled: !!paymentResponseQuery.data?.sessionCode,
    refetchInterval: 2e3
  }),
  () => queryClient
);
$effect(() => {
  if (paymentStatusQuery.data === "SUCCESS" && lifecycle.isActive()) {
    toast.success(get(i18n).t("payments.paymentSuccess"));
    const timer = setTimeout(() => {
      if (!lifecycle.isActive()) return;
      const href = `/uc/shop/orders/${orderCode}`;
      if (typeof window.pjax?.loadUrl === 'function') window.pjax.loadUrl(href);
      else window.location.href = href;
    }, 1e3);
    return () => clearTimeout(timer);
  }
});
const PaymentMethodComponents = {
  [PaymentInitiateResponsePaymentProviderEnum.Manual]: Manual,
  [PaymentInitiateResponsePaymentProviderEnum.Alipay]: Alipay,
  [PaymentInitiateResponsePaymentProviderEnum.PaymentQrcode]: PaymentQrcode,
  [PaymentInitiateResponsePaymentProviderEnum.BankTransfer]: BankTransfer,
  [PaymentInitiateResponsePaymentProviderEnum.WechatPay]: WeChat,
  [PaymentInitiateResponsePaymentProviderEnum.Stripe]: Stripe,
  [PaymentInitiateResponsePaymentProviderEnum.EasyPay]: EasyPay
};
let PaymentMethodComponent = $derived(
  PaymentMethodComponents[paymentResponseQuery.data?.paymentProvider]
);
</script>

<Toaster richColors position="top-center" />

<div class="shop-entry">
  <div class="shop-entry__header">
    <h1 class="shop-entry__title">{$i18n.t('payments.title')}</h1>
    <p class="shop-entry__subtitle">{$i18n.t('payments.orderCode', { code: orderCode })}</p>
  </div>

  {#if orderQuery.isLoading}
    <div>{$i18n.t('common.loading')}</div>
  {:else if orderQuery.isError}
    <div>{$i18n.t('payments.loadOrderFailed')}</div>
  {:else if !isPendingPayment}
    <div>
      {$i18n.t('payments.orderNotPayablePrefix')}
      <a href={`/uc/shop/orders/${orderCode}`}>{$i18n.t('common.viewOrderDetails')}</a>
      {$i18n.t('payments.orderNotPayableSuffix')}
    </div>
  {:else if orderQuery.data}
    <div class="shop-payments" transition:fade={{ duration: 200 }}>
      <div class="shop-payments__left">
        <div class="shop-card">
          <h2 class="shop-card__title">{$i18n.t('payments.selectPaymentMethod')}</h2>
          <div class="shop-payment-methods">
            {#if paymentMethodsQuery.isLoading}
              <div>{$i18n.t('common.loading')}</div>
            {:else if paymentMethodsQuery.isError}
              <div>{$i18n.t('payments.loadPaymentMethodsFailed')}</div>
            {:else if paymentMethodsQuery.data?.length === 0}
              <div>{$i18n.t('payments.noPaymentMethods')}</div>
            {:else}
              {#each paymentMethodsQuery.data ?? [] as paymentMethod}
                <label
                  class="shop-payment-method"
                  class:shop-payment-method--active={selectedPaymentMethodId === paymentMethod.id}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={paymentMethod.id}
                    bind:group={selectedPaymentMethodId}
                    class="shop-payment-method__radio"
                  />
                  <div class="shop-payment-method__content">
                    {#if paymentMethod.icon}
                      <div class="shop-payment-method__icon">
                        <img src={paymentMethod.icon} alt={paymentMethod.name} />
                      </div>
                    {/if}
                    <div class="shop-payment-method__info">
                      <span class="shop-payment-method__name">{paymentMethod.name}</span>
                      <span class="shop-payment-method__desc">
                        {$i18n.t('payments.usePaymentMethod', { name: paymentMethod.name })}
                      </span>
                    </div>
                    <div class="shop-payment-method__check">
                      {@html MingcuteCheckLine}
                    </div>
                  </div>
                </label>
              {/each}
            {/if}
          </div>
        </div>

        <div class="shop-card">
          <h2 class="shop-card__title">{$i18n.t('payments.orderItems')}</h2>
          <div class="shop-order-items">
            {#each orderQuery.data.items ?? [] as item}
              <PaymentOrderItem {item} />
            {/each}
          </div>
        </div>

        <div class="shop-card">
          <h2 class="shop-card__title">{$i18n.t('payments.summaryTitle')}</h2>
          <div class="shop-order-summary">
            <div class="shop-order-summary__row">
              <span>{$i18n.t('payments.itemsSubtotal')}</span>
              <span>{formatPrice(orderSubtotalAmount)}</span>
            </div>
            <div class="shop-order-summary__row">
              <span>{$i18n.t('payments.shipping')}</span>
              <span>{formatPrice(orderShippingAmount)}</span>
            </div>
            {#if hasOrderDiscount}
              <div class="shop-order-summary__row shop-order-summary__row--discount">
                <span>{orderDiscountLabel}</span>
                <span>-{formatPrice(orderDiscountAmount)}</span>
              </div>
            {/if}
            {#each appliedCoupons as coupon (coupon.customerCouponId)}
              <div class="shop-order-summary__row shop-order-summary__row--discount">
                <span>{couponLabel(coupon)}</span>
                <span>-{formatPrice(coupon.discountAmount ?? 0)}</span>
              </div>
            {/each}
            {#if hasRejectedCoupons}
              {#each rejectedCoupons as rc (rc.customerCouponId)}
                <div class="shop-order-summary__row shop-order-summary__row--rejected">
                  <span>{rc.couponName ?? $i18n.t('checkout.coupons')}</span>
                  <span class="shop-order-summary__rejected"
                    >{$i18n.t('checkout.couponsRejected')}</span
                  >
                </div>
                <p class="shop-order-summary__rejected-reason">{rejectedCouponReason(rc)}</p>
              {/each}
            {/if}
            <div class="shop-divider"></div>
            <div class="shop-order-summary__row shop-order-summary__row--total">
              <span>{$i18n.t('payments.payableTotal')}</span>
              <span class="shop-order-summary__amount">
                {formatPrice(orderPayableAmount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="shop-payments__right">
        <div class="shop-card">
          <h2 class="shop-card__title">{$i18n.t('payments.paymentTitle')}</h2>

          {#if paymentResponseQuery.isLoading}
            <div>{$i18n.t('common.loading')}</div>
          {:else if paymentResponseQuery.isError}
            <div>{$i18n.t('payments.loadPaymentResponseFailed')}</div>
          {:else if paymentResponseQuery.data}
            {#if PaymentMethodComponent}
              <PaymentMethodComponent paymentResponse={paymentResponseQuery.data} />
            {:else}
              <div>{$i18n.t('payments.unsupportedPaymentMethod')}</div>
            {/if}
          {/if}
        </div>

        <div class="shop-payments__actions">
          {#if selectedPaymentMethod?.provider === 'BANK_TRANSFER' || selectedPaymentMethod?.provider === 'PAYMENT_QRCODE'}
            <form
              action={`/apis/api.ecommerce.halo.run/v1alpha1/payment-sessions/${paymentResponseQuery.data?.sessionCode}/callback`}
              method="POST"
              style="display: contents;"
            >
              <div class="shop-form-group">
                <label class="shop-label" for="outTradeNo">
                  {$i18n.t('payments.paymentTransactionNumber')}
                </label>
                <input type="text" class="shop-input" id="outTradeNo" name="outTradeNo" required />
              </div>
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit" class="shop-btn shop-btn-primary shop-btn-lg">
                {$i18n.t('payments.paymentConfirmed')}
              </button>
              <a
                href={`/uc/shop/orders/${orderCode}`}
                class="shop-btn shop-btn-secondary shop-btn-lg"
              >
                {$i18n.t('common.viewOrderDetails')}
              </a>
            </form>
          {:else}
            <a
              href={`/uc/shop/orders/${orderCode}`}
              class="shop-btn shop-btn-secondary shop-btn-lg"
            >
              {$i18n.t('common.viewOrderDetails')}
            </a>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
