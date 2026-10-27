// Synthetic DTOs only. These responses never describe a live store.
export const origin = 'https://theme.test';
export const api = '/apis/uc.api.ecommerce.halo.run/v1alpha1';
export const csrf = 'fixture-csrf-token';
export const contextId = 'fixture-checkout-context';
export const orderCode = 'FIXTURE-ORDER-0001';
export const sessionCode = 'fixture-payment-session';
export const products = [
  { id: 901, title: '桌面资源精选套装 · 实体演示商品', coverImageUrl: '/fixture/images/product-physical.png', productType: 'PHYSICAL', status: 'PUBLISHED' },
  { id: 902, title: '高清壁纸与图标资源合集 · 虚拟演示商品', coverImageUrl: '/fixture/images/product-virtual.png', productType: 'VIRTUAL', status: 'PUBLISHED' },
];
export const variants = products.map((product, index) => ({ id: 1901 + index, productId: product.id, price: index ? 18 : 29, originalPrice: index ? 24 : 39, imageUrl: product.coverImageUrl, specValues: [{ name: '版本', value: '演示标准版' }], shippingRequired: !index, trackInventory: true, stock: 20, status: 'PUBLISHED' }));
export const cartItems = products.map((product, index) => ({ id: 2901 + index, product, productVariant: variants[index], productVariantId: variants[index].id, quantity: index ? 1 : 2 }));
export const checkout = {
  id: contextId, source: 'CART', isShippingRequired: true, selectedAddressId: 3901,
  items: cartItems.map(({ product, productVariant, quantity }) => ({ product, productVariant, quantity, price: productVariant.price })),
  calculateResult: { originalTotalAmount: 76, saleTotalAmount: 76, shippingFeeAmount: 8, discountAmount: 0, totalDiscountAmount: 0, couponDiscountAmount: 0, payableAmount: 84, appliedCoupons: [], rejectedCoupons: [] },
};
export const addresses = [{ id: 3901, lastName: '演示', firstName: '收货人', contactPhone: '13800000000', province: '演示省', provinceCode: '990000', city: '演示市', cityCode: '990100', district: '演示区', districtCode: '990101', streetAddress: '本地隔离测试路 1 号', postalCode: '000000', isDefault: true }];
export const order = {
  orderCode, paymentStatus: 'PENDING', status: 'OPEN', subtotalAmount: 76, shippingAmount: 8, discountAmount: 0, payableAmount: 84, totalAmount: 84, appliedCoupons: [],
  items: cartItems.map(({ product, productVariant, quantity }) => ({ productId: product.id, productVariantId: productVariant.id, itemTitle: product.title, itemImageUrl: product.coverImageUrl, productVariantSnapshot: { specValues: productVariant.specValues }, unitPrice: productVariant.price, quantity, subtotal: productVariant.price * quantity })),
};
export const methods = [{ id: 4901, name: '收款码支付（本地演示）', provider: 'PAYMENT_QRCODE', enabled: true, scene: 'PC_WEB' }, { id: 4902, name: '人工支付（本地演示）', provider: 'MANUAL', enabled: true, scene: 'PC_WEB' }];
export const payment = {
  sessionCode, paymentProvider: 'PAYMENT_QRCODE', paymentScene: 'PC_WEB',
  payload: { success: true, responseType: 'DIRECT', payload: { paymentQrcode: { qrcodeImageUrl: '/fixture/images/payment-placeholder.svg', instructions: '仅本地组件布局演示，无实际收款能力。' } } },
};
export const qrPlaceholder = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#fff"/><rect x="16" y="16" width="208" height="208" rx="12" fill="#f3f5f7" stroke="#d4d8dd"/><text x="120" y="106" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#495057">本地支付演示</text><text x="120" y="138" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#6c757d">无实际付款</text></svg>';
