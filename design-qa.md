# PluginLinks 留言板提交评论按钮配色 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-2cd0379b-2d8b-4141-80da-a4d55a083c2a.png`
- Mobile implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-comment-button/after-mobile.jpg`
- Desktop regression: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-comment-button/after-desktop.jpg`
- Route: `http://localhost:8090/links?view=board`
- State: 暗色、已登录、评论编辑器和 3 条真实评论已加载
- Viewport: CSS `390 × 844px`，`devicePixelRatio: 1`；桌面回归 `1280 × 720px`
- Pixel normalization: 参考截图为 `588 × 757px` 的移动端问题裁切，实现在 `390 × 844px` 真页中按 1x CSS 像素检查。两者外框比例不同，因此只比较留言板评论区、按钮层级和配色，不进行跨画布逐像素判断。
- Full-view comparison evidence: 参考截图与 `after-mobile.jpg` 已放入同一视觉输入，蓝色按钮问题、评论区层级、底部导航和移动端边界均清晰可辨。
- Focused region evidence: 不需要额外裁切；两张全图中的 `91 × 37px`“提交评论”按钮均可直接辨认，并以真页计算样式补充核对背景、边框和文字色。

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: 按钮继续使用评论组件原有 14px 系统字体、白色文字和当前字重，没有改变评论正文、作者或时间信息层级。
- Spacing and layout rhythm: 保留原有 `91 × 37px` 圆角按钮、编辑器间距与右对齐位置；390px 下页面 `scrollWidth` 等于视口宽度，没有横向溢出。
- Colors and visual tokens: 留言板范围内的评论组件主色由主题蓝 `#2e5fbd` 改为微信绿 `#07c160`，按压色为 `#06ad56`，按钮背景与边框计算值均为 `rgb(7, 193, 96)`，文字保持白色。
- Image quality and assets: 没有修改头像、评论内容、图标或其他图像资源。
- Copy and content: “提交评论”、评论数量和已有留言完全保留，没有改写或创建测试评论。
- Scope: 配色通过 `.links-comments comment-widget` 的局部变量覆盖实现，不影响文章、文档、图库或其他页面的评论组件，也没有改变评论接口和提交行为。
- Interaction and accessibility: 评论按钮仍由原组件处理悬停、聚焦和提交；主题提供绿色主态、深绿色按压 token 与白色文字。手机真页控制台错误为 0。

## Comparison history

- Pass 1: 参考截图及修复前真页显示“提交评论”为主题蓝 `rgb(46, 95, 189)`，与留言导航及友链应用的微信绿主色不一致，记录为 P2 配色漂移。
- Fix 1: 仅在 `.links-comments` 内覆盖 CommentWidget 的主色、按压色、浅色状态和表情选择器强调色，并增加适配契约断言。
- Pass 2: 390px 真页按钮变为 `rgb(7, 193, 96)`，评论区布局和底部导航保持稳定；桌面真页同样生效，无剩余 P0/P1/P2。

## Verification

- [x] `pnpm run verify:links`
- [x] `pnpm run build`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 390px 手机真页、桌面真页、计算样式、无横向溢出与 console error 复核

final result: passed

---

