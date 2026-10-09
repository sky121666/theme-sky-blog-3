# Halo 商城主题适配实施计划

> 执行方式：当前任务直接执行，独立文件交由子代理并行处理；不进行 Git 暂存、提交或推送。

**Goal:** 将已确认的 App Store 风格接入真实商城的列表、详情、购物车、结算与支付页面，提供商品简介开关及商店入口。

**Architecture:** 新增独立 `shop` App 和五个主题覆盖模板。列表与图册使用主题代码，购买、购物车、结算、支付保留官方组件和 CSRF。商城页面及客户中心使用完整文档导航，避免重复注册官方组件及跨页面残留支付回调。

**Tech Stack:** Halo 2.26.1 / Thymeleaf / Tailwind 4 / Alpine / pnpm 12.5.1 / Node 24.21.0；商城表单只引入带前缀的 daisyUI 按钮、输入与选择控件。

**Spec:** 本地已确认图稿 `output/commerce-design-2026-10-08/设计说明.md`，首页以完整首屏版本为准。官方商城说明基线为 `7a1fb04dd4796e412aa94fc9d19f94f45b80459b`。

## 全局约束

- 仅 `main`；不创建分支或 worktree；只使用 pnpm。
- 保留当前工作区已有修改，包括 CD v5 与无关文档。
- 用户已授权本地商城 DEMO 商品创建；只创建带 DEMO 标识的新商品、分类及对应 SKU，记录返回 ID。
- 不创建订单、发起支付、领取优惠券或变更真实客户资料。
- 支付组件可能在挂载后自动 POST `initiate-payment`；支付与结算显示使用隔离样例或拦截写请求验证。
- 不使用设计稿中的虚构售价、评级、销量作为真实商品数据；正式模板读取后端字段。
- 简介默认显示，可后台关闭；价格、SKU、购买入口与完整详情正文独立保留。
- 只保存必要环境、源码、响应 ID 和检查结果，不记录 PAT、CSRF 值或账号名。

## 重点检查

1. 空商品、无图、长标题、长简介和零价格能正常显示。
2. 分类、搜索、排序、分页保留对应条件；改变筛选时重置页码。
3. 商品简介关闭或为空时没有空行，价格仍显示。
4. 商城相关点击、程序化导航和后退均使用完整导航，并保留既有离开许可。
5. 官方 CSRF、规格、库存、结算上下文和订单标识不因布局改造丢失；业务写链不由只读显示验证推定通过。

## 任务 1：商品与环境基线

**Files:** `output/commerce-adaptation-2026-10-08/upstream/`、`demo-records.json`、`before/`。

- [x] 核对固定官方源码、前台组件与 console 请求声明。
- [x] 确认本地 Halo 2.26.1、目标主题 0.9.47 与商城列表入口。
- [x] 备份本次将修改的文件及生成资产，保留用户原有工作区差异。
- [x] 读取当前商品与分类，创建六件唯一 DEMO 商品；包含多规格、缺货、长简介、无图及零价格样本。
- [x] 保存创建 ID、示例图片与请求摘要；核对实际商品详情路径和商品显示字段。

## 任务 2：商城窗口与五模板

**Files:** `templates/shop/{products,product,cart,checkout,payments}.html`、`templates/modules/shop-app/{window,sidebar,products,product,transaction}.html`、`templates/modules/shell/layout.html`。

**Interfaces:** 输入官方 `categoryTree/productPage/product/context.id/orderCode/_csrf.token`；输出 `pageApp=shop`、`windowVariant=shop`、五种 `browser-shop-*` 页面模式，App 根节点 `data-app-root=shop`、`data-shop-scene`。

- [x] 列表：实际商品驱动完整主推、双列文图卡、下方商品分组；筛选状态使用目录布局；空列表不填入虚构商品。
- [x] 详情：图册、商品名及正文使用真实字段；嵌入官方 `shop-buy-box`。
- [x] 交易：嵌入官方 `shop-page-cart/shop-page-checkout/shop-page-payments`，保留全部必要属性；标题由对应组件提供，避免重复。
- [x] 窗框复用拖动、缩放和滚动协议；桌面侧栏、手机抽屉及操作区保持一致。
- [x] 官方样式与脚本只在完整商城文档加载，避免带入博客 PJAX 页面。

