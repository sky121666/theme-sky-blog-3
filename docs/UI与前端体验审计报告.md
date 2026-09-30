# UI 与前端体验审计报告

## 报告定位（2026-09-30）

本文主体保留 **2026-07-24 初始源码审计**及后续修复记录，问题编号、代码行号、五分区设置描述和当时风险判断属于历史快照。它们不能直接视作当前工作区未解决问题或最新构建的通过证据。

现行系统设置已为十分类，首屏加载、Dock 与并发保存等后续实现见[前端系统设置](设置/前端系统设置.md)、[项目进度](项目进度.md)及[验证矩阵](验证与审计矩阵.md)。复查旧问题时应先定位当前源码，并按具体构建更新对应证据；本文保留原始发现方便追溯。

## 1. 报告信息

| 项目 | 内容 |
| --- | --- |
| 审计对象 | `theme-sky-blog-3` 当前工作区 |
| 项目路径 | `/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3` |
| 审计日期 | 2026-07-24 |
| 审计方式 | 当前未提交工作区源码静态走查 |
| 审计范围 | 系统设置、桌面壳层、内容页、品牌化 App、移动端、PJAX、异步状态、无障碍和性能 |
| 是否修改主题代码 | 否 |

本报告以当前工作区内容为准，包括尚未提交的 `theme-settings.js`、`theme-settings.css`、`theme-settings.html` 等变化。

本报告不复用此前对 `/Volumes/Macintosh HD/...` 失效副本的结论。两份目录内容不同，旧副本报告不代表当前项目。

## 2. 执行摘要

当前项目的前端系统设置已经真实落地，且比旧副本完整得多：五分区信息架构、真实桌面预览、关闭恢复、字段级合并、保存状态栏、焦点约束和 Halo 附件边界都已实现。

当前主要风险已经从“设置页像后台表单”转为以下五类：

1. 保存和并发逻辑仍可能造成无提示丢修改或覆盖配置。
2. 桌面窗口和部分 App 的响应式断点仍按视口设计，没有完整适配可缩放窗口。
3. PJAX 的超时、失败恢复、焦点和内部滚动恢复仍不完整。
4. 移动端触控尺寸、动态视口和 safe-area 没有形成全局统一协议。
5. 部分 App 的错误状态仍会被显示成空数据、正常结束或旧数据。

## 3. 风险等级

| 等级 | 定义 |
| --- | --- |
| P0 | 可能丢失修改、覆盖配置、永久卡死或让当前页面交互失效 |
| P1 | 主要内容被裁切、核心入口不可达、错误状态误导用户 |
| P2 | 可读性、无障碍、一致性、发现性或性能细节问题 |

## 4. 最高优先级问题

### P0-01 保存期间继续编辑会静默丢失后续输入

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:668-728`
- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:512-545`
- `templates/modules/shell/theme-settings.html:529-531`
- `templates/modules/shell/theme-settings.html:956-964`

保存开始时会截取本次路径和草稿，但保存期间表单与关闭按钮仍可操作。用户在慢网络中继续输入后，成功回调会重建草稿并清空全部脏路径，保存开始后产生的新修改会无提示消失。

### P0-02 系统设置和桌面布局写入可能互相覆盖

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:676-693`
- `src/shell/desktop-shell/runtime/desktop/surface/index.js:1507-1539`
- `src/shell/desktop-shell/runtime/desktop/theme-settings-core.js:383-394`

两个前端写入器都执行完整配置的 GET、客户端合并和整包 PUT，没有共享锁、版本号、ETag 或冲突检测。两个请求读取同一旧版本时，后完成的 PUT 会覆盖先完成的修改。

### P0-03 登录重定向后的 200 HTML 可能被误报为保存成功

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:688-707`
- `src/shell/desktop-shell/runtime/desktop/surface/index.js:1534-1560`

写入流程只检查 `response.ok`，没有检查 `response.redirected` 或响应内容类型。会话过期后若请求跟随到登录页并返回 200，界面可能显示“已保存”、清空脏状态，但服务端实际没有写入。

### P0-04 PJAX 请求缺少截止时间

证据：

- `src/shell/desktop-shell/runtime/desktop/pjax/index.js:829-833`
- `src/shell/desktop-shell/runtime/desktop/pjax/index.js:918-930`
- `src/shell/desktop-shell/runtime/desktop/pjax/index.js:1022-1047`
- `src/shell/desktop-shell/runtime/desktop/pjax/index.js:1312-1326`

