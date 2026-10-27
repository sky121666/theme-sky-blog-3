export function resolveCheckoutAddressId(addresses, selectedAddressId) {
  const selectedAddress = addresses.find(address => address.id === selectedAddressId);
  const defaultAddress = addresses.find(address => address.isDefault);
  return selectedAddress?.id ?? defaultAddress?.id ?? addresses[0]?.id ?? '';
}
