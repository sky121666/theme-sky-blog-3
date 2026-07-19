import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderWidget } from '../src/widgets/plugin/photos/render.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const makePhoto = (name, groupName) => ({
  metadata: { name },
  spec: {
    displayName: name,
    groupName,
    url: `https://example.test/${name}.jpg`
  }
});

const sources = {
  photosAvailable: true,
  photosUrl: '/photos',
  // 全局首页样本故意不包含 group-b，用来防止回归到“样本后过滤”。
  photos: [makePhoto('global-a', 'group-a')],
  photoGroups: [
    {
      metadata: { name: 'group-b', annotations: {} },
      spec: { displayName: '相册 B' },
      status: { photoCount: 9 },
      photos: [
        makePhoto('group-b-1', 'group-b'),
        makePhoto('group-b-2', 'group-b'),
        makePhoto('group-b-3', 'group-b'),
        makePhoto('group-b-4', 'group-b')
      ]
    }
  ]
};

const html = renderWidget(
  { sources, escapeHtml, mode: 'live' },
  { widget: 'plugin-photos.gallery', size: 'large', meta: { groupName: 'group-b' } }
);

assert.equal(html.includes('该相册暂无照片'), false, '非全局首页相册不得被误判为空');
assert.equal(html.includes('group-b-1.jpg'), true, '小组应使用 PhotoGroupVo.photos 作为展示样本');
assert.equal(html.includes('global-a.jpg'), false, '选定小组不得渗入全局样本');
assert.equal(html.includes(`9\u2009张照片`), true, '展示数量应使用 PhotoGroupVo.status.photoCount');
assert.equal(html.includes('+5'), true, '更多数量应基于小组总数而非局部样本数');

const editMode = fs.readFileSync(
  new URL('../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js', import.meta.url),
  'utf8'
);
assert.match(
  editMode,
  /widgetConfigPhotoGroupCount\(group\)[\s\S]*?group\?\.status\?\.photoCount/,
  '相册选项计数必须优先使用 PhotoGroupVo.status.photoCount'
);

console.log('photos widget contract passed');
