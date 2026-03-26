# theme-sky-blog-3

Apple-like macOS 桌面壳层 Halo 博客主题。

- GitHub: [sky121666/theme-sky-blog-3](https://github.com/sky121666/theme-sky-blog-3)
- 架构说明: [docs/ARCHITECTURE.md](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/docs/ARCHITECTURE.md)

## 当前定位

`theme-sky-blog-3` 不是 Web OS 模拟器，也不是 Finder-first 主题。

当前产品模型是：

- 首页默认可切换为纯桌面
- 内容通过单一主窗口承载
- 顶栏、Dock、桌面图标构成当前桌面壳层
- 桌面小组件仍在规划和实现中
- 文章、页面、搜索、评论属于内容层

## 技术栈

- Halo Theme
- Thymeleaf
- Alpine.js
- Pjax
- Vite
- Tailwind CSS v4
- Plain JavaScript

## 已完成

- [x] 主题基础架构与构建链
  - Vite 构建输出已接入 `templates/assets/main.css` 和 `templates/assets/main.js`
  - GitHub 仓库已创建并同步

- [x] 首页桌面壳层
  - 支持桌面优先的首页形态
  - 已接入顶栏、Dock、桌面图标、主窗口容器
  - 小组件区域和默认布局尚未完成

- [x] 主窗口交互
  - 支持打开、关闭、最小化、最大化
  - 最小化已接入 Genie Effect 神奇效果
  - 深链接页已避免被首页窗口缓存状态错误覆盖

- [x] Dock
  - Dock 菜单已支持从 Halo 菜单读取
  - 已优化放大曲线、tooltip、图标表面和底座材质

- [x] Header 顶栏与二级菜单
  - 顶栏左侧应用名已支持后台配置
  - 默认回退到站点标题
  - Header submenu 已支持图标、分隔线、外链状态
  - submenu 的定位、hover、面板层级已做多轮修正

- [x] 桌面背景设置
  - 已支持 `内置 / 纯色 / 上传`
  - 已提供 12 套内置背景预设
  - 每套预设已配独立 SVG 预览卡

- [x] 桌面配色设置
  - 已支持 `内置 / 自定义`
  - 已提供 8 套内置配色预设
  - 配色方案已改为图片型切换卡

- [x] 文章页阅读模式
  - `post/page` 已独立收成 Reader 风格结构
  - 代码块、表格、评论区已做专用排版

- [x] 搜索与评论适配
  - 搜索插件已支持调用和样式接入
  - 评论组件颜色变量已统一
  - 已修复 PJAX 切页后评论组件不初始化的问题

- [x] 架构与边界文档
  - 已补充 `Shell Fixed Surfaces` / `Content Adaptive Surfaces` 边界
  - 已补充 token、设置和文件职责说明

## 待完成与待优化

- [ ] 桌面小组件（重中之重）
  - 当前桌面小组件未完成
  - 需要补齐模块、默认排版、拖拽吸附和持久化策略
  - 需要明确哪些组件属于首页固定模块，哪些属于可选插件模块

- [ ] Header submenu 继续细化
  - 继续压近 macOS 原生菜单的面板比例、hover 反馈和分组节奏

- [ ] Dock 继续细化
  - 统一最小化窗口图标与普通 Dock 图标的关系
  - 继续压近原生 Dock 的材质和恢复反馈

- [ ] 桌面图标与小组件
  - 桌面图标编排和状态层仍可继续收口

- [ ] 预览资源继续校准
  - 背景预设 SVG 与真实壁纸可以继续逐张校准
  - 配色预览卡可以进一步拉大方案差异

- [ ] 插件界面适配
  - 瞬间界面
  - Tag 界面
  - 友链界面
  - 朋友圈界面
  - 图库界面
  - 追番界面
  - Steam 信息展示界面
  - 论坛界面
  - 以上界面需要等待对应插件仓库和使用文档收集完毕后，再统一补充技能与适配规则

- [ ] README 展示层
  - 增加截图
  - 增加安装说明
  - 增加设置说明和演示图

## 开发

```bash
pnpm install
pnpm run build-only
pnpm run build
```

## 说明

- 当前仓库优先保证主题结构和交互链路稳定
- 视觉仍在持续压向更接近 macOS 的质感
- 测试期内部分配置字段和菜单细节仍可能继续收口
- 插件适配部分将依赖后续补充的仓库地址和使用文档
