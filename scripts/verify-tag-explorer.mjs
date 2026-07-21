import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = process.cwd();
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [collectionTemplate, detailTemplate, runtime, styles, routeManifest, manifest] = await Promise.all([
  read('templates/modules/browser-explorer/tags.html'),
  read('templates/modules/browser-explorer/tag.html'),
  read('src/apps/explorer/tags/runtime.js'),
  read('src/apps/explorer/tags/styles.css'),
  read('src/shell-core/runtime/route-manifest.js'),
  read('src/apps/explorer/tags/manifest.js'),
]);

assert.ok(root, '项目根目录不能为空');

assert.match(collectionTemplate, /data-tag-root/, '标签根页必须暴露稳定根节点契约');
assert.match(collectionTemplate, /x-data="tagsExplorer"/, '标签根页必须启用全部文章预览交互');
assert.match(collectionTemplate, /data-tag-scope="all"/, '标签根页必须声明全部标签作用域');
assert.match(collectionTemplate, /tagList=\$\{tags\}/, '标签根页必须复用 Halo 注入的标签列表');
assert.match(collectionTemplate, /postFinder\.list\s*\(/, '标签根页必须通过 Finder 查询全部已发布文章');
assert.match(collectionTemplate, /site\.post\?\.tagPageSize/, '标签根页分页必须使用 Halo 标签文章分页大小');
assert.match(collectionTemplate, /tag :: postRows/, '标签根页必须复用统一文章行片段');
assert.match(collectionTemplate, /tag :: previewPane/, '标签根页必须复用统一文章预览片段');
assert.match(collectionTemplate, /data-tag-all-link/, '标签根页必须提供唯一“全部标签”入口');
assert.match(collectionTemplate, /data-tag-all-prev/, '标签根页必须提供全部文章上一页契约');
assert.match(collectionTemplate, /data-tag-all-next/, '标签根页必须提供全部文章下一页契约');
assert.match(collectionTemplate, /tagsRootUri \+ '\?page='/, '标签根页必须使用 query 分页');
assert.match(collectionTemplate, /data-tag-current-page/, '标签根页必须暴露当前页码');
assert.match(collectionTemplate, /data-tag-total-pages/, '标签根页必须暴露总页数');
assert.doesNotMatch(collectionTemplate, /tags\[0\]|data-tags-folder|selectTag\s*\(/, '标签根页不得自动选择首标签或保留按钮过滤');
assert.doesNotMatch(collectionTemplate, /postListLoading|browser-explorer-posts-skeleton/, '标签根页不得恢复局部骨架屏');

assert.match(detailTemplate, /tagFinder\.listAll\(\)/, '标签详情必须保留完整标签列表');
assert.match(detailTemplate, /site\.routes\?\.tagsUri/, '标签详情返回入口必须使用 Halo 标签根路由');
assert.match(detailTemplate, /data-tag-scope="tag"/, '标签详情必须声明单标签作用域');
assert.match(detailTemplate, /data-tag-all-link/, '标签详情必须保留全部标签入口');
assert.match(detailTemplate, /th:fragment="tagSidebar\(tags, currentTagName\)"/, '标签根页与详情页必须共享扁平标签侧栏');
assert.match(detailTemplate, /th:fragment="postRows\(posts, parentName\)"/, '标签根页与详情页必须共享文章行片段');
assert.match(detailTemplate, /th:fragment="previewPane"/, '标签根页与详情页必须共享预览片段');
assert.match(detailTemplate, /posts\.prevUrl/, '标签详情必须沿用 Halo 上一页地址');
assert.match(detailTemplate, /posts\.nextUrl/, '标签详情必须沿用 Halo 下一页地址');
assert.match(detailTemplate, /data-tag-empty/, '标签详情必须提供可恢复空页状态');
assert.match(detailTemplate, /data-tag-return-root/, '标签空页必须可返回全部标签');
assert.match(detailTemplate, /data-tag-return-first/, '越界分页必须可返回第一页');
assert.match(detailTemplate, /data-tag-return-last/, '越界分页必须可返回最后一个有效分页');
assert.match(detailTemplate, /datetime=\$\{#dates\.format/, '文章时间必须包含机器可读 datetime');
assert.match(detailTemplate, /aria-current=/, '当前标签和当前页必须暴露可访问状态');
assert.doesNotMatch(detailTemplate, /href="\/tags"/, '标签详情不得硬编码标签根路由');

assert.doesNotMatch(runtime, /fetchTagPosts|renderDynamicPosts|sessionStorage|api\.content\.halo\.run|renderBatch/, '标签运行时不得保留第二套 REST 数据通道');
assert.match(runtime, /registerTagsExplorer/, '标签运行时必须保留全部文章预览交互');
assert.match(runtime, /registerTagPostsExplorer/, '标签运行时必须保留详情文章预览交互');
assert.match(runtime, /scrollIntoView/, '标签详情必须把当前标签滚动到侧栏可视区');
assert.doesNotMatch(`${collectionTemplate}\n${detailTemplate}`, /api\.content\.halo\.run|fetch\s*\(/, '标签模板不得引入 REST 数据通道');

assert.match(styles, /@container windowframe \(max-width: 939px\)/, '标签页必须包含中等宽度两栏断点');
assert.match(styles, /@container windowframe \(max-width: 640px\)/, '标签页必须包含移动端单栏断点');
assert.match(styles, /@media \(min-width: 769px\) and \(max-height: 780px\)/, '标签页必须为低高度 Dock 预留安全区');
assert.match(styles, /:focus-visible/, '标签页必须定义键盘焦点态');
assert.match(styles, /prefers-reduced-motion: reduce/, '标签页必须尊重减少动态效果设置');

assert.match(routeManifest, /matchesTagRoute/, '标签路由必须使用严格匹配器');
assert.match(manifest, /sameAppPjaxLoading:\s*'progress'/, '标签内部 PJAX 必须使用轻量进度而非骨架屏');

console.log('标签浏览器契约验证通过');
