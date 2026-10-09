// Protocol values used by this UI, verified against Commerce DTO declarations.
// No generated API client runtime is imported or distributed.
export const ProductResponseProductTypeEnum = Object.freeze({ External: 'EXTERNAL' });
export const OrderResponsePaymentStatusEnum = Object.freeze({ Pending: 'PENDING' });
export const PaymentInitiateRequestPreferredResponseTypeEnum = Object.freeze({
  RedirectUrl: 'REDIRECT_URL', QrcodeUrl: 'QRCODE_URL'
});
export const PaymentMethodPublicResponseProviderEnum = Object.freeze({
  WechatPay: 'WECHAT_PAY', EasyPay: 'EASY_PAY'
});
export const PaymentInitiateResponsePaymentProviderEnum = Object.freeze({
  Manual: 'MANUAL', Alipay: 'ALIPAY', PaymentQrcode: 'PAYMENT_QRCODE',
  BankTransfer: 'BANK_TRANSFER', WechatPay: 'WECHAT_PAY', Stripe: 'STRIPE', EasyPay: 'EASY_PAY'
});
