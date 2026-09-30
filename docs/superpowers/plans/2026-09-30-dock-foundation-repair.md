# Dock 基础整改实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 按以下任务执行，保留既有工作区改动。

**Goal:** 修复首帧 Dock 尺寸与材质变化、异常图标和重复提示，消除已确认的启动资源重复请求。

**Architecture:** 服务端输出与运行时一致的 Dock 基础样式；运行时负责交互和后续变化。构建产物提供当前 CSS 构建身份，启动仍校验 manifest 并保留失败交接、超时与版本变化处理。运行时复用当前启动阶段已校验清单。

**Tech Stack:** Halo / Thymeleaf / Alpine.js / Tailwind CSS 4 / Vite / pnpm。

**Spec:** 本会话用户“开始修复吧”，承接上一轮基础整改结论；六项新增候选不纳入本次范围。

**交付补充：**实施与验收完成后，用户于本会话授权“提交git”。本地提交包含本聊天已验收的设置与 Dock 改动及匹配资源；不包含推送、标签或发布。

## Global Constraints

- 仅当前主题源码与必要构建产物；保持 main，不创建分支或 worktree，不暂存、提交、推送或打标签。
- 不修改 Halo Core、插件、真实站点配置、数据库、账户及凭据。
- 保留已有未提交改动，使用本次执行前的文件快照核对新增差异。
- 包管理器固定 pnpm；不得安装新 UI 框架或改变主题既有视觉语言。
- 保留导航取消、失败回退、未保存设置保护、资源版本检查和减少动态效果规则。

## Review Focus

- 冷加载、缓存加载、manifest 故障或版本不同：同身份只加载一次 CSS，不同身份继续完整交接。
- 关闭系统设置或名称提示、减少动态效果：首帧状态与运行时一致，可访问名称保留。
- 图片在运行时启动前已经失败、启动后失败、非图片入口无素材：均有安全降级且入口仍可点击。
- 窄视口和较多入口：不以虚构的最小视口宽度计算缩放；悬停不改变桌面预留。
- PJAX、前后退、最小化与未保存设置：复用既有导航保护，本次不增加新的窗口状态模型。

---

### Task 1: Dock 首帧与入口可靠性

**Files:** templates/modules/shell/layout.html；templates/modules/shell/header.html；src/shell/desktop-shell/runtime/desktop/dock-runtime.js；src/shell/desktop-shell/runtime/desktop/dock-geometry.js；src/shell/desktop-shell/styles/desktop/dock.css；scripts/verify-dock-geometry.test.mjs。

**Interfaces:** 容器 data-dock-ready="false" 抑制初始化过渡；既有 data-dock-* 保留。菜单入口提供 aria-label 和 data-dock-label；运行时依据名称安全构建图片降级，不使用 innerHTML 注入。系统设置开关首帧可见性由样式属性表达，不改已有持久字段。

- [x] 用既有 Dock 行为测试补充图片失败、初始化过渡和极窄宽度的回归场景，记录失败。
- [x] 服务端输出有效大小、间距、内边距、玻璃高度、模糊、不透明度与圆角；CSS 对减少动态效果给出同样高度。
- [x] 补空 SVG 与失败图片降级，统一自定义名称提示并保留可访问名称；初始化结束再启用交互过渡。
- [x] 保留已服务端输出的菜单栏品牌与时间首帧，按实际开关隐藏。
- [x] 运行 pnpm run verify:desktop-dock 并核对后续预览、取消、悬停及卸载清理。

### Task 2: 启动资源身份与清单复用

**Files:** vite.config.ts；新 scripts/theme-build-styles.mjs 与行为测试；生成 templates/assets/build-styles.html；src/shell-core/runtime/resource-registry.js；src/shell/desktop-shell/entry-main.js；templates/modules/shell/layout.html；scripts/verify-shell-bootstrap-contract.mjs；资源生命周期测试。

**Interfaces:** build-styles.html 的 styles(pageApp) 片段提供 Shell 和当前 App 的 CSS URL，版本来自同次构建。bootstrap 将已校验完整清单放入 window.__THEME_ASSET_MANIFEST__；仅编译身份与该清单完全匹配时允许复用。force=true 必须继续请求最新清单。

- [x] 增加启动清单复用、初始 pageshow 不重复请求、强制检查能发现新版本的行为测试，记录失败。
- [x] 构建输出当前 CSS 身份片段；现有模板引用它，manifest 校验及样式原子交接继续保留。
- [x] 复用启动清单，初始检查使用非强制读取；BFCache 返回和可见性恢复继续强制检查。
- [x] 在不提前执行 Alpine 的前提下，使 manifest 和 Shell 预加载尽早开始；等待 DOM 可用后启动 Shell。
- [x] 运行 bootstrap 和资源生命周期定向验证，覆盖故障、超时、身份变化。

### Task 3: 集成验收与窗口行为核对

**Files:** 本计划；.superpowers/sdd/2026-09-30-dock-foundation-repair/ 验证记录；必要的现有导航验证脚本。

- [x] 审查本次差异，核对新增功能和站点配置没有被纳入修改。
- [x] 执行 pnpm run check、pnpm run verify:reload、SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright。
- [x] 使用当前浏览器验证冷加载首帧、Dock 悬停/键盘提示、设置开关、桌面与窄屏表现。
- [x] 核对导航、最小化、恢复、前后退的实际缺口；仅修可复现问题，不新增窗口模型。
- [x] 记录结果与限制，保留可回退快照；不执行 Git 写操作。
