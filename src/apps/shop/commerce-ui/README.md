# Commerce UI 源码适配

来源：[`lxware-dev/shop-templates`](https://github.com/lxware-dev/shop-templates/tree/7a1fb04dd4796e412aa94fc9d19f94f45b80459b/ui/src)，固定提交 `7a1fb04dd4796e412aa94fc9d19f94f45b80459b` 的 `ui/src`。上游 README 的“二次开发”说明支持在主题中集成 UI 源码；本目录采用主题已有的构建链，不复制上游 workspace 配置或发布包。

## 2.27 增量来源

订阅、匿名结算和手机支付按 [`release/2.27` 固定提交](https://github.com/lxware-dev/shop-templates/tree/2e03340ca650595b3f3d98a12c6b6be3cc764607) 适配；限购、permalink 与订阅快照同时核对官方 Paid OpenAPI 2.27.0。详细契约和验证边界见 [Halo 2.27 适配记录](../../../../docs/2026-10-22-Halo-2.27-适配.md)。

保留已有四个 Web Components、共享查询清理和导航入口。新增订阅组件是内部组件，订单详情由服务端模板输出。`authenticated` 控制账户 UI，独立 `storefrontApi` 版本能力控制交易路由；不能用登录状态代替游客订单的访问凭证。

## 与初始来源的差异

- 使用 esbuild 的 TS transform 擦除脚本和工具函数的类型声明，保留只被 Svelte 模板使用的运行时 imports；同时移除模板表达式中的 TS 断言。locale JSON 保留已有文案并合并 2.27 新键。
- 不导入或分发 `@halo-dev/api-client` 的运行时代码。`api-contract.js` 仅声明当前界面使用的 API 协议值，核对来源为本地 `halo-dev-api-client-2.24.0/dist/index.d.ts`；不提供生成 API 客户端。
- `~icons/mingcute/*?raw` 改为已有 `@iconify-json/lucide` 的本地 SVG（MIT），映射为 plus、minus、check、search、x，不依赖额外图标编译插件。
- 运行样式复用真实服务的 `/shop-dist/style.css` 预编译快照（本地 `fixture-official-style.css`，SHA256 `72594b7fb8acceda2a2d16da3ecffc4cd00fe56774a5126aa799ff4e5721ae51`），通过 Shop App CSS 接入；保留上游 SCSS 作为来源参考，不引入 Sass 编译依赖。
- queryFn 接收 TanStack 的 signal 并传入 ky。拥有独立 QueryClient 的组件通过 `createCommerceScope` 在 onDestroy 中取消查询、清理缓存。
- 购物车行与结算 mutation 使用组件自己的 AbortController；异步回调在界面销毁后停止显示 toast、改本地状态或 invalidate。购物车行不清理所属购物车页面的共享 QueryClient。
- 支付成功后的跳转 timer 由 effect cleanup 释放；组件销毁后不会执行该跳转。
- SKU 图片放大使用组件内原生 dialog，按需加载大图，支持关闭按钮与 Esc，onDestroy 关闭 top layer。未接入 medium-zoom 的全局监听器或上游 Swiper/DOMContentLoaded 入口。
- 去除上游结算页输出结算上下文的调试日志；保留 CSRF、请求内容、接口地址、原生业务表单和支付提供商 UI。
- 结算地址在上下文和账户地址均成功加载后初始化，优先恢复有效的 `selectedAddressId`，缺失或失效时回退默认地址；同一上下文的后续读取不覆盖用户选择或新地址草稿。
- 移除折扣失败时显示提示并保留输入和已应用折扣，显式重试成功后再清空输入、刷新汇总；继续遵守组件销毁后的回调门控。

## 生命周期与验证边界

`main.js` 只导入四个商城 Web Components、iconify-icon 和商城样式。由主题 Shop App 的模块加载缓存保证注册单实例；具体 PJAX 资源接入由本目录之外的 Shop App 完成。DOM 断开后，Svelte Custom Element 在微任务中销毁组件，触发 effect 与 onDestroy 清理。

语法检查应使用项目安装的 Svelte 编译器与 esbuild；该检查只证明源码可解析。冷启动、PJAX 进入/离开/后退、请求取消、延迟跳转与 mutation 回调由独立隔离 fixture 验收。支付组件挂载时会发起 initiate-payment POST，因此 fixture 必须拦截全部请求，不允许回退到真实商城接口。真实购物车、下单及支付结果需独立授权与验收。
