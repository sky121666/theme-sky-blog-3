# Sky Blog 3

macOS 桌面风格 Halo 博客主题。

## 预览

| 桌面 | 文章详情 |
|:---:|:---:|
| ![桌面](screenshots/desktop.png) | ![文章详情](screenshots/post-detail.png) |

| 归档 Finder | 瞬间列表 | 瞬间详情 |
|:---:|:---:|:---:|
| ![归档](screenshots/archives-finder.png) | ![瞬间列表](screenshots/moments-feed.png) | ![瞬间详情](screenshots/moments-detail.png) |

- GitHub: [sky121666/theme-sky-blog-3](https://github.com/sky121666/theme-sky-blog-3)
- 架构说明: [docs/ARCHITECTURE.md](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/docs/ARCHITECTURE.md)

## 当前定位

`theme-sky-blog-3` 不是 Web OS 模拟器，也不是 Finder-first 主题。

当前产品模型是：

- 首页默认可切换为纯桌面
- 内容通过单一主窗口承载
- 顶栏、Dock、桌面图标构成当前桌面壳层
- 桌面小组件已进入首页桌面层 MVP 阶段
- 文章、页面、搜索、评论属于内容层

## 技术栈

- Halo Theme
- Thymeleaf
- Alpine.js
- Pjax
- Vite
- Tailwind CSS v4
- Plain JavaScript

## 工作计划同步

README 作为 `theme-sky-blog-3` 的对外工作计划同步面，后续每次迭代都按下面规则更新：

- 新增任务：先加入 `进行中` 或 `待开始`
- 完成任务：从 `进行中 / 待开始` 挪到 `已完成`
- 大的结构性变化：同时更新 [docs/ARCHITECTURE.md](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/docs/ARCHITECTURE.md)
- 插件适配：在 README 保留状态，在对应 skill 里维护插件细节

## 进行中

- [ ] 桌面小组件（重中之重）
  - 已支持管理员前端编辑并发布 `default_layout.layout_json`
  - 当前默认布局优先读取服务端已发布 JSON，不再依赖浏览器本地布局缓存
  - 已支持实例级外观模式：`follow / light / dark`
  - 小组件中心已重构为 macOS 风格：960px 宽面板、按类别分组、原始尺寸预览
  - 编辑操作已改为右键菜单，移除顶部工具条，支持 ⌘+S 快捷键保存和 Esc 退出
  - 文章分类组件（桌面卡片）已重构为黑曜石玻璃风格，支持独立颜色与图标注解
  - 桌面小组件站内链接已统一走 PJAX 协议，动态渲染后主动接管
  - 下一步是继续细化其他组件内容布局和明暗主题 token

- [ ] 插件界面适配
  - 友链界面
  - 朋友圈界面
  - 图库界面
  - 追番界面
  - Steam 信息展示界面
  - 论坛界面

- [ ] README 展示层
  - 增加截图
  - 增加安装说明
  - 增加设置说明和演示图

## 待开始

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

## 已完成

- [x] 站内导航性能优化
  - 同变体内容级切换：`explorer→explorer` 和 `moments→moments` 不重建窗口框架
  - 三重白名单约束：`windowVariant + pageApp + pageMode` 全匹配才走内容替换
  - Explorer 列表分批渲染（renderBatch），离屏构建首批后单帧替换旧内容，无抽空闪烁
  - Moments 列表图片 `data-src` + IntersectionObserver 懒加载，首屏仅加载可见图片
  - Moments 列表视频替换为轻量占位卡，详情视频 `preload="none"`
  - 评论区 IntersectionObserver 延后初始化（进入视口 400px 内才 reveal）
  - Dock/菜单栏 hover 预取高频入口
  - 窗口级 loading overlay + 骨架 shimmer 动画
  - 天气组件和 widget 渲染器 `requestIdleCallback` 延迟加载
  - 桌面小组件链接 PJAX 化：统一 `link.js` 协议、`link-attach.js` 共享接管、surface after-render 增强与 click delegate 兜底
  - `attachDynamicLinks` 已修复 `data-pjax-attached` 标记缺失导致 delegate 重复拦截的问题

- [x] 瞬间 (Moments) 独立窗口
  - 瞬间窗口已重构为固定宽度（560px）、上下双边支持垂直拉伸的聊天面板交互
  - 已建立 light/dark 双主题 token 体系，亮色走微信 PC 桌面客户端温白灰纸感风格
  - Feed 页和详情页已重置为微信 PC 朋友圈信息流布局
  - 骨架屏按 `windowScene` 分 feed/detail 双套，比例与真实布局一一对应
  - 标签区、分页区、视频占位卡已从 inline style 抽离为 class 驱动
  - 富文本 code/pre/blockquote 已纳入 token 变量，亮暗模式均适配
  - 评论组件已接入 `--halo-cw-*` 变量跟随 moments 主题色
  - 瞬间摘要已剥离 `#tag` 内联标签文本，避免与独立标签 badge 重复
  - 已支持场景化参数 `windowScene` 控制标题栏与返回操作
  - 新增后台 `瞬间` 设置组：封面背景（attachment）+ 封面名片（display_name / subtitle）
  - 封面区支持自定义上传，留空时显示主题色占位；名片文案回退 site.title / site.subtitle
  - 窗口标题已动态化，消费插件 `title` 变量，默认 `瞬间`
  - 滚动条已适配 macOS 风格：静止透明隐藏，交互时淡入 6px 细轨

- [x] 主题基础架构与构建链
  - Vite 构建已从 IIFE 单文件切换到 ESM 多入口 + code-splitting
  - CSS 已按页拆分为 `main / explorer / reader / moments-app / editing-runtime`
  - JS 按需 chunks：`renderers / editing-runtime / weather-runtime / persistence-write / catalog-editor`
  - Vite `writeBundle` 钩子自动清理空 JS entry stubs
  - `main.js` 182 KB (gzip 60 KB)，首屏仅加载 main.js + main.css
  - GitHub 仓库已创建并同步

- [x] 首页桌面壳层
  - 支持桌面优先的首页形态
  - 首页已改为纯桌面态，点击首页会直接返回桌面，不再打开主页窗口
  - 从首页进入内容页时，已改为等待目标内容到位后再开窗，不再先闪出首页过渡窗口
  - 已接入顶栏、Dock、桌面图标、主窗口容器
  - 已接入桌面小组件层与默认布局

- [x] 主窗口交互
  - 支持打开、关闭、最小化、最大化
  - 最小化已接入 Genie Effect 神奇效果
  - 已修复最小化后从 Dock 恢复时窗口消失、标题栏滞后和恢复交接闪烁问题
  - 深链接页已避免被首页窗口缓存状态错误覆盖
  - 已修复从非主题界面返回后暗亮色状态不同步的问题
  - 桌面端已改为四边 / 四角自定义缩放，不再依赖浏览器原生右下角缩放

- [x] Dock
  - Dock 菜单已支持从 Halo 菜单读取
  - 已支持最小化窗口缩略图从 Dock 直接恢复
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

- [x] 桌面小组件 MVP
  - 已支持首页桌面层小组件渲染、编辑态和拖拽吸附
  - 已接入组件中心，不再只是简单工具面板
  - 已支持时间、日历、最新文章、随机标签、站点统计、瞬间和天气组件类型
  - 已接入管理员发布默认布局链路，后端权威配置为 `default_layout.layout_json`
  - 已去掉本地布局缓存和旧的扩展持久化桥，只保留服务端默认布局与结构化 fallback

- [x] 桌面配色设置
  - 已支持 `内置 / 自定义`
  - 已提供 8 套内置配色预设
  - 配色方案已改为图片型切换卡

- [x] 归档页 Finder 视图
  - 已改成窗口内容区内的三栏 Finder 风格归档浏览
  - 已支持年份 / 月份 / 文章 / 预览联动
  - 已补齐 sidebar 辉光、选中态与窗口缩放修复
  - 已统一内部独立滚动、浅灰滚动条和底部分页区
  - 手机端已回落到主窗口纵向滚动，并隐藏预览栏

- [x] 标签页 Finder 视图
  - 已适配 `/tags` 和 `/tags/{slug}` 的 Finder 风格标签浏览
  - 标签集合页已支持点击标签直接显示对应文章与右侧预览
  - 标签集合页内部分页已继承后台 `tagPageSize`
  - 已补齐标签栏独立滚动、系统浅灰滚动条与文件行选中态
  - 已统一侧栏防拉伸规则与预览按钮尺寸
  - 手机端已回落到主窗口纵向滚动，并隐藏预览栏
  - 已重构为首屏 SSR + API 动态加载模式（仅 SSR 第一个标签 20 篇，切换后 fetch + sessionStorage 5min 缓存）

- [x] 分类页 Finder 视图
  - 已适配 `/categories` 和 `/categories/{slug}` 的 Finder 风格分类浏览
  - 分类集合页已支持分类切换、文章列表与右侧预览联动
  - 分类集合页内部分页已继承后台 `categoryPageSize`
  - 分类详情页已统一三栏结构、分页指示与预览面板
  - 手机端已回落到主窗口纵向滚动，并隐藏预览栏
  - 已重构为首屏 SSR + API 动态加载模式（仅 SSR 第一个分类 20 篇，切换后 fetch + sessionStorage 5min 缓存）

- [x] 作者页 Finder 视图
  - 已适配 `/authors/{name}` 的 Finder 风格作者浏览
  - 已支持作者资料栏、资料库来源切换、文章列表与右侧预览联动
  - 已接入作者瞬间数据源、列表分页与详情预览
  - 手机端已隐藏预览面板并回落到主窗口纵向滚动

- [x] 错误页系统弹窗
  - 已按 Halo 标准错误模板路径接入 `404 / 4xx / 5xx / error`
  - 已改为桌面层系统错误弹窗，并与 PJAX 整页跳转隔离
  - 已统一对象图标笔触、按钮比例和主题主色适配

- [x] Pjax 导航稳定性
  - 已修复 `main.js` 重复执行导致 Alpine/Pjax 双重初始化的问题
  - 已补齐 `attachLink` 去重守卫，防止同一链接绑定多个 click handler
  - 已拦截 404 等错误响应，在 `handleResponse` 层面做全页跳转
  - 已优化 MutationObserver：过滤时钟节点、仅处理含 pjax-link 的子树
  - 导航时已支持 CSS 按页切换（加载目标页 CSS + 禁用非当前页 CSS）

- [x] 开发者调试系统
  - 已在后台设置新增「开发者」组，包含 `debug_mode` 开关
  - 已统一 `[pjax]` / `[desktop]` / `[window]` 日志输出，受 `data-debug` 控制

- [x] 文章页阅读模式
  - `post/page` 已独立收成 Reader 风格结构
  - 已补齐桌面端吸附目录、窄窗口折叠目录和移动端折叠目录
  - 已补齐点赞、上一篇 / 下一篇和更轻量的文末导航
  - 代码块、表格、评论区已做专用排版

- [x] 分享面板
  - 已改为基于 `canonical + og/meta` 的自定义分享面板
  - 已支持复制链接、Telegram、X、邮件和系统分享兜底
  - 已补齐微信二维码、二维码保存和 QQ 复制链接回退
  - 移动端标题栏已接入同一套分享入口

- [x] 搜索与评论适配
  - 搜索插件已支持调用和样式接入
  - 评论组件颜色变量已统一
  - 已修复 PJAX 切页后评论组件不初始化的问题

- [x] SEO 与 Halo 参数适配
  - 已按 Halo 当前路由实际提供的参数能力分层补齐页面 SEO 输出
  - 已修复 PJAX 切页后 `title / description / canonical / 社交描述` 不同步的问题

- [x] 架构与边界文档
  - 已补充 `Shell Fixed Surfaces` / `Content Adaptive Surfaces` 边界
  - 已补充 token、设置和文件职责说明
  - 已补充桌面小组件协议与未来插件存储接口文档

- [x] 插件技能资料整理
  - 已补充独立 skill：
    - Steam
    - Comment Widget
    - Search Widget
    - Shiki
    - Moments
    - Links
    - Friends
    - Photos
    - Equipment
    - Douban
    - Bilibili Bangumi
    - Docsme
    - Auth Passkey

## 开发

```bash
pnpm install
pnpm run build-only
pnpm run build
```

## 说明

- 当前仓库优先保证主题结构和交互链路稳定
- 视觉仍在持续压向更接近 macOS 的质感
- 桌面小组件默认布局以 `default_layout.layout_json` 为权威来源
- 管理员可在前端编辑桌面并直接发布默认布局
- 测试期内部分配置字段和菜单细节仍可能继续收口
- 插件适配部分将依赖后续补充的仓库地址和使用文档
