# Sky Blog 3

macOS 桌面风格 Halo 博客主题。

- GitHub: [sky121666/theme-sky-blog-3](https://github.com/sky121666/theme-sky-blog-3)

## 预览

| 桌面 | 文章详情 |
| :---: | :---: |
| ![桌面](screenshots/desktop.png) | ![文章详情](screenshots/post-detail.png) |

| 归档 Finder | 瞬间列表 | 瞬间详情 |
| :---: | :---: | :---: |
| ![归档](screenshots/archives-finder.png) | ![瞬间列表](screenshots/moments-feed.png) | ![瞬间详情](screenshots/moments-detail.png) |

## 定位

- 首页支持纯桌面视图
- 内容统一通过单一主窗口承载
- 顶栏、Dock、桌面图标、小组件共同组成桌面壳层
- 图库、瞬间、浏览列表、阅读页都已拆成独立功能模块

## 文档

- 文档入口：[/docs/文档索引.md](/docs/文档索引.md)
- 架构总览：[/docs/架构总览.md](/docs/架构总览.md)
- 开发约束：[/docs/开发约束.md](/docs/开发约束.md)
- 代码质量评估：[/docs/代码质量评估.md](/docs/代码质量评估.md)
- 后台设置：[/docs/设置/后台设置协助说明.md](/docs/设置/后台设置协助说明.md)
- 图标与注解：[/docs/设置/图标与注解设置指南.md](/docs/设置/图标与注解设置指南.md)
- 桌面小组件：[/docs/桌面小组件.md](/docs/桌面小组件.md)
- 项目进度：[/docs/项目进度.md](/docs/项目进度.md)
- 插件适配状态：[/docs/插件适配状态.md](/docs/插件适配状态.md)
- 插件适配契约：[/docs/插件适配契约.md](/docs/插件适配契约.md)
- 插件更新跟进：[/docs/插件更新跟进计划.md](/docs/插件更新跟进计划.md)

## 开发进度

- 已完成：`shell-core / apps / widgets` 架构收口；桌面壳层、图库、瞬间、浏览列表、阅读页、认证页、链接页、追番页、Steam 页、装备页、Docsme 页独立化；构建产物已按页面目录分发；跨模块滚动条与加载反馈统一、PJAX 加载骨架体验收口、Windows 交互体验适配；主题可控图片已接入懒加载；**图库小组件（plugin-photos.gallery）上线**，支持 small/medium/large 三种尺寸，PhotoGroup icon/简介 annotation 接入，widget meta 配置框架（hasConfig + 配置弹窗）完成；**图库详情页（/photos/{name}）上线**，支持 macOS Photos 风格窗口、邻近照片序列、滚轮缩放、拖拽平移、详情浮层和评论抽屉；**瞬间前端发布上线**，支持登录态显示、文字、常用 emoji、标签、图片/GIF、视频和音频上传；**瞬间点赞评论互动上线**，支持真实点赞数、微信风格三点操作、列表评论预览、详情完整评论、回复和表情输入；**链接 App（/links）上线**，支持独立窗口、分组图标、自助提交插件适配与留言兜底；**追番 App（/bangumis）上线**，支持追番/追剧筛选、状态计数、搜索和自动无限加载；**Steam App（/steam）上线**，支持资料、最近游玩、游戏库、徽章和热力图容器；**装备 App（/equipments）上线**，支持分组导航、沉浸式单品展厅和自动加载；**Docsme App（/docs）上线**，支持项目大厅、文档正文、目录页和同窗口 PJAX
- 进行中：桌面小组件持续打磨、插件界面适配、插件契约版本补验和更新跟进
- 待开始：预览资源继续校准
- 详细进度：[/docs/项目进度.md](/docs/项目进度.md)

## 安装与启用

### 环境要求

- Halo `>= 2.23.0`

### 开发构建

```bash
pnpm install
pnpm run build-only
pnpm run check
pnpm run verify:reload
SMOKE_BASE_URL="https://your-site.example.com" pnpm run smoke:playwright
```

### 打包发布

```bash
pnpm run build
```

打包后会在 [/dist](/dist) 生成主题压缩包。
将压缩包上传到 Halo 后台主题管理中启用即可。

## 🐛 问题反馈

如果你遇到问题或有功能建议：

1. **GitHub Issues**：[提交 Issue](https://github.com/sky121666/theme-sky-blog-3/issues)
2. **加入社群**：与其他用户交流

| 企业微信（备注进群） | QQ 群 |
| :---: | :---: |
| <img width="200" src="https://api.minio.yyds.pink/kunkunyu/files/2025/02/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20250212142105-pbceif.jpg" /> | <img width="200" src="https://api.minio.yyds.pink/kunkunyu/files/2025/05/qq-708998089-iqowsh.webp" /> |

> ⚠️ 卖服务器的广告人，就不要加了。
