# 图库胶片坞显隐动效设计 QA

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
- Focused region comparison was not required: the component's pixels, typography and geometry intentionally remain unchanged; temporal fidelity was instead checked from actual `requestAnimationFrame` samples across opacity、translateY、scale、visibility、主舞台和主图矩形。

## Findings

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: 标题、计数、侧栏和胶片缩略图没有改动；同视口对照未出现字重、换行、截断或抗锯齿漂移。
- Spacing and layout rhythm: 胶片坞位置、宽度、圆角、缩略图间距和主图比例保持一致；逐帧样本中主舞台与主图的 `top/left/width/height` 漂移均未超过 `0.75px`。
- Colors and visual tokens: 半透明背景、边框、阴影和选中态完全复用原有 Photos token；没有动画 blur、filter、阴影或尺寸，避免玻璃材质重绘掉帧。
- Image quality and assets: 主照片及缩略图沿用同一真实资源、裁切和解码路径；没有新增、替换或降级任何可见资源。
- Copy and content: 文件名、`3 / 17` 计数、相簿名称、导航和辅助文本均未变化。
- Motion and accessibility: 显示采用 `220ms` 柔和透明度与 `340ms` 弹性位移；隐藏采用 `220ms` 柔和透明度与 `280ms` 弹性位移，位移由 `9px` 收到 `6px`、缩放由 `0.985` 收到 `0.992`。`visibility` 延迟到退场结束，隐藏时继续同步 `inert/aria-hidden`；触屏常显，减少动态效果时无过渡。

## Primary interactions tested

- 约 3.2 秒空闲后自动隐藏，移动指针后重新显示。
- 显示与隐藏均产生至少 4 个不同的 opacity、translateY 和 scale 中间态，且方向连续单调。
- 悬停和键盘聚焦保持显示；触屏设备空闲时保持常显。
- `prefers-reduced-motion`、详情 PJAX 切换、旧节点计时器与监听器清理。
- 真页运行时错误与 `console.error`: none in `verify:photos:view-transition`。

## Comparison history

- Pass 1: 基线实测发现退场使用 `140ms opacity + 200ms` 末段加速曲线，同时下沉 `9px`、缩放至 `0.985`；透明度先结束而位移继续，形成突然消失的 P2 动效问题。
- Fix: 显隐统一复用 Photos 的 soft/spring 曲线，延长渐隐、减小位移和缩放，并只为桌面自动隐藏场景预提升 `transform/opacity` 合成层。
- Pass 2: 同视口全景对照确认静态界面无漂移；真页逐帧采样、终态、辅助技术、触屏、减少动态效果和 PJAX 生命周期全部通过。

## Implementation checklist

- [x] Unified soft/spring motion language
- [x] Subtle translate and scale range
- [x] Compositor hints without filter animation
- [x] Frame-by-frame motion and geometry assertions
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
