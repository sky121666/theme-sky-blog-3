# 通知中心数据完整性、操作语义与响应式细节 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-beeb37d9-306c-453c-903e-9b0a6d918e36.png`
- Before implementation: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/01-before-desktop-dark.png`
- Final desktop dark collapsed: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/02-after-desktop-dark-collapsed.png`
- Final desktop dark expanded: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/03-after-desktop-dark-expanded.png`
- Final desktop light: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/05-after-desktop-light-collapsed.png`
- Final mobile light: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/07-after-mobile-390-light-expanded.png`
- Final mobile dark: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/08-after-mobile-390-dark-collapsed.png`
- Final 320px single-column layout: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/10-after-mobile-320-dark-single-column.png`
- Source/final material comparison: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/11-reference-vs-after.png`
- Same-viewport before/final comparison: `/private/tmp/theme-sky-blog-3-notification-fix-20260723/12-before-vs-after-same-viewport.png`
- Route: `http://localhost:8090/?_qa=notification-details-final`
- State: 登录通知可见；分别复核未读/全部、折叠/展开、继续加载、组菜单、关闭/重开、亮色/暗色以及 `390px`、`320px`。
- Viewports: 桌面 CSS `1250 × 1169px`；移动端 CSS `390 × 844px` 与 `320 × 740px`。修复前后同视口裁图均来自桌面右侧 `420 × 520px` 区域。

## Findings

- No actionable P0/P1/P2 findings remain in the notification data, interaction semantics, focus, motion and responsive scope.
- Data completeness: Halo 通知列表不再永久固定在第一页。真页首批加载 `50 / 52`，点击后补齐到 `52 / 52` 并隐藏入口；未读总数通过独立的小页统计请求获取，不再用当前页样本冒充全量。
- Long-list control: 通知组展开默认只显示 10 条，当前账号组真页显示「继续显示 20 条」；每次再增量显示 10 条，避免 30 张卡一次占满通知中心并把小组件推到不可预期的位置。
- Operation semantics: 单条未读操作明确为「标为已读」，已读操作明确为「删除此通知」；组头只保留折叠和省略号操作，组内「清除已读通知」增加二次确认，不再用同一个 `x` 同时表达已读、删除和整组清理。
- Accessibility: 对话框补齐 `aria-modal`、Tab 焦点约束和关闭后回焦；真页关闭后焦点回到「打开通知中心」，重新打开后焦点进入关闭按钮。通知卡主链接与操作按钮改为兄弟节点，不再形成嵌套交互控件。
- Open state: 通知中心每次重新打开都会收起通知组、关闭组菜单并回到 `scrollTop: 0`；异步通知返回期间关闭滚动锚定，避免打开后被后加载内容带离顶部。
- Time and readability: 七天后的通知继续显示月日，跨年通知补全年份；真实 `<time>` 同时保留机器可读时间和完整日期提示。已读通知只通过轻微字重/文本对比降低辨识，不增加装饰线或彩色底。
- Light/dark material: 保留用户确认的中性图标壳与低饱和语义色，面板仍由带遮罩的柔和虚化承担边界；亮暗色均没有重新引入贯穿页面的硬直线。面板空气层从 `28px` 收敛到 `32px` 柔化，透明度只做小幅提升。
- Responsive: `390px` 下通知内容无横向溢出，展开态卡片间距稳定；`320px` 下通知栏小组件改为单列，实测 `bodyScrollWidth: 320px`、内容区 `236.8px`，站点统计不再被双列压缩成碎片。
- Motion: 打开/关闭只对前 10 个主要内容节点做分层动画，其余内容随面板整体过渡；最终自动化动效审计为 `10/10`，8 个场景均无超阈值 findings。审计同时修正了游客态误跑和页面常驻动画被计入通知动画的基线误差。
- Safety: 真页只执行读取、分页、筛选、展开/收起和焦点检查，没有删除或标记真实通知；PUT/DELETE 分流由隔离的动效审计路由验证。

## Comparison history

- Pass 1: 真页确认总数为 52、DOM 只加载 50；账号组一次展开 30 张未读卡，重开仍保留展开状态；组头「更少内容 + x」和单卡 `x` 的语义不明确，卡片链接内部还嵌套按钮。
- Fix 1: 增加通知分页、全量未读统计、组内 10 条增量显示、重开状态复位、焦点恢复与有效对话框语义；拆分主链接和操作按钮。
- Pass 2: 桌面明暗色、`390px`、`320px` 真页确认分页、折叠、组菜单和回焦有效；发现 `320px` 下双列小组件被压缩。
- Fix 2: `350px` 以下切换为单列小组件；优化触控按钮、安全区、通知/小组件节奏与面板空气层。
- Pass 3: 同视口修复前后与用户参考图均已放入合并输入复核；最终 `320px` 无横向溢出，Reload、Playwright smoke、完整 check 与通知动效审计全部通过。

## Verification

