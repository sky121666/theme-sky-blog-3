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
assert.match(collectionTemplate, /x-data="categoriesExplorer"/, '分类根页必须启用全部文档预览交互');
assert.match(collectionTemplate, /data-category-scope="all"/, '分类根页必须声明全部分类作用域');
assert.match(collectionTemplate, /categoryTree=\$\{categories\}/, '分类根页必须复用 Halo 注入的唯一分类树');
assert.match(collectionTemplate, /postFinder\.list\s*\(/, '分类根页必须查询全部已发布文档');
assert.match(collectionTemplate, /site\.post\?\.categoryPageSize/, '分类根页分页必须使用分类文章分页大小');
assert.match(collectionTemplate, /category :: postRows/, '分类根页必须复用统一文档行片段');
assert.match(collectionTemplate, /category :: previewPane/, '分类根页必须复用统一文档预览片段');
assert.match(collectionTemplate, /data-category-all-link/, '分类根页必须提供唯一的“全部分类”入口');
assert.match(collectionTemplate, /data-category-all-prev/, '分类根页必须提供全部文档上一页契约');
assert.match(collectionTemplate, /data-category-all-next/, '分类根页必须提供全部文档下一页契约');
assert.match(collectionTemplate, /categoriesRootUri \+ '\?page='/, '分类根页必须使用查询参数分页');
assert.match(collectionTemplate, /data-category-current-page/, '分类根页必须暴露当前页码供真页验证');
assert.match(collectionTemplate, /data-category-total-pages/, '分类根页必须暴露总页数供真页验证');
assert.equal(
  (collectionTemplate.match(/category :: categorySidebar/g) || []).length,
  1,
  '分类根页只能输出一棵分类树',
);
assert.doesNotMatch(collectionTemplate, /categoryFinder\.listAsTree\(\)/, '分类根页不得重复查询第二棵分类树');
assert.doesNotMatch(collectionTemplate, /data-category-overview-link|categories-workspace--overview|categories-overview-card/, '分类根页不得保留旧概览卡片结构');
assert.doesNotMatch(collectionTemplate, /data-categories-folder|selectCategory\s*\(/, '分类根页不得保留无路由的按钮切换');

assert.match(detailTemplate, /categoryFinder\.listAsTree\(\)/, '分类详情必须保留完整分类树');
assert.match(detailTemplate, /site\.routes\?\.categoriesUri/, '分类详情返回入口必须使用 Halo 分类根路由');
assert.match(detailTemplate, /data-category-scope="category"/, '分类详情必须声明单分类作用域');
assert.match(detailTemplate, /data-category-all-link/, '分类详情必须保留全部分类入口');
assert.match(detailTemplate, /th:fragment="postRows\(posts, parentName\)"/, '分类根页与详情页必须共享文档行片段');
assert.match(detailTemplate, /th:fragment="previewPane"/, '分类根页与详情页必须共享预览片段');
assert.match(detailTemplate, /#annotations\.getOrDefault\(item, 'icon', ''\)/, '分类列表必须读取分类图标元数据');
assert.match(detailTemplate, /#annotations\.getOrDefault\(item, 'color', ''\)/, '分类列表必须读取分类颜色元数据');
assert.match(detailTemplate, /data-category-custom-icon/, '分类列表必须暴露自定义图标渲染状态');
assert.match(detailTemplate, /data-category-color/, '分类列表必须暴露通过校验的颜色值');
assert.match(detailTemplate, /categories-folder-icon--custom/, '分类列表必须渲染自定义 SVG 图标');
assert.match(detailTemplate, /icon-\[lucide--folder\]/, '分类缺少图标元数据时必须回退默认文件夹图标');
assert.doesNotMatch(detailTemplate, /categories-sidebar-icon/, '分类列表图标不得增加归档风格之外的包裹容器');
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
assert.doesNotMatch(detailTemplate, /data-category-overview-link|categories-overview-card/, '分类详情不得恢复旧概览卡片结构');

assert.doesNotMatch(runtime, /fetchCategoryPosts|renderDynamicPosts|sessionStorage|api\.content\.halo\.run/, '分类运行时不得恢复第二套 REST 数据通道');
assert.match(runtime, /registerCategoriesExplorer/, '分类运行时必须保留全部文档预览交互');
assert.match(runtime, /registerCategoryPostsExplorer/, '分类运行时必须保留文章预览交互');
assert.doesNotMatch(`${collectionTemplate}\n${detailTemplate}`, /api\.content\.halo\.run|fetch\s*\(/, '分类模板不得引入 REST 数据通道');

assert.match(styles, /@container windowframe \(max-width: 939px\)/, '分类页必须包含中等宽度两栏断点');
assert.match(styles, /@container windowframe \(max-width: 640px\)/, '分类页必须包含移动端单栏断点');
assert.match(styles, /@media \(min-width: 769px\) and \(max-height: 780px\)/, '分类页必须为低高度 Dock 预留安全区');
assert.match(styles, /:focus-visible/, '分类页必须定义清晰的键盘焦点态');
assert.match(styles, /prefers-reduced-motion: reduce/, '分类页必须尊重减少动态效果设置');
assert.match(styles, /--category-item-color/, '分类列表样式必须消费分类颜色元数据');
assert.match(styles, /\.categories-folder-icon--custom > svg/, '分类自定义 SVG 必须受图标容器约束');
assert.doesNotMatch(styles, /\.categories-sidebar-icon/, '分类图标样式不得恢复底块、边框或包裹容器');
const categoryActivePostStyles = styles.match(/\.category-post-row\.is-active\s*\{([^}]*)\}/)?.[1] ?? '';
assert.match(categoryActivePostStyles, /background:\s*var\(--categories-selection-fill\)/, '分类文档选中态必须复用归档式轻量填充');
assert.match(categoryActivePostStyles, /border-color:\s*var\(--categories-selection-border\)/, '分类文档选中态必须复用归档式细边框');
assert.match(categoryActivePostStyles, /box-shadow:\s*inset 0 1px 0/, '分类文档选中态必须只保留归档式顶部高光');
assert.doesNotMatch(styles, /list-active-rim|inset 2px 0 0/, '分类选中态不得恢复左侧强调线');

assert.match(routeManifest, /matchesCategoryRoute/, '分类路由必须使用严格匹配器');
assert.match(widgetRenderer, /__SKY_THEME_ROUTES__\?\.categoriesUri/, '分类 Widget 必须复用主题分类根路由');

console.log('分类浏览器契约验证通过');
