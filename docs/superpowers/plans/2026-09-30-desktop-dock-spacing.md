# 桌面滚动与 Dock 间距修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复桌面空白区域不能滚动，并让桌面依据稳定的 Dock 尺寸预留空间。

**Architecture:** 原生滚动由现有网格容器承接。Dock 同步注册 Alpine 入口，挂载时异步加载外观和几何运行时，发布派生 CSS 变量；桌面高度变化只更新度量，宽度变化继续沿用响应式排列。设置取消恢复滚动上下文。

**Tech Stack:** Halo 2.26.1、本地主题 0.9.46、Alpine.js、CSS、Node.js 24、pnpm。

**Spec:** 本文件“设计与边界”章节，承接聊天中已讨论方案；用户于 2026-09-30 明确要求“做方案，然后开始修吧”，在本会话直接执行。

## Global Constraints

- 使用现有 main 检出和 pnpm，保留已有用户改动。
- 实施阶段授权主题相关源码、文档、必要测试和本地验证；用户随后授权分批本地提交，提交状态见项目进度。
- Dock 外观和后台菜单语义沿用现状，不新增图标兜底。
- 预览和窗口高度变化不得保存布局、改写配置或重新排列已放置的节点。
- 桌面底边距离 12px；手机沿用 10px，并计入设备底部安全区域。

## 设计与边界

- 第一批：恢复 `.desktop-widgets-grid-shell` 的原生命中；右键、空白点击、选择和拖拽继续由现有桌面处理器承接。
- 第二批：保留 `runtime/desktop/dock.js` 为同步注册入口，主体移至 `dock-runtime.js`，参数读取与几何计算放在 `dock-geometry.js`。导入成功或失败均检查 generation，挂载时重读当前参数。
- 以静态玻璃面板上方 24px、有效最大放大图标上方 8px 为候选间距。计算 `reserve = B + qH + max(24, qE + 8)`，其中 H 为玻璃高度，E 为有效最大图标向上超出玻璃的高度。关闭放大、倍率 1 或系统减少动态效果时 E=0。
- q 来自基础图标尺寸、间隙、留白和分隔线宽度，不读取动画中的图标宽度。悬停和回落不更新桌面 reserve。
- 只在参数、视口或 Dock 子项数量变化时重算；新增监听、Observer 和排队帧全部在销毁时清理。
- 桌面容器尺寸 Observer 更新度量；纯高度变化不执行 normalizeVisibleLayout，也不加载无关数据。
- 取消设置预览恢复打开设置时的桌面滚动上下文；实际视口缩小导致位置不可达时按原生范围钳制。
- 应用窗口布局、导航、插件接口与布局保存格式不属于本轮改造对象。

## Review Focus

1. 空白滚动不抢占应用窗口内滚动，右键与取消选择正常。
2. 悬停回落不改变 reserve，新增/移除最小化项可重新适配宽度。
3. 仅高度变化保留节点坐标和布局脏状态，设置取消恢复滚动上下文。
4. 大尺寸/2 倍放大、关闭放大、减少动态效果和手机断点均能得到有限、正确的预留值。
5. 运行时销毁后没有 Observer、监听或帧继续更新旧节点。

## Task 1: 原生桌面滚动

**Files:** Modify `src/shell/desktop-shell/styles/widgets/shell.css`。

- [x] 在本地 1440×594 页面复现空白处滚轮不改变 scrollTop、组件处可以滚动。
- [x] 将网格滚动容器恢复为 pointer-events:auto，保留内部节点事件与现有右键处理。
- [x] 构建并复测空白滚动、组件滚动、点击取消选择与右键。

## Task 2: 稳定 Dock 几何与桌面度量

**Files:** Create `src/shell/desktop-shell/runtime/desktop/dock-geometry.js`、`dock.js`、`dock-runtime.js`、`scripts/verify-dock-geometry.test.mjs`、`scripts/verify-desktop-viewport.test.mjs`。Modify `window-manager.js`、`surface/grid.js`、`surface/index.js`、`settings-model/preview.js`、`theme-settings.js`、`styles/desktop/dock.css`、`styles/desktop/surface.css`、`styles/widgets/shell.css`、相关设置验证入口。

**Interfaces:**
- `readDockSettings(dataset, { reduceMotion=false }={})`：输出现有 Dock 有效参数和派生尺寸。
- `calculateDockGeometry(settings, { viewportWidth, iconCount, separatorWidths=[], bottomInset=12 })`：输出稳定基础宽度、fitScale、desktopReserve。
- `applyDockAppearance(element, settings)`：应用共享外观 CSS 变量。
- `registerDock(Alpine)`：同步注册 dock Alpine 组件，隔离异步导入生命周期。
- `mountDock(component)`：挂载动画、几何与监听，返回完整清理函数。
- `syncGridMetrics({ normalizeLayout=true, deferVisibility=false })`：允许纯高度更新度量而不重新排列。

