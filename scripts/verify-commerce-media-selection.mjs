import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { SHOP_DISPLAY_PREFS_KEY } from '../src/apps/shop/display-model.js';

// Default: isolated browser, real source module, no server. --live: anonymous,
// read-only local Halo and its rendered candidates/window/display preferences.
const live = process.argv.includes('--live');
const base = new URL(live ? process.env.SMOKE_BASE_URL || 'http://localhost:8090' : 'https://fixture.test').origin;
const candidate = url => Number(new URL(url).searchParams.get('width'));
const browser = await chromium.launch();
const results = [];
const describe = img => ({ width: img.getBoundingClientRect().width, sizes: img.sizes, src: img.getAttribute('src'),
  srcset: img.srcset, currentSrc: img.currentSrc, decoded: img.complete && img.naturalWidth > 0 });
const media = await readFile(new URL('../src/apps/shop/media.js', import.meta.url), 'utf8');
async function scenario(options, run) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block',
    // Bypass stale page-cache entries without flushing the user's server cache.
    extraHTTPHeaders: live ? { 'Cache-Control': 'no-cache' } : {}, reducedMotion: 'reduce', ...options });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    if (live) await ctx.route('**/*', route => {
      if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) return route.fulfill({ status: 204 });
      if (new URL(route.request().url()).origin !== base) return route.abort();
      return route.continue();
    });
    await run(page);
  } finally { await ctx.close(); }
}
const group = key => [400, 800, 1200, 1600].map(w => '/'+key+'?width='+w+' '+w+'w').join(', ');
const set = (key, sizes) => 'src="/'+key+'" srcset="'+group(key)+'" sizes="'+sizes+'"';
async function offline(page) {
  const requests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) throw new Error('Unexpected external request: '+url.href);
    if (url.pathname === '/media.js') return route.fulfill({ contentType: 'text/javascript', body: media });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><main>
      <img data-shop-gallery-main ${set('one', '279px')} style="width:279px;height:110px">
      <button data-shop-thumbnail="/two"><img ${set('two','60px')} width="60"></button>
      <button data-shop-thumbnail="/original"><img src="/original" width="60"></button>
      <button data-shop-thumbnail="/broken"><img ${set('broken','60px')} width="60"></button>
      <button data-shop-thumbnail="/one"><img ${set('one','60px')} width="60"></button></main>
      <script type="module">import { hydrateShopMedia, selectShopImage } from './media.js';
      const main=document.querySelector('main'), img=main.firstElementChild;
      hydrateShopMedia(main, new AbortController().signal);
      main.onclick=e=>{const b=e.target.closest('button');if(b)selectShopImage(img,b)};
      main.dataset.ready="true";</script>` });
    requests.push(url.pathname+url.search);
    if (url.pathname === '/broken' && Number(url.searchParams.get('width')) >= 800) return route.fulfill({status:404});
    const width = Number(url.searchParams.get('width')) || 1800;
    return route.fulfill({ contentType: 'image/svg+xml',body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="100"/>` });
  });
  await page.goto(base);
  await page.waitForSelector('[data-ready]');
  const main = page.locator('[data-shop-gallery-main]');
  async function decoded(file, width) {
    await page.waitForFunction(([name,w]) => {const img=document.querySelector('[data-shop-gallery-main]');
      if (!img.complete || !img.naturalWidth || !img.currentSrc) return false;
      const url=new URL(img.currentSrc);
      return url.pathname==='/'+name && Number(url.searchParams.get('width'))===w;}, [file,width]);
    return main.evaluate(describe);
  }
  const initial = await decoded('one', 800);
  await page.locator('[data-shop-thumbnail="/two"]').click();
  assert.equal((await decoded('two', 800)).srcset, group('two'));
  await main.evaluate(img=>img.style.width='450px');
  assert.equal((await decoded('two', 1200)).sizes, '450px');
  await page.locator('[data-shop-thumbnail="/original"]').click();
  const original = await decoded('original', 0);
  assert.equal(original.srcset, ''); assert.equal(original.sizes, '');
  await page.locator('[data-shop-thumbnail="/broken"]').click();
  const fallback = await decoded('broken', 0);
  assert.equal(fallback.srcset, '');
  assert.ok(requests.includes('/broken?width=1200') && requests.includes('/broken'), 'failed candidate retries the original');
  await page.locator('[data-shop-thumbnail="/one"]').click();
  assert.equal((await decoded('one', 1200)).srcset, group('one'));
  results.push({scope:'isolated multi-image gallery',initial,restored:await main.evaluate(describe)});
}
async function catalog(page, dpr, js, smallScreen) {
  const imageResponses=new Map();
  page.on('response',res=>{if (res.request().resourceType()==='image') imageResponses.set(res.url(),res);});
  const response = await page.goto(base+'/shop/products?view=all',{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  const selector='[data-shop-catalog] .shop-catalog-card > img[srcset]';
  const img=page.locator(selector).first();
  if (!js) {
    const htmlImage=await img.evaluate(describe);
    assert.match(htmlImage.sizes,/^auto,/);
    assert.ok(htmlImage.src && htmlImage.srcset.includes('400w') && htmlImage.srcset.includes('800w'));
    results.push({scope:'real no-JS server image markup; shell visibility is independent', htmlImage,visible:await img.isVisible()});
    return;
  }
  await img.scrollIntoViewIfNeeded(); await img.evaluate(n=>n.decode());
  const initial=await img.evaluate(describe);
  assert.match(initial.sizes,/^auto,/);
  const widths = initial.srcset.split(',').map(item=>Number(item.trim().match(/ (\d+)w$/)[1])).sort((a,b)=>a-b);
  const expected=widths.find(w=>w>=Math.ceil(initial.width*dpr)) || widths.at(-1);
  assert.equal(candidate(initial.currentSrc),expected,JSON.stringify(initial));
  if (!smallScreen && initial.width >= 270 && initial.width <= 285) assert.equal(expected, dpr === 1 ? 400 : 800);
  const responseForImage=imageResponses.get(initial.currentSrc);
  assert.ok(responseForImage && responseForImage.ok(),'actual chosen image received successful response');
  const body=await responseForImage.body();
  const timing=await page.evaluate(url=>{
    const entry=performance.getEntriesByName(url,'resource').at(-1);
    return entry ? {transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize,decodedBodySize:entry.decodedBodySize} : null;
  },initial.currentSrc);
  // Resource Timing transferSize includes protocol overhead. Playwright body
  // length counts the content-decoded response payload, not decoded pixels.
  const initialResponse={url:responseForImage.url(),status:responseForImage.status(),type:responseForImage.headers()['content-type'],
    bodyBytes:body.byteLength,timing};
  assert.ok(initialResponse.bodyBytes>0 && initial.decoded,'successful response must also decode as an image');
  const display=[];
  if (js) {
    for (const layout of ['list','cards']) for (const size of ['small','medium','large']) {
      await page.locator('[data-shop-display-layout="'+layout+'"]:visible').click();
      await page.locator('[data-shop-display-size-select]:visible').selectOption(size);
      await img.scrollIntoViewIfNeeded();
      await page.waitForFunction(([sel,layout,size])=>{
        const app=document.querySelector('[data-app-root="shop"]'),img=document.querySelector(sel);
        const width=img.getBoundingClientRect().width;
        const slot=layout==='list' ? parseFloat(getComputedStyle(app).getPropertyValue('--shop-display-row-image'))
          : img.closest('.shop-catalog-card').getBoundingClientRect().width;
        return app.dataset.shopLayout===layout && app.dataset.shopSize===size &&
          Math.abs(width-slot)<1 && img.sizes==='auto, '+Math.ceil(width)+'px';},[selector,layout,size]);
      await img.evaluate(n=>n.decode());
      display.push({layout,size,...await img.evaluate(describe)});
    }
  }
  results.push({scope:'real catalog',dpr,js,smallScreen,initial,initialResponse,display});
}
async function detailAndReader(page) {
  // Discover public samples; no assumptions about numeric IDs or gallery count.
  await page.goto(base+'/shop/products?view=all',{waitUntil:'domcontentloaded'});
  const links = await page.locator('.shop-catalog-card').evaluateAll(nodes=>nodes.map(a=>a.href));
  const samples = [];
  for (const url of links) {
    if (new URL(url).origin !== base) continue;
    const response = await page.request.get(url);
    assert.equal(response.status(),200);
    const html = await response.text();
    if (/<img\b[^>]*\bdata-shop-gallery-main\b/.test(html)) samples.push({url,buttons:(html.match(/\bdata-shop-thumbnail="/g)||[]).length});
  }
  assert.ok(samples.length,'A public physical product with a cover is required');
  const sample=samples.sort((a,b)=>b.buttons-a.buttons)[0];
  await page.goto(sample.url,{waitUntil:'domcontentloaded'});
  const img=page.locator('[data-shop-gallery-main]');
  await img.evaluate(n=>n.decode());
  const first=await img.evaluate(describe);
  assert.ok(first.decoded);
  const buttons=page.locator('[data-shop-thumbnail]');
  let selected;
  if (await buttons.count()>1) {
    await buttons.nth(1).click();
    assert.equal(await buttons.nth(1).getAttribute('aria-pressed'),'true');
    await img.evaluate(n=>n.decode());
    selected=await img.evaluate(describe);
    assert.equal(selected.src,await buttons.nth(1).getAttribute('data-shop-thumbnail'));
    assert.equal(selected.srcset,(await buttons.nth(1).locator('img').getAttribute('srcset')) || '');
    assert.notEqual(selected.currentSrc,first.currentSrc);
  }
  results.push({scope:'real product detail',...sample, first, selected: selected || 'no multi-image physical product in public sample; covered by offline browser'});

  const article=process.env.READING_ARTICLE_PATH || '/archives/mac-restart-podman-container-start';
  await page.goto(base+article,{waitUntil:'domcontentloaded'});
  const cover=page.locator('.post-cover img');
  assert.equal(await cover.getAttribute('loading'),'eager');
  assert.equal(await cover.getAttribute('fetchpriority'),'high');
  const geometry=await cover.evaluate(img=>{
    const box=img.getBoundingClientRect(), pane=img.closest('.window-body').getBoundingClientRect();
    return {top:box.top,slot:box.width,paneTop:pane.top,paneBottom:pane.bottom,visible:box.bottom>pane.top && box.top<pane.bottom};
  });
  assert.ok((await page.locator('#article-content').innerText()).trim().length>0,'SSR article stays readable when the external cover is blocked');
  const bodyImages=await page.locator('#article-content img').evaluateAll(imgs=>imgs.map(img=>({loading:img.getAttribute('loading'),priority:img.getAttribute('fetchpriority')})));
  results.push({scope:'real article header; external asset transfer excluded',article,geometry,loading:'eager',priority:'high',bodyImages});
  // Record the separate ownership boundary: content processors/editor HTML
  // supply rich-text <img>s. A lazy SSR header check cannot certify these.
  const richArticle=process.env.READING_RICH_ARTICLE_PATH || '/archives/editor-feature-demo';
  const richResponse=await page.request.get(base+richArticle);
  if (richResponse.status()===200) {
    const richImages=await page.evaluate(html=>{
      const tpl=document.createElement('template'); tpl.innerHTML=html;
      return [...tpl.content.querySelectorAll('#article-content img')].map(img=>img.getAttribute('loading'));
    },await richResponse.text());
    results.push({scope:'unaltered rich body server markup supplied by Halo/editor',richArticle,count:richImages.length,
      lazy:richImages.filter(x=>x==='lazy').length,unspecified:richImages.filter(x=>!x).length});
  }
}
try {
  if (!live) await scenario({deviceScaleFactor:2},offline);
  else {
    for (const dpr of [1,2]) await scenario({deviceScaleFactor:dpr},p=>catalog(p,dpr,true,false));
    await scenario({deviceScaleFactor:2},async page=>{
      await page.addInitScript(key=>localStorage.setItem(key, JSON.stringify({layout:'list',size:'small'})),SHOP_DISPLAY_PREFS_KEY);
      const images=[];
      page.on('request',req=>{if(req.resourceType()==='image') images.push(req.url());});
      await page.goto(base+'/shop/products?view=all',{waitUntil:'domcontentloaded'});
      const img=page.locator('[data-shop-layout="list"][data-shop-size="small"] .shop-catalog-card > img[srcset]').first();
      await img.scrollIntoViewIfNeeded(); await img.evaluate(n=>n.decode());
      const selected=await img.evaluate(describe), file=new URL(selected.currentSrc).pathname;
      assert.equal(selected.width,52); assert.equal(candidate(selected.currentSrc),400);
      const requests=images.filter(url=>new URL(url).pathname===file);
      assert.ok(requests.length>0 && requests.every(url=>candidate(url)===400),'saved list view must not first download the default medium cover');
      results.push({scope:'real cold saved list view',selected,requests});
    });
    await scenario({deviceScaleFactor:2,javaScriptEnabled:false},p=>catalog(p,2,false,false));
    await scenario({deviceScaleFactor:2,viewport:{width:390,height:844}},p=>catalog(p,2,true,true));
    await scenario({deviceScaleFactor:2},detailAndReader);
  }
  console.log(JSON.stringify({passed:true,results},null,2));
} finally {await browser.close();}