# PluginLinks 手机端全屏响应式设计 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-d6e2dc87-08eb-4b85-ab45-06d2dae63215.png`
- Mobile before: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/01-before-source.png`
- Mobile implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/02-after-source-390.png`
- Narrow implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/08-after-source-320.png`
- Mobile list: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/03-after-list-390.png`
- Mobile apply: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/07-after-apply-320.png`
- Mobile more menu: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/09-after-more-menu-320.png`
- Desktop regression: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-mobile-responsive/10-desktop-regression.png`
- Route: `http://localhost:8090/links?view=friends&linkName=link-QDUTJ`
- State: 暗色、PluginLinks 真实来源和 20 条 RSS 动态、管理员能力已加载
- Viewports: CSS `390 × 844px`、`320 × 640px`、桌面 `1250 × 1169px`；`devicePixelRatio: 1`
- Pixel normalization: 桌面目标是页头聚焦裁切 `720 × 213px`；移动实现分别为 `390 × 844px` 与 `320 × 640px`。这是同一设计语言的响应式重排，不进行跨形态逐像素比较；所有实现截图按 1x CSS 像素检查。
- Full-view comparison evidence: 桌面视觉目标、手机端修复前和 `02-after-source-390.png` 已放入同一视觉输入，确认信息层级、微信配色和来源动态语义保持一致，并修复整窗不可见问题。
- Focused region evidence: `08-after-source-320.png`、`03-after-list-390.png`、`07-after-apply-320.png` 与桌面回归图已放入同一视觉输入，逐项核对 320px Header、底部导航、表单、真实头像、文本换行和桌面布局。

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: 继续使用系统字体与原有 10–14px 信息层级；320px 下来源标题、日期和摘要可自然换行，Header 标题与域名/动态数保持两行，不发生逐字换行或遮挡。
- Spacing and layout rhythm: 手机端窗口改为完整 `100dvh` 沉浸式画布，390px 与 320px 均无横向溢出；底部导航为 64px 并显示图标与短标签，详情按钮和主要表单控件提升到 40px 触控尺寸。
- Colors and visual tokens: 微信绿只用于当前导航、访问入口和状态动作；暗色背景、边界与弱化文本全部继续复用 links app 自有 token，不受主题强调色影响。
- Image quality and assets: 左侧来源与动态作者继续使用 PluginLinks 的真实头像；透明 Logo 背景保持透明，没有新增、替换或伪造图像资产。
- Copy and content: “5ee博客 / 5ee.net · 20 条动态”“访问网站”“收藏 / 稍后读 / 未读”等桌面信息在移动端保留；访问网站在窄 Header 中仅隐藏文字、保留语义完整的图标入口。
- Interaction and accessibility: 390px 下已验证来源详情返回列表、朋友圈与链接标签切换、友链详情、添加友链；320px 下更多菜单边界为 `x=86..303`，没有越出视口。底部导航显示文字标签，触控入口拥有明确语义，真页 `console.error` 为 0。
- Desktop regression: 桌面窗口仍为 `1120 × 652px`，来源 Header 仍为 78px，菜单栏和 Dock 保持显示，用户确认的桌面布局未变化。
- Framework boundary: 仅扩展现有响应式 CSS 和静态契约测试，没有新增 DaisyUI、依赖、接口、权限或路由。

## Comparison history

- Pass 1: 390px 修复前截图中友链窗口收缩为约 `2 × 60px`，整个应用不可见，属于 P0 响应式阻断。
- Fix 1: 为 links 页面补齐移动端全屏窗口契约：隐藏桌面菜单栏/Dock/拖拽控件，令 `#window-frame-root` 和 `.links-window` 占满 `100dvh`；同时优化底部导航标签、Header、动态操作和表单触控尺寸。
- Pass 2: 390px 来源详情、来源列表与 320px 来源详情、添加表单、更多菜单均可见且无横向溢出；桌面回归保持原布局，无剩余 P0/P1/P2。

## Primary interactions tested

- 来源详情返回朋友圈来源列表，URL 正确移除 `linkName`。
- 朋友圈切换到链接列表后，`view=links` 状态在 2.1 秒复核中保持稳定。
- 点击真实“5ee博客”友链进入资料详情。
- 点击底部“添加”进入管理员直连表单。
- 320px 下展开首条动态三点菜单，收藏、稍后读、未读操作完整可见且未越界。
- 390px、320px 均无 body 横向溢出；当前页控制台错误为 0。

## Verification

- [x] `pnpm run build`
- [x] `pnpm run verify:links`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 390px、320px 和桌面真页视觉及交互复核

final result: passed

---

# PluginLinks 来源详情页头精简设计 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-d6e2dc87-08eb-4b85-ab45-06d2dae63215.png`
- Browser-rendered implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-header-final/implementation.png`
- Route: `http://localhost:8090/links?view=friends&linkName=link-QDUTJ`
- State: 暗色、朋友圈、单一 RSS 来源、20 条真实动态已加载
- Viewport: CSS `1250 × 1169px`，`devicePixelRatio: 1`
- Pixel normalization: 参考图是页头聚焦裁切 `720 × 213px`；实现全页截图为 `1250 × 1169px`。两者均按 1x 像素查看，不做缩放后的亚像素推断；实现页头的 DOM 实测区域为 `618 × 78px`。
- Full-view comparison evidence: 参考图与 `implementation.png` 已放入同一个视觉比较输入，核对应用窗口比例、详情页头层级、首条动态衔接及左右栏关系。
- Focused region comparison evidence: 参考图本身就是目标页头的聚焦区域；同一比较输入中实现页头文字与控件可清晰辨认，并辅以真页 DOM 实测：页头图片 `0`、旧简介节点 `0`、标题为“5ee博客”、第二行为“5ee.net · 20 条动态”。浏览器后端不支持元素局部截图，因此未伪造额外裁切图。

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: 标题继续使用 14px/600 系统字体，第二行使用 10px 弱化元数据；两行层级与参考图一致，没有重复简介、换行或截断异常。
- Spacing and layout rhythm: 来源页头维持 `78px` 高度、`0 12px 0 18px` 内边距和 `8px` 控件间距；删除页头头像后，标题左对齐更干净，首条动态仍按原间距衔接。
- Colors and visual tokens: 暗色面板、弱化文字、微信绿访问按钮与参考图一致，继续复用现有 links app token，没有受主题强调色影响。
- Image quality and assets: 只移除了页头内重复 Logo；左侧来源列表和 20 条动态中的真实头像全部保留，真页统计为 20 个动态图片节点，没有新增或伪造资源。
- Copy and content: 页头仅保留“5ee博客”“5ee.net · 20 条动态”和“访问网站”；刷新与收起控件保持不变，信息噪点与参考图一致。
- Interaction and accessibility: “访问来源网站”“刷新动态”“收起详情”均保留明确语义；`links` 与 `links-interactions` 冒烟页的 page error、console error、request failure 均为空，当前真页额外检查 `console.error` 为 0。
- Framework boundary: 只修改现有 Thymeleaf 模板和原生 CSS，没有引入 daisyUI、依赖、接口、权限或路由变化。

