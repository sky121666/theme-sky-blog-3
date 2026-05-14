import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const assetManifestFile = path.join(root, 'templates/assets/asset-manifest.json');
assert(fs.existsSync(assetManifestFile), '缺少 templates/assets/asset-manifest.json');

const manifest = readJson(assetManifestFile);
const requiredAssets = ['shell-core', 'auth', 'reader', 'moments', 'friends', 'links', 'bangumis', 'steam', 'equipments', 'photos', 'explorer-tags', 'explorer-categories', 'explorer-author', 'explorer-archives'];

for (const key of requiredAssets) {
  assert(manifest[key], `asset-manifest 缺少入口: ${key}`);
  for (const jsFile of manifest[key].js || []) {
    const local = path.join(root, 'templates/assets', jsFile.replace(/^\/themes\/theme-sky-blog-3\/assets\//, ''));
    assert(fs.existsSync(local), `缺少 JS 产物: ${jsFile}`);
  }
  for (const cssFile of manifest[key].css || []) {
    const local = path.join(root, 'templates/assets', cssFile.replace(/^\/themes\/theme-sky-blog-3\/assets\//, ''));
    assert(fs.existsSync(local), `缺少 CSS 产物: ${cssFile}`);
  }
}

const legacyOutputs = [
  'templates/assets/css/explorer.css',
  'templates/assets/css/moments-app.css',
  'templates/assets/css/photos-app.css',
  'templates/assets/js/chunks/renderers.js'
];

for (const rel of legacyOutputs) {
  assert(!fs.existsSync(path.join(root, rel)), `遗留旧产物未清理: ${rel}`);
}

const protocolChecks = [
  ['templates/gateway_fragments/layout.html', ['data-app-root="auth"', 'data-app-props="auth"', 'data-page-mode="auth"']],
  ['templates/modules/browser-reader/post.html', ['data-app-root="reader"', 'data-app-props="reader"']],
  ['templates/modules/browser-reader/page.html', ['data-app-root="reader"', 'data-app-props="reader"']],
  ['templates/modules/moments-app/list.html', ['data-app-root="moments"', 'data-app-props="moments"']],
  ['templates/modules/moments-app/detail.html', ['data-app-root="moments"', 'data-app-props="moments"']],
  ['templates/modules/friends-app/list.html', ['data-app-root="friends"', 'data-app-props="friends"']],
  ['templates/modules/links-app/list.html', ['data-app-root="links"', 'data-app-props="links"']],
  ['templates/modules/bangumis-app/list.html', ['data-app-root="bangumis"', 'data-app-props="bangumis"']],
  ['templates/modules/steam-app/list.html', ['data-app-root="steam"', 'data-app-props="steam"']],
  ['templates/modules/equipments-app/list.html', ['data-app-root="equipments"', 'data-app-props="equipments"']],
  ['templates/photos.html', ['data-app-root="photos"', 'data-app-props="photos"']],
  ['templates/photo.html', ['data-app-root="photos"', 'data-app-props="photos"', '<halo:comment group="core.halo.run" kind="Photo"']],
  ['templates/modules/browser-explorer/tags.html', ['data-app-root="explorer-tags"', 'data-app-props="explorer-tags"']],
  ['templates/modules/browser-explorer/categories.html', ['data-app-root="explorer-categories"', 'data-app-props="explorer-categories"']],
  ['templates/modules/browser-explorer/author.html', ['data-app-root="explorer-author"', 'data-app-props="explorer-author"']],
  ['templates/modules/browser-explorer/archives.html', ['data-app-root="explorer-archives"', 'data-app-props="explorer-archives"']]
];

for (const [rel, patterns] of protocolChecks) {
  const content = read(path.join(root, rel));
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${rel} 缺少协议字段: ${pattern}`);
  }
}

const seoProtocolChecks = [
  [
    'templates/modules/shell/layout.html',
    [
      "seoPluginAvailable = ${pluginFinder.available('seo-tools') or pluginFinder.available('plugin-seo-tools')}",
      "shouldEmitMetaFallback = ${!seoPluginAvailable and (seoFallbackMode == 'meta' or seoFallbackMode == 'full')}",
      "shouldEmitCanonicalFallback = ${!seoPluginAvailable and !#strings.isEmpty(absoluteCanonical)}",
      "shouldEmitSocialFallback = ${!seoPluginAvailable and seoFallbackMode == 'full'}",
      '<meta name="robots" th:if="${error != null}" content="noindex,nofollow" />',
      '<link rel="canonical"',
      'th:if="${shouldEmitCanonicalFallback}"',
      '<meta property="og:description"',
      'th:if="${shouldEmitSocialFallback and !#strings.isEmpty(pageDescription)}"',
      '<meta name="twitter:description"',
      '<link rel="alternate" type="application/rss+xml" title="RSS" th:href="@{/rss.xml}" />',
      'window.__SKY_THEME_ROUTES__ = Object.freeze({',
      'categoriesUri: [[${themeCategoriesUri}]]',
      'tagsUri: [[${themeTagsUri}]]',
      'archivesUri: [[${themeArchivesUri}]]'
    ]
  ],
  [
    'src/shell/desktop-shell/runtime/desktop/pjax/seo.js',
    [
      "meta[property^='og:']",
      "meta[property^='article:']",
      "meta[name^='twitter:']",
      "script[type='application/ld+json']",
      "new CustomEvent('pjax:seo-updated'",
      'detail: { title, url }'
    ]
  ],
  [
    'src/shell-core/runtime/route-manifest.js',
    [
      'function getThemeRoutes()',
      "categoriesUri: '/categories'",
      "tagsUri: '/tags'",
      "archivesUri: '/archives'",
      'matchesArchiveRoute(pathname)',
      'matchesDefaultReaderRoute(pathname)',
      '^\\/photos\\/(?:page\\/)?[^/]+\\/?$'
    ]
  ],
  [
    'templates/modules/browser-explorer/categories.html',
    [
      "canonical = ${!#strings.isEmpty(site.routes?.categoriesUri) ? site.routes.categoriesUri : '/categories'}"
    ]
  ],
  [
    'templates/modules/browser-explorer/tags.html',
    [
      "canonical = ${!#strings.isEmpty(site.routes?.tagsUri) ? site.routes.tagsUri : '/tags'}"
    ]
  ],
  [
    'templates/modules/browser-explorer/archives.html',
    [
      "canonical = ${!#strings.isEmpty(site.routes?.archivesUri) ? site.routes.archivesUri : '/archives'}"
    ]
  ],
  [
    'templates/gateway_fragments/layout.html',
    ['<meta name="robots" content="noindex,nofollow" />']
  ],
  [
    'templates/index.html',
    ['<h1 class="sr-only" th:text="${site.title}"></h1>']
  ],
  [
    'templates/modules/moments-app/list.html',
    ['<h1 class="sr-only">瞬间</h1>']
  ],
  [
    'templates/photos.html',
    ['<h1 class="sr-only" th:text="${resolvedWindowTitle}">图库</h1>']
  ],
  [
    'templates/modules/browser-explorer/categories.html',
    ['<h1 class="sr-only">所有分类</h1>']
  ],
  [
    'templates/modules/browser-explorer/tags.html',
    ['<h1 class="sr-only">所有标签</h1>']
  ],
  [
    'templates/modules/browser-explorer/archives.html',
    ['<h1 class="sr-only">文章归档</h1>']
  ]
];

for (const [rel, patterns] of seoProtocolChecks) {
  const content = read(path.join(root, rel));
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${rel} 缺少 SEO/PJAX 协议: ${pattern}`);
  }
}

const seoForbiddenPatterns = [
  ['templates/modules/browser-explorer/categories.html', "canonical = '/categories'"],
  ['templates/modules/browser-explorer/tags.html', "canonical = '/tags'"],
  ['templates/modules/browser-explorer/archives.html', "canonical = ''"]
];

for (const [rel, pattern] of seoForbiddenPatterns) {
  const content = read(path.join(root, rel));
  assert(!content.includes(pattern), `${rel} 不应再使用硬编码 SEO 路由: ${pattern}`);
}

const photosLightboxForbiddenPatterns = [
  ['templates/photos.html', 'openLightbox'],
  ['templates/photos.html', 'photos-lightbox'],
  ['src/apps/photos/runtime/explorer.js', 'lightboxOpen'],
  ['src/apps/photos/runtime/explorer.js', 'openLightbox'],
  ['src/apps/photos/runtime/explorer.js', 'closeLightbox'],
  ['src/apps/photos/styles/index.css', 'photos-lightbox'],
  ['src/apps/photos/styles/index.css', 'cursor: zoom-in']
];

for (const [rel, pattern] of photosLightboxForbiddenPatterns) {
  const content = read(path.join(root, rel));
  assert(!content.includes(pattern), `${rel} 不应保留图库内置放大效果: ${pattern}`);
}

const photosWindowChecks = [
  [
    'templates/modules/photos-app/window.html',
    ["th:replace=\"~{modules/shell/window-titlebar-actions :: refreshButton(", "iconClasses='w-4 h-4'", "buttonClasses='photos-titlebar-btn'"]
  ]
];

for (const [rel, patterns] of photosWindowChecks) {
  const content = read(path.join(root, rel));
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${rel} 缺少图库标题栏结构: ${pattern}`);
  }
}

const tagWidgetChecks = [
  [
    'src/widgets/halo/random-tags/render.js',
    ['const limit = size === \'large\' ? (isCompact ? 24 : 30) : (isCompact ? 24 : 30);', 'return `<span class=\"wg-tag-chip-slot\">${chip}</span>`;', 'return chip;']
  ],
  [
    'src/shell/desktop-shell/entry-main.js',
    ["const loadingRoot = el.firstElementChild?.classList?.contains('desktop-widget-loading') === true;", "if (loadingRoot && !nextHtml.includes('desktop-widget-loading')) {", 'el.innerHTML = nextHtml;']
  ],
  [
    'src/shell/desktop-shell/styles/widgets/content/tags.css',
    [':root:not(.dark) .desktop-widget-card.widget--halo-random_tags.is-medium[data-widget-appearance="follow"],', '.desktop-widget-card.widget--halo-random_tags.is-medium .desktop-widget-header {', '.desktop-widget-card.widget--halo-random_tags.is-medium .desktop-widget-body {', 'padding: 10px 14px 16px !important;', 'overflow-y: auto;', 'mask-image: linear-gradient(', '.desktop-widget-card.widget--halo-random_tags.is-medium .desktop-widget-body>.wg-tag-wall {', 'display: flex;', 'flex-wrap: wrap;', 'justify-content: center;', '.desktop-widget-card.widget--halo-random_tags.is-medium .wg-tag-chip-slot {', 'display: inline-flex;', '.desktop-widget-card.widget--halo-random_tags.is-medium .wg-tag-chip {', 'background: rgba(255, 255, 255, 0.6);', 'transform: rotate(var(--j-rot, 0deg)) translate(var(--j-tx, 0px), var(--j-ty, 0px));', '.desktop-widget-card.widget--halo-random_tags.is-medium .wg-tag-chip:hover {', 'transform: rotate(0deg) scale(1.05);']
  ]
];

for (const [rel, patterns] of tagWidgetChecks) {
  const content = read(path.join(root, rel));
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${rel} 缺少标签小组件 live 布局收口: ${pattern}`);
  }
}

const authStructureChecks = [
  [
    'templates/gateway_fragments/layout.html',
    ['class="auth-gateway-card mac-window"', 'class="mac-titlebar"', 'class="auth-titlebar-leading"', 'class="mac-traffic-lights"', 'class="mac-traffic-light close auth-traffic-link"', 'th:href="@{/}"', 'class="auth-titlebar-back"', 'data-auth-go-back', 'class="auth-titlebar-actions"', 'data-auth-theme-toggle', 'auth-toast-stack', 'data-auth-toast-host', 'gateway_fragments/login::toast']
  ],
  [
    'templates/gateway_fragments/login.html',
    ['th:text="${!#strings.isEmpty(headerAppName) ? headerAppName : site.title}"', 'data-auth-toast', 'id="login-form" autocomplete="on"']
  ],
  [
    'templates/login_local.html',
    ['id="password" name="password"', 'autocomplete="current-password"']
  ],
  [
    'templates/gateway_fragments/common.html',
    ['th:fragment="loginProviderSection"', 'auth-provider-section', 'auth-provider-grid auth-provider-grid-icons', 'th:fragment="returnToSiteContent"', '留空，不再显示底部返回首页', 'loginForm.addEventListener("formdata"', 'event.formData.set("password", encrypted);', 'document.createElement("input")']
  ],
  [
    'templates/gateway_fragments/password_reset_email_send.html',
    ['邮件已发送', 'auth-status-orb']
  ],
  [
    'templates/gateway_fragments/logout.html',
    ['auth-logout-flow', 'auth-logout-hero', 'auth-button-stack auth-logout-actions', 'user.spec.avatar', 'user.spec.displayName', 'user.metadata.name']
  ],
  [
    'src/entries/auth.css',
    ['.auth-login-badge', '.auth-view-title', '.auth-view-subtitle', '.auth-status-orb', '.auth-logout-flow', '.auth-logout-hero', '.auth-logout-actions', '.auth-logout-avatar-orb', '.auth-toast-stack', '.auth-alert-toast', 'padding-left: 52px !important', 'padding-right: 48px !important', 'left: -9999px', '.auth-titlebar-actions', '.auth-theme-toggle', '.auth-titlebar-leading', '.auth-titlebar-back', 'background: none;', 'box-shadow: none;', '.auth-login-badge img', 'border-radius: 18px;', '.auth-traffic-link', '--auth-brand-box-size:', 'aspect-ratio: 1 / 1;', 'min-height: var(--auth-brand-lock-height);']
  ],
  [
    'src/entries/auth.js',
    ['initAuthThemeToggle', 'initAuthBackLink', 'initAuthToasts', 'data-auth-theme-toggle', 'data-auth-go-back', 'data-auth-toast', "window.history.length > 1", "localStorage.setItem('theme'"]
  ],
  [
    'src/entries/auth.css',
    ['.altcha {', '.altcha[data-floating] {', 'left: 50% !important;', 'right: auto !important;', 'transform: translateX(-50%) !important;', 'width: min(208px, calc(100vw - 32px)) !important;', '.altcha .altcha-main {', '.altcha .altcha-footer {']
  ]
];

for (const [rel, patterns] of authStructureChecks) {
  const content = read(path.join(root, rel));
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${rel} 缺少认证结构: ${pattern}`);
  }
}