- [x] `node scripts/verify-desktop-state-and-url-safety.mjs`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] `pnpm run audit:notification-motion`：`10/10`，0 findings
- [x] 真页 `50 → 52` 分页、默认 10 条展开、折叠/重开/回焦、组菜单
- [x] 桌面亮色/暗色、`390 × 844px`、`320 × 740px` 与横向溢出检查

final result: passed

---

# 通知中心背景边界柔化 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-69cb0ea8-ec60-49ca-8c70-68e7a5b80f0e.png`
- Before implementation: `/private/tmp/theme-sky-blog-3-notification-edge-20260723/01-before.png`
- Final desktop light implementation: `/private/tmp/theme-sky-blog-3-notification-edge-20260723/06-final-desktop-light.png`
- Final desktop dark implementation: `/private/tmp/theme-sky-blog-3-notification-edge-20260723/07-final-desktop-dark.png`
- Final narrow implementation: `/private/tmp/theme-sky-blog-3-notification-edge-20260723/05-final-narrow.png`
- Focused final implementation: `/private/tmp/theme-sky-blog-3-notification-edge-20260723/08-final-edge-crop.png`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-edge-20260723/09-source-vs-final.png`
- Route: `http://localhost:8090/?_qa=notification-boundary-edge-final`
- State: 通知中心打开；分别复核亮色、暗色和 `390px` 窄屏。
- Viewports and normalization: 桌面真页为 CSS `1280 × 720px`、窄屏为 CSS `390 × 844px`，`devicePixelRatio: 1`。用户问题图为 `317 × 596px`；最终暗色真页按通知面板左边界等高裁出 `318 × 596px`，横向合并为 `635 × 596px`，专门比较桌面与通知中心之间的竖向过渡。

## Findings

- No actionable P0/P1/P2 findings remain in the notification-center background edge scope.
- Root cause: 通知中心根容器原来对完整 `516px` 宽矩形应用 `blur(10px) saturate(108%)`，该滤镜没有遮罩，因此在面板左侧 `x=764px` 形成贯穿页面的硬直线；已有 `::before` 渐变蒙层虽然带遮罩，但无法覆盖根容器自身的滤镜边界。
- Colors and visual tokens: 根容器现在保持透明且不再承担背景滤镜；明暗色原有面板空气色、卡片材质、语义色与阴影完全保留，虚化只由既有 `28px` 渐变蒙层提供。
- Spacing and layout rhythm: 没有修改通知卡、标题、控件、小组件或面板内容的宽高、间距和定位；桌面面板仍为 `516px`，内容区与 `120px` 过渡带尺寸不变。
- Responsive: 窄屏原有遮罩停靠点会出现 `60px > 42.9px` 的逆序计算；现调整为 `10 / 20 / 28 / 42.9px` 单调递进，`390 × 844px` 下抽屉仍为 `x=8px / 382px`，左缘没有硬带或横向溢出。
- Fonts and typography: 没有修改字体、字号、字重、行高和截断规则。
- Image quality and assets: 没有新增或替换图像、图标与小组件资源；背景虚化仍作用于真实桌面内容，没有使用静态图片伪造。
- Copy and content: 没有改写任何通知或小组件文案。
- Accessibility and interaction: 通知中心打开、关闭、筛选和卡片行为均未修改；亮暗色通过真实关闭通知中心、切换外观、重新打开的路径复核，最终浏览器 `console.error` 为 `0`。

## Comparison history

- Pass 1: 来源问题图和修复前真页都能看到与 `.notification-center` 左边界完全对齐的竖线；计算样式确认根容器为 `backdrop-filter: blur(10px) saturate(1.08)`，而带渐变遮罩的 `::before` 为独立的 `blur(28px)`。
- Fix 1: 将根容器改为透明并移除矩形 `backdrop-filter`，让唯一的背景虚化来源回到带透明遮罩的 `::before`。
- Pass 2: 桌面明暗色真页中，根容器计算样式均为 `background: transparent / backdrop-filter: none`，来源与最终聚焦区域同屏后不再出现贯穿页面的直线。
- Fix 2: 将窄屏遮罩停靠点收敛为 `10 / 20 / 28px`，确保任何 `32–52px` 过渡带宽度下都按透明到不透明的顺序递进。
- Pass 3: `390 × 844px` 真页计算为 `0 / 10 / 20 / 28 / 42.9px`，桌面亮色、暗色及窄屏均无新的 P0/P1/P2。

## Verification

- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 桌面亮色/暗色、`1280 × 720px`、`390 × 844px`
- [x] 根容器与伪元素计算样式、遮罩停靠顺序、来源/最终同屏比较及 `console.error: 0`

final result: passed

---

