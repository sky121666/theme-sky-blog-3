/** The server enforces cumulative per-customer limits; the UI knows per-order limits. */
export function getVariantQuantityLimit(variant) {
  if (!variant) return 0;
  const limits = [];
  if (variant.trackInventory) limits.push(Math.max(0, Math.floor(Number(variant.stock) || 0)));
  if (Number(variant.maxPerOrder) > 0) limits.push(Math.floor(Number(variant.maxPerOrder)));
  return limits.length ? Math.min(...limits) : Infinity;
}

export function normalizePurchaseQuantity(value, { min = 1, max = Infinity } = {}) {
  if (max < min) return Math.max(0, max);
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? Math.floor(number) : min));
}

export function readPurchaseQuantityInput(input, bounds) {
  const quantity = normalizePurchaseQuantity(input.value, bounds);
  input.value = String(quantity);
  return quantity;
}

export function productPermalink(product) {
  return product?.permalink || `/shop/product/${product?.id}`;
}
