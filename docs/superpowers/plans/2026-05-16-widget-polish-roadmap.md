# Desktop Widgets Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面小组件从“能添加”推进到“可配置、可预览、可回溯扩展”，并优先增强瞬间、朋友圈、Docsme 等和当前主题主线最贴合的小组件。

**Architecture:** 小组件仍保持 `src/widgets/*` 为内容边界，桌面编辑器只负责配置、预览、布局和保存。每个 widget 通过 manifest 声明尺寸、外观和配置 schema，实例配置继续写入 `default_layout.layout_json.instances[].meta`。插件数据只通过已确认契约或明确的前端 fetch 边界进入 widget，不把页面私有 DOM 直接耦合进渲染器。

**Tech Stack:** Halo Thymeleaf templates, Alpine runtime, Vite ESM, `src/widgets` lazy renderers, `pnpm` scripts, main branch only.

---

## Commit Policy

每个任务结束后独立提交，便于回溯和回滚。提交顺序建议如下：

1. `feat(widgets): add configurable widget schema`
2. `feat(widgets): configure core widget instances`
3. `fix(widgets): refine widget center feedback`
4. `feat(widgets): upgrade moments widget`
5. `feat(widgets): add friends widget`
6. `feat(widgets): add docs quick widget`
7. `docs(widgets): update widget roadmap and usage`

约束：

- 只在 `main` 分支提交。
- 只使用 `pnpm`。
- 单个 commit 不混入无关插件或页面改动。
- 模板或 YAML 改动后执行 `pnpm run verify:reload`。
- 前端交互、小组件运行时或 PJAX 改动后执行 `pnpm run typecheck`、`pnpm run build-only`、`SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright`。

---

## File Map

### Widget Core

- Modify: `src/widgets/registry.js`
  - 注册新增 widget manifest。
- Modify: `src/widgets/loaders.js`
  - 注册新增 widget renderer lazy loader。
- Modify: `src/shell/desktop-shell/runtime/widgets/catalog-core.js`
  - 让 catalog 暴露 `configSchema`、`configDefaults`、`hasConfig`。
- Modify: `src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js`
  - 把当前图库专用配置弹窗升级为通用配置 schema 入口。
- Modify: `templates/modules/shell/desktop-widgets.html`
  - 把配置弹窗从图库专用 UI 扩展为 schema-driven UI。
- Modify: `src/shell/desktop-shell/styles/widgets/editor.css`
  - 配置弹窗、预览、保存反馈样式。

### Existing Widget Renderers

- Modify: `src/widgets/system/weather/manifest.js`
- Modify: `src/widgets/system/weather/render.js`
- Modify: `src/shell/desktop-shell/runtime/widgets/weather-runtime.js`
- Modify: `src/widgets/halo/latest-posts/manifest.js`
- Modify: `src/widgets/halo/latest-posts/render.js`
- Modify: `src/widgets/halo/popular-posts/manifest.js`
- Modify: `src/widgets/halo/popular-posts/render.js`
- Modify: `src/widgets/plugin/moments-recent/manifest.js`
- Modify: `src/widgets/plugin/moments-recent/render.js`

### New Plugin Widgets

- Create: `src/widgets/plugin/friends-recent/manifest.js`
- Create: `src/widgets/plugin/friends-recent/render.js`
- Create: `src/widgets/plugin/docsme-quick/manifest.js`
- Create: `src/widgets/plugin/docsme-quick/render.js`
- Modify: `templates/modules/shell/desktop-widgets.html`
  - 增加 `friendsAvailable`、`docsmeAvailable`、必要 source 字段。
- Modify: `templates/modules/shell/layout.html`
  - 向 desktop widgets fragment 传入插件可用性与必要 URL。

### Docs

- Modify: `docs/桌面小组件.md`
- Modify: `docs/项目进度.md`
- Optional: `README.md`
  - 只有当小组件能力完成可见阶段性跃迁时再同步。

---

## Task 1: Generic Widget Config Schema

**Goal:** 把当前硬编码的图库配置弹窗抽成通用配置能力，同时保持 `plugin-photos.gallery` 行为不变。

**Files:**

- Modify: `src/shell/desktop-shell/runtime/widgets/catalog-core.js`
- Modify: `src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js`
- Modify: `templates/modules/shell/desktop-widgets.html`
- Modify: `src/shell/desktop-shell/styles/widgets/editor.css`
- Modify: `src/widgets/plugin/photos/manifest.js`

Steps:

- [ ] Add `configSchema` and `configDefaults` to widget manifest normalization.