## 任务 3：运行时、样式与导航

**Files:** `src/apps/shop/{entry,manifest,protocol,hydrate,runtime,model}.js`、`styles/index.css`、`src/shared/commerce-navigation.js`、`src/shell-core/runtime/{app-manifests,route-manifest}.js`、`src/shell/desktop-shell/runtime/desktop/pjax/index.js`。

**Interfaces:** `buildShopBrowseUrl(currentUrl, changes)` 保留筛选并处理页码；`isShopDescriptionVisible(value)` 处理后端布尔值；`requiresCommerceDocumentNavigation(currentUrl, targetUrl)` 为导航协调器提供完整导航判断。

- [x] 先写并运行筛选、简介值解析、导航边界测试，确认缺少实现时失败。
- [x] 实现表单筛选、分页、移动抽屉、横向卡片箭头和图册切换；监听器按 App 生命周期清理。
- [x] 登记独立 App，确保商城 JS/CSS 不进入 Shell 静态依赖闭包。
- [x] 交易与商城资源的完整导航在协调器真实入口执行，不只填写未被消费的 manifest 字段。
- [x] CSS 按完整首屏的 220px 侧栏、40px 内容间距、880:340 横幅和等宽双卡实现；深浅模式及手机适配使用主题变量。

## 任务 4：设置与入口

**Files:** `settings.yaml`、系统设置共享字段模型、`templates/modules/shell/settings/apps.html`、`templates/modules/shell/layout.html`。

- [x] 后台增加商品简介开关（默认开启）及商店 Dock 入口开关（默认关闭，社区版可保持不展示）。
- [x] 同步前台系统设置的字段、默认值与保存模型，验证新字段往返。
- [x] Dock 提供商店入口，避免与用户已配置的同一路径菜单重复；不改写用户菜单数据。
- [x] 简介只控制展示，空值或关闭时不保留专用间距；价格与完整详情正文不受影响。

## 任务 5：验证与记录

**Files:** `scripts/verify-commerce*.mjs`、`docs/插件适配契约.md` 商城独立章节、`docs/项目进度.md`、`docs/2026-10-08-商城适配.md`。

- [x] 功能测试通过后执行 `pnpm run lint/typecheck/check`，同步生成资产和第三方许可记录。
- [x] 执行 `pnpm run verify:reload`，验证商城列表与实际 DEMO 详情；无业务样本的交易页按输入要求记录。
- [x] 执行要求的 `SMOKE_BASE_URL=http://localhost:8090 pnpm run smoke:playwright`；真实商城验证阻断业务写入。
- [x] 浏览器核对商品列表、筛选、详情、图册、缺货、手机、深浅模式和简介开关；Cart/Checkout/Payments 使用隔离样例验证可见布局与组件。
- [x] 记录当前主题构建、实际商城页面范围与 DEMO ID。分开报告源码、构建、真实页面显示和未执行的下单支付。

## 计划自检

本计划覆盖五个模板、首屏排版、描述开关、入口、资源隔离、导航与验收。官方组件继续拥有交易请求；主题只处理已授权的展示和导航。DEMO 创建需要目标服务端实际接受请求，客户端 2.24.0 声明不能替代 2.26.1 的运行证据。任何新增路由、字段或测试范围变化应记录在本计划及验收文档中。

## 执行结果

候选构建 `0.9.47 / 714a9e8ca182`。完整check、reload、53项模型与导航、24项DOM、8场景124项官方交易布局通过；真实SSR与配置保存已核对并恢复。全站smoke未通过，22场景只报告同一外部图标ORB错误。订单/支付真实写链未执行。

范围补充：为了接入既有结构，新增官方薄style/script模块、注册/typecheck断言、daisyUI分发许可、商城使用说明与7张截图。实页发现并修复模板replace条件优先级、手机窗口父容器尺寸、Dock遮挡和按钮SVG压缩；导航经现有许可入口执行。保留全部既有无关变更，无Git暂存或提交。