# 通知中心折叠卡间距与内容收纳 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-ac1d0209-1713-48dc-b575-685ceaf23ccf.png`
- Before implementation: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/01-before-all.png`
- Final implementation: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/02-after-all.png`
- Final expanded implementation: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/03-after-expanded.png`
- Final dark implementation: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/04-after-dark-all.png`
- Final narrow implementation: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/05-after-narrow.png`
- Focused implementation: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/06-after-focused.png`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-spacing-20260723/07-source-after-comparison.png`
- Route: `http://localhost:8090/?_qa=notification-spacing-round`
- State: 登录数据可见、「全部」筛选、四组通知折叠；另行复核「未读」、瞬间互动展开/收起、明暗色和窄屏。
- Viewports and normalization: 真页全图为 CSS `1280 × 720px`、`devicePixelRatio: 1`；窄屏为 CSS `390 × 844px`。用户问题图为 `424 × 380px`，最终实现从同一右上区域裁出 `420 × 380px`，并与来源等高横向合并为 `844 × 380px`，聚焦比较卡片内容收纳、叠层尾部和相邻组节奏。

## Findings

- No actionable P0/P1/P2 findings remain in the collapsed notification-card spacing and content-containment scope.
- Root cause: 折叠卡片固定为 `64px`，但允许两行摘要后卡片 `scrollHeight` 达到 `72px`，两行内容底部几乎贴住卡片边缘；「全部」状态又把包装高度压到 `68px`，最底层叠卡与下一张主卡之间只剩约 `0.3px`，共同造成视觉挤压。
- Spacing and layout rhythm: 折叠卡摘要改为单行省略，四张可见卡片现在均为 `clientHeight: 64px / scrollHeight: 64px`；「全部」状态包装高度恢复到 `72px`，主卡之间为 `12px`，最底层叠卡与下一张主卡之间保留约 `4.3px` 的可见空气。
- Expanded state: 展开态不继承单行限制，真实两行摘要保持 `white-space: normal`；两张样本卡高度约 `79.6px`，卡间距 `7px`，内容完整且无覆盖。收起后恢复四组折叠列表。
- Responsive: `390 × 844px` 下四组顶部位置依次为 `64.84 / 140.84 / 216.84 / 292.84px`，节奏稳定；通知面板宽 `382px`、左右边距 `8px`，页面横向溢出为 `0px`。
- Fonts and typography: 保留原有字体、标题字号、正文层级和截断样式；只把折叠预览的摘要从两行改为单行省略，展开态仍提供更多上下文。
- Colors and visual tokens: 未修改明暗材质、语义色、阴影和图标壳。明色与暗色真页中卡片高度和间距计算一致。
- Image quality and assets: 没有新增、替换或压缩任何头像、图标和小组件图像；现有真实图标资源保持不变。
- Copy and content: 没有改写通知标题或正文；折叠态只改变可见截断，展开后仍能读取原摘要。
- Accessibility and interaction: 卡片按钮/链接语义、键盘入口、筛选与展开/收起行为均保留；本轮真页 `console.error` 为 `0`。截图不能单独证明完整辅助技术兼容，本轮仅确认现有语义未被间距修复改变。

## Comparison history

- Pass 1: 来源和修复前真页都显示中间通知的两行摘要贴近底边，叠卡尾部几乎触碰下一张主卡；实测长摘要卡 `scrollHeight: 72px` 大于固定 `64px`，叠卡尾部间距约 `0.3px`，记录为 P2 内容收纳与垂直节奏问题。
- Fix 1: 折叠态摘要改为单行省略；「全部」状态叠卡包装高度由 `68px` 调整为 `72px`。展开态规则保持不变。
- Pass 2: 来源与最终聚焦区域已放入同一视觉输入。最终四张卡均为 `scrollHeight: 64px`，叠层尾部间距约 `4.3px`；明暗色、展开/收起与 `390px` 窄屏无新的 P0/P1/P2。

## Verification

- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 「全部 / 未读」、四组折叠、瞬间互动展开/收起
- [x] 明色/暗色、`1280 × 720px`、`390 × 844px`
- [x] 卡片 `clientHeight / scrollHeight`、叠层尾部距离、横向溢出与 `console.error: 0`

final result: passed

---

# 通知中心跳转、明暗材质与可逆开关动效 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-beeb37d9-306c-453c-903e-9b0a6d918e36.png`
- Before light implementation: `/private/tmp/theme-sky-blog-3-notification-audit-20260723/01-before-light-open.png`
- Before dark implementation: `/private/tmp/theme-sky-blog-3-notification-audit-20260723/02-before-dark-open.png`
- Final light implementation: `/private/tmp/theme-sky-blog-3-notification-audit-20260723/03-after-light-open.jpg`
- Final dark implementation: `/private/tmp/theme-sky-blog-3-notification-audit-20260723/04-after-dark-open.jpg`
- Final narrow implementation: `/private/tmp/theme-sky-blog-3-notification-audit-20260723/06-after-narrow.jpg`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-audit-20260723/07-reference-vs-implementation.jpg`
- Route: `http://localhost:8090/?_qa=notification-navigation-theme-motion`
- State: 登录态；明色与暗色分别复核账号通知展开；「全部」状态复核真实通知跳转；另行复核无目标通知、关闭后重开、关闭途中反向打开及减少动态效果。
- Viewports: 桌面 CSS `1250 × 1169px`、窄屏 CSS `390 × 844px`，`devicePixelRatio: 1`。来源是 `884 × 1778px` 的概念级近景，合并比较时等高缩放；只比较材质、图标壳、语义色、层级与动效方向，不把来源的放大比例套到真实通知密度。

