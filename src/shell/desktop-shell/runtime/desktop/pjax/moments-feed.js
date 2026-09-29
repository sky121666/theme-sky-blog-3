// Tag changes refresh feed data while retaining the surrounding Moments chrome.
// Request ownership, leave guards and history stay in the PJAX coordinator.
export function prepareMomentsFeedNavigation(contentRoot, targetUrl) {
  const isFeedUrl = (url) => url.origin === window.location.origin
    && url.pathname === '/moments' && !url.hash
    && [...url.searchParams.keys()].every((key) => key === 'tag')
    && url.searchParams.getAll('tag').length <= 1;
  try {
    if (!isFeedUrl(new URL(window.location.href))
      || !isFeedUrl(new URL(targetUrl, window.location.href))) return null;
  } catch { return null; }

  const root = contentRoot?.querySelector('.moments-app--feed[data-app-root="moments"]');
  const region = root?.querySelector('[data-moments-feed-region]');
  const content = region?.querySelector('[data-moments-feed-content]');
  const tags = root?.querySelector('.moments-tags');
  if (!content || !region.querySelector('[data-window-loading-overlay]')) return null;

  return {
    loadingRoot: region,
    prepareSwap(targetContainer) {
      const nextRoot = targetContainer?.querySelector('.moments-app--feed[data-app-root="moments"]');
      const nextContent = nextRoot?.querySelector('[data-moments-feed-content]');
      const nextTags = nextRoot?.querySelector('.moments-tags');
      if (!root.isConnected || !nextContent || Boolean(tags) !== Boolean(nextTags)) return null;
      return () => {
        // Dispose the removed pagination before its replacement can start.
        // The retained app root, cover and titlebar keep their Alpine markers.
        window.Alpine?.destroyTree?.(content);
        content.innerHTML = nextContent.innerHTML;
        if (tags) tags.innerHTML = nextTags.innerHTML;
      };
    }
  };
}
