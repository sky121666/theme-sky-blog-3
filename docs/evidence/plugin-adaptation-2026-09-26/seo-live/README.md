# SEO Tools 1.10.1：真实 head / PJAX 验收与最小修复

日期：2026-09-26。测试站点：`http://localhost:8090`。Canonical 使用站点配置的公开域名 `https://www.5ee.net`，没有要求它改成验收站点的 localhost。

## 结论

- R2 收集了 **14 个真实页面的 SSR head**，完成 13 个直接加载和 9 次 PJAX SEO 对比；Photos 直接加载有一次 30 秒 DOMContentLoaded 超时，原始证据保留。
- 发现 `CollectionPage` 的插件原生 JSON-LD 身份 URL 带双斜杠，分类/标签分页还缺少当前 `p` 参数。经明确授权，主题客户端增加了严格限定的修补。
- R3 **5/5 直接加载、4/4 PJAX 往返通过，退出码 0**；Photos 原超时页、富文章 head 均通过。页面 JS 错误 0，非 GET/HEAD/OPTIONS 请求 0。
- **原始 SSR 上游缺口仍保留**。R3 修复发生于主题客户端初始化和 PJAX head 同步，不代表插件原始 HTML 已修好，也不是搜索引擎抓取或排名验收。

## 环境和来源

