<script>
import Decimal from "decimal.js";
import { fade } from "svelte/transition";
import { plusIcon as MingcuteAddLine, minusIcon as MingcuteMinimizeLine } from "../icons.js";

import { createCommerceScope } from "../lifecycle.js";
import { getSubscriptionState } from "../utils/subscription-line.js";
import { normalizePurchaseQuantity, readPurchaseQuantityInput } from "../utils/purchase.js";
import "../styles/subscription.css";
const lifecycle = createCommerceScope();
import i18n from "../i18n";
import { formatPrice } from "../utils/price";
const PERIOD_KEYS = ["MONTHLY", "YEARLY", "LIFETIME", "OTHER"];
const MODE_ORDER = {
  SUBSCRIPTION: 0,
  ONE_TIME: 1,
  LIFETIME: 2
};
let {
  csrfToken = "",
  currentUrl = window.location.href,
  plans = [],
  subscriptions = [],
  singleSubscription = true
} = $props();
const currentSubscription = $derived(subscriptions[0] ?? null);
const subscriptionState = $derived(getSubscriptionState(subscriptions, singleSubscription));
function tierGroupKey(plan) {
  if (plan.tierId != null) return `tier:${plan.tierId}`;
  const handle = plan.tierHandle?.trim();
  if (handle) return `handle:${handle}`;
  const name = plan.tier?.trim();
  if (name) return `name:${name}`;
  return `plan:${plan.id ?? "unknown"}`;
}
function tierGroupLabel(groupPlans) {
  const first = groupPlans[0];
  return first?.tier?.trim() || first?.name?.trim() || "";
}
function purchasePeriodKey(plan) {
  if (plan.billingMode === "LIFETIME") return "LIFETIME";
  if (plan.billingPeriod === "MONTHLY") return "MONTHLY";
  if (plan.billingPeriod === "YEARLY") return "YEARLY";
  return "OTHER";
}
function compareModes(a, b) {
  const modeA = MODE_ORDER[a.billingMode ?? ""] ?? 99;
  const modeB = MODE_ORDER[b.billingMode ?? ""] ?? 99;
  if (modeA !== modeB) return modeA - modeB;
  return (a.id ?? 0) - (b.id ?? 0);
}
function comparePlans(a, b) {
  const idA = a.tierId ?? Number.MAX_SAFE_INTEGER;
  const idB = b.tierId ?? Number.MAX_SAFE_INTEGER;
  if (idA !== idB) return idA - idB;
  return compareModes(a, b);
}
function compareTierGroups(a, b) {
  const idA = a.plans[0]?.tierId ?? Number.MAX_SAFE_INTEGER;
  const idB = b.plans[0]?.tierId ?? Number.MAX_SAFE_INTEGER;
  if (idA !== idB) return idA - idB;
  const orderA = a.plans[0]?.sortOrder ?? 0;
  const orderB = b.plans[0]?.sortOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  return (a.plans[0]?.id ?? 0) - (b.plans[0]?.id ?? 0);
}
function periodSuffix(plan) {
  if (plan.billingPeriod === "MONTHLY") return $i18n.t("subscription.perMonth");
  if (plan.billingPeriod === "YEARLY") return $i18n.t("subscription.perYear");
  return "";
}
function periodLabel(key) {
  return $i18n.t("subscription.period." + key, { defaultValue: key });
}
function billingModeLabel(plan) {
  return plan.billingMode ? String(
    $i18n.t("subscription.billingMode." + plan.billingMode, {
      defaultValue: plan.billingMode
    })
  ) : "";
}
function billingLabel(plan) {
  const period = plan.billingPeriod ? String(
    $i18n.t("subscription.billingPeriod." + plan.billingPeriod, {
      defaultValue: plan.billingPeriod
    })
  ) : "";
  return [billingModeLabel(plan), period].filter(Boolean).join(" ");
}
function planTitle(plan) {
  const name = plan.name?.trim();
  if (name) return name;
  const tier = plan.tier?.trim();
  if (tier) return tier;
  return billingLabel(plan);
}
function formatDateTime(instant) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function yearlySavePercent(plan, all) {
  if (plan.billingPeriod !== "YEARLY" || plan.price == null) return null;
  const monthly = all.find(
    (candidate) => candidate.id !== plan.id && candidate.billingPeriod === "MONTHLY" && candidate.billingMode === plan.billingMode && tierGroupKey(candidate) === tierGroupKey(plan)
  );
  if (monthly?.price == null) return null;
  const yearFromMonthly = new Decimal(monthly.price).times(12);
  if (yearFromMonthly.lte(0) || yearFromMonthly.lte(plan.price)) return null;
  const percent = yearFromMonthly.minus(plan.price).div(yearFromMonthly).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return percent > 0 ? percent : null;
}
const isSwitch = $derived(subscriptionState.isSwitch);
const resubscribable = $derived(subscriptionState.resubscribable);
const showManageList = $derived(subscriptionState.showManageList);
const trialOffered = $derived(subscriptionState.trialOffered);
const currentPlanId = $derived(isSwitch ? currentSubscription?.planId ?? null : null);
const currentSubscriptionId = $derived(isSwitch ? currentSubscription?.id ?? null : null);
function periodEndOf(subscription) {
  const instant = subscription.paidThroughAt ?? subscription.currentPeriodEndAt;
  if (!instant) return $i18n.t("subscription.forever");
  return formatDateTime(instant);
}
function planNameOf(subscription) {
  const name = subscription.planName;
  if (name && name.trim().length > 0) return name;
  const plan = allPlans.find((p) => p.id === subscription.planId);
  return plan?.name ?? String(subscription.planId ?? "");
}
const allPlans = $derived([...plans].sort(comparePlans));
const tierGroups = $derived.by(() => {
  const groups = /* @__PURE__ */ new Map();
  for (const plan of plans) {
    const key = tierGroupKey(plan);
    const groupPlans = groups.get(key);
    if (groupPlans) {
      groupPlans.push(plan);
    } else {
      groups.set(key, [plan]);
    }
  }
  return [...groups.entries()].map(([key, groupPlans]) => ({
    key,
    label: tierGroupLabel(groupPlans),
    plans: groupPlans.sort(compareModes)
  })).sort(compareTierGroups);
});
const periodGroups = $derived.by(() => {
  const keys = new Set(plans.map((plan) => purchasePeriodKey(plan)));
  return PERIOD_KEYS.filter((key) => keys.has(key)).map((key) => ({ key }));
});
function plansOf(tierKey, periodKey) {
  if (!tierKey || !periodKey) return [];
  return allPlans.filter(
    (plan) => tierGroupKey(plan) === tierKey && purchasePeriodKey(plan) === periodKey
  );
}
const multiMode = $derived(new Set(allPlans.map((plan) => plan.billingMode)).size > 1);
const multiPeriod = $derived(periodGroups.length > 1);
const saveByPlanId = $derived.by(() => {
  const map = /* @__PURE__ */ new Map();
  for (const plan of allPlans) {
    if (plan.id == null) continue;
    const percent = yearlySavePercent(plan, allPlans);
    if (percent) map.set(plan.id, percent);
  }
  return map;
});
let selectedTierKey = $state(null);
let selectedPeriodKey = $state(null);
let selectedPlanId = $state(null);
let quantity = $state(1);
let submitting = $state(false);
let error = $state(null);
const periodByTier = {};
const tierByPeriod = {};
const planByCombination = {};
const combinationPlans = $derived(plansOf(selectedTierKey, selectedPeriodKey));
const selectedPlan = $derived(
  combinationPlans.find((plan) => plan.id === selectedPlanId) ?? combinationPlans[0] ?? null
);
const planMin = $derived(Math.max(1, selectedPlan?.minQuantity ?? 1));
const planMax = $derived(Math.max(planMin, selectedPlan?.maxQuantity ?? planMin));
$effect(() => {
  if (selectedTierKey !== null || tierGroups.length === 0 || periodGroups.length === 0) return;
  const current = currentPlanId != null ? allPlans.find((plan) => plan.id === currentPlanId) : null;
  const tierKey = current ? tierGroupKey(current) : tierGroups[0]?.key ?? null;
  if (!tierKey) return;
  const periods = [
    current ? purchasePeriodKey(current) : null,
    ...periodGroups.map((g) => g.key)
  ];
  selectedTierKey = tierKey;
  selectedPeriodKey = periods.find((key) => !!key && plansOf(tierKey, key).length > 0) ?? null;
});
$effect(() => {
  if (!selectedTierKey || !selectedPeriodKey || combinationPlans.length === 0) return;
  periodByTier[selectedTierKey] = selectedPeriodKey;
  tierByPeriod[selectedPeriodKey] = selectedTierKey;
  if (isSwitch) return;
  const combinationKey = `${selectedTierKey}::${selectedPeriodKey}`;
  if (combinationPlans.some((plan) => plan.id === selectedPlanId)) {
    if (selectedPlanId != null) planByCombination[combinationKey] = selectedPlanId;
    return;
  }
  const remembered = planByCombination[combinationKey];
  const next = combinationPlans.find((plan) => plan.id === remembered) ?? combinationPlans[0];
  selectedPlanId = next?.id ?? null;
});
let lastSelectedPlanId = void 0;
$effect(() => {
  if (selectedPlanId === lastSelectedPlanId) return;
  lastSelectedPlanId = selectedPlanId;
  if (!isSwitch && selectedPlan) {
    quantity = normalizePurchaseQuantity(quantity, { min: planMin, max: planMax });
  }
});
function selectTier(key) {
  if (key === selectedTierKey) return;
  selectedTierKey = key;
  if (plansOf(key, selectedPeriodKey).length > 0) return;
  const periods = [periodByTier[key], ...periodGroups.map((group) => group.key)];
  selectedPeriodKey = periods.find((candidate) => !!candidate && plansOf(key, candidate).length > 0) ?? null;
}
function selectPeriod(key) {
  if (key === selectedPeriodKey) return;
  selectedPeriodKey = key;
  if (plansOf(selectedTierKey, key).length > 0) return;
  const tiers = [tierByPeriod[key], ...tierGroups.map((group) => group.key)];
  const tierKey = tiers.find((candidate) => !!candidate && plansOf(candidate, key).length > 0) ?? null;
  if (tierKey) selectedTierKey = tierKey;
}
function planMetaLabel(plan) {
  if (selectedPeriodKey === "OTHER") return billingLabel(plan);
  if (multiMode || !multiPeriod) return billingModeLabel(plan);
  return "";
}
const cartLines = $derived.by(() => {
  if (!selectedPlan) return [];
  const qty = normalizePurchaseQuantity(quantity, { min: planMin, max: planMax });
  return [{ productVariantId: selectedPlan.variantId ?? 0, quantity: qty }];
});
const summaryRows = $derived.by(() => {
  if (isSwitch || !selectedPlan) return null;
  const qty = normalizePurchaseQuantity(quantity, { min: planMin, max: planMax });
  const planAmount = new Decimal(selectedPlan.price ?? 0).times(qty);
  const trial = !!selectedPlan.trialEnabled && trialOffered;
  const nowPlanAmount = trial ? new Decimal(selectedPlan.trialPrice ?? 0).times(qty) : planAmount;
  const rows = [];
  const nowTotal = nowPlanAmount;
  const laterTotal = planAmount;
  const recurring = selectedPlan.billingMode === "SUBSCRIPTION" && !!periodSuffix(selectedPlan);
  if (trial) {
    rows.push({
      label: $i18n.t("subscription.summaryTrialNow", { days: selectedPlan.trialDays ?? "" }),
      amount: formatPrice(nowTotal.toNumber()),
      total: true
    });
    if (recurring) {
      rows.push({
        label: $i18n.t("subscription.summaryAfterTrial"),
        amount: formatPrice(laterTotal.toNumber()),
        muted: true
      });
    }
  } else {
    rows.push({
      label: $i18n.t("subscription.summaryDueNow"),
      amount: formatPrice(nowTotal.toNumber()),
      total: true
    });
    if (recurring) {
      rows.push({
        label: $i18n.t("subscription.summaryAfterEach"),
        amount: formatPrice(laterTotal.toNumber()),
        muted: true
      });
    }
  }
  return rows;
});
const showSummary = $derived.by(() => {
  if (!summaryRows || summaryRows.length === 0) return false;
  const trial = !!selectedPlan?.trialEnabled && trialOffered;
  const qty = normalizePurchaseQuantity(quantity, { min: planMin, max: planMax });
  return trial || qty > 1;
});
function navigate(href) {
  if (!lifecycle.isActive()) return;
  if (typeof window.pjax?.loadUrl === 'function') return window.pjax.loadUrl(href);
  else window.location.href = href;
}
async function handleAddToCart() {
  if (submitting || !selectedPlan) return;
  error = null;
  submitting = true;
  try {
    for (const line of cartLines) {
      let res = await fetch("/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items", {
        method: "POST",
        signal: lifecycle.signal,
        credentials: "include",
        headers: {
          "X-CSRF-TOKEN": csrfToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(line)
      });
      if (!lifecycle.isActive()) return;
      if (res.status === 415) {
        res = await fetch("/apis/uc.api.ecommerce.halo.run/v1alpha1/cart-items", {
          method: "POST",
          signal: lifecycle.signal,
          credentials: "include",
          headers: {
            "X-CSRF-TOKEN": csrfToken,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            productVariantId: String(line.productVariantId),
            quantity: String(line.quantity)
          })
        });
      }
      if (!lifecycle.isActive()) return;
      if (res.status === 401) {
        await navigate("/login?redirect_uri=" + encodeURIComponent(new URL(currentUrl, window.location.href).pathname));
        if (lifecycle.isActive()) submitting = false;
        return;
      }
      if (!res.ok) {
        throw new Error($i18n.t("subscription.addCartFailed"));
      }
    }
    await navigate("/shop/cart");
    if (lifecycle.isActive()) submitting = false;
  } catch (e) {
    if (!lifecycle.isActive()) return;
    error = e instanceof Error && e.message ? e.message : $i18n.t("subscription.addCartFailed");
    submitting = false;
  }
}
</script>