同变体请求只有“新导航到来时取消”，没有计时器。服务端连接长期无响应时，骨架、NProgress 和 `aria-busy` 可能一直保留。

### P0-05 PJAX 失败恢复后原 App 可能仍处于已销毁状态

证据：

- `src/shell/desktop-shell/runtime/desktop/pjax/index.js:1359-1381`
- `src/shell/desktop-shell/runtime/desktop/pjax/index.js:1538-1566`
- `src/shell/desktop-shell/runtime/shared/page-app.js:133-189`
- `src/apps/photos/hydrate.js:13-20`
- `src/apps/links/hydrate.js:11-18`
- `src/apps/steam/hydrate.js:14-20`

导航发送时先执行当前 App 的 `dispose()`。网络失败后虽然重新激活当前 App，但多个 App 的 `hydrate()` 为空，原页面仍可见，分页观察器、全局事件和目录等交互却可能持续失效，直到刷新。

### P1-01 桌面菜单子项无法通过键盘可靠打开

证据：`templates/modules/shell/header.html:43-55`

带子项菜单只依赖 `mouseenter/mouseleave`，父项使用 `javascript:void(0)`，没有点击、Enter、Space、聚焦或 `aria-expanded` 逻辑。键盘用户和无可靠 hover 的触屏设备无法访问子菜单。

### P1-02 浅色壁纸上的菜单栏文字对比严重不足

证据：

- `src/shell/desktop-shell/styles/desktop/surface.css:165-181`
- `src/shell/desktop-shell/styles/desktop/menubar.css:15-23`

浅色模式仍固定使用白色菜单文字，部分浅色壁纸只叠加约 15%–16% 的暗层。菜单、时间和系统设置入口在亮区可能难以辨认。

### P1-03 Dock 在小屏上没有宽度兜底

证据：

- `src/shell/desktop-shell/styles/desktop/dock.css:2-13`
- `src/shell/desktop-shell/runtime/desktop/window-manager.js:2132-2157`

Dock 没有 `max-width`、横向滚动、收纳或按视口缩放。图标允许达到 64px，菜单项数量不受限，小屏两端图标会移出视口且无法找回。

### P1-04 窗口断点在平板和横屏手机上发生冲突

证据：

- `src/shell/desktop-shell/runtime/desktop/window.js:444`
- `src/shell/desktop-shell/runtime/desktop/window.js:630-676`
- `src/shell/desktop-shell/runtime/desktop/window.js:726-744`
- `templates/modules/shell/window-frame.html:3-16`

运行时以 `innerWidth > 768` 判断桌面并设置至少 500px 高度；Tailwind 在 768px 已启用桌面样式。横屏手机可能得到超出视口的桌面窗口，正好 768px 时还会出现移动逻辑与桌面样式混用。窗口拖拽和缩放模板仍主要依赖鼠标事件。

### P1-05 小组件中心的后加载样式会覆盖移动断点

证据：

- `src/shell/desktop-shell/styles/widgets/shell.css:599-696`
- `src/shell/desktop-shell/runtime/desktop/surface/editing-runtime.js:1`
- `src/shell/desktop-shell/styles/widgets/center.css:215-232`
- `src/shell/desktop-shell/styles/widgets/center.css:395-445`

移动响应式规则位于先加载的 `shell.css`，中心基础样式由编辑运行时后加载，并以相同优先级覆盖断点结果。320px 屏幕可能只剩约 94px 的内容区，预览和添加按钮被裁切。

### P1-06 归档页在 641–1131px 范围横向裁切

证据：`src/apps/explorer/archives/styles.css:86-94,218-250,633-689`

年份栏和三列内容最小需要约 1132px，但只在 640px 以下改为单列，外层又隐藏横向溢出。中等窗口和部分平板无法访问右侧内容。

### P1-07 作者页默认窗口宽度不足以容纳四列

证据：

- `src/apps/explorer/author/styles.css:3-5,400-421`
- `src/apps/explorer/tags/styles.css:309-328`
- `src/shell/desktop-shell/runtime/desktop/window.js:726-744`

作者页四列最小宽度约 1240px，而默认窗口最大宽度约 1200px，且只在 640px 以下改为单列。默认状态就可能裁掉右侧预览。

### P1-08 Docsme 在 769–959px 视口可能超出屏幕

证据：

- `templates/modules/docsme-app/window.html:7-9`
- `src/apps/docsme/styles/index.css:1686-1705`

