import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Uses current source CSS and native ViewTransition pixels, never Halo or built assets.
const cssFile = process.argv.find((arg) => arg.startsWith('--css-file='))?.slice(11)
  || new URL('../src/apps/photos/styles/index.css', import.meta.url);
const css = await readFile(cssFile, 'utf8');
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) || 'current';
const output = path.resolve('output/photos-snapshot-bounds', label);
await mkdir(output, { recursive: true });
const portrait = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#e32976"/><circle cx="100" cy="125" r="65" fill="#57e6cf"/><path d="M0 260h200" stroke="#fff" stroke-width="16"/></svg>')}`;
const landscape = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#276ae5"/><circle cx="300" cy="150" r="100" fill="#f8c83b"/></svg>')}`;
const reports = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/*', (route) => route.abort());

async function snapshotPixels(baseline, during, host) {
  return page.evaluate(async ({ baseline, during, host }) => {
    const decode = (data) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${data}`;
    });
    const [before, after] = await Promise.all([decode(baseline), decode(during)]);
    const canvas = document.createElement('canvas');
    canvas.width = before.width; canvas.height = before.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(before, 0, 0);
    const reference = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.drawImage(after, 0, 0);
    const captured = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    let visiblePhotoPixels = 0;
    // Only the photos use these pink/blue fills. Allow their alpha blending
    // with the known host background, excluding the yellow caption and chrome.
    const background = [237, 240, 244];
    const photoColors = [[227, 41, 118], [39, 106, 229]].map((color) => {
      const delta = color.map((value, channel) => value - background[channel]);
      return { delta, squaredLength: delta.reduce((sum, value) => sum + value * value, 0) };
    });
    const bounds = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      if (x >= host.left && x < host.right && y >= host.top && y < host.bottom) {
        const delta = background.map((value, channel) => captured[index + channel] - value);
        if (photoColors.some((color) => {
          const alpha = delta.reduce((sum, value, channel) => sum + value * color.delta[channel], 0) / color.squaredLength;
          return alpha >= 0.08 && alpha <= 1.02
            && delta.every((value, channel) => Math.abs(value - alpha * color.delta[channel]) <= 12);
        })) visiblePhotoPixels++;
      }
      // Ignore one antialiasing pixel at the host edge, not a wider overflow allowance.
      if (x >= host.left - 1 && x <= host.right + 1 && y >= host.top - 1 && y <= host.bottom + 1) continue;
      if ([0, 1, 2].some((offset) => Math.abs(reference[index + offset] - captured[index + offset]) > 4)) {
        count++;
        bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
      }
    }
    return { outside: { count, bounds: count ? bounds : null }, visiblePhotoPixels };
  }, { baseline: baseline.toString('base64'), during: during.toString('base64'), host });
}

async function runCase({ kind, direction = 'neutral', fit = 'contain', reducedMotion = 'no-preference' }) {
  const name = `${kind}-${direction}-${fit}-${reducedMotion}`;
  await page.emulateMedia({ reducedMotion });
  await page.setContent(`<!doctype html><html><head><style>${css}
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: #0b1220; }
    #host { position: absolute; left: 270px; top: 190px; width: 900px; height: 600px; overflow: hidden; border-radius: 0; background: #edf0f4; box-shadow: none; }
    #stage { position: relative; width: 100%; height: 100%; overflow: hidden; }
    #stage .photo-card { position: absolute; left: 32px; top: 46px; width: 200px; overflow: hidden; }
    #stage .photo-card-inner { width: 200px; height: 340px; }
    #stage .photo-card-img { width: 200px; height: 300px; transform: none; transition: none; }
    .fixture-caption { display: block; height: 40px; padding: 8px; background: #ffe566; color: #201512; font: 15px monospace; }
    #stage .photos-detail-figure { position: absolute; left: ${kind === 'detail-step' ? 0 : 30}px; top: ${kind === 'detail-step' ? 0 : 40}px; width: ${kind === 'detail-step' ? 900 : 840}px; height: ${kind === 'detail-step' ? 600 : 500}px; max-width: none; max-height: none; margin: 0; }
    #stage .photos-detail-image { position: absolute; inset: 0; width: 100%; height: 100%; max-width: 100%; max-height: 100%; transform: none; object-fit: ${fit}; transition: none; }
    #stage .photos-detail-figure figcaption { background: #ffe566; color: #201512; backdrop-filter: none; }
  </style></head><body><main id="host" class="photos-window"><div id="stage"></div></main></body></html>`);
  await page.evaluate(async ({ portrait, landscape, kind, direction }) => {
    const stage = document.querySelector('#stage');
    const card = `<a class="photo-card ph-loaded"><div class="photo-card-inner" style="view-transition-name:photos-active-photo"><img class="photo-card-img ph-loaded" src="${portrait}"><span class="fixture-caption">portrait-filename.jpg</span></div></a>`;
    const figure = (src) => `<figure class="photos-detail-figure" style="view-transition-name:photos-active-photo"><img class="photos-detail-image" src="${src}"><figcaption>portrait-filename.jpg</figcaption></figure>`;
    stage.innerHTML = kind === 'list-to-detail' ? card : figure(portrait);
    await Promise.all([...stage.querySelectorAll('img')].map((image) => image.decode()));
    window.nextPhotoMarkup = figure(kind === 'list-to-detail' ? portrait : landscape);
    const root = document.documentElement;
    root.classList.add('photos-shared-view-transition');
    root.dataset.photosViewTransitionKind = kind;
    root.dataset.photosViewTransitionDirection = direction;
  }, { portrait, landscape, kind, direction });
  const host = await page.locator('#host').evaluate((node) => node.getBoundingClientRect().toJSON());
  const source = await page.locator('[style*="view-transition-name"]').evaluate((node) => node.getBoundingClientRect().toJSON());
  const baseline = await page.screenshot({ animations: 'allow' });
  await page.evaluate(async () => {
    window.photoTransition = document.startViewTransition(async () => {
      const stage = document.querySelector('#stage');
      stage.innerHTML = window.nextPhotoMarkup;
      await Promise.all([...stage.querySelectorAll('img')].map((image) => image.decode()));
    });
    await window.photoTransition.ready;
    window.photoAnimations = document.getAnimations({ subtree: true }).filter((animation) => animation.effect?.target === document.documentElement);
    window.photoAnimations.forEach((animation) => animation.pause());
  });
  const target = await page.locator('.photos-detail-figure').evaluate((node) => node.getBoundingClientRect().toJSON());
  if (kind === 'list-to-detail') {
    assert.ok(source.height > source.width, 'source snapshot includes a portrait and its caption');
    assert.ok(target.width > target.height, 'destination is a landscape-shaped figure');
  }
  const imageBox = await page.locator('.photos-detail-image').evaluate((image) => image.getBoundingClientRect().toJSON());
  assert.equal(imageBox.width, target.width, 'fixture image fit box follows the definite figure width');
  assert.equal(imageBox.height, target.height, 'fixture image fit box follows the definite figure height');
  const timings = await page.evaluate(() => window.photoAnimations.map((animation) => ({
    name: animation.animationName, pseudo: animation.effect?.pseudoElement,
    duration: animation.effect.getTiming().duration,
  })));
  if (reducedMotion === 'no-preference') {
    assert.ok(timings.some((animation) => animation.pseudo === '::view-transition-group(photos-active-photo)' && animation.duration >= 200), 'the shared-photo native transition remains enabled');
    if (kind === 'detail-step') assert.ok(timings.some((animation) => animation.name.includes(`photos-detail-step-${direction}-in`)), 'detail stepping retains its existing animation');
  }
  for (const milliseconds of reducedMotion === 'reduce' ? [120] : [120, 60, 240]) {
    const pseudoStyles = await page.evaluate(async (time) => {
      window.photoAnimations.forEach((animation) => { animation.currentTime = time; });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = {};
      for (const part of ['group', 'image-pair', 'old', 'new']) {
        const style = getComputedStyle(document.documentElement, `::view-transition-${part}(photos-active-photo)`);
        result[part] = Object.fromEntries(['width', 'height', 'transform', 'overflow', 'objectFit', 'animationName'].map((key) => [key, style[key]]));
      }
      return result;
    }, milliseconds);
    if (reducedMotion === 'reduce') assert.equal(pseudoStyles.group.animationName, 'none', 'reduced motion does not animate the shared-photo geometry');
    const screenshot = await page.screenshot({ path: path.join(output, `${name}-${milliseconds}ms.png`), animations: 'allow' });
    const { outside: pixels, visiblePhotoPixels } = await snapshotPixels(baseline, screenshot, host);
    reports.push({ name, milliseconds, host, source, target, timings, pseudoStyles, outsidePixels: pixels, visiblePhotoPixels });
    await writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
    assert.equal(pixels.count, 0, `${name} at ${milliseconds}ms paints ${pixels.count} pixels outside the host: ${JSON.stringify(pixels.bounds)}; screenshot: ${output}`);
    assert.ok(visiblePhotoPixels >= 1000, `${name} at ${milliseconds}ms has only ${visiblePhotoPixels} visible photo-colored pixels inside the host; screenshot: ${output}`);
  }
  assert.equal(await page.locator('.photos-detail-image').evaluate((image) => getComputedStyle(image).objectFit), fit, 'snapshot bounds must not change the actual image fit mode');
  await page.evaluate(async () => { window.photoTransition.skipTransition(); await window.photoTransition.finished; });
}

try {
  assert.equal(await page.evaluate(() => typeof document.startViewTransition), 'function');
  await runCase({ kind: 'list-to-detail' });
  await runCase({ kind: 'list-to-detail', fit: 'cover' });
  for (const direction of ['next', 'previous', 'neutral']) await runCase({ kind: 'detail-step', direction });
  await runCase({ kind: 'list-to-detail', reducedMotion: 'reduce' });
  await runCase({ kind: 'detail-step', direction: 'next', reducedMotion: 'reduce' });
  assert.deepEqual(errors, []);
  console.log(`Photos snapshot bounds passed (${reports.length} native-transition frames): ${output}`);
} finally { await browser.close(); }