## Comparison history

- Pass 1: 将用户确认的页头截图与重载后的真实页面放入同一视觉输入，未发现 P0/P1/P2 差异；本轮没有因视觉 QA 产生二次修复。

## Verification

- [x] `pnpm run build`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 真页 DOM、动态头像保留、控件语义和 console error 核对
- [x] 参考图与浏览器实现同一视觉输入复核

final result: passed

---

# PluginLinks 来源页头、外链层级与暗色下拉设计 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-f961f4b5-8d64-40a6-ae4f-8c0063472daf.png`
- Select problem evidence: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-b80f3dac-7fbb-44a4-a543-2ea04b7d52fe.png`
- Browser-rendered implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-source-header/02-after.png`
- Same-size implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-source-header/03-after-1068x826.png`
- All-feed action state: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-source-header/05-after-actions-all.png`
- Route: `http://localhost:8090/links?view=friends&linkName=link-QDUTJ`
- State: 暗色、朋友圈、单一 RSS 来源、真实动态与管理员操作已加载
- Pixel normalization: 参考图 `1068 × 826px`；同尺寸实现 `1068 × 826px`，CSS viewport `1068 × 826`、`devicePixelRatio: 1`。参考图不携带 CSS viewport 元数据，因此只按相同像素画布、相同暗色来源状态比较，不做亚像素密度推断。
- Full-view comparison evidence: 用户问题图与 `03-after-1068x826.png` 已在同一视觉比较输入中检查。
- Focused region evidence: 用户问题图本身已是来源页头与首批动态的聚焦截图；实现页头在同尺寸截图中保持清晰可读，因此没有再以不同裁切制造第二组比较。

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: 延续系统字体与微信式紧凑字级；来源名称、简介、域名和动态计数在 `78px` 页头内形成清楚的三级信息，不再上下重复，长内容保持单行截断。
- Spacing and layout rhythm: 来源头像为 `40 × 40px`，访问入口为 `83 × 32px`；旧 `.links-feed-profile` 节点数量为 `0`，首条动态直接衔接页头，重复资料卡与过重留白均已移除。
- Colors and visual tokens: 访问入口改为低饱和微信绿轻底，不再使用大面积实心绿色；暗色应用和分组下拉的计算 `color-scheme` 均为 `dark`，选项背景为 `rgb(51, 51, 51)`、文字为 `rgb(231, 231, 231)`。
- Image quality and assets: 页头继续使用 PluginLinks 的真实站点 Logo；缺图只回退到项目已有 Lucide/Iconify RSS 图标，没有新增、替换或伪造图片资源。
- Copy and content: 来源名称、原简介、域名与真实动态数量完整保留；“只看此来源”增加轻量方向提示，当前已经处于该来源时自动隐藏，避免重复动作。
- Interaction and accessibility: 从“全部动态”点击首条“只看此来源”可回到 `linkName=link-QDUTJ`，页头同步出现；来源网站与原文入口保持 `_blank` 和 `noopener noreferrer`，原文图标命中区为 `28 × 28px`，页面 `console.error` 为 `0`。
- Framework boundary: 继续使用现有 Thymeleaf、Alpine、Lucide/Iconify 与原生 CSS；没有新增 daisyUI、依赖、接口、权限或路由。

## Comparison history