Docsme 从 `md` 断点开始强制至少 960px 宽，但移动全屏覆盖到 768px 才清除该限制，769–959px 的平板会产生超宽窗口。

## 5. 前端系统设置审计

### 5.1 已正确实现

以下能力已经在当前项目真实落地，不应再沿用旧副本中的相反结论：

1. 五分区信息架构已经完成：外观、桌面与 Dock、小组件、菜单栏与控制中心、通知。
   - 证据：`templates/modules/shell/theme-settings.html:75-134`
   - 证据：`src/shell/desktop-shell/styles/desktop/theme-settings.css:340-419`
2. 设置使用圆角分组列表和行分隔，不再是大量孤立 Dashboard 卡片。
3. 重复的静态 Dock、天气和菜单栏预览已经删除，设置直接作用于真实桌面对象。
   - 证据：`templates/modules/shell/theme-settings.html:490-684`
   - 证据：`scripts/verify-theme-settings.mjs:217-219`
4. 侧栏、开关、焦点和主操作统一继承主题强调色，没有继续写死系统蓝。
   - 证据：`src/shell/desktop-shell/styles/desktop/theme-settings.css:1-8,511-520`
5. 访客不会直接探测受保护配置接口，并区分 401、403、404 与非 JSON 响应。
   - 证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:89-102,432-476`
6. 常规关闭未保存设置时，会恢复 body、Dock 和本地外观偏好，并恢复入口焦点。
   - 证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:118-202,490-545,658-665`
7. 外观、Dock、菜单栏和桌面天气均已建立实时同步通道。
   - 证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:204-351`
   - 证据：`src/shell/desktop-shell/runtime/desktop/window-manager.js:2122-2270`
8. 保存前会重新读取配置，并只合并白名单脏路径，保留其他主题字段和配置外壳。
   - 证据：`src/shell/desktop-shell/runtime/desktop/theme-settings-core.js:383-394`
   - 证据：`scripts/verify-theme-settings.mjs:151-187`
9. 应用栏具备修改提示、保存中、成功、警告、错误和刷新状态。
   - 证据：`templates/modules/shell/theme-settings.html:922-966`
10. 基础对话框已经实现初始聚焦、Tab 约束、Escape、关闭回焦和 reduced-motion。
    - 证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:407-421,547-587`
11. 上传壁纸和回退封面仍由 Halo 后台附件字段管理，没有复制第二套上传状态。
    - 证据：`templates/modules/shell/theme-settings.html:477-486,670-684`

### 5.2 问题与后续修复状态

#### P1 首次权限检查和网络失败缺少可见入口状态

证据：

- `templates/modules/shell/header.html:122-130`
- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:447-486`

齿轮入口始终存在，没有检查中、禁用或错误反馈。访客、无权限用户或慢网络环境点击后看起来没有任何反应。

#### P1 重新打开设置不会再次读取最新服务端基线

证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:447-497`

第一次权限探测成功后，后续打开直接复制内存 `baseline`。后台或其他标签页修改配置后，重开设置仍可能展示旧值。

#### 已修复（v0.9.44）：全屏设置层阻止真实 Dock 和下拉菜单交互

证据：

- `src/shell/desktop-shell/styles/desktop/theme-settings.css:28-44,109-110`
- `src/shell/desktop-shell/styles/desktop/dock.css:2-12`
- `src/shell/desktop-shell/styles/desktop/menubar.css:2-24`

设置层已调整到 Dock、通知中心和菜单栏下方，透明区域保持事件穿透，仅打开后的设置窗口本体接收指针。真实 Dock 可继续悬停验证，Header 下拉菜单也可在设置窗口打开时正常操作。

#### P1 天气刷新间隔和实时预览只部分生效

证据：

- `templates/modules/shell/theme-settings.html:644-683`
- `src/shell/desktop-shell/runtime/widgets/weather-runtime.js:32-45`
- `src/shell/desktop-shell/runtime/desktop/surface/index.js:704-715,827-833`

刷新间隔目前主要作为缓存 TTL，没有持续定时刷新；通知中心天气不参与同一实时预览；城市输入使用 `change`，未失焦时不会同步。

