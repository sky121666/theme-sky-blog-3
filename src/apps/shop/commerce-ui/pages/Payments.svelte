<svelte:options
  customElement={{
    tag: 'shop-page-payments',
    shadow: 'none',
    props: {
      orderCode: { reflect: true, type: 'String', attribute: 'ordercode' },
      csrfToken: { reflect: true, type: 'String', attribute: 'csrftoken' },
      authenticated: { reflect: true, type: 'String', attribute: 'authenticated' },
      storefrontApi: { reflect: true, type: 'String', attribute: 'storefrontapi' },
    },
  }}
/>

<script>
import { createCommerceScope } from "../lifecycle.js";
import { createQuery, QueryClient, setQueryClientContext } from "@tanstack/svelte-query";
import { formatPrice } from "../utils/price";
import { fade } from "svelte/transition";
import { checkIcon as MingcuteCheckLine } from "../icons.js";
import {
  OrderResponsePaymentStatusEnum,
  PaymentInitiateResponsePaymentProviderEnum
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
import { createTransactionApi, isOrderAccessLocked, preferredPaymentResponse, paymentInitiateError,
  isPaymentSessionTerminal, paymentPollingInterval, PAYMENT_POLL_TIMEOUT_MS } from "../utils/transactions.js";
let { orderCode, csrfToken, authenticated, storefrontApi } = $props();
// Same-app PJAX initializes this component before committing the target URL.
const currentUrl = $host().closest('[data-pjax-target-url]')?.dataset.pjaxTargetUrl || window.location.href;
const currentPath = new URL(currentUrl, window.location.href).pathname;
const transactionApi = $derived(createTransactionApi({ authenticated, storefrontApi, orderCode, csrfToken, currentPath }));
const orderUrl = $derived(transactionApi.orderUrl);
let accessEmail = $state("");
let accessLinkSent = $state(false);
let accessLinkPending = $state(false);
const queryClient = new QueryClient();
setQueryClientContext(queryClient);
const lifecycle = createCommerceScope(queryClient);
async function sendAccessLink() {
  if (accessLinkPending || !accessEmail.trim() || !lifecycle.isActive()) return;
  accessLinkPending = true;
  accessLinkSent = false;
  try {
    await transactionApi.sendAccessLink(accessEmail.trim(), lifecycle.signal);
    if (lifecycle.isActive()) accessLinkSent = true;
  } catch {
    if (lifecycle.isActive()) toast.error(get(i18n).t("payments.accessLinkFailed"));
  } finally {
    if (lifecycle.isActive()) accessLinkPending = false;
  }
}
const orderQuery = createQuery(
  () => ({
    queryKey: ["shop:order", orderCode],
    queryFn: async ({ signal }) => {
      return await transactionApi.order(signal);
    },
    retry: false
  }),
  () => queryClient
);
const orderAccessLocked = $derived(storefrontApi === "true" && isOrderAccessLocked(orderQuery.error));
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
      return await transactionApi.paymentMethods(signal);
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
  if (paymentMethodsQuery.isSuccess && !paymentMethodsQuery.data?.some((method) => method.id === selectedPaymentMethodId)) {
    selectedPaymentMethodId = paymentMethodsQuery.data?.[0]?.id;
  }
});
let paymentAttempt = $state(0);
const paymentResponseQuery = createQuery(
  () => ({
    queryKey: ["shop:payment:response", orderCode, selectedPaymentMethodId, paymentAttempt],
    queryFn: async ({ signal }) => {
      const preferredResponseType = preferredPaymentResponse(
        selectedPaymentMethod?.provider, typeof navigator === "undefined" ? "" : navigator.userAgent
      );
      try {
        return await transactionApi.initiate({
          paymentMethodId: selectedPaymentMethodId,
          returnUrl: currentUrl,
          preferredResponseType
        }, signal);
      } catch (error) {
        throw await paymentInitiateError(error, (key) => get(i18n).t(key));
      }
    },
    enabled: isPendingPayment && !!selectedPaymentMethodId,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  }),
  () => queryClient
);
function retryPayment() {
  if (!lifecycle.isActive() || !isPendingPayment || paymentSucceeded || terminalOrderQuery.isFetching || paymentResponseQuery.isFetching || !selectedPaymentMethodId) return;
  if (paymentSessionFailed && !paymentNeedsRetry) return;
  // A user action starts a fresh query, including when a provider reuses a code.
  // Never auto-replay an initialization write or retain its old status cache.
  paymentAttempt += 1;
}
const pollingSessionCode = $derived(paymentResponseQuery.data?.sessionCode);
let pollingStartedAt = $state(null);
let pollTimedOut = $state(false);
let pollingRevision = $state(0);
$effect(() => {
  const sessionCode = pollingSessionCode;
  void pollingRevision;
  const terminal = paymentSessionTerminal;
  pollingStartedAt = sessionCode && !terminal ? Date.now() : null;
  pollTimedOut = false;
  if (!sessionCode || terminal) return;
  const timer = setTimeout(() => {
    if (lifecycle.isActive()) pollTimedOut = true;
  }, PAYMENT_POLL_TIMEOUT_MS);
  return () => clearTimeout(timer);
});
const paymentStatusQuery = createQuery(
  () => ({
    queryKey: [
      "shop:payment:status",
      orderCode,
      selectedPaymentMethodId,
      paymentResponseQuery.data?.sessionCode,
      paymentAttempt
    ],
    queryFn: async ({ signal }) => {
      return await transactionApi.status(pollingSessionCode, signal);
    },
    enabled: isPendingPayment && !!pollingSessionCode && !pollTimedOut,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) => paymentPollingInterval({
      startedAt: pollingStartedAt, status: query.state.data, active: lifecycle.isActive()
    })
  }),
  () => queryClient
);
const paymentSessionTerminal = $derived(isPaymentSessionTerminal(paymentStatusQuery.data));
const paymentSessionFailed = $derived(paymentSessionTerminal && paymentStatusQuery.data !== "SUCCESS");
// Administrative payment confirmation cancels the old provider session in Halo.
// Re-read the authoritative order before offering another payment attempt.
const terminalOrderQuery = createQuery(
  () => ({
    queryKey: ["shop:order:payment-terminal", orderCode, pollingSessionCode, paymentAttempt, selectedPaymentMethodId],
    queryFn: async ({ signal }) => transactionApi.order(signal),
    enabled: isPendingPayment && paymentSessionFailed,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  }),
  () => queryClient
);
const paymentSucceeded = $derived(
  paymentStatusQuery.data === "SUCCESS" || terminalOrderQuery.data?.paymentStatus === OrderResponsePaymentStatusEnum.Paid
);
const paymentNeedsRetry = $derived(paymentSessionFailed && !paymentSucceeded
  && terminalOrderQuery.isSuccess && !terminalOrderQuery.isFetching
  && terminalOrderQuery.data?.paymentStatus === OrderResponsePaymentStatusEnum.Pending);
