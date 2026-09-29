// Public data implementations are fetched only after a visible widget needs
// missing data; the persistent shell keeps only the small rendering adapter.
export { bangumiWidgetDataStore } from '../../../../widgets/plugin/bangumis-recent/data.js';
export { randomTagsWidgetDataStore } from '../../../../widgets/halo/random-tags/data.js';
export { resolveFinderWidgetSources, retryFinderWidgetSources } from './finder-data-loader.js';