#### P1 文本字段在输入过程中立即 trim

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings-core.js:265-271,372-380`
- `templates/modules/shell/theme-settings.html:698-702,735-739,872-885`

输入 `Sky Blog` 时，键入尾随空格后会被立即删除；反复回写 value 也可能干扰中文输入法组合输入。

#### P1 横屏和矮视口可能裁掉窗口或应用栏

证据：`src/shell/desktop-shell/styles/desktop/theme-settings.css:84-90,1011-1024`

桌面模式强制至少 520px 高，只有宽度不超过 680px 才取消。844×390 等横屏手机不会进入移动规则。移动布局仍使用 `100vh`，与项目其他使用 `100dvh` 和 safe-area 的面板不一致。

#### P1 移动抽屉没有独立焦点边界

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:547-587,736-753`
- `templates/modules/shell/theme-settings.html:68-131`

抽屉打开后焦点没有移入，主内容也未设为 `inert`。Tab 可以进入遮罩后的设置项；选择分类后焦点可能停留在已隐藏导航中。

#### P1 自定义浅色强调色会降低主按钮对比度

证据：

- `src/shell/desktop-shell/styles/desktop/theme-settings.css:617-635,883-893`
- `templates/modules/shell/theme-settings.html:276-307`

主按钮始终使用近白文字和当前强调色背景。黄色、橙色及接近白色的自定义颜色会让“应用”文字难以辨认。

#### P1 浏览器刷新和关闭标签页不会提醒未应用设置

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings.js:396-430,512-545`
- `src/shell/desktop-shell/runtime/desktop/surface/index.js:610-614`

双重关闭确认只覆盖设置窗口本身，未接入 `beforeunload`。浏览器刷新、关标签页和整页导航可直接丢失草稿。

#### P2 保存后的刷新提示会在重开窗口时消失

证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:498,701-707`

用户保存后关闭设置但没有刷新，再次打开时 `reloadRequired` 被重置，服务端渲染内容仍可能是旧状态，却没有刷新提醒。

#### P2 修改计数按内部路径而非用户动作计算

证据：`src/shell/desktop-shell/runtime/desktop/theme-settings.js:608-645`

一次切换预设可能同时修改 `mode` 和 `preset`，界面显示为两项修改；点击还原后底栏立即隐藏，“已撤销”通常来不及被看见。

#### P2 二级菜单颜色输入缺少可见校验错误

证据：

- `src/shell/desktop-shell/runtime/desktop/theme-settings-core.js:228-258,300-303`
- `templates/modules/shell/theme-settings.html:829-854`

非法格式会静默恢复旧值，没有行内错误、`aria-invalid` 或格式说明。

#### P2 手机设置控件仍小于常见触控建议

证据：`src/shell/desktop-shell/styles/desktop/theme-settings.css:191-203,1098-1103,1319-1327`

抽屉和关闭按钮约 34px，应用和还原按钮高度约 29px，保存类核心动作仍偏小。

#### P2 自定义 radiogroup 缺少方向键语义

证据：`templates/modules/shell/theme-settings.html:142-160,198-256,363-461`

所有强调色和壁纸按钮都是独立 Tab 停靠点，没有 roving tabindex 或方向键切换，键盘用户需要逐项 Tab。

## 6. 桌面壳层

### 6.1 菜单栏与 Dock

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 移动菜单栏按钮仅约 22×22px | `menubar.css:116-129,504-541` | 搜索、登录、设置和菜单入口容易误触 |
| P2 | 时间同时是通知中心入口但使用默认光标 | `header.html:149-159`、`menubar.css:233-247` | 看起来像静态时间，通知入口发现性不足 |
| P1 | Dock 每帧交错读写几何信息 | `window-manager.js:2214-2234` | 图标多时放大动画可能抖动和掉帧 |

### 6.2 窗口

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 持久化窗口尺寸初始应用时缺少完整钳制 | `window.js:543-581,839-925` | 旧尺寸可能让窗口边缘和手柄落到屏幕外 |
| P1 | 最大化窗口不避让 Dock | `window.js:789-796`、`dock.css:2-13` | 最后一段、分页和底部按钮可能被 Dock 覆盖 |
| P1 | 交通灯热区只有约 12px | `window.css:525-565`、`window-controls.html:3-10` | 鼠标和触屏都难以命中 |
| P1 | 移动端仍显示无效最大化按钮 | `window.js:768-770` | 用户点击明确可见控件却没有反应 |
| P2 | 最大化后控件标题仍写“最大化” | `window-controls.html:3-10` | 状态与动作语义不一致 |

