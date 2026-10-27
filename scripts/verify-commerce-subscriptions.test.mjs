import assert from 'node:assert/strict';
import test from 'node:test';

const purchase = await import('../src/apps/shop/commerce-ui/utils/purchase.js').catch(() => ({}));
const subscription = await import('../src/apps/shop/commerce-ui/utils/subscription-line.js').catch(() => ({}));

test('库存与单笔限购共同限制数量，未跟踪库存时仍遵守限购', () => {
  assert.equal(typeof purchase.getVariantQuantityLimit, 'function');
  for (const [variant, expected] of [
    [{ trackInventory: true, stock: 8, maxPerOrder: 3 }, 3],
    [{ trackInventory: true, stock: 2, maxPerOrder: 5 }, 2],
    [{ trackInventory: false, stock: 0, maxPerOrder: 4 }, 4],
    [{ trackInventory: false, maxPerOrder: null }, Infinity],
    [{ trackInventory: true, stock: 0 }, 0],
    [{ trackInventory: true }, 0],
  ]) assert.equal(purchase.getVariantQuantityLimit(variant), expected);
});

test('手工输入、套餐切换和加购使用相同的有效整数边界', () => {
  assert.equal(typeof purchase.normalizePurchaseQuantity, 'function');
  for (const [value, min, max, expected] of [
    ['99', 1, 3, 3], ['2.9', 1, 5, 2], ['-4', 1, 5, 1],
    ['', 2, 8, 2], [NaN, 2, 8, 2], [Infinity, 1, 5, 1],
    [4, 1, 0, 0], [2, 3, 8, 3], [7, 1, Infinity, 7],
  ]) assert.equal(purchase.normalizePurchaseQuantity(value, { min, max }), expected);
});

test('输入超限且数据数量未变时仍回写输入框，避免显示错误数量', () => {
  assert.equal(typeof purchase.readPurchaseQuantityInput, 'function');
  const input = { value: '99' };
  assert.equal(purchase.readPurchaseQuantityInput(input, { min: 1, max: 3 }), 3);
  assert.equal(input.value, '3');
});

test('商品使用服务端别名链接，旧版本没有 permalink 时使用 ID', () => {
  assert.equal(typeof purchase.productPermalink, 'function');
  assert.equal(purchase.productPermalink({ id: 42, permalink: '/shop/product/studio' }), '/shop/product/studio');
  assert.equal(purchase.productPermalink({ id: 42 }), '/shop/product/42');
  assert.equal(purchase.productPermalink({ id: 42, permalink: '' }), '/shop/product/42');
});

test('首次订阅可试用，结束后的重购不可重新试用', () => {
  assert.equal(typeof subscription.getSubscriptionState, 'function');
  assert.deepEqual(subscription.getSubscriptionState([], true), {
    isSwitch: false, resubscribable: false, showManageList: false, trialOffered: true,
  });
  assert.deepEqual(subscription.getSubscriptionState([{ status: 'EXPIRED' }], true), {
    isSwitch: false, resubscribable: true, showManageList: false, trialOffered: false,
  });
});

test('单订阅的活跃状态进入变更，多订阅继续允许购买并展示管理列表', () => {
  assert.equal(typeof subscription.getSubscriptionState, 'function');
  for (const status of ['TRIALING', 'ACTIVE', 'PAST_DUE']) {
    assert.equal(subscription.getSubscriptionState([{ status }], true).isSwitch, true);
    assert.deepEqual(subscription.getSubscriptionState([{ status }], false), {
      isSwitch: false, resubscribable: false, showManageList: true, trialOffered: false,
    });
  }
});

test('结算行按 variantId 展示对应方案及周期，不误标普通商品', () => {
  assert.equal(typeof subscription.resolveSubscriptionLine, 'function');
  const data = { plans: [{ variantId: 101, name: '专业版', billingMode: 'SUBSCRIPTION', billingPeriod: 'YEARLY' }] };
  assert.deepEqual(subscription.resolveSubscriptionLine(data, 101), {
    name: '专业版', billingMode: 'SUBSCRIPTION', billingPeriod: 'YEARLY',
  });
  assert.equal(subscription.resolveSubscriptionLine(data, 102), null);
  assert.equal(subscription.resolveSubscriptionLine(undefined, 101), null);
});

test('已下单的订阅使用订单快照，后续方案改名不改写历史订单', () => {
  const current = { plans: [{ variantId: 101, name: '新方案', billingMode: 'SUBSCRIPTION', billingPeriod: 'YEARLY' }] };
  const snapshot = { planName: '下单时方案', billingMode: 'ONE_TIME', billingPeriod: 'MONTHLY' };
  assert.deepEqual(subscription.resolveSubscriptionLine(current, 101, snapshot), {
    name: '下单时方案', billingMode: 'ONE_TIME', billingPeriod: 'MONTHLY',
  });
});
