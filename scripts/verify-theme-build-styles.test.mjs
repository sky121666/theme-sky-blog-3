import assert from 'node:assert/strict';
import { renderBuildStyles } from './theme-build-styles.mjs';

const manifest = {
  __meta: { version: '0.9.46', revision: '123abc', query: 'v=0.9.46&r=123abc' },
  'shell-core': { css: ['/themes/sky/assets/css/shell-core/index.css'] },
  reader: { css: ['/themes/sky/assets/css/apps/reader/index.css'] },
  'explorer-tags': { css: ['/themes/sky/assets/css/apps/tags/index.css'] },
  'explorer-categories': { css: ['/themes/sky/assets/css/apps/categories/index.css'] },
  'explorer-author': { css: ['/themes/sky/assets/css/apps/author/index.css'] },
  'explorer-archives': { css: ['/themes/sky/assets/css/apps/archives/index.css'] },
};

const html = renderBuildStyles(manifest);
assert.match(html, /th:fragment="styles\(pageApp\)"/);
assert.match(html, /id="shell-core-style"/);
assert.match(html, /data-app-css/);
assert.match(html, /pageApp == 'explorer-tags'/);
assert.match(html, /css\/apps\/tags\/index\.css\?v=0\.9\.46&amp;r=123abc/);
assert.match(html, /css\/apps\/categories\/index\.css\?v=0\.9\.46&amp;r=123abc/);
assert.match(html, /css\/apps\/author\/index\.css\?v=0\.9\.46&amp;r=123abc/);
assert.match(html, /css\/apps\/archives\/index\.css\?v=0\.9\.46&amp;r=123abc/);
assert.doesNotMatch(html, /halo-token|theme\.metadata/);
assert.throws(() => renderBuildStyles({ ...manifest, __meta: { ...manifest.__meta, query: 'v=0.9.46&r=wrong' } }), /identity/i);
console.log('theme build styles passed');