### 6.3 桌面编辑与小组件

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 普通访客右键也被阻止 | `layout.html:486-492`、`desktop-widgets.html:685-689`、`surface/index.js:1054-1087` | 没有自定义菜单时仍失去浏览器原生右键功能 |
| P1 | 编辑态删除按钮被写死隐藏 | `desktop-widgets.html:706-741`、`widgets/shell.css:109-124` | 只能依赖右键菜单删除组件和图标 |
| P1 | 低高度视口中的节点会直接被排除 | `widgets/shell.css:1-9`、`surface/grid.js:38-100` | 底部组件和图标消失，没有滚动或提示 |
| P1 | 渲染器失败会永久显示加载骨架 | `widgets/render-runtime.js:30-69` | 无法区分加载中、插件卸载和资源失败 |
| P1 | 添加图标和组件配置层缺少完整 dialog 语义 | `desktop-widgets.html:302-383`、`surface/index.js:1029-1051` | 焦点可进入背景，Escape 结果与当前弹层不一致 |
| P2 | 移动图标容器缩小但 SVG 仍为 52/56px | `surface.css:579-584`、`icons/render.js:14-30` | 图标可能越过容器并挤压标签 |
| P2 | 组件中心固定暗色且次级文字过淡 | `widgets/center.css:215-234,503-507,713-720` | 亮色主题突变，状态文字难读 |

### 6.4 通知中心

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 标记已读和删除失败只有日志 | `window-manager.js:1239-1279` | 通知消失后又出现，没有失败解释 |
| P1 | 通知跳转等待无超时的标记已读请求 | `window-manager.js:1214-1246,1394-1420` | API 挂起时目标页面一直不打开 |
| P1 | 变更请求没有正确区分 401/403 与登录重定向 | `window-manager.js:1227-1279` | 本地显示成功，刷新后通知重新出现 |
| P1 | 平板和桌面按钮热区仍偏小 | `notification-center.css:316-338,532-540,1138-1157` | 641–820px 触屏设备仍难操作关闭和删除 |
| P2 | 主加载和认证状态没有 live region | `header.html:258-263`、`window-manager.js:1020-1026` | 屏幕阅读器不能及时获知状态变化 |
| P2 | 分组预览只处理 Enter，不处理 Space | `header.html:339-345` | 空格会滚动页面而不是展开通知 |

### 6.5 动效与性能

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | Genie、最大化和 Dock 放大忽略 reduced-motion | `window.js:141-213,768-804`、`window-manager.js:2016-2099,2202-2258` | 减少动态效果用户仍看到大幅缩放和位移 |
| P1 | 最小化会克隆整个窗口 DOM | `window.js:84-138,772-804` | 长文章、图库和大列表窗口可能出现主线程停顿 |
| P2 | 最大化使用尺寸与位置动画 | `window.js:772-804` | 宽高、位置同时变化造成整窗重排 |

## 7. 内容页

### 7.1 Reader

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 隐藏目录后仍保留 220px 网格轨道 | `reader/styles/post.css:392-398,1277-1285,1397-1401` | 653–768px 容器出现大片空白，正文被压窄 |
| P1 | 独立页面正文最大约 1160px | `browser-reader/page.html:24-31`、`post.css:7-16,641-676` | 关于页等长文行宽过长，与文章页不一致 |
| P1 | 移动目录拖动条声明为按钮但键盘不可激活 | `browser-window.html:24-34`、`post-outline.js:53-77` | Enter/Space 无效，且实际点击区仅约 42×4px |
| P1 | iframe 和宽表响应按视口而非窗口 | `post.css:966-1006,1252-1256` | 窄桌面窗口中的视频比例和宽表可能异常 |
| P1 | SinglePage 窄窗显示无效目录按钮 | `post-outline.js:28-43`、`browser-reader/page.html:21-44` | 点击目录没有任何反应 |
| P2 | 评论关闭时整个区域消失 | `browser-reader/post.html:139-145`、`page.html:33-43` | 用户无法判断评论关闭还是组件故障 |

### 7.2 Archives 与 Author

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 归档查询使用站点文章总数作为分页大小 | `browser-explorer/archives.html:22-28` | 文章增长后每次请求构建完整归档树，拖慢 SSR 和 PJAX |
| P2 | 空归档和越界页共用泛化空态 | `archives.html:231-235` | 缺少返回有效页的恢复操作 |
| P1 | 作者瞬间首屏与 API 使用不同排序字段 | `author.html:22-28`、`author/runtime.js:368-370` | 翻页可能重复、遗漏或顺序跳变 |
| P1 | 作者瞬间分页失败没有可见反馈 | `author/runtime.js:279-310,347-399` | 用户看到按钮没有反应，也无法重试 |
| P1 | 瞬间列表没有真实选中态绑定 | `author.html:165-194`、`shared/moments.js:74-96` | 右侧预览变化后无法判断对应哪一行 |
| P2 | 来源按钮和分页触控尺寸偏小 | `author/styles.css:610-617,694-707` | 与分类和标签页的 44px 标准不一致 |

