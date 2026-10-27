# Theme Skill

## Reload Verify

- 当改动涉及 Halo 服务端会直接读取的主题文件时，默认执行重载验证。
- 这类文件主要包括：
  - `templates/**`
  - `settings.yaml`
  - `theme.yaml`
  - `theme-setting.yaml`
  - `templates/modules/**`
  - 其他会被 Halo 后端直接解析的 YAML / HTML 模板文件

- 包管理器固定使用 `pnpm`。
- 禁止使用 `npm` 安装依赖、运行脚本或格式化。
- Git 工作流固定只使用 `main` 分支。
- 禁止创建功能分支、临时分支或 worktree；除非用户明确要求，不执行 `git checkout -b` / `git switch -c`。

- 默认验证命令：
  - `pnpm run verify:reload`

- 如果这次改动还影响前端交互、PJAX、分页/瀑布流或页面协议，继续执行：
  - `SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} pnpm run smoke:playwright`

## Auth

- `pnpm run verify:reload` 依赖项目根目录的 `.env.local`
- 使用变量名：
  - `FIVEEE_PAT`
- 可选变量：
  - `HALO_BASE_URL`

## Verify Standard

- `verify:reload` 需要完成以下事情：
  - 调用 Halo 主题 reload 接口
  - 轮询首页直到服务恢复
  - 校验关键页面返回 200
  - 校验页面协议字段 `data-page-mode` / `data-window-variant`
  - 对已安装插件页面校验 `data-app-id`

- 如果可选页面返回 404，视为对应插件未安装，记录为跳过，不视为失败。

## Build Verify

- 完整检查须先执行 `pnpm run build-only` 生成当前源码对应的资源，再执行类型检查、契约与离线测试、资源预算和构建 smoke。读取 `templates/assets/**` 的检查不得依赖上一轮构建产物。
- `pnpm run check` 的执行顺序必须遵守上述要求；构建失败时停止后续依赖生成资源的检查。结果按实际执行记录，不从脚本或规则已修改推导通过。

## Release Package

- 正式主题 ZIP 按明确的分发范围打包，保留主题运行、版本声明、许可和发布展示所需文件；本地 DEMO 与测试专用素材、测试数据、调试截图和日志不得进入正式安装包。开发素材可以保留在仓库或本地环境，通过打包规则排除，不以删除素材替代发布包检查。
- `templates/assets/**` 归主题运行资源所有；本地 DEMO 原图、测试 fixture、调试截图和日志不得存入该目录。商城 DEMO 原图归档到 `docs/商城/演示素材/`，测试图片归档到 `scripts/fixtures/images/`，这两类路径不能作为正式主题资源引用。
- 本地 DEMO 商品图片应使用 Halo 附件地址；迁移时核对商品引用与附件可访问性，完成状态以实际迁移和页面验证记录为准。
- `docs/**`、`scripts/**` 属于开发文档与工具范围，必须从正式 ZIP 排除。旧 `templates/assets/images/shop-demo` 目录及其后代继续作为禁止路径，防止重新引入。新增开发素材目录时，同步维护打包 CLI 的 `ignorePatterns` 与 `scripts/verify-release-package.mjs` 的禁止路径检查。
- `pnpm run package` 和 `pnpm run build` 必须在写入第三方声明后自动执行发布包校验；校验失败即打包失败，不得将该 ZIP 用于发布。
- 发布前检查 ZIP 条目、必需运行文件、版本、许可证、字节大小与 SHA-256，并与上一正式 ZIP 比较。异常增大时先定位新增条目和体积来源，说明原因后再发布；不设置未经验证的体积硬阈值。
- 官方 v5 CD 通过 `pnpm build` 调用项目现有的 `build` → `package` → `finalize-theme-package.mjs` 链路；[v0.9.49 CD 日志](https://github.com/sky121666/theme-sky-blog-3/actions/runs/38040449674)已记录 finalizer 和发布包校验执行成功。公开 Release 后仍须下载正式 ZIP，显式执行 `pnpm run verify:release-package "<zip-path>"`，不得用本地候选包或 CD 日志结果代替正式制品复核。