- Pass 1: 用户问题图显示顶部标题与下方来源资料卡重复；“访问网站”实心绿按钮过重，“只看此来源 / 阅读原文”层级割裂；暗色原生下拉仍以亮色选项面板出现。
- Fix 1: 将真实头像、名称、简介、域名、数量和访问入口合并到来源页头；删除独立资料卡；统一站内来源跳转、原文图标和页头外链的尺寸、方向提示与按压反馈；为应用和选项补齐原生暗色契约。
- Pass 2: 同尺寸暗色真页复核中没有重复名称块、裁切、溢出或明显层级漂移；来源跳转、外链属性、原生选项计算样式和控制台均通过，无剩余 P0/P1/P2。

## Verification

- [x] `node --check src/apps/links/runtime.js`
- [x] `pnpm run verify:links`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 同尺寸暗色截图、来源跳转、外链属性、暗色下拉计算样式与 console error 真页复核

final result: passed

---

# PluginLinks 微信式三点操作菜单设计 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-2b886c48-c9d2-407b-ba6d-04d0d048bea2.png`
- Browser-rendered closed state: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-more-menu/02-after-closed.png`
- Browser-rendered open state: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-audit/links-more-menu/03-after-open.png`
- Route: `http://localhost:8090/links?view=friends&scope=all`
- Viewport: `1250 × 1169`
- State: 暗色、朋友圈、全部动态、真实 RSS 与受保护状态操作已加载
- 对照说明：参考微信朋友圈的右下角三点入口与横向深色浮层，不复制参考图中 PluginLinks 不提供的点赞、评论或图片字段。

## Findings

- No actionable P0/P1/P2 findings remain.
- 默认层级：每条动态只常显“只看此来源”、原文图标和 `36 × 24px` 三点按钮；收藏、稍后阅读与未读状态不再形成常驻管理工具栏。
- 展开层级：三项操作以 `237 × 40px` 横向深色浮层出现，菜单完全位于详情滚动区内，页面没有横向溢出；同一时间只允许一个菜单展开。
- 文案与状态：可见短标签固定为“收藏 / 稍后读 / 未读”，微信绿只表达已选状态；完整的“取消收藏 / 移出稍后阅读 / 设为未读”等操作说明保留在 `title` 与无障碍语义中。
- 交互：鼠标点击三点切换菜单，点击外部或按 `Escape` 均可收起；键盘打开时自动聚焦首项，并支持方向键、Home 与 End 导航。
- Framework boundary: 复用现有 Thymeleaf、Alpine、Lucide/Iconify 与原生 CSS，没有新增 UI 框架、依赖、接口或路由。

## Verification

- [x] `pnpm run verify:links`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 真页菜单唯一性、矩形边界、点外部、`Escape`、无横向溢出与 console error 复核
- [x] 微信参考图、收起态与展开态同一视觉比较输入复核

final result: passed

---

# PluginLinks 窗口控件与全部动态比例修正设计 QA

## 对照目标

- Source problem evidence: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-4a021984-7c1d-4214-9239-3c872a0cc568.png`
- Browser-rendered controls: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-qa/links-controls-scale-after.png`
- Browser-rendered all-feed row: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-qa/links-all-feed-icon-after.png`
- Route: `http://localhost:8090/links?view=friends&scope=all`
- Viewport: `1250 × 1169`
- State: 暗色、朋友圈、全部动态选中、真实 RSS 来源已加载
- 对照说明：用户截图用于指出“全部动态”图标比例问题；最终目标同时遵循用户文字约束——恢复系统窗口按钮比例、放大全部动态图标、删除侧栏设置入口。

## 对照证据

- Same-input comparison: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-qa/links-all-feed-icon-comparison.png`
- 对比图左侧为用户问题截图，右侧为真实页面修正后选中态。

## Findings

- No actionable P0/P1/P2 findings remain.
- 窗口控件：友链应用不再对全局三色按钮做 `0.72` 倍缩放；关闭、最小化、最大化按钮真页尺寸均恢复为 `12 × 12px`，与桌面窗口系统规格一致。
- 全部动态：光圈图标从通用 `21 × 21px` 提升为 `26 × 26px`；选中态计算颜色为 `rgb(7, 193, 96)`，绿色只作用于图标并保留克制的行背景。
- 侧栏设置：模板和真页中 `.links-rail-settings` 与侧栏 `/console` 链接数量均为 `0`；其他链接、朋友圈、添加和留言入口不受影响。
- 布局：应用继续使用原有 `60px + 440px` 左侧结构，页面无横向溢出；没有改动全局桌面窗口控件或引入 UI 依赖。

## Verification

- [x] `pnpm run verify:links`
- [x] `pnpm run typecheck`
- [x] `pnpm run build-only`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 暗色真页尺寸、节点缺失与并排截图复核

final result: passed

---

# PluginLinks 选中图标与透明头像修正设计 QA

## 对照目标

- Source problem evidence: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-f3affd5c-2f21-4ac9-a5da-f92519a077ad.png`
- Source problem evidence: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-b131f7fa-0793-4e84-bf2f-b9fb7964cd85.png`
- Browser-rendered implementation: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-qa/links-selected-icons-after.png`
- Route: `http://localhost:8090/links?view=friends&scope=all`
- State: 暗色、朋友圈、全部动态选中、真实透明站点 Logo 可见
- 对照说明：两张用户截图是问题区域证据，不是继续复刻的目标；修正目标以用户明确约束为准——透明像素不填绿，选中态只让图标本身变绿。