### 7.3 Links

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 客户端视图切换不更新窗口和浏览器标题 | `links.html:14-17`、`links/runtime.js:1289-1316` | 朋友圈、申请、留言板仍显示旧标题 |
| P1 | 必填项只通过禁用按钮表达 | `links-app/list.html:508-546`、`links/runtime.js:2165-2181` | 用户不知道提交按钮为什么不可用 |
| P1 | 评论插件不可用时申请流程成为死路 | `links-app/list.html:550-568`、`links/runtime.js:2269-2285` | 提示通过其他方式提交，却不提供联系方式 |
| P1 | 响应式基于视口而非窗口宽度 | `links-app/window.html:1-15`、`links/styles/index.css:3-5,112-126` | 宽屏中把窗口缩窄后详情区可能只剩约 100px |
| P1 | 隐藏详情区仍可被 Tab 聚焦 | `links-app/list.html:271-300`、`links/styles/index.css:510-529` | 键盘进入完全不可见的 `aria-hidden` 子树 |
| P1 | 非 JSON 500/502 被误判为游客 | `links/runtime.js:760-778,1792-1805` | 已登录管理员错误降级到访客申请流程 |
| P2 | 最大化能力声明冲突 | `links.html:26-33`、`links-app/window.html:1-10` | 顶层禁用最大化，实际窗口仍显示最大化按钮 |

### 7.4 Docsme 与错误页

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 文档标题被项目标题覆盖 | `doc.html:4-10`、`docsme/hydrate.js:21-35` | 不同文档标签页显示相同标题，影响历史和书签辨认 |
| P1 | 移动目录只通过 transform 移出屏幕 | `docsme-app/content.html:225-271`、`docsme/runtime.js:53-87` | 隐藏目录中的链接和 select 仍可进入 Tab 顺序 |
| P1 | 点击本页目录项后浮层不自动关闭 | `docsme/runtime.js:58-66,201-211` | 跳转成功后目录仍遮挡正文 |
| P1 | 富文本表格没有横向滚动容器 | `docsme/styles/index.css:1119-1193` | 多列宽表和长 URL 可能被裁切 |
| P1 | 失败的同变体导航可能留下永久暗化状态 | `docsme/runtime.js:698-745` | 旧文档一直变暗并显示无限进度 |
| P1 | 错误页模态语义与焦点行为不一致 | `error/modules/dialog.html:5-7`、`error.css:1-25` | 焦点和点击可以穿透到后方菜单栏与 Dock |
| P1 | 5xx 文案要求重试但没有重试按钮 | `error/5xx.html:21-27`、`error/modules/dialog.html:70-77` | 用户只能返回或回首页，不能重试原页面 |

## 8. 品牌化 App

### 8.1 Moments

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | “适应窗口”会让已加载图片卡在加载状态 | `moments/interactions.js:552-599,672-679` | 只能切图或关闭查看器恢复 |
| P1 | 取消发布和移除媒体不会删除已上传附件 | `moments/publish.js:163-209,411-565` | 媒体库产生孤儿附件并占用存储 |
| P2 | 任意 PJAX 失败可能被误报为流分页失败 | `moments-app/list.html:341-379` | 打开详情失败也会把底部改为分页重试 |

当前 Moments 品牌色没有被全局强调色无条件污染，查看器也已经具备图片错误、焦点恢复、视频暂停和 destroy 清理。

### 8.2 Photos

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 后置通用样式覆盖移动详情布局 | `photos/styles/index.css:3474-3517,3877-3918,4288-4293` | 390px 屏幕仍保留约 152px 侧栏，主图只剩约 238px |
| P1 | 成功但为空的尾页被当成网络错误 | `photos/runtime/explorer.js:1221-1258` | 数据删除或分页漂移后会无限显示加载失败 |
| P2 | 详情主图加载失败没有错误态 | `photo.html:60-71`、`photos/runtime/explorer.js:624-645` | 舞台保持空白，控件仍可操作 |
| P2 | 信息层和评论层缺少 `x-cloak` | `photo.html:115-162` | Alpine 延迟时会闪现并挤压主图 |

