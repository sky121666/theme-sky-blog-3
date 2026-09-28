import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_KEYS = new Set([
  'appId', 'windowVariant', 'supportsSameAppPjax', 'sameAppPjaxLoading',
  'sameVariantPageModes', 'entry', 'assetDirectory'
]);
const PAGE_MODES = new Set([
  'browser-reader', 'browser-list', 'browser-moments', 'browser-links',
  'browser-bangumis', 'browser-douban', 'browser-docsme', 'browser-steam',
  'browser-equipments', 'auth'
]);

// This validates the executable manifest contract, not JavaScript expression types.
export function validateAppManifests(manifests, { root, exists = fs.existsSync } = {}) {
  const errors = [];
  const ids = new Set();
  const entries = new Set();
  const directories = new Set();
  const check = (condition, message) => { if (!condition) errors.push(message); };
  for (const manifest of manifests) {
    const id = manifest?.appId;
    check(typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id), 'manifest.appId must be an identifier');
    check(!ids.has(id), `duplicate appId: ${id}`);
    ids.add(id);
    for (const key of Object.keys(manifest || {})) {
      check(MANIFEST_KEYS.has(key), `${id}.${key} is not a consumed manifest field`);
    }
    check(['browser', 'none', id].includes(manifest.windowVariant), `${id}.windowVariant is invalid`);
    check(typeof manifest.supportsSameAppPjax === 'boolean', `${id}.supportsSameAppPjax must be boolean`);
    const loading = manifest.sameAppPjaxLoading ?? 'window-overlay';
    check(['progress', 'window-overlay'].includes(loading), `${id}.sameAppPjaxLoading is invalid`);
    check(loading !== 'progress' || manifest.supportsSameAppPjax, `${id}: progress requires same-app PJAX`);
    const modes = manifest.sameVariantPageModes;
    check(Array.isArray(modes) && modes.every((mode) => PAGE_MODES.has(mode)), `${id}.sameVariantPageModes is invalid`);
    check(manifest.supportsSameAppPjax || modes?.length === 0, `${id}: disabled PJAX cannot declare switch modes`);
    check(!manifest.supportsSameAppPjax || modes?.length > 0, `${id}: enabled PJAX requires switch modes`);
    const entry = manifest.entry;
    const safeEntry = typeof entry === 'string' && /^src\/apps\/[a-z0-9/-]+\/entry\.js$/.test(entry)
      && !entry.includes('//') && !entry.includes('..');
    check(safeEntry, `${id}.entry must be a relative app source entry`);
    check(safeEntry && exists(path.resolve(root, entry)), `${id}.entry does not exist: ${entry}`);
    check(!entries.has(entry), `duplicate app entry: ${entry}`);
    entries.add(entry);
    const directory = manifest.assetDirectory;
    check(typeof directory === 'string' && /^[a-z][a-z0-9-]*$/.test(directory), `${id}.assetDirectory is invalid`);
    check(!directories.has(directory), `duplicate asset directory: ${directory}`);
    directories.add(directory);
  }
  return errors;
}