## Findings

- No actionable P0/P1/P2 findings remain in the notification navigation, light/dark material and reversible center motion scope.
- Navigation semantics: 只有存在真实 `targetUrl` 的通知卡才暴露 `link` 角色、键盘焦点及点击行为；无目标的账号通知保持 `article` 且点击不关闭、不跳转。真页已点击瞬间通知进入本地 `/moments/moment-9roi1c7n`，并用浏览器后退/前进复核历史记录。
- URL routing: 主题站点配置中的绝对同站链接会重定位到当前 Halo 主机，避免本地验证被带到 `www.5ee.net`；主题内容路由继续使用 PJAX，`/console` 等管理路径改为整页跳转。真页系统通知已进入 `http://localhost:8090/console/backup?tab=synchronization`。
- Light/dark material: 明色卡片使用 `rgba(244, 247, 252, 0.76)` 的浅玻璃、深色正文与柔和中性阴影；暗色卡片使用 `rgba(24, 25, 28, 0.60)` 的石墨玻璃、浅色正文与低亮阴影。图标壳随明暗材质切换，类型色仍是固定、低饱和的语义色，不继承主题强调色。
- Open/close motion: 通知中心由单段显隐改为面板、背景和内容的分层过渡；打开使用较长减速，关闭使用更短收束。关闭途中在 `90ms` 反向打开可从当前视觉状态连续接管，不再被 `notificationCenterVisible` 阻断。
- Motion root cause: Web Animations 的关闭动画使用 `fill: forwards`，完成后仍覆盖新的内联打开状态，造成下一次打开短暂保持 `opacity: 0` 与关闭位移。关闭完成时现在显式固化最终样式并取消已结束动画，真页重开后计算样式为 `opacity: 1`、`transform: none`，无遗留动画。
- Reduced motion and responsive: `prefers-reduced-motion: reduce` 下打开/关闭即时完成且无动画实例；`390 × 844px` 下抽屉 `x=8px`、宽 `382px`，无横向溢出。
- Visual comparison: 来源近景与最终暗色真页已放入同一视觉输入。两者都采用中性深色图标壳、单一语义色图形、低边界对比和透明黑玻璃；真页保留了真实 `344px` 级紧凑信息密度，没有机械复制概念图的夸张放大比例。
- Runtime evidence: 当前真页 `console.error` 为 `0`。

## Comparison history

- Pass 1: 明暗状态沿用近似相同的深色卡片；无目标通知仍表现为链接；配置域名绝对地址会离开当前 Halo；控制台路径被当作 PJAX；快速关闭后重开会发生状态竞争。
- Fix 1: 补齐通知卡语义、同站 URL 归一化与主题路由/管理路由分流；建立明色与暗色独立材质；将通知中心改为可从当前视觉状态反向接管的分层动画。
- Pass 2: 真页正常关闭后重开仍出现透明状态，定位为关闭动画的 `fill: forwards` 持续覆盖新状态。
- Fix 2: 关闭完成时写入最终样式并取消已完成动画，消除 Web Animations 样式泄漏。
- Pass 3: 真页正常开关、`90ms` 反向开关、真实 PJAX 跳转、控制台整页跳转、无目标通知、后退/前进、明暗切换、减少动态效果与窄屏均通过。

## Verification

- [x] `node scripts/verify-desktop-state-and-url-safety.mjs`
- [x] `node --check src/shell/desktop-shell/runtime/desktop/notification-center-motion.js`
- [x] `node --check src/shell/desktop-shell/runtime/desktop/window-manager.js`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 真页真实目标跳转、无目标通知、浏览器后退/前进、正常开关与 `90ms` 反向开关
- [x] 明色/暗色计算样式、`390 × 844px` 窄屏、减少动态效果与 `console.error: 0`

final result: passed

---

# 通知中心第五阶段语义色图形与柔和玻璃 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-beeb37d9-306c-453c-903e-9b0a6d918e36.png`
- Browser-rendered implementation: `/private/tmp/theme-sky-blog-3-notification-semantic-glyph/01-implementation-desktop.jpg`
- Focused implementation: `/private/tmp/theme-sky-blog-3-notification-semantic-glyph/02-implementation-focus.jpg`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-semantic-glyph/03-source-implementation-comparison.jpg`
- Route: `http://localhost:8090/?_qa=notification-semantic-glyph-final`
- State: 登录态、「全部」筛选、账号/瞬间互动/评论回复/系统通知四组折叠；另行复核账号组展开与收起。
- Viewport: 实现为 CSS `1280 × 720px`、`devicePixelRatio: 1`。来源为 `884 × 1778px` 聚焦图；比较时裁去顶部空白为 `884 × 1640px`，等比缩放至约 `226 × 420px`，实现聚焦区域为 `400 × 420px`。两者只比较通知卡材质、图标底座、语义色分配和列表节奏，不对不同真实数据文本逐像素判定。

