# 核心页面与匿名认证页验收

日期：2026-09-26。站点：`http://localhost:8090`；Halo 2.26.1；启用主题 `theme-sky-blog-3`。

## 核心列表 live

R1 构建 `0.9.46 / 4279f9779da0` 后，以下现有脚本依次运行，均 exit 0。R2 只修改认证入口样式及 reader 冷锚点，不重复此组列表回归。

| 命令 | UTC 时间 | 耗时 | 样本与覆盖 |
| --- | --- | --- | --- |
| `verify:archives:live` | 12:20:32.749–12:20:43.907 | 11.158s | 2025-03、14 篇、分页大小 6 |
| `verify:categories:live` | 12:20:43.909–12:20:57.242 | 13.333s | Finder、全部文档 query 分页、category-niTYW 原生分页、PJAX/history/直达/越界及响应式 |
| `verify:tags:live` | 12:20:57.242–12:21:10.765 | 13.522s | Finder、全部文章 query 分页、tag-kjYJq 原生分页、PJAX/history/越界及响应式 |

入口脚本：`run-core-live.mjs`；结果：`../core-pages-results.json`；原始日志：`../logs/core-{archives,categories,tags}.log`。

## 匿名认证页 R1

独立匿名 Chromium context，desktop 1440×960、mobile 390×844。未使用主代理已有登录会话。

| 页面 | HTTP | 原生表单 | 已执行的纯客户端动作 |
| --- | --- | --- | --- |
| `/login` | 200 | `form.halo-form`，POST `/login` | 明暗切换并恢复；虚构用户名进入密码步骤后返回 |
| `/login?method=passkey` | 200 | `form.halo-form`，POST `/apis/api.passkey.halo.run/v1alpha1/authentication/verify` | 明暗切换；读取真实 provider 入口，未点击认证按钮 |
| `/signup` | 200 | POST `/signup` | 明暗切换；两个密码按钮分别用 Enter/Space 显隐，验证 input.type、aria-controls、稳定名称及 aria-pressed |
| `/password-reset/email` | 200 | POST `/password-reset/email` | 明暗切换；读取邮箱输入和返回登录入口 |
| 故意不存在的路径 | 404 | 无 | 检查主题错误壳、代码 404、返回入口 |

第二轮功能断言 10/10 通过，theme3 资源身份全部匹配，无横向文档溢出，无 JS pageerror、请求失败、表单提交、WebAuthn 调用或写请求。两张 404 页面各有一条预期的当前文档 HTTP 404 console 记录。

这轮脚本当时未断言 provider 的可见内容。后续逐图发现 Passkey 的密码登录入口为空，故 R1 不作为该入口最终验收。原结果保留为 `anonymous-auth-pre-passkey-fix.json`。

### 首轮脚本误判

首轮错误要求密码显隐按钮的名称跟随状态改变，导致两个 signup 项误报。实际 input.type 与 aria-pressed 均已正确变化。按 [WAI APG Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) 修正为稳定可访问名称的 toggle button 验收。父代理授权仅改测试，业务显隐代码未因此改动。首轮原报告和截图保留在 `anonymous-auth-first-report.json`、`first-run/`，日志为 `../logs/core-anonymous-auth-first.log`。

## 实际截图审阅

已逐图用 view_image 审阅以下 17 张文件：

- `login-desktop.png`、`login-mobile.png`
- `login-alternate-theme-desktop.png`、`login-alternate-theme-mobile.png`
- `login-password-step-desktop.png`、`login-password-step-mobile.png`
- `passkey-desktop.png`、`passkey-mobile.png`、`passkey-settled-desktop.png`
- `signup-desktop.png`、`signup-mobile.png`
- `reset-email-desktop.png`、`reset-email-mobile.png`
- `reset-email-settled-dark.png`、`reset-email-settled-light.png`
- `404-desktop.png`、`404-mobile.png`

观察：

