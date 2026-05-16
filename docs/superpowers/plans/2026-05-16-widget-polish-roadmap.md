# Desktop Widgets Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面小组件从“能添加”推进到“可配置、可预览、可回溯扩展”，并引入身份状态型小组件，把作者、Steam、瞬间、文章和图库状态组合成更有个人桌面感的内容入口。

**Architecture:** 小组件仍保持 `src/widgets/*` 为内容边界，桌面编辑器只负责配置、预览、布局和保存。每个 widget 通过 manifest 声明尺寸、外观和配置 schema，实例配置继续写入 `default_layout.layout_json.instances[].meta`。插件数据只通过已确认契约或明确的前端 fetch 边界进入 widget，不把页面私有 DOM 直接耦合进渲染器；身份状态卡片使用统一的 presence resolver 汇总真实数据，不伪造在线、正在游玩或最近活动。

**Tech Stack:** Halo Thymeleaf templates, Alpine runtime, Vite ESM, `src/widgets` lazy renderers, `pnpm` scripts, main branch only.

---

## Commit Policy

每个任务结束后独立提交，便于回溯和回滚。提交顺序建议如下：

1. `test(widgets): lock widget config schema contract`
2. `feat(widgets): add configurable widget schema`
3. `feat(widgets): configure core widget instances`
4. `fix(widgets): refine widget center feedback`
5. `feat(widgets): add identity presence widget`
6. `feat(widgets): upgrade moments widget`
7. `feat(widgets): add friends widget`
8. `feat(widgets): add docs quick widget`
9. `docs(widgets): update widget roadmap and usage`

约束：

- 只在 `main` 分支提交。
- 只使用 `pnpm`。
- 单个 commit 不混入无关插件或页面改动。
- `git status --short` 若出现本任务无关改动，必须保留并跳过，不纳入本任务 commit。
- `Task 1` 必须拆成 contract commit 和 implementation commit，先锁住现有图库配置行为再改编辑器。
- 模板或 YAML 改动后执行 `pnpm run verify:reload`。
- 前端交互、小组件运行时或 PJAX 改动后执行 `pnpm run typecheck`、`pnpm run build-only`、`SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright`。

Hard gates:

- Gate A: 不允许跳过 `Task 1A`。通用配置 schema 没有 contract verifier 时，不进入 `Task 1B`。
- Gate B: `plugin-photos.gallery` 配置弹窗、`meta.groupName` 保存、默认布局保存任一回归，停止后续任务。
- Gate C: `halo.identity_card` 只能在 `Task 1` 和 `Task 2` 全绿后开始。
- Gate D: Friends / Docsme 没有可靠数据 source 时，只做入口和空态，不临时解析私有页面结构冒充“最新动态”。
- Gate E: 任何一步发现旧桌面编辑能力、图库小组件、PJAX 或默认布局保存异常，先修回归，不继续加新 widget。

Stop and rollback rules:

- 如果 `pnpm run verify:reload` 失败，先确认是否模板/YAML 改动导致；不要继续提交后续任务。
- 如果 Playwright smoke 失败在桌面编辑、widget center、`/photos` 或 `/moments`，本任务不得合并到后续功能 commit。
- 如果新脚本失败，先修脚本对应的契约问题；不能删掉脚本绕过。
- 如果只是本地 Halo 插件缺失导致可选页 404，按现有 verify 标准记录跳过，不视为失败。

---

## Risk Closure Matrix

