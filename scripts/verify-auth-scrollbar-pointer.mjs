import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const css = await readFile(new URL('../src/entries/auth.css', import.meta.url), 'utf8');
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents:
  `import { initAuthScrollbars } from './src/entries/auth.js'; window.__initScrollbar = initAuthScrollbars;`
}, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
const browser = await chromium.launch({ headless: true });
const result = { method: 'Real Chromium hit-testing and pointer drag; production CSS/runtime, Windows platform branch simulated; not a Windows host test' };
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
  await page.setContent(`<style>${css}</style><body class="auth-gateway-page"><div style="height:2400px;flex:none">long authentication content</div></body>`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => __initScrollbar());
  const point = await page.evaluate(() => {
    const thumb = document.querySelector('.auth-scrollbar-thumb');
    const rect = thumb.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return { x, y, hit: document.elementFromPoint(x, y)?.classList.contains('auth-scrollbar-thumb'), pointerEvents: getComputedStyle(thumb).pointerEvents };
  });
  result.point = point;
  assert.equal(point.hit, true, 'the visible custom thumb must receive a real pointer hit');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y + 80, { steps: 8 });
  await page.mouse.up();
  result.scrollTop = await page.evaluate(() => document.scrollingElement.scrollTop);
  assert.ok(result.scrollTop > 100, 'dragging the actual thumb must scroll the document');
  result.passed = true;
  console.log('PASS Windows auth branch: thumb hit and drag scroll');
} catch (error) {
  result.passed = false;
  result.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await browser.close();
  const output = new URL('../output/navigation-audit-repairs-20261116/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL(`auth-scrollbar-${result.passed ? 'green' : 'red'}.json`, output), JSON.stringify(result, null, 2)+'\n');
}
