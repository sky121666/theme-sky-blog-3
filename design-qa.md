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