| Risk | Failure mode | Guardrail | Verification |
| --- | --- | --- | --- |
| 通用配置 schema 破坏图库 | 图库弹窗打不开、不能选择相册、`meta.groupName` 丢失 | 先做 `scripts/verify-widgets-config-schema.mjs`，再改 UI | `node scripts/verify-widgets-config-schema.mjs` + smoke |
| 默认布局保存回归 | 保存后 reload 丢失 `meta` 或位置 | `serializeWidgetInstance()` 不改变协议，只追加 schema 元数据 | `pnpm run verify:reload` + 保存/回读 smoke |
| 预览触发跳转 | widget center preview 点击后 PJAX 导航 | preview mode 统一禁用 `buildWidgetPjaxLink()` | Playwright 点击预览，URL 不变 |
| Steam 状态伪造 | 最近玩过显示成正在游戏 | `resolveIdentityPresence()` 禁止读取 `steamRecentGames` 判断 playing | `node scripts/verify-widgets-presence.mjs` |
| 时间字段不稳定 | Moments/Posts 状态优先级误判 | 只接受可解析时间，超窗跳过，缺字段回落默认态 | presence acceptance table |
| 视觉不统一 | 身份卡像 Steam 页面或营销卡片 | 只用 widget token、局部 token、固定尺寸和 macOS 小组件密度 | Visual Quality Gate |
| 插件缺失破坏组件中心 | 未安装插件时 catalog 报错或空白 | manifest/source gating，renderer 输出明确空态 | smoke 可选插件页 404 不失败 |

## Execution Baseline

每次开始一个任务前先执行：

```bash
git status --short
git branch --show-current
```

Expected:

- 当前分支是 `main`。
- 只允许出现本任务相关文件；如果有无关文件，记录并跳过。

每次改动前记录当前桌面协议锚点：

```bash
rg -n "openWidgetConfigForm|submitWidgetConfigForm|serializeWidgetInstance|meta.groupName|plugin-photos.gallery" \
  src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js \
  src/shell/desktop-shell/runtime/widgets/catalog-core.js \
  src/widgets/plugin/photos/manifest.js \
  templates/modules/shell/desktop-widgets.html
```

Expected:

- 能定位现有图库配置入口。
- 能定位 `serializeWidgetInstance()` 的 `meta` 写回。
- 能定位 `plugin-photos.gallery` manifest。

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
- Create: `scripts/verify-widgets-config-schema.mjs`
  - 锁定 catalog schema、图库默认 meta、序列化回读和 preview 禁止跳转契约。

### Existing Widget Renderers

- Create: `src/widgets/halo/identity-card/manifest.js`
- Create: `src/widgets/halo/identity-card/render.js`
- Create: `src/widgets/shared/presence.js`
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

### Identity Presence Data

- Modify: `templates/modules/shell/desktop-widgets.html`
  - 向 widget protocol 传入 Steam presence、recent game、必要 profile 字段。
- Modify: `templates/modules/shell/layout.html`
  - 判空调用 `steamFinder.getProfile()`、`steamFinder.getStats()`、`steamFinder.getRecentGames(1)`。
- Modify: `src/widgets/shared/data.js`
  - 复用作者资料解析，不把身份卡片重新硬编码一套作者字段。
- Create: `scripts/verify-widgets-presence.mjs`
  - 用固定输入校验身份状态优先级，防止把“最近玩过”错误显示为“正在游戏”。

### Docs

- Modify: `docs/桌面小组件.md`
- Modify: `docs/项目进度.md`
- Optional: `README.md`
  - 只有当小组件能力完成可见阶段性跃迁时再同步。

---

## Task 1A: Widget Config Schema Contract

**Goal:** 先用独立脚本锁住现有图库配置和 `meta` 持久化契约，给后续编辑器重构提供回归防线。

**Files:**

- Create: `scripts/verify-widgets-config-schema.mjs`
- Modify: `src/shell/desktop-shell/runtime/widgets/catalog-core.js`
- Modify: `src/widgets/plugin/photos/manifest.js`

Steps:

- [ ] Add config schema fields to `plugin-photos.gallery` manifest without touching editor UI.

Manifest target:

```js
export const pluginPhotosWidgetManifest = {
  widgetId: 'plugin-photos.gallery',
  title: '图库',
  kicker: '图库',
  defaultSize: 'small',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'plugin',
  description: '展示图库照片精选',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
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
};
```

- [ ] Normalize config fields in `DESKTOP_WIDGET_CATALOG`.

Required catalog fields:

```js
{
  hasConfig: true,
  configSchema: manifest.configSchema || [],
  configDefaults: manifest.configDefaults || {}
}
```

- [ ] Create `scripts/verify-widgets-config-schema.mjs`.