{#snippet planBody(plan)}
  {@const savePercent = plan.id != null ? saveByPlanId.get(plan.id) : undefined}
  {@const metaLabel = planMetaLabel(plan)}
  <span class="shop-subscription__plan-body">
    <span class="shop-subscription__plan-main">
      <span class="shop-subscription__plan-name">{planTitle(plan)}</span>
      {#if metaLabel}
        <span class="shop-subscription__plan-billing">{metaLabel}</span>
      {/if}
    </span>
    <span class="shop-subscription__plan-aside">
      <span class="shop-subscription__plan-price">
        {formatPrice(plan.price ?? 0)}
        {#if periodSuffix(plan)}
          <span class="shop-subscription__plan-interval">{periodSuffix(plan)}</span>
        {/if}
      </span>
      {#if plan.originalPrice != null}
        <span class="shop-subscription__plan-original">{formatPrice(plan.originalPrice)}</span>
      {/if}
      {#if savePercent}
        <span class="shop-subscription__plan-save">
          {$i18n.t('subscription.savePercent', { percent: savePercent })}
        </span>
      {/if}
      {#if trialOffered && plan.trialEnabled}
        <span class="shop-subscription__plan-trial">
          {$i18n.t('subscription.trial', { days: plan.trialDays ?? '' })}
        </span>
      {/if}
      {#if isSwitch}
        {#if plan.id === currentPlanId}
          <span class="shop-subscription__plan-current">{$i18n.t('subscription.currentPlan')}</span>
        {:else}
          <span class="shop-subscription__plan-action">{$i18n.t('subscription.goSwitch')}</span>
        {/if}
      {/if}
    </span>
  </span>
{/snippet}

<div class="buy-box shop-subscription" transition:fade={{ duration: 200 }}>
  {#if showManageList && currentSubscription}
    <section class="shop-subscription-manage">
      <div class="shop-subscription-manage__head">
        <h2 class="shop-subscription-manage__title">
          {singleSubscription
            ? $i18n.t('subscription.manageTitle')
            : $i18n.t('subscription.manageTitleMultiple', {
                count: subscriptions.length,
              })}
        </h2>
      </div>
      {#each singleSubscription ? [currentSubscription] : subscriptions as subscription (subscription.id)}
        <div class="shop-subscription-manage__item">
          <div class="shop-subscription-manage__head">
            <span
              class="shop-subscription-status"
              class:shop-subscription-status--warning={subscription.status === 'PAST_DUE'}
              class:shop-subscription-status--success={subscription.status !== 'PAST_DUE'}
            >
              {$i18n.t('subscription.status.' + (subscription.status ?? ''), {
                defaultValue: subscription.status ?? '',
              })}
            </span>
          </div>
          <p class="shop-subscription-manage__summary">
            <span>{planNameOf(subscription)}</span>
            {#if subscription.status !== 'EXPIRED' && subscription.status !== 'CANCELLED'}
              <span class="shop-subscription-manage__dot" aria-hidden="true">·</span>
              <span>{$i18n.t('subscription.managePeriodEnd')} {periodEndOf(subscription)}</span>
            {/if}
          </p>
          <a
            class="shop-btn shop-btn-secondary shop-btn-sm"
            href={`/uc/shop/subscriptions/${subscription.id}`}
          >
            {$i18n.t('subscription.manageGoUc')}
          </a>
        </div>
      {/each}
      {#if !singleSubscription}
        <p class="shop-subscription__switch-hint">
          {$i18n.t('subscription.manageMultipleHint')}
        </p>
      {/if}
    </section>
  {/if}

  <div class="shop-subscription__picker">
    {#if tierGroups.length === 0}
      <div class="shop-subscription__empty">{$i18n.t('subscription.noPlans')}</div>
    {:else}
      {#if tierGroups.length > 1 || periodGroups.length > 1}
        <div class="shop-subscription__axes">
          {#if tierGroups.length > 1}
            <span class="shop-subscription__axis-label">
              {$i18n.t('subscription.tierTabsLabel')}
            </span>
            <div
              class="shop-subscription__tabs"
              role="tablist"
              aria-label={$i18n.t('subscription.tierTabsLabel')}
            >
              {#each tierGroups as tier (tier.key)}
                <button
                  type="button"
                  class="shop-subscription__tab"
                  class:is-active={tier.key === selectedTierKey}
                  role="tab"
                  aria-selected={tier.key === selectedTierKey}
                  onclick={() => selectTier(tier.key)}
                >
                  {tier.label}
                </button>
              {/each}
            </div>
          {/if}

          {#if periodGroups.length > 1}
            <span class="shop-subscription__axis-label">
              {$i18n.t('subscription.periodTabsLabel')}
            </span>
            <div
              class="shop-subscription__tabs"
              role="tablist"
              aria-label={$i18n.t('subscription.periodTabsLabel')}
            >
              {#each periodGroups as period (period.key)}
                <button
                  type="button"
                  class="shop-subscription__tab"
                  class:is-active={period.key === selectedPeriodKey}
                  role="tab"
                  aria-selected={period.key === selectedPeriodKey}
                  onclick={() => selectPeriod(period.key)}
                >
                  {periodLabel(period.key)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="shop-subscription__plans">
        {#each combinationPlans as plan (plan.id)}
          {#if isSwitch}
            {#if currentSubscriptionId && plan.id !== currentPlanId}
              <a
                class="shop-subscription__plan"
                href={`/uc/shop/subscriptions/${currentSubscriptionId}/change?planId=${plan.id}`}
              >
                {@render planBody(plan)}
              </a>
            {:else}
              <div class="shop-subscription__plan is-selected is-current">
                {@render planBody(plan)}
              </div>
            {/if}
          {:else}
            <label class="shop-subscription__plan" class:is-selected={selectedPlanId === plan.id}>
              <input type="radio" name="plan" value={plan.id} bind:group={selectedPlanId} />
              {@render planBody(plan)}
            </label>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  {#if isSwitch}
    <p class="shop-subscription__switch-hint">{$i18n.t('subscription.switchHint')}</p>
  {:else if tierGroups.length > 0}
    {#if planMin !== planMax}
      <div class="shop-subscription__qty">
        <span class="shop-subscription__qty-label">{$i18n.t('buyBox.quantity')}</span>
        <div class="shop-quantity">
          <button
            type="button"
            class="shop-quantity__btn"
            onclick={() => (quantity = Math.max(planMin, quantity - 1))}
            disabled={quantity <= planMin}
            aria-label={$i18n.t('subscription.decreaseQuantity')}
          >
            {@html MingcuteMinimizeLine}
          </button>
          <input
            type="number"
            class="shop-quantity__input"
            aria-label={$i18n.t('buyBox.quantity')}
            value={quantity}
            oninput={(event) => (quantity = readPurchaseQuantityInput(event.currentTarget, { min: planMin, max: planMax }))}
            min={planMin}
            max={planMax}
          />
          <button
            type="button"
            class="shop-quantity__btn"
            onclick={() => (quantity = Math.min(planMax, quantity + 1))}
            disabled={quantity >= planMax}
            aria-label={$i18n.t('subscription.increaseQuantity')}
          >
            {@html MingcuteAddLine}
          </button>
        </div>
        <span class="shop-subscription__qty-hint">
          {$i18n.t('subscription.quantityRange', { min: planMin, max: planMax })}
        </span>
      </div>
    {/if}

    {#if resubscribable}
      <p class="shop-subscription__notice">{$i18n.t('subscription.resubscribeNotice')}</p>
    {/if}

    {#if error}
      <p class="shop-subscription__error">{error}</p>
    {/if}

    {#if showSummary && summaryRows}
      <div class="shop-subscription__summary">
        {#each summaryRows as row}
          <div
            class="shop-subscription__summary-row"
            class:shop-subscription__summary-row--muted={row.muted}
            class:shop-subscription__summary-row--total={row.total}
          >
            <span>{row.label}</span>
            <span>{row.amount}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="buy-box__actions shop-subscription__actions">
      <button
        type="button"
        class="shop-btn shop-btn-secondary"
        onclick={handleAddToCart}
        disabled={submitting || !selectedPlan}
      >
        {submitting ? $i18n.t('subscription.addingToCart') : $i18n.t('buyBox.addToCart')}
      </button>
      <form
        action={`/shop/checkout/prepare?redirect_uri=${encodeURIComponent(currentUrl)}`}
        method="post"
      >
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="source" value="BUY_NOW" />
        {#each cartLines as line, index}
          <input
            type="hidden"
            name={`items[${index}].productVariantId`}
            value={line.productVariantId}
          />
          <input type="hidden" name={`items[${index}].quantity`} value={line.quantity} />
        {/each}
        <button
          type="submit"
          class="shop-btn shop-btn-primary"
          disabled={submitting || !selectedPlan}
        >
          {$i18n.t('buyBox.buyNow')}
        </button>
      </form>
    </div>
  {/if}
</div>
