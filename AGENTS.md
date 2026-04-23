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

- 默认验证命令：
  - `npm run verify:reload`

- 如果这次改动还影响前端交互、PJAX、分页/瀑布流或页面协议，继续执行：
  - `SMOKE_BASE_URL=${HALO_BASE_URL:-http://localhost:8090} npm run smoke:playwright`

## Auth

- `npm run verify:reload` 依赖项目根目录的 `.env.local`
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