### 8.3 Douban

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 筛选慢请求期间继续显示旧结果 | `douban/runtime.js:357-405,563-595` | 新筛选按钮与旧内容同时出现，造成数据错觉 |
| P1 | 加载失败同时显示空态、错误和旧分页 | `douban/runtime.js:466-471,642-648` | 状态互相冲突，可能继续请求错误页码 |
| P1 | Quick Look 关闭后内部控件仍可聚焦 | `douban/runtime.js:729-763`、`douban-app/list.html:161-189` | 焦点进入不可见对话框，关闭后也不回触发项 |

### 8.4 Steam、Bangumis、Equipments

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P2 | Steam 禁用外链后仍使用 `href="#"` | `steam-app/list.html:140-153,280-303` | 卡片看似可打开，点击只产生空 fragment 导航 |

当前未发现 Steam、Bangumis、Moments 和 Douban 的品牌色被全局强调色无条件污染。Bangumis、Steam 和 Equipments 的分页具有取消、代次防陈旧响应和销毁清理；Equipments 也已使用 `100dvh` 与 safe-area。

## 9. 跨页面前端逻辑

### 9.1 PJAX 与历史

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 窗口内部滚动位置不进入历史状态 | `pjax/index.js:453-523,1090-1095,1276-1303` | 返回长文章或列表时通常回到顶部 |
| P1 | 内容替换后没有安置焦点 | `pjax/index.js:1150-1185,1238-1259,1446-1469` | 键盘和读屏用户无法确认新页面已经打开 |
| P1 | 网络级失败只有日志，没有可见反馈 | `pjax/index.js:842-853,1538-1567` | 进度条结束后页面不变，看起来像点击无效 |
| P2 | 动态链接观察器在完整替换后失去根节点 | `pjax/index.js:964-979,1437-1465` | 后续动态插入链接可能退化为整页刷新 |

### 9.2 请求、权限与主题

| 等级 | 问题 | 证据 | 用户影响 |
| --- | --- | --- | --- |
| P1 | 设置和布局 GET/PUT 没有超时 | `theme-settings.js:432-475,668-728`、`surface/index.js:1434-1578` | 按钮永久停在检查中或保存中 |
| P1 | 远程壁纸预览没有预加载和失败提示 | `theme-settings.js:204-240` | 慢网先闪深色背景，失效图片仍可被保存 |
| P2 | 登录页系统主题不响应实时变化 | `entries/auth.js:6-65` | 登录页长时间打开时主题状态滞后 |
| P2 | Windows 登录页指针移动持续测量滚动布局 | `entries/auth.js:147-216` | 高刷新率设备可能产生额外布局和耗电 |

## 10. 共性根因

### 10.1 可缩放窗口与视口响应混用

项目真实内容容器是可以拖动和缩放的窗口，但 Author、Archives、Links、Reader、Docsme 等模块仍大量依赖浏览器视口媒体查询。

结果是：浏览器很宽但窗口很窄时，页面仍保持桌面多列结构；平板宽度又可能进入半桌面半移动状态。

### 10.2 写入协议缺少版本与冲突层

字段级合并已经实现，但最终仍是整包 PUT。系统设置、桌面布局、后台和其他标签页之间没有 revision、ETag 或冲突比较。

### 10.3 异步状态协议没有完全统一

部分模块已经具备完整的 `checking / loading / ready / empty / error / retry`，但仍有模块将：

- 请求失败显示为旧内容。
- 空尾页显示为错误。
- 非 JSON 错误显示为访客。
- 操作失败只写调试日志。

### 10.4 移动交互尺寸与全屏协议不统一

项目内同时存在 22px、26px、29px、32px、34px、38px 和 44px 控件；全屏高度也混用 `100%`、`100vh` 和 `100dvh`。

### 10.5 减少动态效果只覆盖部分模块

通知、主题过渡和部分骨架已经支持 reduced-motion，但窗口 Genie、最大化、Dock 放大和部分平滑滚动仍没有统一接入。

## 11. 整改顺序建议

### 第一阶段：防止丢数据和假成功

1. 保存期间冻结本次草稿或正确保留保存后产生的新脏路径。
2. 检查登录重定向、响应类型和真实写入结果。
3. 为系统设置与桌面布局建立共享写入队列和版本冲突检测。
4. 为设置、布局、通知和 PJAX 请求统一增加超时与取消。

### 第二阶段：修复主要不可达布局

1. 修复 Author、Archives、Docsme 的中间宽度裁切。
2. 统一窗口桌面/移动断点，处理 768px 与横屏矮视口。
3. 为 Dock 建立小屏缩放、滚动或收纳策略。
4. 调整小组件中心动态样式加载顺序，确保移动断点最终生效。