## 对照证据

- Same-input comparison: `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/output/design-qa/links-icon-avatar-comparison.png`
- 对比图左侧为修正前问题区域，右侧为同一真实页面修正后实现。

## Findings

- No actionable P0/P1/P2 findings remain.
- 透明头像：来源资料头像与动态头像的计算背景均为 `rgba(0, 0, 0, 0)`，透明 PNG 直接透出当前列表或详情面板；缺图时才使用中性面板占位，不再使用绿色底。
- 选中图标：朋友圈轨道图标和“全部动态”图标的计算颜色均为 `rgb(7, 193, 96)`，计算背景为透明，绿色方块已移除。
- 版本证据：前台可见文本不再包含 `PluginLinks 2.2.1`；版本仍由 `templates/modules/links-app/list.html` 的 `plugin-contract` 注释和 `docs/插件适配契约.md` 维护。
- Framework boundary: 延续项目现有 Thymeleaf、Alpine、Iconify 与原生 CSS，没有新增或引用 UI 框架。

## Verification

- [x] `pnpm run verify:links`
- [x] `pnpm run build-only`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 暗色真页计算样式与合并对照图复核

final result: passed

---

# PluginLinks 微信式链接应用初版设计 QA

## 对照目标

- Source visual truth: `/Users/sky/.codex/generated_images/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/exec-81e45e0b-9849-4fbb-9dba-251d69034510.png`
- Browser-rendered implementation: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/links-wechat-initial/05-source-profile-dark.png`
- Route: `http://localhost:8090/links?view=friends&linkName=link-QDUTJ`
- Viewport: `1120 × 832`
- State: 暗色、朋友圈、单一 RSS 来源、来源资料头与动态列表展开
- 对照说明：参考图按中心裁切归一到 `1120 × 832`；实现使用 PluginLinks 2.2.1 的真实来源与动态，不补造点赞、评论、图片或不存在的 RSS 字段。

## 对照证据

- Same-viewport reference: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/links-wechat-initial/06-reference-1120x832.png`
- Side-by-side comparison: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/links-wechat-initial/07-reference-vs-implementation.png`
- Compact default state: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/links-wechat-initial/01-compact-dark.png`
- All-feed state: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/links-wechat-initial/03-feed-dark.png`

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and density: 使用系统字体、紧凑 `68px` 会话行、14px 主标题和克制的 10–13px 元数据；长标题与真实简介均截断，不改变左栏几何。
- Layout: 默认窗口固定为 `60px + 440px` 紧凑列表；点击链接、RSS 来源、添加或留言后只向右展开，左侧栏与列表不重建。参考图左栏比例更窄，但这里保留用户确认的 `500px` 默认窗口约束。
- Colors: links app 固定使用 `#07C160 / #95EC69 / #DFF7E8`，暗亮切换实测只替换中性表面；微信绿在两种模式下都保持 `#07C160`，不读取主题或系统强调色。
- Assets: 头像和站点 Logo 全部来自 PluginLinks 或站点真实资源；缺图使用项目现有 Lucide/Iconify 图标，没有 CSS 图形、内联 SVG、emoji 或占位图片。
- Content hierarchy: 单来源详情补齐来源头像、名称、简介、域名和访问入口，再展示动态；全部动态不伪造来源资料头。公开 RSS 缺少的点赞、评论与图片字段不在 UI 中伪造。
- Interaction and accessibility: 默认列表、链接详情、全部动态、单来源、添加助手、留言板、收起详情、刷新、前进/后退与暗亮切换均可操作；键盘焦点使用 3px 左侧绿线，避免鼠标点击产生过重整圈描边。
- Framework boundary: 只使用项目现有 Thymeleaf、Alpine、Tailwind/Iconify 管线与原生 CSS/控件，没有引入 daisyUI 或其他 UI 框架。

## Primary interactions tested