Script content:

```js
import assert from 'node:assert/strict';
import {
  DESKTOP_WIDGET_CATALOG,
  normalizeWidgetInstance,
  serializeWidgetInstance,
  createWidgetInstance
} from '../src/shell/desktop-shell/runtime/widgets/catalog-core.js';

const photosCatalog = DESKTOP_WIDGET_CATALOG['plugin-photos.gallery'];
assert.ok(photosCatalog, 'photos widget catalog exists');
assert.equal(photosCatalog.hasConfig, true, 'photos widget remains configurable');
assert.deepEqual(photosCatalog.configSchema, [
  {
    key: 'groupName',
    type: 'photo-group',
    label: '显示精选集',
    required: true
  }
], 'photos config schema is normalized');
assert.deepEqual(photosCatalog.configDefaults, {}, 'photos config defaults are normalized');

const instance = createWidgetInstance('plugin-photos.gallery', {
  key: 'photos-test',
  size: 'medium',
  appearance: 'dark',
  x: 2,
  y: 3,
  meta: { groupName: 'album-a' }
});

const serialized = serializeWidgetInstance(instance);
assert.deepEqual(serialized.meta, { groupName: 'album-a' }, 'meta survives serialization');

const normalized = normalizeWidgetInstance(serialized);
assert.deepEqual(normalized.meta, { groupName: 'album-a' }, 'meta survives normalization');
assert.equal(normalized.size, 'medium', 'size survives normalization');
assert.equal(normalized.appearance, 'dark', 'appearance survives normalization');

console.log('widget config schema contract passed');
```

- [ ] Run contract verification.

Run:

```bash
node scripts/verify-widgets-config-schema.mjs
pnpm run typecheck
pnpm run build-only
```

Expected:

- `widget config schema contract passed`
- typecheck and build pass.

- [ ] Commit.

```bash
git add scripts/verify-widgets-config-schema.mjs \
  src/shell/desktop-shell/runtime/widgets/catalog-core.js \
  src/widgets/plugin/photos/manifest.js
git commit -m "test(widgets): lock widget config schema contract"
```

---

## Task 1B: Generic Widget Config Schema UI

**Goal:** 把当前硬编码的图库配置弹窗抽成通用配置能力，同时保持 `plugin-photos.gallery` 行为不变。

**Files:**

- Modify: `src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js`
- Modify: `templates/modules/shell/desktop-widgets.html`
- Modify: `src/shell/desktop-shell/styles/widgets/editor.css`

Steps:

- [ ] Add schema-driven form state to `openWidgetConfigForm()`.

Required form shape:

```js
{
  open: true,
  widgetId: 'plugin-photos.gallery',
  widgetType: 'plugin-photos.gallery',
  size: 'small',
  catalogKey: 'plugin-photos.gallery:small',
  configSchema: [
    {
      key: 'groupName',
      type: 'photo-group',
      label: '显示精选集',
      required: true
    }
  ],
  meta: { groupName: 'album-name' },
  previewWidget: {}
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
- `photo-group` field remains required; submit button is disabled until a group exists and `meta.groupName` is non-empty.
- Non-config widgets continue to call `_doAddWidget(widgetType, size, catalogKey, {})`.
- Config modal title uses current widget title, not fixed “配置图库组件”.
- `previewWidget` is built with `createWidgetInstance(widgetType, { size, appearance, meta })`.
- Preview mode must pass `mode: 'preview'` into the widget renderer so links cannot navigate.

- [ ] Update template modal to render fields by schema.

Supported field types for this task:

- `photo-group`
- `select`
- `number`
- `toggle`

- [ ] Add a preview area to the config modal.

Rules:

- Preview updates when `widgetConfigForm.meta` changes.
- Preview root has `aria-label="组件预览"` and never writes into `this.widgets`.
- Clicking preview links must not change `window.location.href`.

- [ ] Verify existing Photos widget config still works.

Run:

```bash
node scripts/verify-widgets-config-schema.mjs
pnpm run typecheck
pnpm run build-only
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

Manual smoke:

- Open desktop edit mode.
- Add `plugin-photos.gallery`.
- Select a photo group.
- Confirm widget appears on desktop.
- Save default layout.
- Reload home.
- Confirm the widget still points to the same group and no duplicate config modal remains open.

- [ ] Commit.

```bash
git add src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js \
  templates/modules/shell/desktop-widgets.html \
  src/shell/desktop-shell/styles/widgets/editor.css
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

## Task 4: Identity Presence Widget

**Goal:** 新增身份状态型小组件，参考 sky-blog-1 侧边栏 Steam 状态卡片思路，把作者卡片升级成能根据真实数据切换状态的桌面名片。

**Files:**

- Create: `src/widgets/halo/identity-card/manifest.js`
- Create: `src/widgets/halo/identity-card/render.js`
- Create: `src/widgets/shared/presence.js`
- Create: `scripts/verify-widgets-presence.mjs`
- Modify: `src/widgets/registry.js`
- Modify: `src/widgets/loaders.js`
- Modify: `templates/modules/shell/layout.html`
- Modify: `templates/modules/shell/desktop-widgets.html`
- Create: `src/shell/desktop-shell/styles/widgets/content/identity-card.css`
- Modify: `src/shell/desktop-shell/styles/widgets/content/index.css`
- Modify: `docs/桌面小组件.md`
- Modify: `docs/功能/Steam.md`

Design principle:

- 这是身份状态卡，不是单独 Steam 小组件。
- 默认显示作者身份；当有真实活动时，自动切换主状态。
- 状态判断只来自主题已有数据或已确认插件契约，不根据最近游玩列表伪造“正在玩”。

Presence priority:

| Priority | Condition | Primary text | Link |
| --- | --- | --- | --- |
| 1 | `sources.steamProfile.playing === true` | `正在游戏` 或插件 `statusText` | `/steam` |
| 2 | 最近 Moments 在 48 小时内 | `刚刚更新瞬间` | `/moments/{name}` |
| 3 | 最新文章在 7 天内 | `最近写了文章` | 最新文章 |
| 4 | Photos 有可用照片 | `最近整理图库` | `/photos` |
| 5 | 无活动 | 作者简介 | 作者页 |

Steam boundary:

- Can show `profile.statusText` when available.
- Can show `正在游戏` when `profile.playing === true`.
- Can show current game name only if the plugin profile summary exposes a dedicated current game field.
- Must not use `steamFinder.getRecentGames(1)` as “正在玩”; recent games only means “最近玩过”.

Explicitly not doing in v1:

- 不做独立 Steam 小组件；`halo.identity_card` 只提供身份/状态入口。
- 不做 websocket、长轮询或在线状态实时刷新；桌面可见时读取一次 source，后续遵循现有 widget cache 策略。
- 不从 `steamRecentGames` 推断当前游戏名；最近游玩只能作为弱信息显示在详情文案里。
- 不引入新的复杂后台设置；v1 只使用 widget instance `meta` 中的四个开关。
- 不假设 Docsme、Friends 或 Photos 有私有接口；未确认的数据只做入口或空态。
- 不替换现有 `halo.author_card`；身份状态卡是增强入口，旧作者卡继续保留。

Source contract:

| Source | Required fields | Optional fields | Fallback |
| --- | --- | --- | --- |
| Author | `siteProfile.title`, `siteProfile.subtitle`, `siteProfile.logo` or post owner | `owner.permalink` | 显示站点作者 |
| Steam | `steamAvailable`, `steamProfile.playing` | `statusText`, `personaName`, `avatarFull`, `steamLevel`, `currentGameName` | 未安装时跳过 Steam 状态 |
| Moments | `momentsAvailable`, `recentMoments[].metadata.name`, timestamp | `stats.upvote`, media cover | 无时间或超过 48h 时跳过 |
| Posts | `latestPosts[].status.permalink`, timestamp | cover, owner | 无时间或超过 7d 时跳过 |
| Photos | `photosAvailable`, `photoGroups[]` or `photos[]` | cover, count | 仅作为弱活动入口 |

Copywriting rules:

- 主状态只显示一个，不把 Steam、瞬间、文章、图库堆成列表。
- 事件类文案使用短句：`正在游戏`、`刚刚更新瞬间`、`最近写了文章`、`最近整理图库`。
- 默认态使用作者简介，不写“暂无动态”这种负面文案。
- `small` 尺寸最多两行文字；`medium` 最多一个状态胶囊和三个快捷入口；`large` 可以显示一行补充说明和三项指标。
- 外链必须有明确视觉区别；内部链接全部走 `buildWidgetPjaxLink()`。

Size layout contract:

| Size | Grid | Layout | Content budget | Interaction |
| --- | --- | --- | --- | --- |
| `small` | 2×1 or 2×2 by catalog | 头像左侧，姓名和状态右侧 | 头像 40px，姓名 1 行，状态 1 行 | 整卡进入当前 presence `href` |
| `medium` | 4×2 | 左侧 profile，右侧状态胶囊，下方 3 个快捷按钮 | 头像 52px，状态标题 1 行，副标题 1 行 | 状态区进主链接，快捷按钮独立链接 |
| `large` | 4×4 | 顶部状态 hero，中部 profile，底部指标/快捷入口 | hero 高 42%，最多 3 个 metric | hero 进主链接，底部按钮 44px 命中区 |

Visual system:

- 组件 CSS 只使用 widget token 或本文件局部 token，不在 renderer 字符串里写 raw hex。
- 根节点设置 `data-presence-type` 和 `data-presence-accent`，CSS 根据状态切换局部 token。
- 局部 token 名称固定：

```css
.wg-identity {
  --wg-identity-accent: var(--theme-accent, var(--accent, #0a84ff));
  --wg-identity-accent-soft: color-mix(in srgb, var(--wg-identity-accent) 18%, transparent);
  --wg-identity-surface: color-mix(in srgb, var(--widget-card-surface) 86%, transparent);
  --wg-identity-border: var(--widget-card-outline);
}
```

- Steam 状态允许使用局部 `steam` accent，但只写在 CSS token 中，不扩散到其他小组件。
- 图片、头像和 hero 必须有固定 `aspect-ratio` 或明确尺寸，避免桌面布局抖动。
- 卡片内按钮命中区不小于 44px；图标使用 lucide icon class，不使用 emoji。

Motion and accessibility:

- hover/press 只使用 `transform` 和 `opacity`，持续时间 160-260ms。
- 使用 `cubic-bezier(0.2, 0.8, 0.2, 1)`，和现有桌面小组件动效保持一致。
- `@media (prefers-reduced-motion: reduce)` 下取消位移和缩放，仅保留必要 opacity。
- icon-only 快捷按钮必须带 `title` 和 `aria-label`。
- preview mode 输出 `<span>` 或禁用态节点，不允许点击跳转。

Manifest:

```js
export const haloIdentityCardWidgetManifest = {
  widgetId: 'halo.identity_card',
  title: '身份状态',
  kicker: 'Halo',
  defaultSize: 'medium',
  supportedSizes: ['small', 'medium', 'large'],
  category: 'halo',
  description: '作者身份与当前状态',
  appearanceSupport: ['follow', 'light', 'dark'],
  cachePolicy: 'ttl',
  loadWhen: 'desktop-visible',
  hasConfig: true,
  configSchema: [
    { key: 'showSteam', type: 'toggle', label: '显示 Steam 状态', defaultValue: true },
    { key: 'showMoments', type: 'toggle', label: '显示瞬间状态', defaultValue: true },
    { key: 'showPosts', type: 'toggle', label: '显示文章状态', defaultValue: true },
    { key: 'showPhotos', type: 'toggle', label: '显示图库状态', defaultValue: true }
  ],
  configDefaults: {
    showSteam: true,
    showMoments: true,
    showPosts: true,
    showPhotos: true
  }
};
```

Renderer behavior:

- `small`: avatar + name + one-line presence.
- `medium`: avatar/profile + presence capsule + 3 quick actions.
- `large`: cover/status hero + profile + status details + quick metrics.
- Use author avatar/name from `resolveDesktopAuthorProfile(sources)`.
- Use `buildWidgetPjaxLink()` for internal links and disable navigation in preview mode.
- Empty or unavailable plugin data gracefully falls back to the default author profile.

Presence resolver shape:

```js
{
  type: 'steam-playing' | 'moment-recent' | 'post-recent' | 'photos-active' | 'default',
  label: '正在游戏',
  title: 'Steam Player',
  subtitle: '当前在线',
  href: '/steam',
  app: 'steam',
  cover: '',
  accent: 'steam'
}
```

Presence resolver acceptance table:

| Case | Input | Meta | Expected |
| --- | --- | --- | --- |
| Steam 正在玩 | `steamProfile.playing: true`, `statusText: "正在游戏"` | all true | `type: "steam-playing"`, `href: "/steam"` |
| Steam 最近玩过但不在线 | `steamProfile.playing: false`, `steamRecentGames: [{ name: "A" }]` | all true | 不返回 `steam-playing` |
| Moments 24h 内 | `recentMoments[0].metadata.creationTimestamp` 为 `now - 24h` | all true | `type: "moment-recent"` |
| Moments 超 48h | `recentMoments[0].metadata.creationTimestamp` 为 `now - 72h` | all true | 跳过 Moments |
| 文章 3 天内 | `latestPosts[0].metadata.creationTimestamp` 为 `now - 3d` | all true | `type: "post-recent"` |
| 文章超 7 天 | `latestPosts[0].metadata.creationTimestamp` 为 `now - 10d` | all true | 跳过 Posts |
| 图库可用 | `photosAvailable: true`, `photoGroups.length > 0` | all true | `type: "photos-active"` |
| 全部插件缺失 | no plugin sources | all true | `type: "default"` |
| 手动关闭 Steam | `steamProfile.playing: true` | `showSteam: false` | 不返回 `steam-playing` |
| 时间无效 | timestamp 为 `"invalid"` | all true | 忽略该来源，不抛异常 |

Implementation skeleton for `src/widgets/shared/presence.js`:

```js
const DEFAULT_META = {
  showSteam: true,
  showMoments: true,
  showPosts: true,
  showPhotos: true
};

function isEnabled(meta, key) {
  return meta?.[key] !== false;
}

function parseTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function isWithin(time, now, windowMs) {
  return time > 0 && time <= now && now - time <= windowMs;
}

export function resolveIdentityPresence(sources = {}, meta = {}, now = Date.now()) {
  const options = { ...DEFAULT_META, ...meta };
  if (isEnabled(options, 'showSteam') && sources.steamAvailable && sources.steamProfile?.playing === true) {
    return {
      type: 'steam-playing',
      label: sources.steamProfile.statusText || '正在游戏',
      title: sources.steamProfile.currentGameName || sources.steamProfile.personaName || 'Steam',
      subtitle: sources.steamProfile.currentGameName ? sources.steamProfile.personaName || '' : '当前在线',
      href: '/steam',
      app: 'steam',
      cover: sources.steamProfile.avatarFull || '',
      accent: 'steam'
    };
  }

  const moment = Array.isArray(sources.recentMoments) ? sources.recentMoments[0] : null;
  const momentTime = parseTime(moment?.metadata?.creationTimestamp || moment?.spec?.releaseTime || moment?.status?.lastModifyTime);
  if (isEnabled(options, 'showMoments') && sources.momentsAvailable && isWithin(momentTime, now, 48 * 60 * 60 * 1000)) {
    return {
      type: 'moment-recent',
      label: '刚刚更新瞬间',
      title: moment?.spec?.content || moment?.spec?.raw || '新的瞬间',
      subtitle: '48 小时内',
      href: moment?.status?.permalink || `/moments/${moment?.metadata?.name || ''}`,
      app: 'moments',
      cover: '',
      accent: 'moments'
    };
  }

  const post = Array.isArray(sources.latestPosts) ? sources.latestPosts[0] : null;
  const postTime = parseTime(post?.metadata?.creationTimestamp || post?.spec?.publishTime || post?.status?.lastModifyTime);
  if (isEnabled(options, 'showPosts') && isWithin(postTime, now, 7 * 24 * 60 * 60 * 1000)) {
    return {
      type: 'post-recent',
      label: '最近写了文章',
      title: post?.spec?.title || '最新文章',
      subtitle: '7 天内',
      href: post?.status?.permalink || '#',
      app: 'explorer-post',
      cover: post?.spec?.cover || '',
      accent: 'posts'
    };
  }

  if (isEnabled(options, 'showPhotos') && sources.photosAvailable && (sources.photoGroups?.length || sources.photos?.length)) {
    return {
      type: 'photos-active',
      label: '最近整理图库',
      title: '图库',
      subtitle: '照片入口',
      href: '/photos',
      app: 'photos',
      cover: sources.photoGroups?.[0]?.spec?.cover || sources.photos?.[0]?.spec?.url || '',
      accent: 'photos'
    };
  }

  return {
    type: 'default',
    label: '站点作者',
    title: '',
    subtitle: '',
    href: '#',
    app: 'explorer-author',
    cover: '',
    accent: 'default'
  };
}
```

Steps:

- [ ] Add Steam source fields to desktop widget protocol.

Source shape:

```js
steamAvailable: true,
steamProfile: {
  playing: true,
  statusText: '正在游戏',
  personaName: 'Steam Player',
  avatarFull: '',
  profileUrl: '',
  steamLevel: 0
},
steamStats: {
  totalGames: 0,
  recentPlaytimeFormatted: ''
},
steamRecentGames: []
```

- [ ] Implement `resolveIdentityPresence(sources, meta, now)` in `src/widgets/shared/presence.js`.

Rules:

- Respect meta toggles.
- Clamp date windows: Moments 48 hours, posts 7 days.
- Use `Date.parse()` defensively and ignore invalid timestamps.
- Return `default` when data is missing.
- Never inspect `steamRecentGames` to decide `steam-playing`.

- [ ] Add `scripts/verify-widgets-presence.mjs`.

Script content:

```js
import assert from 'node:assert/strict';
import { resolveIdentityPresence } from '../src/widgets/shared/presence.js';

const now = Date.parse('2026-05-16T12:00:00.000Z');

const cases = [
  {
    name: 'steam playing wins',
    sources: {
      steamAvailable: true,
      steamProfile: { playing: true, statusText: '正在游戏', personaName: 'Sky' },
      recentMoments: [{ metadata: { creationTimestamp: '2026-05-16T06:00:00.000Z' } }]
    },
    meta: {},
    expected: 'steam-playing'
  },
  {
    name: 'recent game is not current playing',
    sources: {
      steamAvailable: true,
      steamProfile: { playing: false },
      steamRecentGames: [{ name: 'Game A' }],
      recentMoments: []
    },
    meta: {},
    expected: 'default'
  },
  {
    name: 'recent moment within 48h',
    sources: {
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: '2026-05-15T12:00:00.000Z' } }]
    },
    meta: {},
    expected: 'moment-recent'
  },
  {
    name: 'steam toggle off falls through to moment',
    sources: {
      steamAvailable: true,
      steamProfile: { playing: true },
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: '2026-05-15T12:00:00.000Z' } }]
    },
    meta: { showSteam: false },
    expected: 'moment-recent'
  },
  {
    name: 'invalid time falls back',
    sources: {
      momentsAvailable: true,
      recentMoments: [{ metadata: { name: 'moment-1', creationTimestamp: 'invalid' } }]
    },
    meta: {},
    expected: 'default'
  }
];