Expected catalog shape:

```js
{
  widgetId: 'plugin-photos.gallery',
  hasConfig: true,
  configSchema: [
    {
      key: 'groupName',
      type: 'photo-group',
      label: '显示精选集',
      required: true
    }
  ],
  configDefaults: {}
}
```

- [ ] Keep `meta` persistence unchanged.

Validation target:

```json
{
  "widget": "plugin-photos.gallery",
  "meta": {
    "groupName": "album-name"
  }
}
```

- [ ] Replace `openWidgetConfigForm()` hardcoded photo logic with schema-driven initialization.

Behavior:

- `photo-group` field defaults to the first `sources.photoGroups[0].metadata.name`.
- Non-config widgets continue to call `_doAddWidget(widgetType, size, catalogKey, {})`.
- Config modal title uses current widget title, not fixed “配置图库组件”.

- [ ] Update template modal to render fields by schema.

Supported field types for this task:

- `photo-group`
- `select`
- `number`
- `toggle`

- [ ] Verify existing Photos widget config still works.

Run:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

- [ ] Commit.

```bash
git add src/shell/desktop-shell/runtime/widgets/catalog-core.js \
  src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js \
  templates/modules/shell/desktop-widgets.html \
  src/shell/desktop-shell/styles/widgets/editor.css \
  src/widgets/plugin/photos/manifest.js
git commit -m "feat(widgets): add configurable widget schema"
```

---

## Task 2: Configurable Core Widgets

**Goal:** 给已有高价值小组件接入实例级配置，不新增新 widget。

**Files:**

- Modify: `src/widgets/system/weather/manifest.js`
- Modify: `src/widgets/system/weather/render.js`
- Modify: `src/shell/desktop-shell/runtime/widgets/weather-runtime.js`
- Modify: `src/widgets/halo/latest-posts/manifest.js`
- Modify: `src/widgets/halo/latest-posts/render.js`
- Modify: `src/widgets/halo/popular-posts/manifest.js`
- Modify: `src/widgets/halo/popular-posts/render.js`
- Modify: `src/widgets/plugin/moments-recent/manifest.js`
- Modify: `src/widgets/plugin/moments-recent/render.js`

Widget config targets:

| Widget | Meta | Behavior |
| --- | --- | --- |
| `system.weather` | `cityName`, `refreshMinutes` | 优先使用实例配置，回退后台全局天气配置 |
| `halo.latest_posts` | `limit`, `showSummary`, `categoryName` | 限制数量，可按分类过滤 |
| `halo.popular_posts` | `limit`, `showSummary` | 限制数量，保留现有热度排序 |
| `plugin-moments.recent` | `limit`, `showMedia` | 控制显示条数和媒体预览 |

Steps:

- [ ] Add config schema to each manifest.

Example:

```js
configSchema: [
  { key: 'limit', type: 'number', label: '显示数量', min: 1, max: 8, step: 1, defaultValue: 4 },
  { key: 'showSummary', type: 'toggle', label: '显示摘要', defaultValue: true }
],
configDefaults: {
  limit: 4,
  showSummary: true
}
```

- [ ] Renderers must sanitize `meta`.

Rules:

- `limit` must clamp to a safe range.
- Missing booleans use default values.
- Unknown category means no category filter.
- Empty results use the existing `.desktop-widget-empty` style.

- [ ] Weather runtime supports per-instance city without breaking existing global state.

Implementation direction:

- Keep global weather as fallback.
- Add cache keyed by normalized city name.
- If `widget.meta.cityName` exists, fetch/cache that city separately.

- [ ] Verify configured instances survive save and reload.

Run:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

- [ ] Commit.

```bash
git add src/widgets/system/weather/manifest.js \
  src/widgets/system/weather/render.js \
  src/shell/desktop-shell/runtime/widgets/weather-runtime.js \
  src/widgets/halo/latest-posts/manifest.js \
  src/widgets/halo/latest-posts/render.js \
  src/widgets/halo/popular-posts/manifest.js \
  src/widgets/halo/popular-posts/render.js \
  src/widgets/plugin/moments-recent/manifest.js \
  src/widgets/plugin/moments-recent/render.js
git commit -m "feat(widgets): configure core widget instances"
```

---

## Task 3: Widget Center Feedback And Preview Polish

**Goal:** 让组件中心更像 macOS 小组件面板：状态清晰、预览可靠、保存反馈明确。

**Files:**