- `/links` 默认保持 500px 紧凑列表，不提前请求 RSS 正文。
- 点击友链展开资料详情；收起后恢复列表宽度。
- `/links?view=friends` 显示公开来源且插件描述 HTML 只以纯文本展示。
- “全部动态”与单一来源使用真实 PluginLinks 2.2.1 RSS 数据、刷新与继续加载。
- `/links?view=apply` 展示权限感知的内嵌提交助手；`/links?view=board` 展示留言兜底。
- 浏览器后退从留言板恢复添加助手，前进重新恢复留言板。
- 暗色 `#1F1F1F` 与亮色 `#F5F7F5` 表面切换时，主绿色保持 `#07C160`。
- Playwright 中 `links` 与 `links-interactions` 的 page error、console error、request failure 均为 0。

## Comparison history

- Pass 1: 真页基线确认默认紧凑列表和按需展开成立，但发现插件来源描述中的 HTML 标签会短暂以源码显示。
- Fix 1: 来源描述在运行时统一转成纯文本并回写列表节点，复测不再出现 `<br>`、`<strong>` 等标记。
- Pass 2: 详情截图发现鼠标点击后的选中行仍继承整圈焦点描边，视觉重量高于微信列表。
- Fix 2: 提高链接行焦点覆盖规则的特异性，只保留左侧 3px 微信绿焦点线。
- Pass 3: 同视口对照发现单来源详情缺少参考图中的来源资料层级。
- Fix 3: 增加真实来源头像、名称、简介、域名与访问入口；全部动态仍保持纯时间流。
- Pass 4: 同视口并排复核后无剩余 P0/P1/P2；真实数据差异、500px 默认左栏宽度和不伪造社交字段属于明确产品约束。

## Implementation checklist

- [x] 500px 默认会话列表和按需展开详情
- [x] 微信固定绿与独立暗亮中性色
- [x] 链接、RSS 来源、添加助手和留言板完整路由状态
- [x] 单来源资料头与真实 RSS 时间流
- [x] 移动端列表到全屏详情规则
- [x] 无新增 UI 框架，daisyUI 零引用
- [x] 构建、Halo Reload、静态契约、全站 Playwright 与同视口设计 QA

final result: passed

---

# 图库胶片坞显隐与切图层级设计 QA

## 对照目标

- Source visual truth: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/01-before-visible.png`
- Browser-rendered implementation: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/03-after-visible.png`
- Route: `http://localhost:8090/photos/photo-gtulnjy1?group=photo-group-8ruj7awi`
- Viewport: `1280 × 720`
- State: 图库详情、星空相簿、第 3/17 张、胶片坞显示
- 对照说明：本轮只优化显隐的时间曲线与合成层，不改变胶片坞的静态布局、材质、内容或路由行为。

## 对照证据

- Full-view comparison: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/06-same-viewport-comparison.png`
- Hidden-state implementation: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/04-after-hidden.png`
- Mid-exit implementation (`180ms`): `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/07-gradual-exit-midpoint.png`
- Mid-maximize implementation (`180ms`): `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/08-maximize-no-occlusion-midpoint.png`
- Large-photo transition midpoint (`129ms`): `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/09-large-photo-transition-filmstrip-above.png`
- List-to-detail transition midpoint (`195ms`): `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/gallery-motion-polish/10-list-to-detail-filmstrip-above.png`
- Focused region comparison was not required: the component's pixels, typography and geometry intentionally remain unchanged; temporal fidelity was instead checked from actual `requestAnimationFrame` samples across opacity、translateY、scale、visibility、主舞台和主图矩形。

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: 标题、计数、侧栏和胶片缩略图没有改动；同视口对照未出现字重、换行、截断或抗锯齿漂移。
- Spacing and layout rhythm: 胶片坞位置、宽度、圆角、缩略图间距和主图比例保持一致；逐帧样本中主舞台与主图的 `top/left/width/height` 漂移均未超过 `0.75px`。
- Colors and visual tokens: 半透明背景、边框、阴影和选中态完全复用原有 Photos token；没有动画 blur、filter、阴影或尺寸，避免玻璃材质重绘掉帧。
- Image quality and assets: 主照片及缩略图沿用同一真实资源、裁切和解码路径；没有新增、替换或降级任何可见资源。
- Copy and content: 文件名、`3 / 17` 计数、相簿名称、导航和辅助文本均未变化。
- Motion and accessibility: 显示采用 `220ms` 柔和透明度与 `340ms` 弹性位移；隐藏改用 `360ms` 渐进透明度与 `400ms` 渐进位移，两者均使用对称 `cubic-bezier(0.33, 0, 0.67, 1)`。真页退场 `180ms` 时透明度为 `0.501`、下沉约 `2.55px`、缩放约 `0.9966` 且仍为 `visible`，`visibility` 延迟到 `400ms` 后切换；隐藏时继续同步 `inert/aria-hidden`，触屏常显，减少动态效果时无过渡。