| 项目 | 证据 |
| --- | --- |
| Halo / 主题 | Halo `2.26.1`；启用 `theme-sky-blog-3`；版本 `0.9.46` |
| R2 | revision `2502971fe17c`；原始矩阵为 `report.json` |
| R3 | revision `7d606b5e09d7`；sourceFingerprint `5d0ced93edafcb463e96f544cc4c1f309b8fa802d5895e3b1ac42e3e262c26db`；`../environment-code.json` |
| 插件 | `seo-tools` / `1.10.1` / enabled / STARTED；当前快照和浏览器 head 同时核对 |
| 工具 | Node `v24.18.0`，项目 pnpm `10.34.5`，Playwright Chromium `149.0.7827.55`；新匿名上下文，1440×960，禁用 Service Worker |
| 官方当前版本 | [官方版本列表](https://www.halo.run/store/apps/app-FNGbT/releases) 当前标记 `1.10.1` 最新，要求 Halo `>=2.23.0`；1.10.1 修复非公开文章自动推送，未据此重写有效主题契约 |
| 官方职责 | [插件介绍](https://www.halo.run/store/apps/app-FNGbT) 列出 Canonical、结构化数据和社交元数据；[社交媒体文档](https://www.halo.run/docs/plugin-seo-tools/usage/smo) 说明 OG / Twitter 等功能受配置影响 |
| 主题合同 | `docs/插件适配契约.md#pc-seo` 的既有契约基线为 `1.9.5`；本次验证的安装版本是 `1.10.1`，二者没有混用 |

官方链接指向的源码比较页面不可公开读取，本次不声称审阅了插件私有 Java 实现。插件原生输出以真实 SSR 为证据；主题源码及其不生成服务端 JSON-LD 的边界已核对。

## 原反例与修复边界

R2 `/tags?p=2` 的真实原始片段：

```json
{
  "name": "Tags",
  "url": "https://www.5ee.net//tags",
  "mainEntityOfPage": "https://www.5ee.net//tags",
  "publisher": { "name": "", "@type": "Organization" },
  "@context": "https://schema.org",
  "@type": "CollectionPage"
}
```

该页 canonical 为 `https://www.5ee.net/tags?p=2`。同类问题出现在归档和分类集合。对本机相同路径 `//archives`、`//categories`、`//tags` 的匿名 GET 均为 400，见 `jsonld-url-probe.json`；没有据此断言公网服务器也返回同一状态码。

修改文件：

- [seo.js](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/shell/desktop-shell/runtime/desktop/pjax/seo.js:214)：可信 canonical 检查；[当前页面身份修补](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/shell/desktop-shell/runtime/desktop/pjax/seo.js:237)；[结构化数据入口](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/src/shell/desktop-shell/runtime/desktop/pjax/seo.js:280)。
- [verify-seo-contract.mjs](/Users/sky/Public/work/sky-blog1/themes/theme-sky-blog-3/scripts/verify-seo-contract.mjs:266)：真实反例、不能改写的边界、幂等性与 PJAX 往返回归。

修补条件全部成立才修改：

1. 当前唯一 canonical 与主题 `data-canonical` 完全一致，且为无凭据、无 hash 的 HTTP(S) URL。
2. Canonical 不含查询参数，或只含一个有效正整数 `p` 分页参数。
3. 节点是文档顶层、顶层数组或 `@graph` 中的 `CollectionPage`；支持 `@type` 数组。
4. 节点已有的 `url` / `mainEntityOfPage` 为字符串或带字符串 `@id` 的对象；每个字段都同 origin，归并重复斜杠后的 path 与 canonical 相同，原 query 为空或已与 canonical 相同，且无 hash / 凭据。
5. 只将上述身份字段设为当前 canonical，不补不存在的身份字段。

保留非 CollectionPage、其他域名/path/不同分页/query/hash、图片、作者、`hasPart`、`itemListElement` 和其他内容实体。既有空 publisher 名称修补继续独立执行。没有删除插件 head、全局字符串替换、修改共享 Halo、修改插件或后台配置。

## R3 SSR 与客户端修后对照

下面列出的两个身份字段均同时核对。

| 实际测试 URL | SSR `url` / `mainEntityOfPage` | R3 客户端与 PJAX |
| --- | --- | --- |
| `http://localhost:8090/archives` | `https://www.5ee.net//archives` | `https://www.5ee.net/archives` |
| `http://localhost:8090/categories?p=2` | `https://www.5ee.net//categories` | `https://www.5ee.net/categories?p=2` |
| `http://localhost:8090/tags?p=2` | `https://www.5ee.net//tags` | `https://www.5ee.net/tags?p=2` |

R3 从标签分页出发，依次 PJAX 到分类分页 → 归档 → 标签分页 → 分类分页。4 步都保留同一 document 哨兵，完整 head 与该目标的直接加载一致，SEO 更新事件 URL 指向目标 canonical，JSON-LD 始终只保留当前集合页一个块。没有旧分页身份残留。

R3 另验证：

- `http://localhost:8090/archives/editor-feature-demo`：非空文章摘要、OG / Twitter 描述与图片、Article URL / mainEntityOfPage、发布日期/修改日期、作者图片、标签和 keywords 保留。只继续修补插件空 publisher.name 和不合法 Twitter handle。
- `http://localhost:8090/photos/photo-yvqae9y4?page=2&size=6`：原超时页已直接加载通过，canonical 正确去除列表返回上下文 query；OG / Twitter 当前照片身份正确，未擅自添加不存在的 JSON-LD。

## R2 代表页面覆盖矩阵

所有路由均基于 `http://localhost:8090`。具体原始 head 文件为 `<name>-ssr-head.html`，字段和来源标识见 `report.json`。

| 路由 | title / description | canonical / robots | OG / Twitter / JSON-LD |
| --- | --- | --- | --- |
| `/` | 首页标题、站点描述 | 公开站点根地址 | 插件社交字段；主题 OG URL/站点名；WebSite |
| `/archives` | 归档标题、主题补站点描述 | `/archives` | 社交字段；SSR 无 OG URL，客户端按已配置 fallback 补；CollectionPage（R3 身份修复） |
| `/categories?p=2` | 含第 2 页标题、描述 | self-canonical 保留 `p=2` | 社交字段；CollectionPage（R3 身份修复） |
| `/tags?p=2` | 含第 2 页标题、描述 | self-canonical 保留 `p=2` | 社交字段；CollectionPage（R3 身份修复） |
| `/tags?p=999999` | 越界页标题、描述 | SSR/客户端 `noindex,follow` | R2 PJAX 离开后 robots 正确移除，无残留；R3 对同类集合身份的修复另有 mock 与有效分页真页验证 |
| `/archives/ijhJxHtw` | “测试”文章本身摘要为空；没有虚构摘要 | 文章 permalink | Article/社交标题正确；R2 7 条 reader 注册错误独立记录，R3 富文章无此错误 |
| `/about` | 自定义页面标题和实际内容描述 | `/about` | OG/Twitter、Article |
| `/links?view=apply` | 申请视图标题、主题站点描述 | 按既有应用规则合并到 `/links` | OG/Twitter；无 JSON-LD，未强制新增 |
| `/douban?type=movie&dataType=db&status=done&page=2&size=2` | 豆瓣记录标题和描述 | 按插件 canonical 规则合并 `/douban` | OG/Twitter；无 JSON-LD，未强制新增 |
| `/photos/photo-yvqae9y4?page=2&size=6` | 照片标题/描述 | 当前照片 permalink | SSR head 已采；R2 直接加载超时，R3 直接加载补过 |
| `/steam` | Steam 游戏库标题和描述 | `/steam` | OG/Twitter；无 JSON-LD，未强制新增 |
| `/docs/halo-theme-sky-blog-1` | 当前首篇“简介”和实际描述 | SSR canonical 为项目别名；客户端按既有主题权威改成 `/docs/halo-theme-sky-blog-1/jianjie` | SSR OG URL/TechArticle 已指向 `/jianjie`；PJAX 与直接加载一致 |
| `/docs/halo-theme-sky-blog-1/theme-settings` | 目录标题和描述 | 当前目录路径 | OG/Twitter、CollectionPage，正确路径不改写 |
| `/docs/halo-theme-sky-blog-1/jianjie` | 文档标题和描述 | 文档 permalink | OG/Twitter、TechArticle |

R2 9 次 PJAX 路径：文章 → Docsme 别名 → Docsme 目录 → Douban 筛选 → 标签越界 → 标签分页 → Links 申请视图 → 文章 → 首页。每步都与直接加载的标题、description、canonical、robots、OG、Twitter、JSON-LD、RSS 相同，document 哨兵保留，未发生标签累积。

RSS 属于 PluginFeed/主题 discovery 协作，不归 SEO Tools 生成。全部采样 head 恰有一条 `/rss.xml` alternate；真实 `/rss.xml` 返回 200、`application/xml`、RSS 根节点和 20 个 item。

## 仍保留的原始 SSR 边界

- CollectionPage 双斜杠及分页身份：如上表，R3 SSR 原值仍在；只修客户端/PJAX。
- 原生 `twitter:creator` 出现 `@null` 或作者 URL：既有客户端规则删除非法 handle；原始 SSR 未改。
- 原生 JSON-LD `publisher.name` 为空：既有客户端使用站点名 `5ee博客`；原始 SSR 未改。
- Docsme 项目别名：插件 SSR canonical 是请求别名，主题 SSR `og:url` 与插件 TechArticle 已是真实文档 permalink；既有客户端规则统一 canonical。原始 HTML 的差异仍需上游/服务端安全扩展点处理。
- 图像、社交字段和结构化类型因页面内容、插件配置和页面类型不同，没有以“每页所有字段必须存在”作为检查标准。

## 测试命令、退出码与异常分类

运行环境前缀：

```sh
PATH="$PWD/output/interface-fixes-2026-09-26/bin:/Users/sky/Library/pnpm/nodejs/24.18.0/bin:$PATH"
HALO_BASE_URL=http://localhost:8090
```

| 命令 | 退出码 | 证据 |
| --- | --- | --- |
| `node output/page-adaptation-2026-09-26/seo-live/verify-seo-live.mjs`（R2） | 1 | `run.log` / `report.json`；14 SSR 200，13 直接通过/1 Photo 超时，9 PJAX通过 |
| `node scripts/verify-seo-contract.mjs` | 0 | `verify-seo-contract-fix.log`；既有8类合同、新反例/保护边界/幂等性/4步 mock PJAX |
| `node --check src/shell/desktop-shell/runtime/desktop/pjax/seo.js` | 0 | 语法检查 |
| `node --check scripts/verify-seo-contract.mjs` | 0 | 语法检查 |
| `SEO_EXPECTED_REVISION=7d606b5e09d7 node output/page-adaptation-2026-09-26/seo-live/verify-seo-r3.mjs` | 0 | `r3-run.log` / `r3-report.json`；5 直接/4 PJAX通过 |

这里的 `node` 实际使用 `/Users/sky/Library/pnpm/nodejs/24.18.0/bin/node`。主代理负责整体 check/build/reload，本代理没有重复构建或 reload。

R2 原始退出码 1 未隐藏：一次 Photo 导航超时；7 条主代理已确认的 reader/Alpine 冷启动注册错误；一条 `Failed to fetch` 与被只读拦截的 `POST /apis/api.halo.run/v1alpha1/trackers/counter` 同次运行出现。该 POST 在发送前已 abort，没有执行计数写入；没有把它当成 SEO 标签错误。R3 定向运行没有这些错误或非 GET 请求。

## 未覆盖

未提交评论/申请/点赞/表单，未保存插件配置，未升级或修改插件、Halo Core、Git。未验证搜索引擎真实抓取/索引/推送、排名、外部社交平台卡片抓取、微信认证功能、所有文章/路由、插件禁用的真实站点状态或多语言/权限隔离页面。客户端结果不能替代这些范围，也不能替代原始 SSR 修复。
