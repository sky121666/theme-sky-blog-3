import { authAppManifest } from '../../apps/auth/manifest.js';
import { explorerArchivesAppManifest } from '../../apps/explorer/archives/manifest.js';
import { explorerAuthorAppManifest } from '../../apps/explorer/author/manifest.js';
import { explorerCategoriesAppManifest } from '../../apps/explorer/categories/manifest.js';
import { explorerTagsAppManifest } from '../../apps/explorer/tags/manifest.js';
import { friendsAppManifest } from '../../apps/friends/manifest.js';
import { momentsAppManifest } from '../../apps/moments/manifest.js';
import { photosAppManifest } from '../../apps/photos/manifest.js';
import { readerAppManifest } from '../../apps/reader/manifest.js';

export const APP_MANIFESTS = [
  readerAppManifest,
  momentsAppManifest,
  friendsAppManifest,
  photosAppManifest,
  authAppManifest,
  explorerTagsAppManifest,
  explorerCategoriesAppManifest,
  explorerAuthorAppManifest,
  explorerArchivesAppManifest
];

export function getKnownAppIds() {
  return APP_MANIFESTS.map((manifest) => manifest.appId);
}

export function getAppManifest(appId) {
  return APP_MANIFESTS.find((manifest) => manifest.appId === appId) || null;
}

export function supportsSameVariantContentSwitch(appId) {
  return !!getAppManifest(appId)?.supportsSameAppPjax;
}

export function isContentSwitchAllowed(appId, pageMode) {
  const allowedModes = getAppManifest(appId)?.sameVariantPageModes || [];
  if (!appId || !pageMode) return false;
  return allowedModes.includes(pageMode);
}