1. 登录两步、注册、找回密码和 404 的主要内容及操作入口在所测尺寸内未出现遮挡、文本裁切或横向溢出。注册移动端的用户名/显示名称及验证码/发送按钮按列排列，提交及返回登录入口可见。
2. Passkey 的密码登录链接占 44×44，但 CSS 同时隐藏名称及图标，形成空白入口。computed style 和截图确认，非瞬态。已最小修改 `src/entries/auth.css`：仅在非 multiple provider grid 中隐藏 local 图标。离线真实 Chromium 回归证明 multiple 图标恢复为 21×21，single 的文字布局保持不变。证据：`auth-visual-details.json`、`provider-css-regression.json`、`verify-provider-css.mjs`。
3. 找回密码快速切换后的截图曾显示深色卡片而 DOM 为 light。等待 700ms 后 computed background 确认 light → dark → light 正常，补图也一致，属于抓图时序。验收脚本已加入渲染等待，未修改该页业务源码。

本节是截图及指定客户端交互检查，不等于完整无障碍、真实移动设备键盘或所有滚动位置验收。未测定整套颜色对比度数值。

## 冷直达评论锚点

R1 匿名复现：`/archives/mac-restart-podman-container-start#post-comments` 在窗口最初为零尺寸时完成浏览器原生 hash 定位；10s 后窗口可见，但 scrollTop 仍为 0、评论 y=4118、hidden=1、widget=0。手动点击同页评论锚点后 scrollTop=3479、hidden=0、widget=1。

对照 `/about#post-comments`：初期同样零尺寸，但 6 张指向旧 `192.168.1.23` 的内容图片挂起，页面仍为 interactive；后续原生锚点定位成功，scrollTop=5911、widget=1。这是内容资源限制，未修改正式内容。该页截图曾因 fonts.ready 等待超时，不把截图超时计为评论功能失败。

已修复 `src/apps/reader/hydrate.js` 冷初始化锚点恢复：仅 `initial-load` 且 hash 解码为 `post-comments` 时工作；节点有布局后定位，交给已有 IntersectionObserver 揭示评论；不执行 PJAX 滚动；已有滚动、wheel/touch/key 操作、hash 改变、节点离开或销毁时取消，代次保护且最多 60 帧。R2 曾新增直接调用的 helper，已因构建入口依赖问题在 R3 前删除，详见后文。

定向测试全部通过：

- `scripts/verify-reader-comment-anchor.mjs`：隐藏后显现、有效/非法/百分号 hash、无 hash、PJAX 排除、原生/手动滚动优先、快速销毁、旧代次回调、无限等待防护、替代评论提供方。
- `scripts/verify-lazy-comment-lifecycle.mjs`
- `scripts/verify-comment-integration.mjs`
- `scripts/verify-core-page-regressions.mjs`
- 本次文件 `git diff --check`

前例证据：`comment-anchor-before-fix.json`、`../logs/core-comment-anchor-before-fix.log`。只读诊断阻断 3 次 tracker counter POST；对应 `Failed to fetch` 属于阻断副作用，未写浏览计数。未发评论或点赞。

## R2 真页复测及发现的回归

环境：主题 `0.9.46 / 2502971fe17c`，sourceFingerprint `689b1a70c1bf1777797a2a30723d465e0a320bd77124713cbdf3072a8d093f64`。认证回归于 UTC 12:39:39.010–12:39:57.588 执行，10/10 通过；无 JS pageerror、表单提交、WebAuthn 调用、写请求或请求失败；404 各保留一条预期文档 404 console。

全部 14 张认证/错误页最终截图已重新逐图审阅。Passkey 的第四个密码登录图标在 desktop/mobile 均可见，computed 断言 iconVisible=true；找回密码的稳定截图恢复浅色，未再出现状态与画面不一致。其他布局未见新增遮挡或裁切。

两条冷锚点均无需点击即可到达评论：post scrollTop=3480、about=5911，hidden=0、widget=1。但 post 出现 7 条 Alpine 未定义错误（postUpvote/liked/pending/count/error）。根代理 smoke 同样复现。因此 R2 的整页运行验收失败，不能由锚点定位成功覆盖。

