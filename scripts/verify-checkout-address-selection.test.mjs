import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCheckoutAddressId } from '../src/apps/shop/commerce-ui/utils/checkout-address.js';

const addresses = [
  { id: 3901, isDefault: true },
  { id: 3902, isDefault: false },
];

test('结算上下文中的有效地址优先于账号默认地址', () => {
  assert.equal(resolveCheckoutAddressId(addresses, 3902), 3902);
});

test('结算地址已失效或未指定时回退到账号默认地址', () => {
  for (const selectedAddressId of [9999, null, undefined]) {
    assert.equal(resolveCheckoutAddressId([...addresses].reverse(), selectedAddressId), 3901);
  }
});

test('没有默认地址时回退到第一个有效地址', () => {
  assert.equal(resolveCheckoutAddressId(addresses.map(address => ({ ...address, isDefault: false })), 9999), 3901);
});

test('账号没有地址时选择填写新地址', () => {
  assert.equal(resolveCheckoutAddressId([], 3902), '');
});
