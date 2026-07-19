import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const layout = fs.readFileSync(path.join(root, 'templates/modules/shell/layout.html'), 'utf8');
const importShellSource = layout.match(/const importShell = \(scriptUrl, styleUrl\) => \{[\s\S]*?\n\s*\};/)?.[0];

assert.ok(importShellSource, '无法从 layout.html 提取 importShell 实现');

function createImportShell(shellStyle) {
  const context = vm.createContext({
    shellStyle,
    URL,
    window: { location: { origin: 'https://example.com' } }
  });
  const functionSource = importShellSource
    .replace(/^const importShell = /, '')
    .replace('return import(scriptUrl);', 'return scriptUrl;')
    .replace(/;\s*$/, '');
  return vm.runInContext(`(${functionSource})`, context);
}

function trackedStyle(href) {
  let currentHref = href;
  let writes = 0;
  return {
    style: {
      get href() {
        return currentHref;
      },
      set href(value) {
        writes += 1;
        currentHref = new URL(value, 'https://example.com').href;
      }
    },
    get writes() {
      return writes;
    },
    get href() {
      return currentHref;
    }
  };
}

const samePath = trackedStyle('https://example.com/themes/theme-sky-blog-3/assets/css/shell-core/index.css?v=1&r=old');
assert.equal(
  createImportShell(samePath.style)(
    '/themes/theme-sky-blog-3/assets/js/shell-core/index.js?v=1&r=new',
    '/themes/theme-sky-blog-3/assets/css/shell-core/index.css?v=1&r=new'
  ),
  '/themes/theme-sky-blog-3/assets/js/shell-core/index.js?v=1&r=new',
  '样式判断不能改变脚本 URL'
);
assert.equal(samePath.writes, 0, '相同 CSS pathname 仅 revision 不同时不得重复替换 href');

const differentPath = trackedStyle('https://example.com/themes/theme-sky-blog-3/assets/css/legacy.css?v=1');
createImportShell(differentPath.style)(
  '/themes/theme-sky-blog-3/assets/js/shell-core/index.js?v=1',
  '/themes/theme-sky-blog-3/assets/css/shell-core/index.css?v=1'
);
assert.equal(differentPath.writes, 1, 'CSS pathname 变化时必须替换 href');
assert.equal(differentPath.href.endsWith('/assets/css/shell-core/index.css?v=1'), true);

assert.doesNotThrow(() => {
  createImportShell(null)('/assets/js/shell-core/index.js', '/assets/css/shell-core/index.css');
}, '缺少预加载 style link 时不能抛错');

assert.equal(layout.includes('photoFinder.listAll()'), false, '桌面 bootstrap 禁止重新读取全部照片');
const photoSize = Number(layout.match(/photoFinder\.list\(1,\s*(\d+)\)/)?.[1]);
const steamSize = Number(layout.match(/steamFinder\.getOwnedGames\(1,\s*(\d+)\)/)?.[1]);
assert.ok(Number.isInteger(photoSize) && photoSize > 0 && photoSize <= 12, '照片 Finder 首批大小必须在预算内');
assert.ok(Number.isInteger(steamSize) && steamSize > 0 && steamSize <= 12, 'Steam Finder 首批大小必须在预算内');
assert.match(layout, /photos=\$\{widgetsPhotos != null \? widgetsPhotos\.items : \{\}\}/, 'Photo Page 必须消费 items');
assert.match(layout, /steamOwnedGames=\$\{widgetsSteamWidgetGames != null \? widgetsSteamWidgetGames\.items : \{\}\}/, 'Steam Page 必须消费 items');
assert.match(layout, /widgetsPhotosAvailable \? photoFinder\.list\(1,\s*\d+\) : null/, 'Photos 插件不可用时必须短路 Finder');
assert.match(layout, /widgetsSteamAvailable \? steamFinder\.getOwnedGames\(1,\s*\d+\) : null/, 'Steam 插件不可用时必须短路 Finder');
assert.match(layout, /dockImageAllowed\s*=\s*\$\{[^}]*https:\/\//, 'Dock 必须使用图片 URL 协议白名单');
assert.match(layout, /iconType == 'image' and dockImageAllowed/, 'Dock img 只能输出允许的 URL');
assert.match(layout, /dock-icon-svg dock-icon-svg--fallback/, 'Dock data URI 必须有轻量回退图标');

const header = fs.readFileSync(path.join(root, 'templates/modules/shell/header.html'), 'utf8');
assert.equal((header.match(/childImageAllowed\s*=\s*\$\{/g) || []).length, 2, '桌面和移动 Header 必须分别校验图片 URL');
assert.equal((header.match(/childIconType == 'image' and childImageAllowed/g) || []).length, 2, 'Header img 只能输出允许的 URL');
assert.equal((header.match(/childIconType == 'image' and !childImageAllowed/g) || []).length, 2, 'Header 无效图片必须有回退图标');

console.log('shell bootstrap contract passed');