## Findings

- No actionable P0/P1/P2 findings remain in the selected semantic-glyph and soft-glass scope.
- Colors and visual tokens: 图标底座统一为 `rgba(31, 32, 35, 0.72)` 的中性石墨色，类型色只作用于真实 Lucide 图形。账号为 `#88abf4`、瞬间互动为 `#67d38a`、评论回复为 `#a779ee`、内容与系统通知为 `#eda04c`、插件通知为 `#62bcc5`，未知类型回退到银灰 `#a7adb6`；没有彩色底、彩色投影或主题强调色继承。
- Card material: 通知卡改为 `rgba(24, 25, 28, 0.58)` 的柔和局部玻璃，未读仅轻微增加到 `0.60`。卡片与叠层均取消硬描边、顶部亮线和内高光，边界由 `24px` 背景虚化及两层短而散的中性阴影形成；计算样式为 `border: 0`，`::after` 为 `none`。
- Icon material: 图标壳保留所选视觉中的 `30px` 中性深色方块与低对比半像素边界，移除双层高光、彩色渐变和染色阴影；类型辨识完全来自图形形状与单一语义色。
- Spacing and layout rhythm: 「全部」状态四张主卡可见间距实测均为 `8px`，与上一阶段确认的紧凑节奏一致；页面横向溢出为 `0px`。
- Interaction: 真页已执行「未读 → 全部」、账号组展开、收起；收起后恢复四组，展开动画结束后没有遗留 `opacity / transform / clip-path / overflow` 内联样式。
- Typography, images and copy: 没有改变通知字体、字重、截断、真实通知文本、桌面小组件或图像资源。来源图为概念级放大稿，实际真页继续遵循既有 `11 / 12 / 13px` 信息层级和真实数据密度。
- Runtime evidence: 当前浏览器日志 `console.error` 为 `0`；仍存在既有 `[desktop] repaired corrupt node placements Object` warning，与本轮通知视觉修改无关。

## Comparison history

- Pass 1: 上一阶段真页使用彩色图标底与顶部高光，类型色承担了大面积装饰；卡片还存在 `0.5px` 外框、顶部 `::after` 亮线和内高光，记录为 P2 语义色使用过量与玻璃材质硬边。
- Fix 1: 用户从三套方向中选定“中性图标底 + 彩色语义图形”；将类型色从图标底迁移到 Lucide 图形，统一中性底座；同时移除卡片和叠层硬边、顶线及内高光，恢复淡透明背景和软阴影。
- Pass 2: 来源与真页聚焦区域已放入同一视觉输入复核。四类语义色可快速识别，图标底保持一致，卡片边缘不再出现硬线；展开/收起、间距、横向溢出和日志均无新的 P0/P1/P2。

## Verification

- [x] `pnpm exec vite build`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 当前真页「未读 / 全部」、四种类型色、展开/收起、动画样式清理、横向溢出与浏览器日志

final result: passed

---

# 通知中心第四阶段固定类型色与「全部」间距 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-c1e3b0a3-5d8e-4643-822a-618bd93f4832.png`
- Before implementation: `/private/tmp/theme-sky-blog-3-notification-colors-spacing-round4/01-before-all.png`
- Final desktop implementation: `/private/tmp/theme-sky-blog-3-notification-colors-spacing-round4/02-after-all.png`
- Focused final implementation: `/private/tmp/theme-sky-blog-3-notification-colors-spacing-round4/03-after-all-focus.png`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-colors-spacing-round4/04-before-after-focus.png`
- Final mobile implementation: `/private/tmp/theme-sky-blog-3-notification-colors-spacing-round4/05-after-mobile-all.png`
- Route: `http://localhost:8090/?_qa=notification-colors-spacing-round4-after`
- State: 登录态、「全部」筛选、账号/瞬间互动/评论回复/系统通知四组折叠；另行复核账号组展开/收起。
- Viewports: 桌面 `1280 × 720px`、移动 `430 × 820px`。

## Findings

