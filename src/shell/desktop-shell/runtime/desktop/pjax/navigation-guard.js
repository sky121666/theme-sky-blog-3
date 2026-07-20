/**
 * Return whether a click should be handled as an in-place navigation.
 * Modified clicks must retain the browser's native new-tab/new-window behavior.
 */
export function isPlainPrimaryNavigationEvent(event) {
  if (!event || event.defaultPrevented) return false;
  if (typeof event.button === 'number' && event.button !== 0) return false;
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * Pjax copies request options onto its lifecycle events. Missing or malformed
 * intent tags are treated as legacy/current events; a valid positive tag must
 * exactly match the latest shared navigation intent.
 */
export function isCurrentNavigationIntent(value, currentGeneration) {
  const intentGeneration = Number(value);
  return !Number.isFinite(intentGeneration)
    || intentGeneration <= 0
    || intentGeneration === currentGeneration;
}

/**
 * Resolve the effective navigation URL using the same redirect precedence as
 * Pjax itself. The originally requested href is only a fallback because it can
 * be stale after an HTTP redirect.
 */
export function resolveNavigationHref(request, href, currentHref = globalThis.window?.location?.href || '') {
  const responseUrl = typeof request?.responseURL === 'string'
    ? request.responseURL.trim()
    : '';
  if (responseUrl) return responseUrl;

  for (const headerName of ['X-PJAX-URL', 'X-XHR-Redirected-To']) {
    try {
      const redirectedTo = request?.getResponseHeader?.(headerName);
      if (typeof redirectedTo === 'string' && redirectedTo.trim()) {
        return redirectedTo;
      }
    } catch (_error) {
      // Some XHR shims throw when response headers are unavailable. Continue
      // through the remaining redirect sources and request fallback.
    }
  }

  if (typeof href === 'string' && href) return href;
  return currentHref;
}

/**
 * Track which full-navigation intent owns browser history bookkeeping. A new
 * intent always revokes the previous popstate/forward claim.
 */
export function createBrowserNavigationOwnership() {
  let popstateIntent = 0;
  let forwardIntent = 0;

  const normalizeIntent = (value) => {
    const intent = Number(value);
    return Number.isFinite(intent) && intent > 0 ? intent : 0;
  };

  return {
    begin(intentValue, { popstate = false } = {}) {
      const intent = normalizeIntent(intentValue);
      popstateIntent = popstate && intent ? intent : 0;
      forwardIntent = 0;
      return intent;
    },

    markForward(intentValue) {
      const intent = normalizeIntent(intentValue);
      if (!intent || popstateIntent === intent) return false;
      forwardIntent = intent;
      return true;
    },

    isPopstate(intentValue) {
      const intent = normalizeIntent(intentValue);
      return Boolean(intent && popstateIntent === intent);
    },

    shouldCommitForward(intentValue) {
      const intent = normalizeIntent(intentValue);
      return Boolean(intent && forwardIntent === intent && popstateIntent !== intent);
    },

    release(intentValue) {
      const intent = normalizeIntent(intentValue);
      const owned = Boolean(intent && (popstateIntent === intent || forwardIntent === intent));
      if (popstateIntent === intent) popstateIntent = 0;
      if (forwardIntent === intent) forwardIntent = 0;
      return owned;
    },

    snapshot() {
      return { popstateIntent, forwardIntent };
    }
  };
}

/**
 * Full completion continuations must retain both their request generation and
 * shared navigation intent across every await boundary.
 */
export function isFullNavigationCompletionCurrent({
  completionGeneration,
  currentGeneration,
  completionIntent,
  currentIntent
}) {
  return completionGeneration === currentGeneration
    && isCurrentNavigationIntent(completionIntent, currentIntent);
}

/**
 * Optional post-swap hooks must never turn an already committed navigation
 * into a fallback. Report their failures without letting them escape.
 */
export function runNonFatalNavigationHook(hook, onError) {
  if (typeof hook !== 'function') return true;
  try {
    hook();
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

/**
 * Latest-navigation-wins coordinator for async content switches.
 * Starting a navigation aborts the previous fetch and invalidates all of its
 * later continuations, including work that cannot consume an AbortSignal.
 */
export function createNavigationCoordinator() {
  let generation = 0;
  let activeController = null;

  return {
    begin() {
      activeController?.abort();
      generation += 1;
      activeController = new AbortController();
      return {
        generation,
        controller: activeController,
        signal: activeController.signal
      };
    },

    isCurrent(navigation) {
      return Boolean(
        navigation
        && navigation.generation === generation
        && navigation.controller === activeController
        && !navigation.signal.aborted
      );
    },

    finish(navigation) {
      if (!this.isCurrent(navigation)) return false;
      activeController = null;
      return true;
    },

    cancel() {
      activeController?.abort();
      activeController = null;
      generation += 1;
    }
  };
}

export function isNavigationAbort(error, navigation, coordinator) {
  return error?.name === 'AbortError'
    || navigation?.signal?.aborted === true
    || !coordinator?.isCurrent?.(navigation);
}
