# Settings Completion Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for integration and independent delegated tasks for Dock, colors and app navigation. Steps use checkbox (`- [x]`) syntax.

**Goal:** 完成用户六项设置要求，并保留配置、权限、草稿和桌面预留空间。

**Architecture:** Halo `settings.yaml` 与前端注册表使用相同字段。页面归属调整不重命名已保存字段；应用子页面只改变导航状态，继续共享同一草稿和保存入口。Dock 内置设置按钮复用 `requestOpen()`。

**Tech Stack:** Halo Thymeleaf / Alpine / Tailwind 4 / existing theme CSS / pnpm / Node 24.

**Spec:** 本文件以下六项需求对应用户截图与本轮“开始补全”授权。

**交付补充：**实施与验收完成后，用户于本会话授权“提交git”。原实施阶段的 Git 写入限制由该授权更新为本地选择性暂存、提交已验收改动；不包含推送、标签或发布。

## Global Constraints

- 只使用当前 main；禁止分支、worktree、暂存、提交、推送、标签。
- 不修改 Halo Core、正式主题配置、账号、数据库或原有未提交文档。
- 六项需求：Dock 系统设置入口及后台开关；参考图1的图标和上方名称；外观移除墙纸跳转；桌面与Dock改标题Dock并迁出布局；菜单背景颜色透明度选择器；桌面管理归小组件；应用按图4入口列表与详情两层。
- 新字段 `dock.appearance.settings_enabled: boolean = true`；既有字段与插件数据路径保持兼容。
- 保留全部应用已有字段和未启用插件的预配置能力。
- 使用现有设计系统，无新增依赖；真实图标资源或已安装图标库，不手绘图标。
- 在 .superpowers/sdd/2026-09-30-settings-completion/ 保存修改前快照、执行证据及验收报告。

## Review Focus

- 关闭放大或启用 reduced-motion 后，悬停和键盘名称仍可见。
- Dock开关取消后恢复按钮和几何；设置按钮不绕过权限。
- 颜色保留旧HEX/RGBA透明度、零值；取消恢复背景及前景；预览与菜单一致。
- 应用返回、搜索跳转和切换侧栏保留草稿及各详情滚动；聚焦隐藏字段前先进入详情。
- 桌面布局独立保存，入口迁移后保留未保存/刷新/权限保护。

### Task 1: Dock / delegated

**Files:** `settings.yaml`, `templates/modules/shell/layout.html`, `src/shell/desktop-shell/styles/desktop/dock.css`, `src/shell/desktop-shell/runtime/desktop/dock-runtime.js`, Dock tests and a settings icon asset if needed.

**Interfaces:** Consumes `dock.appearance.settings_enabled`; produces `.dock-container[data-settings-enabled]` and a button calling `$store.themeSettings.requestOpen()`. Root registers the field and previews the dataset. Use actual visible icons in geometry; do not destabilize viewport reserve during hover.

- [x] Reproduce label behavior with magnification disabled/reduced-motion and changing enabled entry.
- [x] Add the backend flag, settings icon button, unclipped tooltip/dot and focus behavior.
- [x] Run Dock regression and retain RED/GREEN evidence.

### Task 2: Colors / delegated

**Files:** new `settings-model/color-controls.js`, `settings/menu-control.html`, `theme-settings-controls.css`, `menubar.css`, `settings-model/preview.js`, color tests.

**Interfaces:** Export `createSettingsColorMethods()`; store methods `colorParts(path)`, `updateColorHex(path, hex)`, `updateColorOpacity(path, percentage)`. Root mixes these into theme settings. Persist only existing `header.dropdown.light_bg` / `dark_bg`. Agent may derive runtime foreground properties; root adds Dock dataset preview after this task finishes.

- [x] Test alpha preservation, short/full HEX, percentage RGBA, zero opacity and invalid input without losing draft.
- [x] Implement color swatch/HEX and opacity controls, direct background values and readable foreground.
- [x] Run color/preview regression with RED/GREEN evidence.

### Task 3: App navigation / delegated

**Files:** `settings/apps.html`, `settings-model/panels.js`, `theme-settings.js`, `theme-settings-panes.css`, app navigation tests.

**Interfaces:** `activeApp` is null for list, or one of field app IDs. `openApp(id)`, `paneLabel()`, `backPane()`, `focusSetting(path)` preserve existing store API; every app field retains pane `apps`. Sidebar Apps remains active in detail. Include resource-loading changes: Dock pane loads menus; Widgets pane loads desktop content. Root preserves internal pane id `desktop-dock` but changes its visible label to Dock.

- [x] Test app back/search/scroll and drafts with real panel/store methods.
- [x] Implement five rows then application detail using existing controls and global footer.
- [x] Run navigation and lifecycle tests with RED/GREEN evidence.

### Task 4: Information structure / root

**Files:** `settings-model/schema.js`, `settings/appearance.html`, `settings/desktop-dock.html`, `settings/widgets.html`, `settings/navigation.html`, existing schema contract tests.

- [x] Register backend toggle; retain internal pane id and old persisted paths.
- [x] Rename visible Dock label; move desktop five fields and editor to Widgets desktop-management section.
- [x] Move Dock menu selector into Dock; remove only appearance wallpaper shortcut.
- [x] Integrate colors factory and Dock preview; run all settings tests.

### Task 5: Acceptance / root

- [x] Review complete diff independently and fix material findings.
- [x] Run `pnpm run check`, `pnpm run verify:reload`, `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`.
- [x] Use native browser to check live Dock, menu, anonymous permissions and served asset freshness.
- [x] Verify settings with controlled fixtures that block real writes; distinguish fixture proof from real authenticated persistence.
- [x] Compare reference screenshots and desktop/mobile application views; save report and evidence.
- [x] Report implemented, verified and remaining acceptance boundaries; keep all changes uncommitted.