for (const item of cases) {
  const result = resolveIdentityPresence(item.sources, item.meta, now);
  assert.equal(result.type, item.expected, item.name);
}

console.log(`presence resolver cases passed: ${cases.length}`);
```

- [ ] Implement identity-card renderer.

Visual direction:

- Calm macOS card, not Steam page clone.
- Steam state can borrow dark blue/online accent from Steam, but card still follows widget appearance token.
- Use one primary status, not a crowded list of every service.
- Quick actions: 作者页、瞬间、Steam or 图库 depending on available state.
- Text, icon and metric sizes must stay consistent with `author-card.css` and existing widget header scale.
- Do not render decorative blobs or gradients that fight the desktop wallpaper; use surface, border and subtle hero imagery only.

- [ ] Register widget manifest and loader.

Files:

```bash
src/widgets/registry.js
src/widgets/loaders.js
src/shell/desktop-shell/styles/widgets/content/index.css
```

- [ ] Document the data boundary.

Docs must state:

- Steam currently playing only uses explicit `profile.playing`.
- Recent game is not treated as currently playing.
- The widget falls back to author profile when plugins are missing.

- [ ] Verify.

Run:

```bash
pnpm run typecheck
pnpm run build-only
node scripts/verify-widgets-presence.mjs
pnpm run verify:reload
SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright
```

- [ ] Commit.

```bash
git add src/widgets/halo/identity-card \
  src/widgets/shared/presence.js \
  scripts/verify-widgets-presence.mjs \
  src/widgets/registry.js \
  src/widgets/loaders.js \
  templates/modules/shell/layout.html \
  templates/modules/shell/desktop-widgets.html \
  src/shell/desktop-shell/styles/widgets/content/identity-card.css \
  src/shell/desktop-shell/styles/widgets/content/index.css \
  docs/桌面小组件.md \
  docs/功能/Steam.md