原因：R2 的 reader 引用了 shell 内的 `revealLazyCommentSection`，构建后的 `reader/index.js` 因 manual chunk 归属直接 import `shell-core/index.js`，主壳提前执行 Alpine.start，reader 的点赞组件随后才注册。该问题由本次 helper 引用引入。

R3 前最小纠正：删除该跨入口 import 及新增 export；冷锚点只 `scrollIntoView`，沿用既有 IO 揭示评论。定向测试已改为执行实际 `initLazyComments`，验证滚动本身不直接揭示、随后 IO 回调揭示。`scripts/smoke-theme.mjs` 增加 reader 构建静态依赖图检查，防止直接或间接依赖主壳入口；它位于 `pnpm check` 的构建后阶段。对现存 R2 错误产物运行，确实按预期捕获 `reader/index.js -> shell-core/index.js`。

证据：`anonymous-auth-results.json`、`comment-anchor-r2-regression.json`、`../logs/core-reader-entry-r2-counterexample.log`。R2 认证 15 个相关源码/模板 SHA 保存在 `auth-code-r2.json`，用于 R3 核对复用范围。

## R3 最终复测

源码于 UTC 12:46:02 冻结。R3 环境为 Halo 2.26.1、主题 `0.9.46 / 7d606b5e09d7`、sourceFingerprint `5d0ced93edafcb463e96f544cc4c1f309b8fa802d5895e3b1ac42e3e262c26db`（410 文件）。主代理已确认 check 和 active Reload 13 路由通过。

按主代理最后收敛要求，只复测冷锚点和认证代码/资产一致性，未重新跑注册或全组认证。

| R3 冷直达页面 | 点击前 scrollTop | 懒加载隐藏节点 | comment-widget | 非预期运行错误 |
| --- | ---: | ---: | ---: | ---: |
| `/archives/mac-restart-podman-container-start#post-comments` | 3479 | 0 | 1 | 0 |
| `/about#post-comments` | 5911 | 0 | 1 | 0 |

`check-comment-anchor.mjs` exit 0；R2 的 7 条 postUpvote/liked/pending/count/error 均未再出现。记录到的 3 条 `Failed to fetch` 与只读拦截的 3 个 tracker counter POST 对应，未提交点赞、评论或其他业务写入。

已实际查看 `comment-cold-post.png` 和 `comment-cold-about.png`：文章首屏已到评论标题和编辑器上部；独立页显示编辑器及真实 2 条评论。文章截图未覆盖编辑器下部，不将此视口当作全部评论功能验收。About 常规截图仍因字体等待 5s 超时，原始限制保留；额外 CDP 当前视口截图未等待 fonts.ready，其字体就绪状态不作为验收依据。旧 `192.168.1.23` 内容图片的限制仍在，未修改内容。

`verify-auth-code-assets.mjs` exit 0：15 个认证源码/模板 SHA 与 R2 完全一致；从真实 `/signup` HTML 提取的两个 auth CSS/JS URL 返回内容与本地 R3 构建逐字节一致。因此保留 R2 的 10 项认证实测范围，不宣称在 R3 重跑了这 10 项。

认证入口的 `r=1157` 来自 Halo `theme.metadata.version`，不同于资源 manifest 的构建 revision。资产核对脚本首轮误将二者要求相等，随后根据 `gateway_fragments/layout.html:31` 改为验证页面实际引用 URL 的响应字节，源码未改变。首轮错误保存在 `../logs/core-auth-code-assets-r3-first.log`，最终证据为 `auth-code-assets-r3.json`。

最终证据：`comment-anchor-results.json`、`auth-code-assets-r3.json`、`../logs/core-comment-anchor.log`、`../logs/core-auth-code-assets-r3.log`。R1/R2 反例与误判证据保持可追溯。

## 明确未执行

- 不提交登录、注册、验证码、重置或评论表单；不发邮件、不触发 WebAuthn、不登出用户。
- `templates/error/5xx.html` 仅静态核对 server variant 和主题壳，未制造真实 500。
- `templates/gateway_fragments/password_reset_email_reset.html` 仅核对 token 原生 action、POST 与两组密码按钮，未伪造有效 token 或重置密码成功。