- No actionable P0/P1/P2 findings remain in the fixed notification-type color and collapsed-list spacing scope.
- Fixed semantic colors: 类型色改为通知中心内部的固定常量，不读取主题强调色。账号为蓝色、瞬间为绿色、评论为紫色、内容为橙色、系统为石墨灰、插件为青色；未知类型回退到石墨灰。真页四种已出现类型的计算渐变分别为蓝 `#5c9df5 → #2964c8`、绿 `#48c77a → #1c8a4c`、紫 `#9c7bdc → #6543aa`、灰 `#7b8796 → #464e59`。
- Root cause: `data-notification-type` 一直正确，但默认色变量原先定义在图标壳自身，覆盖了通知卡父级的类型变量，导致所有图标都显示为蓝色；默认值已上移到通知卡，类型选择器现在能正常继承。
- Icon material: 保留真实 Lucide 类型图标，将 `32px` 的强高光厚阴影壳收敛为 `30px`、`7.5px` 圆角的轻量渐变图标；移除顶部亮斑胶囊，仅保留半像素边界、短阴影和细内描边。
- All-filter spacing: 「全部」折叠列表单独采用 `4px` 组间距和 `68px` 包装高度，主卡之间的可见间距由 `15px` 降为 `8px`；未读筛选及展开列表继续使用原有节奏，避免全局压缩。
- Responsive and interaction: 桌面与 `430px` 窄屏均无横向溢出；账号组展开后只显示该组，收起后恢复四组及 `8px` 间距，动画结束没有残留 `opacity / transform / clip-path / overflow` 内联样式。

## Comparison history

- Pass 1: 真页确认四组 `data-notification-type` 正确，但四个图标的计算背景完全相同；「全部」主卡间距实测均为 `15px`。
- Fix 1: 将默认图标色 token 上移到通知卡，加入六类固定颜色；收敛图标高光和阴影；仅为「全部」折叠状态增加紧凑几何。
- Pass 2: 参考与实现同屏复核，四类真实通知颜色可清楚区分，主卡间距实测均为 `8px`；移动端、展开/收起和动画清理没有回归。

## Verification

- [x] `pnpm exec vite build`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 真实通知数据、四类计算色、桌面/移动无横向溢出、展开/收起与动画样式清理

final result: passed

---

# 通知中心第三阶段图标材质与分组动效 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-1e545883-1b19-4e4a-83d4-c7bea11f5b31.png`
- Rejected collapsed baseline: `/private/tmp/theme-sky-blog-3-notification-motion-round3/01-before-collapsed.png`
- Rejected expanded baseline: `/private/tmp/theme-sky-blog-3-notification-motion-round3/02-before-expanded.png`
- Final collapsed implementation: `/private/tmp/theme-sky-blog-3-notification-motion-round3/03-after-collapsed.png`
- Expand keyframes: `/private/tmp/theme-sky-blog-3-notification-motion-round3/04-expand-mid-a.png`、`/private/tmp/theme-sky-blog-3-notification-motion-round3/05-expand-mid-b.png`
- Final expanded implementation: `/private/tmp/theme-sky-blog-3-notification-motion-round3/06-after-expanded.png`
- Collapse keyframes: `/private/tmp/theme-sky-blog-3-notification-motion-round3/07-collapse-mid-a.png`、`/private/tmp/theme-sky-blog-3-notification-motion-round3/08-collapse-mid-b.png`
- Final mobile implementation: `/private/tmp/theme-sky-blog-3-notification-motion-round3/14-mobile-expanded.png`
- Focused icon detail: `/private/tmp/theme-sky-blog-3-notification-motion-round3/12-icon-detail.png`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-motion-round3/11-reference-after-comparison.png`
- Route: `http://localhost:8090/?_qa=notification-motion-round3-after`
- State: 登录态、账号通知折叠/展开、重复快速展开、减少动态效果分支；桌面 `1280 × 720px` 与移动 `430 × 820px`。

## Findings

- No actionable P0/P1/P2 findings remain in the icon material and notification-group transition scope.
- Icon material: 保留真实 Lucide 通知类型图形，不新增伪造图标；图标壳由单层纯色块改为分类型上下色阶、顶部局部高光、双层内描边、底部压暗和短距离染色阴影。账号、瞬间、评论、内容、系统和插件拥有独立语义色，透明抽屉上的边缘仍清楚。
- Motion continuity: 修复 `expandStack()` 与 `collapseExpandedGroup()` 原先直接返回空 Promise 的问题。展开现在依次执行“叠层收拢 → 第一张卡接续 → 列表遮罩向下释放 → 前 12 张可见卡片短错峰落位”；收起按相反方向合拢，再恢复两层卡片背板。
- Interaction rhythm: 进入使用 `cubic-bezier(0.16, 1, 0.3, 1)` 的 Apple 式减速曲线，退出使用 `cubic-bezier(0.32, 0, 0.67, 0)` 的短促加速曲线；展开主遮罩为 430ms，收起主遮罩为 250ms，收起后的叠层回弹为 280ms。
- Race safety: 分组切换新增独立 motion token；重复快速点击、筛选切换和关闭通知中心都会取消旧动画，避免旧 Promise 在新状态上继续写入。真页双击展开后稳定停在展开态，列表、卡片和叠层没有残留 `opacity / transform / clip-path / overflow` 内联样式。
- Responsive: `430 × 820px` 下通知卡宽约 `335px`，页面无横向溢出；展开后首屏可见 10 张真实账号通知，控制按钮、卡片和滚动区域没有遮挡。
- Reduced motion: 四个分组动画入口均在 `prefers-reduced-motion: reduce` 下直接完成状态切换且不访问动画 DOM，专项 Node 分支验证通过。