const authForbiddenBackgroundPatterns = [
  ['src/entries/auth.css', 'radial-gradient(at 100% 0%, rgba(190, 210, 250, 0.8) 0, transparent 50%)'],
  ['src/entries/auth.css', 'radial-gradient(at 100% 0%, rgba(20, 50, 100, 0.6) 0, transparent 50%)'],
  ['src/entries/auth.css', 'background-attachment: fixed;'],
  ['templates/gateway_fragments/layout.html', 'auth-stage-tools'],
  ['templates/gateway_fragments/layout.html', '返回上一页</span>'],
  ['templates/gateway_fragments/logout.html', '@halo'],
  ['templates/gateway_fragments/logout.html', 'currentUser'],
  ['templates/gateway_fragments/logout.html', 'auth-alert auth-alert-info'],
  ['templates/gateway_fragments/logout.html', 'auth-logout-card'],
  ['templates/gateway_fragments/common.html', 'plainPasswordInput.name = "plainPassword"'],
  ['templates/gateway_fragments/common.html', '<script type="module" src="/js/main.js"></script>'],
  ['templates/login_local.html', 'data-auth-encrypted-password'],
  ['templates/login_local.html', 'auth-toggle-password'],
  ['templates/login_local.html', 'auth-input-wrap'],
  ['templates/login_local.html', 'auth-password-wrap'],
  ['src/entries/auth.js', 'querySelectorAll?.(\'altcha-widget[floating]\')'],
  ['src/entries/auth.js', "widget.removeAttribute('floating')"],
  ['templates/gateway_fragments/signup.html', 'autocomplete="off"'],
  ['templates/gateway_fragments/password_reset_email_reset.html', 'autocomplete="off"'],
  ['templates/gateway_fragments/password_reset_email_send.html', 'placeholder="name@example.com" autofocus required th:field="*{email}"'],
  ['src/widgets/halo/random-tags/render.js', 'resolveTagCandidateLimit'],
  ['src/widgets/halo/random-tags/render.js', 'data-tag-pack="balanced"'],
  ['src/widgets/halo/random-tags/render.js', 'data-tag-pack-order'],
  ['src/widgets/halo/random-tags/render.js', 'function rebalanceTagWall(wall)'],
  ['src/widgets/halo/random-tags/render.js', 'document.addEventListener(\'pjax:complete\', scheduleRebalance)'],
  ['templates/modules/shell/desktop-widgets.html', "'halo.random_tags'"]
];

for (const [rel, pattern] of authForbiddenBackgroundPatterns) {
  const content = read(path.join(root, rel));
  assert(!content.includes(pattern), `${rel} 不应再包含单独适配的认证背景: ${pattern}`);
}

console.log('构建 smoke 通过');
