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
const requiredAssets = ['shell-core', 'auth', 'reader', 'moments', 'photos', 'explorer-tags', 'explorer-categories', 'explorer-author', 'explorer-archives'];

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
  ['templates/photos.html', ['data-app-root="photos"', 'data-app-props="photos"']],
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
  ['templates/gateway_fragments/password_reset_email_send.html', 'placeholder="name@example.com" autofocus required th:field="*{email}"']
];

for (const [rel, pattern] of authForbiddenBackgroundPatterns) {
  const content = read(path.join(root, rel));
  assert(!content.includes(pattern), `${rel} 不应再包含单独适配的认证背景: ${pattern}`);
}

console.log('构建 smoke 通过');
