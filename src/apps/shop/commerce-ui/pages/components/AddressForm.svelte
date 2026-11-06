<script>
import { createCommerceScope } from "../../lifecycle.js";
import { createQuery, QueryClient } from "@tanstack/svelte-query";
import ky from "ky";
import i18n, { getLocale } from "../../i18n";
const queryClient = new QueryClient();
const lifecycle = createCommerceScope(queryClient);
let provinceCode = $state("");
let cityCode = $state("");
let areaCode = $state("");
const addressCopy = {
  en: { province: "Select a province", city: "Select a city", district: "Select a district", provinceFirst: "Select a province first", cityFirst: "Select a city first" },
  es: { province: "Selecciona una provincia", city: "Selecciona una ciudad", district: "Selecciona un distrito", provinceFirst: "Selecciona primero una provincia", cityFirst: "Selecciona primero una ciudad" },
  "zh-CN": { province: "请选择省份", city: "请选择城市", district: "请选择区县", provinceFirst: "请先选择省份", cityFirst: "请先选择城市" },
  "zh-TW": { province: "請選擇省份", city: "請選擇城市", district: "請選擇區縣", provinceFirst: "請先選擇省份", cityFirst: "請先選擇城市" }
}[getLocale()];
const provinceQuery = createQuery(
  () => ({
    queryKey: ["shop:address:provinces"],
    retry: false,
    queryFn: async ({ signal }) => {
      return await ky.get("/apis/api.ecommerce.halo.run/v1alpha1/provinces", { signal }).json();
    }
  }),
  () => queryClient
);
const cityQuery = createQuery(
  () => ({
    queryKey: ["shop:address:cities", provinceCode],
    retry: false,
    queryFn: async ({ signal }) => {
      return await ky.get(`/apis/api.ecommerce.halo.run/v1alpha1/provinces/${provinceCode}/cities`, { signal }).json();
    },
    enabled: !!provinceCode
  }),
  () => queryClient
);
const areaQuery = createQuery(
  () => ({
    queryKey: ["shop:address:areas", cityCode],
    retry: false,
    queryFn: async ({ signal }) => {
      return await ky.get(`/apis/api.ecommerce.halo.run/v1alpha1/cities/${cityCode}/areas`, { signal }).json();
    },
    enabled: !!cityCode
  }),
  () => queryClient
);
function resetCity() {
  cityCode = "";
  areaCode = "";
}
function resetArea() {
  areaCode = "";
}
</script>

<div class="shop-checkout__form-row">
  <div class="shop-form-group">
    <label class="shop-label" for="lastName">{$i18n.t('addressForm.lastName')}</label>
    <input type="text" class="shop-input" id="lastName" name="userAddress.lastName" required />
  </div>
  <div class="shop-form-group">
    <label class="shop-label" for="firstName">{$i18n.t('addressForm.firstName')}</label>
    <input type="text" class="shop-input" id="firstName" name="userAddress.firstName" required />
  </div>
</div>
<div class="shop-form-group">
  <label class="shop-label" for="contactPhone">{$i18n.t('addressForm.contactPhone')}</label>
  <input type="tel" class="shop-input" id="contactPhone" name="userAddress.contactPhone" required />