- [x] 添加几何、纯高度保留坐标与滚动恢复用例，记录修改前的相关失败。
- [x] 实现共享几何模块、提取 Dock 运行时，接入稳定宽度和派生预留变量。
- [x] 同步设置预览与恢复、桌面容器高度变化、销毁清理。
- [x] 运行定向测试，验证当前配置得到 102px，较大配置保留真实所需空间。
- [x] 检查正常/矮窗口、悬停、最小化宽度变化与手机断点；设置预览取消通过隔离浏览器验证。

## Task 3: 集成验证和交付

- [x] 执行 `pnpm run check`（包含构建）并检查资源引用。
- [x] 执行 `pnpm run verify:reload`。
- [x] 执行 `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`。
- [x] 在当前构建页面复核滚动、Dock 悬停、最小化和坐标保持；设置取消与管理员事件另作隔离浏览器验证。截图及原始验证结果仅存本地 output。
- [x] 更新本文件的执行记录，运行 `git diff --check`，交付已修改/已验证/未验证边界。

## 执行记录

2026-09-30 本地实现与验证完成，保留既有 main 检出改动。验证完成时未暂存、提交、推送或修改站点配置；后续本地提交状态见项目进度。

### 已实现

- 网格滚动壳恢复原生事件命中，增加稳定滚动条槽位。
- Dock 使用基础尺寸计算宽度与桌面 reserve；压缩后的鼠标距离换算到局部坐标，避免窄屏多图标悬停溢出。悬停/回落不更新 reserve。
- 高度变化只更新网格度量；宽度变化沿用既有响应式排列。
- 设置取消恢复桌面滚动位置；新预览、重新打开、组件销毁会取消过期恢复帧。
- 新监听、Observer、帧和异步挂载均有销毁保护。

### 验证证据

- `pnpm run check`：通过。架构检查 224 模块，新 Dock/桌面度量测试 20/20，设置预览测试 9/9，以及其余现有合同、构建和 smoke 均通过。
- 构建：`0.9.46 / e66d1a843400`。构建后静态 Shell JS gzip 147629 bytes，限制 148480；CSS gzip 65091 bytes，限制 65536。预算未调整。这些是压缩源码检查，不能代表真实网络或 Web Vitals。
- `pnpm run verify:reload`：通过，13 个页面返回 200，协议与插件标识检查通过。
- `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`：最终 24 场景通过，无失败；包含 23 个正常 200 与 1 个预期 404 场景。
- 首轮冒烟番剧页 HTTP 500：Halo 日志显示请求 Bilibili 接口时 `Connection prematurely closed BEFORE response`。随后只读请求恢复 200，完整冒烟重跑通过；未修改插件或服务配置。
- 真实页面 1440×594：空白处 wheel `scrollTop 0→180`；18 个节点坐标与修复前完全一致；reserve 102px，玻璃上方间距 24px。悬停图标 46→64px、回落 64→46px，reserve/桌面底边/滚动位置保持。
- 真实页面 1440×900：高度变化后 18 个节点坐标保持，玻璃上方仍为 24px。
- 真实文章窗口：窗口内 wheel 将窗口 scrollTop 0→150，桌面保持 0。最小化使 Dock 4→5 图标并新增分隔线，宽度 240→317px；恢复/关闭后返回 4 图标、240px。
- 真实页面 390×844：最终 Dock 宽度 240px、左右边界 75/315px，底边距 10px，reserve 100px；无横向溢出。仅验证模拟视口，未作真实设备触摸验收。
- 隔离 Chromium：4/8/12 图标 × gap 12/2、64px、padding 16、2倍放大，共 6 组；全图标中心悬停与双向连续扫描均无溢出，q/reserve 保持，无 pageerror。异步导入延迟 300ms 并提前销毁时，旧组件未挂载或写入。
- 隔离 Chromium 管理场景：真实桌面处理器的空白右键打开菜单，空白点击清选择；真实设置 factory 与 Dock runtime 的预览取消将 scrollTop 50→230，并保持编辑坐标 (3,4)。权限和缺席 UI 方法由 fixture 提供，计算/恢复函数没有 mock。
- `git diff --check`：通过。

### 验收边界与本地证据

真实站点当前为匿名会话。管理员完整 Alpine 模板下的设置预览取消、选择/拖拽 UI 未作登录态验收；隔离浏览器和定向测试覆盖了本轮相关处理器与恢复逻辑。

证据目录：`output/dock-spacing-2026-09-30/`（已忽略，未加入提交）。其中 `before.png` / `after.png` / `mobile.png`、最终 check/reload/smoke 日志、最终 `smoke-report.json`、`desktop-scroll-fixture.mjs`。窄屏几何 fixture 位于 `output/playwright/dock-fit-probe.mjs`。