## Primary interactions tested

- 约 3.2 秒空闲后自动隐藏，移动指针后重新显示。
- 显示与隐藏均产生至少 4 个不同的 opacity、translateY 和 scale 中间态，且方向连续单调。
- 胶片坞隐藏后最大化及还原图库窗口，全程保持 `opacity: 0`、`visibility: hidden`、`pointer-events: none`，不再遮挡主图底部；随后回到主图仍可正常唤醒。
- 大竖图与横图双向详情切换期间，主图从新快照首帧开始保持居中；胶片栏使用独立 `photos-detail-filmstrip` 过渡层，始终位于主图过渡层上方，中央缩略图不再被大图快照覆盖。
- 从列表中后段照片进入详情时，新胶片栏同样位于主图过渡层上方；当前缩略图在新快照前已居中，过渡完成后横向滚动位置不再二次跳动。
- 悬停和键盘聚焦保持显示；触屏设备空闲时保持常显。
- `prefers-reduced-motion`、详情 PJAX 切换、旧节点计时器与监听器清理。
- 真页运行时错误与 `console.error`: none in `verify:photos:view-transition`。

## Comparison history

- Pass 1: 基线实测发现退场使用 `140ms opacity + 200ms` 末段加速曲线，同时下沉 `9px`、缩放至 `0.985`；透明度先结束而位移继续，形成突然消失的 P2 动效问题。
- Fix 1: 显隐统一复用 Photos 的 soft/spring 曲线，延长渐隐、减小位移和缩放，并只为桌面自动隐藏场景预提升 `transform/opacity` 合成层。
- Pass 2: 用户真页复测仍感到消失生硬；逐帧复核发现旧 soft 曲线在 `50ms / 76ms / 128ms` 时透明度已降至约 `0.357 / 0.155 / 0.041`，虽然存在过渡，但视觉信息过早耗尽。
- Fix 2: 退场单独改用 `360ms / 400ms` 对称渐进曲线，并新增动画中段仍为 `visible`、透明度保持 `0.3–0.7` 的回归门禁。
- Pass 3: 同视口静态界面无漂移；真页 `180ms` 中间态透明度实测 `0.501`，逐帧、终态、辅助技术、触屏、减少动态效果和 PJAX 生命周期全部通过。
- Pass 4: 用户截图与真页时间轴确认，标题栏最大化按钮被整个窗口级活动监听器误判为照片区操作，点击后 `80ms` 胶片坞透明度已达 `0.91`，`1000ms` 仍完全显示并覆盖主图底部。
- Fix 3: 胶片坞活动范围收窄到 `.photos-detail-main`；最大化/还原意图会在窗口 300ms 尺寸过渡期间锁定隐藏态并暂时关闭胶片坞自身 transition，避免任何遮挡帧。
- Pass 5: 真页最大化时间轴在 `0 / 80 / 180 / 320 / 1000ms` 均保持隐藏、透明度 `0`、不可命中；还原后同样保持隐藏，主图唤醒回归继续通过。
- Pass 6: 用户局部截图和真页逐帧确认，大图详情切换的新 DOM 在 Alpine 接管前缺少居中 transform；同时 `photos-active-photo` 快照位于 View Transition 顶层，约 300ms 内会盖住普通层胶片栏中央缩略图。
- Fix 4: 主图增加 `translate(-50%, -50%) scale(1)` 静态兜底；详情切换时胶片栏加入独立命名过渡层并使用 `z-index: 2`，主图过渡层固定为 `z-index: 1`，旧胶片快照立即退出、新快照保持不混色常显。
- Pass 7: `photo-nbgx3edf ↔ photo-lglk3ors` 双向真页复测通过；正向 `129ms` 中段截图中胶片栏中央缩略图完整，反向 `11–279ms` 活动帧层级、透明度和矩形均稳定，约 `305ms` 完成，主图中心始终与 figure 中心一致。
- Pass 8: 用户继续指出 `/photos` 列表进入详情仍有同类遮挡；复现确认该路径使用 `list-to-detail`，此前胶片命名层只覆盖 `detail-step`，因此新胶片栏仍位于主图顶层快照下方。
- Fix 5: 胶片命名层显式覆盖 `detail-step` 与 `list-to-detail` 两类共享过渡；PJAX 在生成目标快照前同步居中 `.is-current` 缩略图，避免列表中后段照片进入详情后再由 Alpine 二次滚动。
- Pass 9: 列表下滚后点击第 15 张 `2EB6AAD4.jpg` 真页复测通过；`195ms` 中段截图中主图与胶片栏虽有 `22px` 几何重叠，但缩略图和选中边框完整位于上层；手工逐帧采样中 `scrollLeft` 从首个活动帧到结束始终为 `255`，无收尾跳变。自动化专项同时锁定两类过渡的新快照居中、命名层唯一性与清理、`z-index 1/2`、中后段当前项可见及结束前后滚动偏差不超过 `1px`。