- Modify: `templates/modules/shell/desktop-widgets.html`
- Modify: `src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js`
- Modify: `src/shell/desktop-shell/runtime/desktop/surface/index.js`
- Modify: `src/shell/desktop-shell/styles/widgets/center.css`
- Modify: `src/shell/desktop-shell/styles/widgets/editor.css`

Steps:

- [ ] Add “已添加 N 个” badge to catalog entries.

Current method exists:

```js
countVisibleWidgetsByType(widgetType)
```

Use it in catalog cards and keep `catalogStatusText(entry)` as secondary copy.

- [ ] Add config preview before adding configured widgets.

Behavior:

- Config modal shows widget preview with current `meta`.
- Preview uses existing renderer in preview mode.
- Config modal does not place widget until submit.

- [ ] Improve save feedback.

States:

- `保存中...`
- `已保存`
- `保存失败，请检查登录状态或后台权限`

Keep failure non-destructive: do not exit edit mode on failed save.

- [ ] Add “推荐布局” action but do not auto-save.

Recommended layout rules:

- Adds clock, calendar, weather, latest posts, site stats.
- Adds Photos/Moments only if plugin source is available.
- Marks layout as local dirty until user saves.

- [ ] Verify editor does not break desktop icon editing.

Run:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

- [ ] Commit.

```bash
git add templates/modules/shell/desktop-widgets.html \
  src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js \
  src/shell/desktop-shell/runtime/desktop/surface/index.js \
  src/shell/desktop-shell/styles/widgets/center.css \
  src/shell/desktop-shell/styles/widgets/editor.css
git commit -m "fix(widgets): refine widget center feedback"
```

---

## Task 4: Moments Widget Upgrade

**Goal:** 让瞬间小组件更接近朋友圈/照片回忆卡片，同时不提前加载全部评论。

**Files:**

- Modify: `src/widgets/plugin/moments-recent/manifest.js`
- Modify: `src/widgets/plugin/moments-recent/render.js`
- Modify: `src/widgets/shared/moments.js`
- Modify: `src/shell/desktop-shell/styles/widgets/content/moments.css`
- Modify: `docs/功能/瞬间.md`
- Modify: `docs/桌面小组件.md`

Steps:

- [ ] Add supported sizes.

Manifest:

```js
supportedSizes: ['small', 'medium', 'large']
```

- [ ] Render size-specific layouts.

Rules:

- `small`: 最新一条，纯文本优先，弱化统计。
- `medium`: 最新一条大卡，有媒体时显示一张图。
- `large`: 最新一条 + 后续两条列表，媒体优先。

- [ ] Click behavior.

Rules:

- If item has `metadata.name`, link to `/moments/{name}` with PJAX.
- If no item, link to `/moments`.
- Preview mode disables navigation.

- [ ] Stats behavior.

Rules:

- 显示点赞数。
- 评论数弱化或不显示，和当前 Moments UI 口径一致。

- [ ] Verify.

Run:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

- [ ] Commit.

```bash
git add src/widgets/plugin/moments-recent/manifest.js \
  src/widgets/plugin/moments-recent/render.js \
  src/widgets/shared/moments.js \
  src/shell/desktop-shell/styles/widgets/content/moments.css \
  docs/功能/瞬间.md \
  docs/桌面小组件.md
git commit -m "feat(widgets): upgrade moments widget"
```

---

## Task 5: Friends Recent Widget

**Goal:** 新增朋友圈小组件，展示最新友链动态入口。

**Files:**

- Create: `src/widgets/plugin/friends-recent/manifest.js`
- Create: `src/widgets/plugin/friends-recent/render.js`
- Modify: `src/widgets/registry.js`
- Modify: `src/widgets/loaders.js`
- Modify: `templates/modules/shell/layout.html`
- Modify: `templates/modules/shell/desktop-widgets.html`
- Modify: `src/shell/desktop-shell/styles/widgets/content/index.css`
- Create: `src/shell/desktop-shell/styles/widgets/content/friends.css`
- Modify: `docs/桌面小组件.md`
- Modify: `docs/插件适配状态.md`

Data boundary:

- Prefer theme-provided source if available.
- If no reliable server-side model exists on home, use a narrow client fetch of `/friends` HTML only after desktop is visible.
- Do not couple renderer to `.friends-*` page private DOM; parse a small normalized source list before rendering.

Manifest:

```js
export const pluginFriendsRecentWidgetManifest = {
  widgetId: 'plugin-friends.recent',
  title: '朋友圈',
  kicker: '朋友圈',
  defaultSize: 'medium',
  supportedSizes: ['medium', 'large'],
  category: 'plugin',
  description: '最新友链动态',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible'
};
```

