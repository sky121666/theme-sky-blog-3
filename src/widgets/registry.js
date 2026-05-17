import { haloAuthorCardWidgetManifest } from './halo/author-card/manifest.js';
import { haloCategoriesWidgetManifest } from './halo/categories/manifest.js';
import { haloIdentityCardWidgetManifest } from './halo/identity-card/manifest.js';
import { haloLatestPostsWidgetManifest } from './halo/latest-posts/manifest.js';
import { haloPopularPostsWidgetManifest } from './halo/popular-posts/manifest.js';
import { haloRandomTagsWidgetManifest } from './halo/random-tags/manifest.js';
import { haloSiteStatsWidgetManifest } from './halo/site-stats/manifest.js';
import { pluginMomentsRecentWidgetManifest } from './plugin/moments-recent/manifest.js';
import { pluginFriendsRecentWidgetManifest } from './plugin/friends-recent/manifest.js';
import { pluginDocsmeQuickWidgetManifest } from './plugin/docsme-quick/manifest.js';
import { pluginPhotosWidgetManifest } from './plugin/photos/manifest.js';
import { systemCalendarWidgetManifest } from './system/calendar/manifest.js';
import { systemClockWidgetManifest } from './system/clock/manifest.js';
import { systemWeatherWidgetManifest } from './system/weather/manifest.js';

export const WIDGET_MANIFESTS = [
  systemClockWidgetManifest,
  systemCalendarWidgetManifest,
  systemWeatherWidgetManifest,
  haloLatestPostsWidgetManifest,
  haloPopularPostsWidgetManifest,
  haloCategoriesWidgetManifest,
  haloAuthorCardWidgetManifest,
  haloIdentityCardWidgetManifest,
  haloSiteStatsWidgetManifest,
  haloRandomTagsWidgetManifest,
  pluginMomentsRecentWidgetManifest,
  pluginFriendsRecentWidgetManifest,
  pluginDocsmeQuickWidgetManifest,
  pluginPhotosWidgetManifest
];

export const WIDGET_MANIFEST_MAP = Object.fromEntries(
  WIDGET_MANIFESTS.map((manifest) => [manifest.widgetId, manifest])
);

export function getWidgetManifest(widgetId) {
  return WIDGET_MANIFEST_MAP[widgetId] || null;
}

export function getWidgetManifests() {
  return WIDGET_MANIFESTS.slice();
}