git commit -m "feat(widgets): add identity presence widget"
```

---

## Task 5: Moments Widget Upgrade

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

## Task 6: Friends Recent Widget

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

## Task 7: Docsme Quick Widget

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

## Task 8: Documentation And Final Verification

**Goal:** 把小组件能力、配置方式、后续增强边界写清楚，并做最终回归。

**Files:**

- Modify: `docs/桌面小组件.md`
- Modify: `docs/项目进度.md`
- Optional: `README.md`

Steps:

- [ ] Update widget inventory.

Document:

- 系统：时间、日历、天气
- Halo：身份状态、最新文章、热门文章、分类、作者卡片、站点统计、随机标签
- 插件：瞬间、图库、朋友圈、Docsme

- [ ] Update configuration guide.

Document:

- 哪些 widget 支持实例配置。
- `meta` 保存在哪里。
- 后台全局设置和实例配置的优先级。

- [ ] Update remaining roadmap.

Keep future items:

- 追番小组件
- 独立 Steam 小组件（身份状态卡已覆盖“正在游戏/最近游戏”的轻量入口）
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
- [ ] `node scripts/verify-widgets-config-schema.mjs` 通过。
- [ ] `node scripts/verify-widgets-presence.mjs` 通过。
- [ ] 已安装插件缺失时，对应 plugin widget 不破坏组件中心。
- [ ] 移动端按现有 `hide_on_mobile` 规则工作。
- [ ] 无权限用户不能保存默认布局。
- [ ] `pnpm run verify:reload` 通过。
- [ ] Playwright smoke 通过。

## Visual Quality Gate

- [ ] Widget center 中的预览不可跳转，点击不会改动桌面布局。
- [ ] 所有新增 icon-only 按钮都有 `title` 或 `aria-label`。
- [ ] 所有可点击区域在桌面和触屏下至少 44px 命中区。
- [ ] 小组件内部无横向滚动，长标题使用 1-2 行截断策略。
- [ ] 卡片高度固定，图片和头像加载前后不改变 grid 尺寸。
- [ ] `prefers-reduced-motion: reduce` 下无缩放/位移动画。
- [ ] CSS 组件文件不直接散落 raw hex；状态色通过局部 token 收口。
- [ ] 明暗外观和 `follow` 外观都能看清文本，正常文本对比度不低于 4.5:1。

## Plan Score

当前方案按可实现性、契约清晰度、视觉一致性、回滚粒度和验证闭环评分：**9.6 / 10**。

仍然没有给满分的原因：

- Friends recent 和 Docsme quick 的可展示数据依赖后续 source 能力，v1 只能稳做入口和空态。
- Identity 卡片的“实时在线感”受 Steam 插件公开字段限制，主题只能使用已公开的 `profile.playing`，不做前端猜测。
