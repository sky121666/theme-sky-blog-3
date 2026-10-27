const LIVE_STATUSES = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE']);

export function getSubscriptionState(subscriptions = [], singleSubscription = true) {
  const hasHistory = subscriptions.length > 0;
  const hasLiveSubscription = subscriptions.some((item) => LIVE_STATUSES.has(item.status));
  const isSwitch = singleSubscription && hasLiveSubscription;
  return {
    isSwitch,
    resubscribable: hasHistory && !hasLiveSubscription,
    showManageList: isSwitch || (!singleSubscription && hasHistory),
    trialOffered: !hasHistory,
  };
}

export function resolveSubscriptionLine(data, variantId, snapshot) {
  if (snapshot?.planName) return {
    name: snapshot.planName,
    billingPeriod: snapshot.billingPeriod,
    billingMode: snapshot.billingMode,
  };
  if (!data || variantId == null) return null;
  const plan = (data.plans ?? []).find((item) => item.variantId === variantId);
  return plan?.name ? {
    name: plan.name,
    billingPeriod: plan.billingPeriod,
    billingMode: plan.billingMode,
  } : null;
}
