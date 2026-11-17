import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Actual installed public LightGallery bytes, native DOM and current theme host.
// Only discovery/assets are fetched from Halo. All interactions stay offline.
const base = process.env.HALO_BASE_URL || 'http://localhost:8090';
const html = await (await fetch(new URL('/archives/editor-feature-demo', base))).text();
const scriptPath = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map(match => match[1]).find(src => src.includes('/PluginLightGallery/assets/static/js/lightgallery.min.js'));
const stylePaths = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)]
  .map(match => match[1]).filter(src => src.includes('/PluginLightGallery/assets/static/'));
assert.ok(scriptPath, 'Use the installed article LightGallery runtime');
const plugin = await (await fetch(new URL(scriptPath, base))).text();
const styles = (await Promise.all(stylePaths.map(async path => (await fetch(new URL(path, base))).text()))).join('\n');
const source = (await readFile(new URL('../src/shell/desktop-shell/runtime/shared/plugin-compat.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const readerCss = await readFile(new URL('../src/apps/reader/styles/post.css', import.meta.url), 'utf8');
const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="slateblue"/></svg>');
const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, action, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width || 1000, height: 760 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(1600);
  try {
    await page.setContent(`<!doctype html><html><head><style>${styles}\n${readerCss}\nbody{margin:0;background:white}.post-reader-frame{padding:20px}#article-content{max-width:650px}#article-content img{width:100px;display:inline-block}</style></head><body>
      <button id="before">前置操作</button><main data-app-root="reader"><article id="article-content">
        <img id="plain" src="${photo}" alt="夜景照片"><a href="#native-link" id="link"><img id="linked" src="${photo}" alt="原生图片链接"></a>
        <button id="native-button"><img id="button-image" src="${photo}" alt="按钮图片"></button>
        <span role="button" tabindex="0" id="role-button"><img id="role-image" src="${photo}" alt="角色图片"></span>
        <img id="image-role" role="button" tabindex="0" src="${photo}" alt="自有角色图片">
        <img id="preset" tabindex="3" src="${photo}" alt="已有焦点顺序">
      </article></main><section data-app-root="photos"><div id="other-gallery"><img id="photo-owned" src="${photo}" alt="Photos图片"></div></section><button id="after">后置操作</button>
    </body></html>`);
    await page.addScriptTag({ content: plugin });
    await page.addScriptTag({ content: `${source}\nwindow.mountGallery=mountLightGallery;window.disposeGallery=disposeLightGallery;` });
    await page.evaluate(({ officialFirst }) => {
      window.openEvents = 0;
      window.nativeRoleKeys = 0;
      document.querySelector('#article-content').addEventListener('onBeforeOpen', () => window.openEvents++);
      document.querySelector('#role-button').addEventListener('keydown', event => {
        if (event.key === 'Enter') { window.nativeRoleKeys++; event.preventDefault(); }
      });
      if (officialFirst) window.lightGallery(document.querySelector('#article-content'), { selector: 'img' });
      window.mountGallery(document);
    }, { officialFirst: !!options.officialFirst });
    await action(page);
    assert.deepEqual(errors, [], 'Host and official LightGallery must not throw');
    results.push({ name, passed: true }); console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
  } finally { await page.close(); }
}
const closed = page => page.waitForFunction(() => !document.querySelector('.lg-outer'));
try {
  for (const key of ['Enter', 'Space']) await scenario(`${key} 打开独立图片，Escape 关闭回到原图片`, async page => {
    assert.equal(await page.locator('#plain').getAttribute('tabindex'), '0', 'Unwrapped image must join native keyboard order');
    assert.equal(await page.locator('#plain').getAttribute('role'), null, 'Preserve native image semantics');
    assert.equal(await page.locator('#plain').getAttribute('alt'), '夜景照片');
    await page.locator('#plain').focus();
    assert.equal(await page.locator('#plain').evaluate(node => getComputedStyle(node).outlineWidth), '2px', 'Keyboard target has a visible theme focus ring');
    await page.keyboard.press(key);
    await page.waitForSelector('.lg-outer.lg-visible');
    await page.keyboard.press('Escape'); await closed(page);
    await page.waitForFunction(() => document.activeElement?.id === 'plain');
    assert.equal(await page.evaluate(() => window.openEvents), 1);
  });
  await scenario('官方冷加载先挂载后仍补齐键盘入口', async page => {
    assert.equal(await page.locator('#plain').getAttribute('tabindex'), '0');
    await page.locator('#plain').focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('.lg-outer.lg-visible');
    assert.equal(await page.evaluate(() => window.openEvents), 1);
  }, { officialFirst: true });
  await scenario('已有链接、按钮、角色和其他图片 owner 不被接管', async page => {
    for (const selector of ['#linked', '#button-image', '#role-image', '#photo-owned']) {
      assert.equal(await page.locator(selector).getAttribute('tabindex'), null);
    }
    assert.equal(await page.locator('#image-role').getAttribute('role'), 'button');
    assert.equal(await page.locator('#image-role').getAttribute('tabindex'), '0');
    assert.equal(await page.locator('#preset').getAttribute('tabindex'), '3');
    await page.locator('#role-button').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.nativeRoleKeys), 1);
    assert.equal(await page.evaluate(() => window.openEvents), 0);
    await page.locator('#link').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => location.hash), '#native-link');
    assert.equal(await page.evaluate(() => window.openEvents), 0);
  });
  await scenario('重复挂载/销毁恢复 tabindex，不累积监听或过期焦点', async page => {
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.evaluate(() => { window.mountGallery(document); window.mountGallery(document); });
      await page.locator('#plain').focus(); await page.keyboard.press('Enter');
      await page.waitForSelector('.lg-outer.lg-visible');
      assert.equal(await page.evaluate(() => window.openEvents), cycle + 1);
      await page.evaluate(() => { window.disposeGallery(document); document.querySelector('#after').focus(); });
      await closed(page);
      assert.equal(await page.locator('#plain').getAttribute('tabindex'), null);
      assert.equal(await page.locator('#preset').getAttribute('tabindex'), '3');
      assert.equal(await page.locator('#plain').getAttribute('data-theme-lightgallery-keyboard'), null);
      assert.equal(await page.locator('#after').evaluate(node => document.activeElement === node), true);
    }
    await page.locator('#plain').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.openEvents), 3, 'Disposed keyboard handlers must stay removed');
  });
} finally {
  await browser.close();
  await writeFile(new URL('../output/plugin-ui-polish-20261116/embedded-lightgallery-keyboard.json', import.meta.url), JSON.stringify({ scope: 'installed public LightGallery + current host on offline native Chromium DOM', pluginPath: scriptPath, results }, null, 2));
}
if (results.some(result => !result.passed)) process.exitCode = 1;
