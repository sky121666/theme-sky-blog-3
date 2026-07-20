import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = process.cwd();
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [collectionTemplate, detailTemplate, runtime, styles, routeManifest, widgetRenderer] = await Promise.all([
  read('templates/modules/browser-explorer/categories.html'),
  read('templates/modules/browser-explorer/category.html'),
  read('src/apps/explorer/categories/runtime.js'),
  read('src/apps/explorer/categories/styles.css'),
  read('src/shell-core/runtime/route-manifest.js'),
  read('src/widgets/halo/categories/render.js'),
]);

assert.ok(root, '项目根目录不能为空');

assert.match(collectionTemplate, /data-category-root/, '分类根页必须暴露稳定的根节点契约');
assert.match(collectionTemplate, /data-category-overview-link/, '分类根页必须输出真实分类概览链接');
assert.match(collectionTemplate, /class="categories-sidebar-item pjax-link"/, '分类侧栏必须使用真实 PJAX 链接');
assert.doesNotMatch(collectionTemplate, /postFinder\.list\s*\(/, '分类根页不得再固定查询文章列表');
assert.doesNotMatch(collectionTemplate, /data-categories-folder|selectCategory\s*\(/, '分类根页不得保留无路由的按钮切换');

assert.match(detailTemplate, /categoryFinder\.listAsTree\(\)/, '分类详情必须保留完整分类树');
assert.match(detailTemplate, /site\.routes\?\.categoriesUri/, '分类详情返回入口必须使用 Halo 分类根路由');
assert.match(detailTemplate, /data-category-current-page/, '分类详情必须暴露当前页码供真页验证');
assert.match(detailTemplate, /data-category-total-pages/, '分类详情必须暴露总页数供真页验证');
assert.match(detailTemplate, /posts\.prevUrl/, '分类详情必须沿用 Halo 上一页地址');
assert.match(detailTemplate, /posts\.nextUrl/, '分类详情必须沿用 Halo 下一页地址');
assert.match(detailTemplate, /data-category-empty/, '分类详情必须提供可恢复的空页状态');
assert.match(detailTemplate, /data-category-return-root/, '分类空页必须可返回全部分类');
assert.match(detailTemplate, /data-category-return-first/, '越界分页必须可返回第一页');
assert.match(detailTemplate, /data-category-return-last/, '越界分页必须可直达最后一个有效分页');
assert.match(detailTemplate, /datetime=\$\{#dates\.format/, '文章时间必须包含机器可读 datetime');
assert.match(detailTemplate, /aria-current=/, '当前分类和当前页必须暴露可访问状态');

assert.doesNotMatch(runtime, /fetchCategoryPosts|renderDynamicPosts|sessionStorage|api\.content\.halo\.run/, '分类运行时不得恢复第二套 REST 数据通道');
assert.match(runtime, /registerCategoryPostsExplorer/, '分类运行时必须保留文章预览交互');

assert.match(styles, /@container \(max-width: 1179px\)/, '分类页必须包含中等宽度两栏断点');
assert.match(styles, /@container \(max-width: 640px\)/, '分类页必须包含移动端单栏断点');
assert.match(styles, /@media \(min-width: 769px\) and \(max-height: 780px\)/, '分类页必须为低高度 Dock 预留安全区');
assert.match(styles, /:focus-visible/, '分类页必须定义清晰的键盘焦点态');
assert.match(styles, /prefers-reduced-motion: reduce/, '分类页必须尊重减少动态效果设置');

assert.match(routeManifest, /matchesCategoryRoute/, '分类路由必须使用严格匹配器');
assert.match(widgetRenderer, /__SKY_THEME_ROUTES__\?\.categoriesUri/, '分类 Widget 必须复用主题分类根路由');

console.log('分类浏览器契约验证通过');