function recheckOrder() {
  if (!lifecycle.isActive() || !paymentSessionFailed || terminalOrderQuery.isFetching) return;
  // Retry only the read. Payment initialization still requires a separate action.
  void terminalOrderQuery.refetch();
}
$effect(() => {
  if (paymentSucceeded && lifecycle.isActive()) {
    toast.success(get(i18n).t("payments.paymentSuccess"));
    const timer = setTimeout(() => {
      if (!lifecycle.isActive()) return;
      const href = orderUrl;
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
    {#if orderAccessLocked}
      <div class="shop-card shop-order-locked">
        <h2 class="shop-card__title">{$i18n.t('payments.accessEmail')}</h2>
        <p class="shop-tip">{$i18n.t('payments.accessEmailHelp')}</p>
        <form class="shop-address-form" onsubmit={(event) => { event.preventDefault(); sendAccessLink(); }}>
          <div class="shop-form-group">
            <label class="shop-label" for="access-email">{$i18n.t('payments.accessEmail')}</label>
            <input class="shop-input" id="access-email" type="email" required autocomplete="email" bind:value={accessEmail} />
          </div>
          <button type="submit" class="shop-btn shop-btn-primary" disabled={accessLinkPending || !accessEmail.trim()}>
            {$i18n.t('payments.sendAccessLink')}
          </button>
        </form>
        {#if accessLinkSent}<p class="shop-tip" role="status">{$i18n.t('payments.accessLinkSent')}</p>{/if}
      </div>
    {:else}
      <div class="shop-empty">
        <p class="shop-empty__title">{$i18n.t('payments.loadOrderFailed')}</p>
        <button type="button" class="shop-btn shop-btn-secondary" onclick={() => orderQuery.refetch()}>{$i18n.t('common.retry')}</button>
      </div>
    {/if}
  {:else if !isPendingPayment}
    <div>
      {$i18n.t('payments.orderNotPayablePrefix')}
      <a href={orderUrl}>{$i18n.t('common.viewOrderDetails')}</a>
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
                    disabled={paymentSucceeded || (paymentSessionFailed && !paymentNeedsRetry)}
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
            <p role="alert">{paymentResponseQuery.error?.message || $i18n.t('payments.loadPaymentResponseFailed')}</p>
            <button type="button" class="shop-btn shop-btn-secondary" onclick={retryPayment} disabled={paymentResponseQuery.isFetching}>
              {$i18n.t('common.retry')}
            </button>
          {:else if paymentSucceeded}
            <p role="status">{$i18n.t('payments.paymentSuccess')}</p>
          {:else if paymentSessionFailed && terminalOrderQuery.isFetching}
            <p role="status">{$i18n.t('common.loading')}</p>
          {:else if paymentSessionFailed && terminalOrderQuery.isError}
            <p role="alert">{$i18n.t('payments.orderStatusUnavailable')}</p>
            <button type="button" class="shop-btn shop-btn-secondary" onclick={recheckOrder}>
              {$i18n.t('payments.recheckOrder')}
            </button>
          {:else if paymentNeedsRetry}
            <p role="status">{$i18n.t('payments.sessionStatus.' + paymentStatusQuery.data)}</p>
            <button type="button" class="shop-btn shop-btn-secondary" onclick={retryPayment} disabled={paymentResponseQuery.isFetching}>
              {$i18n.t('common.retry')}
            </button>
          {:else if paymentSessionFailed && terminalOrderQuery.isSuccess}
            <p role="status">
              {$i18n.t('payments.orderNotPayablePrefix')}
              <a href={orderUrl}>{$i18n.t('common.viewOrderDetails')}</a>
              {$i18n.t('payments.orderNotPayableSuffix')}
            </p>
          {:else if paymentResponseQuery.data}
            {#if PaymentMethodComponent}
              <PaymentMethodComponent paymentResponse={paymentResponseQuery.data} />
            {:else}
              <div>{$i18n.t('payments.unsupportedPaymentMethod')}</div>
            {/if}
          {/if}
        </div>

        {#if pollTimedOut && !paymentSessionTerminal}
          <div class="shop-tip" role="status">
            <p>{$i18n.t('payments.pollTimeout')}</p>
            <button type="button" class="shop-btn shop-btn-secondary" onclick={() => { pollingRevision += 1; }}>
              {$i18n.t('payments.pollResume')}
            </button>
          </div>
        {/if}
        <div class="shop-payments__actions">
          {#if paymentResponseQuery.data?.sessionCode && !paymentSessionTerminal && !paymentResponseQuery.isError && !paymentResponseQuery.isFetching && (selectedPaymentMethod?.provider === 'BANK_TRANSFER' || selectedPaymentMethod?.provider === 'PAYMENT_QRCODE')}
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
                href={orderUrl}
                class="shop-btn shop-btn-secondary shop-btn-lg"
              >
                {$i18n.t('common.viewOrderDetails')}
              </a>
            </form>
          {:else}
            <a
              href={orderUrl}
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
