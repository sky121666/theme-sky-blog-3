import { buildSync, transformSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export function renderEarlyDesktopTemplate(root) {
  const result = buildSync({
    stdin: {
      contents: "import { renderEarlyDesktopSurface } from './src/shell/desktop-shell/runtime/desktop/surface/early-surface.js'; renderEarlyDesktopSurface(document);",
      resolveDir: root,
      sourcefile: 'early-desktop-entry.js'
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true
  });
  const code = result.outputFiles[0].text;
  const css = transformSync(fs.readFileSync(path.join(root, 'src/shell/desktop-shell/styles/desktop/surface-early.css'), 'utf8'), {
    loader: 'css', minify: true
  }).code;
  if (code.includes('</script')) throw new Error('Unexpected closing script in early desktop');
  if (css.includes('</style')) throw new Error('Unexpected closing style in early desktop');
  console.log(`[desktop-preview] ${Buffer.byteLength(code + css)} raw / ${gzipSync(code + css).byteLength} gzip bytes (home only)`);
  return `<th:block xmlns:th="https://www.thymeleaf.org" th:fragment="surface" th:if="\${isDesktopHome and widgetsEnabled}"><style data-theme-early-desktop-style>${css}</style><script data-theme-early-desktop>${code}</script></th:block>\n`;
}