</div>
<div class="shop-checkout__form-row">
  <div class="shop-form-group">
    <label class="shop-label" for="province">{$i18n.t('addressForm.province')}</label>
    <select
      id="province"
      class="shop-select"
      name="userAddress.provinceCode"
      bind:value={provinceCode}
      onchange={resetCity}
      aria-busy={provinceQuery.isFetching}
      aria-describedby={provinceQuery.isError ? "province-error" : undefined}
      required
    >
      <option value="" disabled>{provinceQuery.isPending ? $i18n.t('common.loading') : addressCopy.province}</option>
      {#each provinceQuery.data ?? [] as province (province.code)}
        <option value={province.code}>{province.name}</option>
      {/each}
    </select>
    {#if provinceQuery.isError}
      <div class="shop-address-error" id="province-error" role="alert">
        <span>{$i18n.t('buyBox.loadFailed', { message: provinceQuery.error.message })}</span>
        <button type="button" class="shop-btn shop-btn-secondary shop-btn-sm" onclick={() => provinceQuery.refetch()} disabled={provinceQuery.isFetching}>
          {provinceQuery.isFetching ? $i18n.t('common.loading') : $i18n.t('common.retry')}
        </button>
      </div>
    {/if}
  </div>
  <div class="shop-form-group">
    <label class="shop-label" for="city">{$i18n.t('addressForm.city')}</label>
    <select
      id="city"
      class="shop-select"
      name="userAddress.cityCode"
      bind:value={cityCode}
      onchange={resetArea}
      disabled={!provinceCode}
      aria-busy={cityQuery.isFetching}
      aria-describedby={cityQuery.isError ? "city-error" : undefined}
      required
    >
      <option value="" disabled>{!provinceCode ? addressCopy.provinceFirst : cityQuery.isPending ? $i18n.t('common.loading') : addressCopy.city}</option>
      {#each cityQuery.data ?? [] as city (city.code)}
        <option value={city.code}>{city.name}</option>
      {/each}
    </select>
    {#if provinceCode && cityQuery.isError}
      <div class="shop-address-error" id="city-error" role="alert">
        <span>{$i18n.t('buyBox.loadFailed', { message: cityQuery.error.message })}</span>
        <button type="button" class="shop-btn shop-btn-secondary shop-btn-sm" onclick={() => cityQuery.refetch()} disabled={cityQuery.isFetching}>
          {cityQuery.isFetching ? $i18n.t('common.loading') : $i18n.t('common.retry')}
        </button>
      </div>
    {/if}
  </div>
</div>
<div class="shop-checkout__form-row">
  <div class="shop-form-group">
    <label class="shop-label" for="district">{$i18n.t('addressForm.district')}</label>
    <select
      id="district"
      class="shop-select"
      name="userAddress.districtCode"
      bind:value={areaCode}
      disabled={!cityCode}
      aria-busy={areaQuery.isFetching}
      aria-describedby={areaQuery.isError ? "district-error" : undefined}
      required
    >
      <option value="" disabled>{!cityCode ? addressCopy.cityFirst : areaQuery.isPending ? $i18n.t('common.loading') : addressCopy.district}</option>
      {#each areaQuery.data ?? [] as area (area.code)}
        <option value={area.code}>{area.name}</option>
      {/each}
    </select>
    {#if cityCode && areaQuery.isError}
      <div class="shop-address-error" id="district-error" role="alert">
        <span>{$i18n.t('buyBox.loadFailed', { message: areaQuery.error.message })}</span>
        <button type="button" class="shop-btn shop-btn-secondary shop-btn-sm" onclick={() => areaQuery.refetch()} disabled={areaQuery.isFetching}>
          {areaQuery.isFetching ? $i18n.t('common.loading') : $i18n.t('common.retry')}
        </button>
      </div>
    {/if}
  </div>
  <div class="shop-form-group">
    <label class="shop-label" for="postalCode">{$i18n.t('addressForm.postalCode')}</label>
    <input
      type="text"
      class="shop-input"
      id="postalCode"
      name="userAddress.postalCode"
      required
      placeholder={$i18n.t('addressForm.postalCodePlaceholder')}
    />
  </div>
</div>

<style>
  .shop-address-error {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--shop-color-error);
    font-size: var(--shop-font-size-sm, 14px);
    overflow-wrap: anywhere;
  }
</style>
<div class="shop-form-group">
  <label class="shop-label" for="address">{$i18n.t('addressForm.address')}</label>
  <textarea
    class="shop-textarea"
    id="address"
    rows="3"
    placeholder={$i18n.t('addressForm.addressPlaceholder')}
    name="userAddress.streetAddress"
    required
  ></textarea>
</div>
