import ky from 'ky';

const UC_API = '/apis/uc.api.ecommerce.halo.run/v1alpha1';
export const PAYMENT_POLL_TIMEOUT_MS = 5 * 60 * 1000;

// The server advertises the 2.27 storefront routes independently of login state.
// An absent/unknown capability keeps the existing 2.26 UC API contract.
export function createTransactionApi({ authenticated, storefrontApi, contextId, orderCode, csrfToken, currentPath = '', http = ky }) {
  const signedIn = authenticated === 'true';
  const useStorefrontApi = storefrontApi === 'true';
  const context = encodeURIComponent(contextId ?? '');
  const order = encodeURIComponent(orderCode ?? '');
  const storefrontOrder = `/shop/order/${order}`;
  const orderBase = useStorefrontApi ? storefrontOrder : `${UC_API}/orders/${order}`;
  // A login does not turn an email-access guest order into an account-owned order.
  const retainStorefrontAccess = useStorefrontApi && currentPath.startsWith('/shop/order/');
  const headers = { Accept: 'application/json' };
  const read = (url, signal) => http.get(url, { signal, headers }).json();
  const write = (url, json, signal) => http.post(url, {
    signal, json, retry: 0,
    headers: { ...headers, 'X-XSRF-TOKEN': csrfToken },
  });
  return {
    orderUrl: signedIn && !retainStorefrontAccess ? `/uc/shop/orders/${order}` : storefrontOrder,
    context: (signal) => read(useStorefrontApi ? `/shop/checkout/${context}/context` : `${UC_API}/checkout/${context}`, signal),
    order: (signal) => read(orderBase, signal),
    paymentMethods: (signal) => read(`${orderBase}/payment-methods`, signal),
    initiate: (payload, signal) => write(`${orderBase}/initiate-payment`, payload, signal).json(),
    status: (sessionCode, signal) => read(
      useStorefrontApi ? `${storefrontOrder}/payment-sessions/${encodeURIComponent(sessionCode)}/status`
        : `${UC_API}/payment-sessions/${encodeURIComponent(sessionCode)}/status`, signal),
    sendAccessLink: (email, signal) => {
      if (!useStorefrontApi) return Promise.reject(new Error('Order access recovery is unavailable'));
      return write(`${storefrontOrder}/access-link`, { email }, signal);
    },
  };
}

function isMobile(userAgent) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? '');
}

export function preferredPaymentResponse(provider, userAgent = '') {
  const wechatH5 = provider === 'WECHAT_PAY' && isMobile(userAgent) && !/MicroMessenger/i.test(userAgent);
  return !wechatH5 && (provider === 'WECHAT_PAY' || provider === 'EASY_PAY') ? 'QRCODE_URL' : 'REDIRECT_URL';
}

export function paymentRedirectTarget(userAgent = '') {
  return isMobile(userAgent) ? '_self' : '_blank';
}

export function isOrderAccessLocked(error) {
  return [401, 403, 404].includes(error?.response?.status);
}

export function isPaymentSessionTerminal(status) {
  return ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(status);
}

export function paymentPollingInterval({ startedAt, now = Date.now(), status, active = true }) {
  if (!active || isPaymentSessionTerminal(status) || (startedAt != null && now - startedAt >= PAYMENT_POLL_TIMEOUT_MS)) return false;
  return 2000;
}

export async function paymentInitiateError(error, translate) {
  if (error?.name === 'AbortError') return error;
  try {
    const body = await error?.response?.json();
    if (body?.code === 'WECHAT_PAY_REENTRY') return new Error(translate('payments.wechatPayReentry'));
    if (body?.detail) return new Error(body.detail);
  } catch {
    // A network or non-JSON failure uses the same localized retryable message.
  }
  return new Error(translate('payments.loadPaymentResponseFailed'));
}
