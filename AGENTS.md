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

## Release Package

- 正式主题 ZIP 按明确的分发范围打包，保留主题运行、版本声明、许可和发布展示所需文件；本地 DEMO 与测试专用素材、测试数据、调试截图和日志不得进入正式安装包。开发素材可以保留在仓库或本地环境，通过打包规则排除，不以删除素材替代发布包检查。
- 当前 `templates/assets/images/shop-demo/**` 仅供本地商城 DEMO 使用，必须从正式 ZIP 排除。新增开发素材目录时，同步维护打包 CLI 的 `ignorePatterns` 与 `scripts/verify-release-package.mjs` 的禁止路径检查。
- `pnpm run package` 和 `pnpm run build` 必须在写入第三方声明后自动执行发布包校验；校验失败即打包失败，不得将该 ZIP 用于发布。
- 发布前检查 ZIP 条目、必需运行文件、版本、许可证、字节大小与 SHA-256，并与上一正式 ZIP 比较。异常增大时先定位新增条目和体积来源，说明原因后再发布；不设置未经验证的体积硬阈值。
- 现行 v5 CD 未调用本地 `finalize-theme-package.mjs`；CLI 排除规则与本地自动校验应分别核对。公开 Release 后仍须下载正式 ZIP，显式执行 `pnpm run verify:release-package "<zip-path>"`，不得用本地候选包结果代替正式制品验收。