Renderer behavior:

- `medium`: 最新 2-3 条。
- `large`: 最新 4-5 条 + 来源站点。
- 点击卡片进入原文章外链；底部入口进入 `/friends`。
- 没安装或无数据时显示清晰空态。

Verify:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

Commit:

```bash
git add src/widgets/plugin/friends-recent \
  src/widgets/registry.js \
  src/widgets/loaders.js \
  templates/modules/shell/layout.html \
  templates/modules/shell/desktop-widgets.html \
  src/shell/desktop-shell/styles/widgets/content/index.css \
  src/shell/desktop-shell/styles/widgets/content/friends.css \
  docs/桌面小组件.md \
  docs/插件适配状态.md
git commit -m "feat(widgets): add friends widget"
```

---

## Task 6: Docsme Quick Widget

**Goal:** 新增 Docsme 快捷入口小组件，先做稳定入口，不做复杂文档索引。

**Files:**

- Create: `src/widgets/plugin/docsme-quick/manifest.js`
- Create: `src/widgets/plugin/docsme-quick/render.js`
- Modify: `src/widgets/registry.js`
- Modify: `src/widgets/loaders.js`
- Modify: `templates/modules/shell/layout.html`
- Modify: `templates/modules/shell/desktop-widgets.html`
- Create: `src/shell/desktop-shell/styles/widgets/content/docsme.css`
- Modify: `src/shell/desktop-shell/styles/widgets/content/index.css`
- Modify: `docs/桌面小组件.md`

Scope:

- Do not fetch private Docsme document data.
- Use `/docs` as primary entry.
- If source projects are available in home protocol later, progressively show project count.

Manifest:

```js
export const pluginDocsmeQuickWidgetManifest = {
  widgetId: 'plugin-docsme.quick',
  title: '文档',
  kicker: 'Docsme',
  defaultSize: 'small',
  supportedSizes: ['small', 'medium'],
  category: 'plugin',
  description: '文档中心快捷入口',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'static',
  loadWhen: 'desktop-visible'
};
```

Renderer behavior:

- `small`: 图标 + 文档中心。
- `medium`: 文档中心 + 简短说明 + 打开按钮。
- 插件未安装时不出现在组件中心。

Verify:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

Commit:

```bash
git add src/widgets/plugin/docsme-quick \
  src/widgets/registry.js \
  src/widgets/loaders.js \
  templates/modules/shell/layout.html \
  templates/modules/shell/desktop-widgets.html \
  src/shell/desktop-shell/styles/widgets/content/docsme.css \
  src/shell/desktop-shell/styles/widgets/content/index.css \
  docs/桌面小组件.md
git commit -m "feat(widgets): add docs quick widget"
```

---

## Task 7: Documentation And Final Verification

**Goal:** 把小组件能力、配置方式、后续增强边界写清楚，并做最终回归。

**Files:**

- Modify: `docs/桌面小组件.md`
- Modify: `docs/项目进度.md`
- Optional: `README.md`

Steps:

- [ ] Update widget inventory.

Document:

- 系统：时间、日历、天气
- Halo：最新文章、热门文章、分类、作者卡片、站点统计、随机标签
- 插件：瞬间、图库、朋友圈、Docsme

- [ ] Update configuration guide.

Document:

- 哪些 widget 支持实例配置。
- `meta` 保存在哪里。
- 后台全局设置和实例配置的优先级。

- [ ] Update remaining roadmap.

Keep future items:

- 追番小组件
- Steam 小组件
- Equipment 随机装备小组件
- Douban 页面完成后再评估 Douban 小组件

- [ ] Final verification.

Run:

```bash
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
git status --short
```

- [ ] Commit.

```bash
git add docs/桌面小组件.md docs/项目进度.md README.md
git commit -m "docs(widgets): update widget roadmap and usage"
```

---

## Release Readiness Checklist

- [ ] 每个任务都有独立 commit。
- [ ] 没有功能分支或 worktree。
- [ ] 没有 npm 命令或 npm 产物。
- [ ] `default_layout.layout_json` 仍能保存和回读 `meta`。
- [ ] 已安装插件缺失时，对应 plugin widget 不破坏组件中心。
- [ ] 移动端按现有 `hide_on_mobile` 规则工作。
- [ ] 无权限用户不能保存默认布局。
- [ ] `pnpm run verify:reload` 通过。
- [ ] Playwright smoke 通过。

