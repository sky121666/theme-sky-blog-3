import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function walk(dir, bucket = []) {
  if (!fs.existsSync(dir)) return bucket;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, bucket);
      continue;
    }
    bucket.push(full);
  }
  return bucket;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function fail(messages) {
  console.error('\n架构 lint 失败:\n');
  messages.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

const sourceFiles = walk(path.join(root, 'src')).filter((file) => file.endsWith('.js') || file.endsWith('.ts'));
const templateFiles = walk(path.join(root, 'templates')).filter((file) => file.endsWith('.html'));

const failures = [];

for (const file of sourceFiles) {
  const content = read(file);
  if (/from\s+['"][^'"]*features\/[^'"]*\/runtime\//.test(content)) {
    failures.push(`${path.relative(root, file)} 仍然引用旧 features runtime`);
  }
  if (/from\s+['"][^'"]*runtime\/widgets\/renderers\//.test(content)) {
    failures.push(`${path.relative(root, file)} 仍然引用旧 widget renderers`);
  }
}

const requiredTemplateChecks = [
  {
    file: 'templates/modules/shell/browser-window.html',
    patterns: ['window-frame :: shell(', 'window-titlebar :: shell(', 'data-window-content-root', 'data-window-content-variant="browser"']
  },
  {
    file: 'templates/modules/moments-app/window.html',
    patterns: ['window-frame :: shell(', 'window-titlebar :: shell(', 'data-window-content-root', 'data-window-content-variant="moments"']
  },
  {
    file: 'templates/modules/photos-app/window.html',
    patterns: ['window-frame :: shell(', 'window-titlebar :: shell(', 'data-window-content-root', 'data-window-content-variant="photos"']
  },
  {
    file: 'templates/modules/shell/window-titlebar.html',
    patterns: ['th:fragment="slots', 'th:fragment="titleStack']
  },
  {
    file: 'templates/modules/shell/window-titlebar-actions.html',
    patterns: ['th:fragment="themeToggle', 'th:fragment="refreshButton', 'th:fragment="shareMenu']
  },
  {
    file: 'templates/modules/shell/window-titlebar-leading.html',
    patterns: ['th:fragment="browserHistory', 'th:fragment="momentsBack', 'th:fragment="trafficLightsOnly']
  },
  {
    file: 'templates/modules/shell/window-frame.html',
    patterns: ['th:fragment="contentBody', 'data-window-content-root', 'data-window-content-variant']
  }
];

for (const check of requiredTemplateChecks) {
  const full = path.join(root, check.file);
  const content = read(full);
  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) {
      failures.push(`${check.file} 缺少必要片段或协议: ${pattern}`);
    }
  }
}

const forbiddenSelectorChecks = [
  {
    file: 'templates/modules/photos-app/window.html',
    patterns: ['data-photos-chrome-title', 'data-photos-chrome-subtitle']
  },
  {
    file: 'src/shell/desktop-shell/runtime/shared/page-app.js',
    patterns: ['data-photos-chrome-subtitle']
  },
  {
    file: 'src/shell/desktop-shell/runtime/desktop/pjax/index.js',
    patterns: ['data-photos-chrome-subtitle']
  },
  {
    file: 'src/features/photos-app/runtime/explorer.js',
    patterns: ['data-photos-chrome-title', 'data-photos-chrome-subtitle']
  },
  {
    file: 'src/apps/photos/runtime/explorer.js',
    patterns: ['data-photos-chrome-title', 'data-photos-chrome-subtitle']
  }
];

for (const check of forbiddenSelectorChecks) {
  const full = path.join(root, check.file);
  if (!fs.existsSync(full)) continue;
  const content = read(full);
  for (const pattern of check.patterns) {
    if (content.includes(pattern)) {
      failures.push(`${check.file} 仍然保留旧私有标题选择器: ${pattern}`);
    }
  }
}

if (failures.length) {
  fail(failures);
}

console.log('架构 lint 通过');