## Implementation checklist

- [x] Spring entry and symmetric gradual exit motion language
- [x] Subtle translate and scale range
- [x] Compositor hints without filter animation
- [x] Frame-by-frame motion and geometry assertions
- [x] Maximize and restore occlusion regression
- [x] Large-photo first-frame centering and filmstrip stacking regression
- [x] List-to-detail filmstrip stacking and scroll-position regression
- [x] Halo reload and live Photos regression

final result: passed

---

# 历史记录：分类 Finder 设计 QA

## 对照目标

- Source visual truth: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/category-finder-audit/02-archives.png`
- Browser-rendered implementation: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/category-finder-implementation/root-1280x720.png`
- Route: `http://localhost:8090/categories`
- Viewport: `1280 × 720`
- State: 浅色主题、全部分类、全部文档第 1 页、第一篇文档默认选中并展示预览
- 对照说明：归档页是视觉语言和 Finder 交互基准，不是分类页的一比一信息架构稿；分类页按业务约束采用“分类 / 文档 / 预览”三栏。

## 对照证据

- Full-view comparison: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/category-finder-implementation/full-comparison.png`
- Focused Finder comparison: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/category-finder-implementation/finder-content-comparison.png`
- Tablet evidence: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/category-finder-implementation/root-700x900.png`
- Mobile evidence: `/Users/sky/.codex/visualizations/2026/07/19/019f78b0-cdc9-7b81-9e9a-f1795cde72f6/category-finder-implementation/root-390x844.png`
- Focused evidence was required because the full-view text and divider details were too small to judge reliably. The focused comparison uses the same Finder content crop from both 1280 × 720 captures.

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: small toolbar labels, row titles, metadata hierarchy, weights, truncation and line density follow the archive Finder baseline; long real article titles remain readable without changing column geometry.
- Spacing and layout rhythm: the implementation preserves the same 1086px Finder frame, 40px pane headers, quiet dividers, list-row rhythm and preview spacing. The intentional three-column split is `220 / 526 / 340px` at the reference viewport.
- Colors and visual tokens: sidebar tint, selected-row fill, muted metadata, borders and preview surfaces reuse the existing Finder tokens and match the archive visual balance in light mode.
- Image quality and assets: this screen has no photographic or illustrative target assets. Folder/file icons use the project's existing Lucide icon pipeline; no placeholder imagery, emoji, CSS drawings or custom SVG substitutes were introduced.
- Copy and content: “分类 / 文档 / 预览”“全部分类”“全部文档” and pagination labels describe the actual behavior. The preview path identifies the active scope and publication date.
- States and accessibility: one category tree is exposed; the active category and page use `aria-current`; all navigation uses real same-origin links; default preview, disabled pagination, focus styles and reduced-motion rules are present. Mobile category, document and pagination targets are at least 44px high.
- Responsive behavior: 1280px shows three panes, 700px shows two panes with preview hidden, and 390px uses a horizontally scrollable category strip above the document list. No tested viewport has horizontal page overflow.

## Primary interactions tested

- Default first-document preview and preview URL synchronization.
- Category selection and return to “全部分类” through PJAX.
- Root pagination at `/categories?page=2`, including previous/next, direct access and browser back/forward.
- Category pagination at `/categories/{slug}/page/2`, including direct access and browser back/forward.
- Root and category overflow recovery at page `999999`.
- 1280 × 720, 700 × 900 and 390 × 844 responsive layouts.
- Browser console warnings/errors: none in the final in-app browser capture.
- Automated page errors and `console.error`: none in `verify:categories:live`.

## Comparison history

- Pass 1: final browser render and archive visual baseline were combined at the same viewport and compared at full-view and focused-region levels. No P0/P1/P2 mismatch was found, so no visual fix-and-recapture loop was required.

## Implementation checklist

- [x] Unified root/detail Finder structure
- [x] One category tree and one “全部分类” entry
- [x] All-document query pagination and category native pagination
- [x] Default preview and real document links
- [x] Desktop, tablet and mobile breakpoint coverage
- [x] Static contracts, full check, Halo reload and live browser validation

final result: passed