## Comparison history

- Pass 1: 当前源码和真页确认图标仅为单层蓝色圆角底；`expandStack()`、`collapseExpandedGroup()` 是空实现，DOM 先瞬间换态，再补 120–140ms 淡入，记录为 P2 图标材质不足和 P1 状态连续性缺失。
- Fix 1: 重做图标材质 token；补齐叠卡离场、列表遮罩展开、卡片错峰、反向收拢与叠层回弹；在窗口管理器加入分组动效 token 和筛选/关闭取消逻辑。
- Pass 2: 桌面、移动、展开中段、收起中段和最终状态同屏复核；快速重复展开能稳定收敛，减少动态效果分支不创建动画，无剩余 P0/P1/P2。

## Verification

- [x] `node --check src/shell/desktop-shell/runtime/desktop/notification-center-motion.js`
- [x] `node --check src/shell/desktop-shell/runtime/desktop/window-manager.js`
- [x] `pnpm exec vite build`
- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 真实通知数据、展开/收起关键帧、快速重复展开、动画样式清理、移动端无横向溢出
- [x] 减少动态效果四个分组动效入口专项验证

final result: passed

---

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

# 通知中心第二阶段 macOS 精细化设计 QA

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-1e545883-1b19-4e4a-83d4-c7bea11f5b31.png`
- Rejected baseline: `/private/tmp/theme-sky-blog-3-notification-macos-round2-audit/01-before-expanded.png`
- Final mobile implementation: `/private/tmp/theme-sky-blog-3-notification-macos-round2-audit/05-final-compact-expanded.png`
- Final desktop implementation: `/private/tmp/theme-sky-blog-3-notification-macos-round2-audit/07-final-desktop-expanded.png`
- Alternate widget appearance: `/private/tmp/theme-sky-blog-3-notification-macos-round2-audit/08-final-dark-expanded.png`
- Same-input comparison: `/private/tmp/theme-sky-blog-3-notification-macos-round2-audit/06-reference-before-after.png`
- Route: `http://localhost:8090/?_qa=notification-macos-round2-audit`
- State: 登录态、全部通知、账号通知展开；复核折叠预览、未读/全部筛选、关闭后重开、两种小组件外观。
- Viewports: 移动窄窗 `441 × 571px`；桌面 `1280 × 900px`。

## 对照结论

- Cards: 从偏灰、厚描边、宽泛投影的 `307px` 卡片，调整为 `344 × 66px` 的局部深色玻璃；采用 `18px` 圆角、半像素弱边、短距离阴影和顶部局部高光，不再出现塑料胶囊感。
- Information hierarchy: 账号通知不再重复显示两遍完整标题；正文压缩为 `浏览器 · 月/日 时间 · IP`，应用类型、时间、标题和详情形成四级但低噪声的信息层级。
- Background depth: 抽屉仍透明，小组件和桌面继续透出；内容区只增加轻量背景虚化与色彩收敛，没有恢复整块黑色面板。
- Responsive density: `441px` 窄窗下缩短左侧渐隐区，卡片恢复到与 macOS 参考一致的 `344px` 内容宽度；桌面端保持右对齐且无横向溢出。
- Theme surfaces: 深色通知卡不跟随小组件底色切换，两种外观下均保持稳定对比度，符合真实 macOS 通知卡在不同壁纸上的表现。

## Findings

- No actionable P0/P1/P2 visual findings remain in the agreed notification material, density, responsive and information-hierarchy scope.
- `pnpm run verify:notification-center` 的访客专项脚本仍被既有桌面布局修复警告 `[desktop] repaired corrupt node placements {}` 拦截；该警告来自桌面节点完整性检查，不由本轮通知卡改动引入，已单独保留为验证说明，没有通过修改断言掩盖。

## Comparison history

- Pass 1: 用户真页证明第一阶段仍存在灰塑料材质、重边重影、重复正文、统一蓝色图标壳和窄窗内容宽度不足，第一阶段结论作废。
- Fix 1: 收紧描边、阴影、高光和控制按钮；加入通知类型色调、展开卡片自适应高度、账号通知详情摘要及空正文隐藏。
- Pass 2: `441 × 571px` 真页显示材质改善，但卡片仅约 `307px`，账号摘要仍折成两行。
- Fix 2: 将窄窗渐隐区改为 `clamp(32px, 11vw, 52px)`，恢复 `344px` 卡片；日期压缩为 `MM/DD HH:mm`，账号详情稳定为一行。
- Pass 3: 参考、被拒基线和最终真页同屏复核；移动与桌面均无内容溢出，展开列表、折叠预览及两种小组件外观可用。

## Verification

- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 登录态真实通知数据、未读/全部筛选、折叠/展开、关闭/重开
- [x] `441 × 571px` 与 `1280 × 900px`，两种小组件外观，无横向溢出
- [ ] `pnpm run verify:notification-center`（被既有桌面布局修复 warning 拦截，非本轮回归）

final result: passed

---

# 通知中心第一阶段局部玻璃质感设计 QA（已由第二阶段取代）

## 对照目标

- Source visual truth: `/var/folders/l6/smy8mmk15898tpm0vddrbyt00000gn/T/codex-clipboard-1e545883-1b19-4e4a-83d4-c7bea11f5b31.png`
- Restored baseline: `/private/tmp/theme-sky-blog-3-notification-macos-audit/01-restored-current.jpg`
- Browser-rendered implementation: `/private/tmp/theme-sky-blog-3-notification-macos-stage1/05-final-preview.jpg`
- Expanded-list evidence: `/private/tmp/theme-sky-blog-3-notification-macos-stage1/03-expanded.jpg`
- Light-surface evidence: `/private/tmp/theme-sky-blog-3-notification-macos-stage1/04-dark.jpg`
- Same-input focused comparison: `/private/tmp/theme-sky-blog-3-notification-macos-stage1/02-reference-before-after.png`
- Route: `http://localhost:8090/?_qa=notification-macos-stage1`
- State: 通知中心打开、暗色桌面小组件、未读筛选、账号通知折叠；另外复核全部通知展开和亮色小组件背景。
- Viewport: CSS `1280 × 900px`，`devicePixelRatio: 1`；实现截图为 `1280 × 900px`。
- Pixel normalization: 参考图为 `652 × 1386px` 的 macOS 通知中心长截图；聚焦比较将参考通知区域 `358 × 138px` 等比缩放为 `378 × 146px`，与修复前、修复后的 `378 × 146px` 真页裁切水平并排。只判断本阶段约定的卡片材质、边缘、阴影和叠层，不把参考图中不同的数据高度误判为像素偏差。

## 对照证据

- Full-view comparison: `05-final-preview.jpg` 与 `03-expanded.jpg` 证明右侧抽屉仍保持透明，壁纸、桌面图标和小组件可透出；局部对比不依赖整块深色遮罩。
- Focused comparison: `02-reference-before-after.png` 从左到右依次为 macOS 参考、恢复后的基线、本次实现；卡片底色、顶部高光、短阴影和后层玻璃唇均在同一输入中清晰可辨。

## Findings

- No actionable P0/P1/P2 findings remain within the agreed stage-one material scope.
- Fonts and typography: 本阶段没有修改应用名、时间、标题、正文的字体、字重、截断或行高；真页仍为 `11 / 13 / 13px` 的现有层级，避免把质感修复扩成内容重排。
- Spacing and layout rhythm: 卡片继续保持 `344 × 70px`、`22px` 圆角和既有列表间距，展开/折叠几何没有回归。参考图的自适应内容高度属于已明确留给第二阶段的内容结构优化，不是本阶段未完成的视觉缺陷。
- Colors and visual tokens: 抽屉空气层仍为原有 `rgba(0,0,0,.15)` 与 `34px` 背景虚化；卡片局部底色调整为 `rgba(26,27,30,.58)`，使用 `30px` 模糊、`145%` 饱和度、`104%` 对比度、较清晰的半像素边缘和短距离双层阴影。未读蓝只保留为轻微语义染色。
- Image quality and assets: 没有修改、替换或伪造通知图标及桌面资源；原有图标仅增加局部高光、细边和更短的投影。
- Copy and content: 通知标题、正文、来源、时间和所有真实数据均原样保留。
- Interaction and accessibility: 已验证未读/全部切换、通知组展开和关闭/重新打开；31 张可见通知卡均保持 `344 × 70px`，页面无横向溢出，浏览器日志中没有 `console.error`。
- Responsive and theme surfaces: 暗色小组件背景与亮色小组件背景下卡片均保持可读，面板没有变为整块黑底；本阶段没有改变移动端断点或触控行为。

## Comparison history

- Pass 1: 参考图与恢复基线的同屏对照显示，基线卡片底色偏灰、背景穿透过强，边缘与叠层深度不足，记录为 P2 材质漂移。
- Fix 1: 只调整通知卡、后层玻璃唇和图标壳的局部材质；收紧阴影，增加顶部高光与内外细边，降低过强的 `42px` 卡片模糊，同时完全保留抽屉透明空气层和小组件。
- Pass 2: 参考、基线、修复后聚焦图再次同屏比较；修复后卡片的局部黑玻璃、边缘分离和叠层关系已接近参考，本阶段无剩余 P0/P1/P2。

## Verification

- [x] `pnpm run check`
- [x] `pnpm run verify:reload`
- [x] `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`
- [x] 1280 × 900 暗/亮背景、折叠/展开、筛选交互、横向溢出与浏览器错误复核
- [x] macOS 参考、恢复基线和真页实现同一视觉输入复核

final result: superseded

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