### 第三阶段：补齐 PJAX 恢复契约

1. 导航失败时重新 hydrate 被 dispose 的原 App。
2. 恢复窗口内部滚动位置。
3. 新页面完成后移动焦点并播报标题。
4. 对网络错误显示可见状态和重试入口。
5. 完整 PJAX 替换后重新绑定动态链接观察器。

### 第四阶段：统一设置与弹层体验

1. 每次打开设置时读取最新服务端基线。
2. 处理浏览器刷新和关闭标签页时的未应用草稿。
3. 为移动抽屉、组件配置、添加图标和 Quick Look 建立统一 dialog/focus 协议。
4. 已解决设置遮罩阻止真实 Dock 和二级菜单交互预览的问题（v0.9.44）。
5. 对文本输入、颜色校验和强调色文字对比提供安全约束。

### 第五阶段：移动端与细节收尾

1. 建立统一的 `100dvh` 与 safe-area token。
2. 核心触控目标统一到至少约 44px 热区。
3. 让 Genie、最大化、Dock 和所有平滑滚动遵循 reduced-motion。
4. 将响应式从视口媒体查询迁移到窗口容器查询。

## 12. 建议验收矩阵

1. 保存设置期间继续修改，后续修改不会消失。
2. 会话过期时保存明确提示重新登录，不会显示“已保存”。
3. 系统设置与桌面布局同时保存时不会互相覆盖。
4. 320、375、390、640、768、820、960、1132、1240px 宽度均无不可达内容。
5. 844×390 横屏下设置窗口和底部应用栏完整可见。
6. Dock 项目数量较多且图标为 64px 时仍可访问全部项目。
7. PJAX 超时、断网和资源失败后页面可以恢复和重试。
8. PJAX 返回时恢复窗口内部滚动位置和焦点。
9. 所有弹层可通过键盘进入、循环、Escape 关闭并恢复触发焦点。
10. `prefers-reduced-motion` 开启后不再执行大幅窗口和 Dock 动画。
11. 401、403、500、非 JSON、空尾页和真实空数据拥有不同状态。
12. 浅色壁纸上的菜单栏文字满足可读对比。
13. 自定义浅色强调色不会让“应用”按钮文字消失。
14. 远程壁纸失败时保留原背景并显示错误，不允许静默保存坏地址。

## 13. 当前已确认的工程基础

以下能力已经存在，可作为整改时的复用基础：

1. PJAX 最新导航优先、旧请求取消和 generation 校验。
   - `src/shell/desktop-shell/runtime/desktop/pjax/navigation-guard.js:102-179`
2. App 资源加载有去重、15 秒超时、失败移除和硬导航兜底。
   - `src/shell-core/runtime/app-loader.js:122-170`
3. 通知中心已有初始聚焦、Tab 限制、Escape 和关闭回焦。
   - `src/shell/desktop-shell/runtime/desktop/window-manager.js:711-821`
4. 通知中心使用 `100dvh`、safe-area、移动单列和触屏操作常显。
   - `src/shell/desktop-shell/styles/desktop/notification-center.css:88-112,1678-1806`
5. 主桌面主题会监听系统主题变化，并避免明显首屏主题闪烁。
   - `templates/modules/shell/layout.html:108-129`
   - `src/shell/desktop-shell/runtime/desktop/window-manager.js:385-425`
6. 天气请求具备 8 秒超时、AbortController、请求去重和缓存。
   - `src/shell/desktop-shell/runtime/widgets/weather-runtime.js:5-7,64-86,139-146`
7. 桌面拖放已经使用 Pointer Events、pointer capture 和 `pointercancel` 清理。
   - `src/shell/desktop-shell/runtime/desktop/surface/drag.js:14-77,434-545`
8. Categories 和 Tags 已采用窗口容器查询，并在移动端提供较完整的 44px 操作尺寸和越界恢复。
   - `src/apps/explorer/categories/styles.css:840-947`
   - `src/apps/explorer/tags/styles.css:826-923`
9. Links 朋友圈具备 checking、loading、ready、empty、error、retry、请求取消和能力降级。
   - `templates/modules/links-app/list.html:428-447`
10. 懒加载图片和评论支持重复初始化去重，并在释放时取消观察。
    - `src/shell/desktop-shell/runtime/shared/lazy-media.js:85-125`
    - `src/shell/desktop-shell/runtime/shared/lazy-comment.js:84-125`
