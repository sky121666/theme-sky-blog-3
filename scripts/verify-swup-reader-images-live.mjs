import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Anonymous, read-only acceptance on the public editor demo. Its first and
// last native figures enclose four plugin-owned gallery images.
const base=new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
const article=process.env.READING_RICH_ARTICLE_PATH || '/archives/editor-feature-demo';
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block',
    extraHTTPHeaders:{'Cache-Control':'no-cache'},reducedMotion:'reduce'});
  await page.route('**/*',route=>new URL(route.request().url()).origin===base
    && ['GET','HEAD','OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.goto(base+'/archives',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.pjax?.loadUrl);
  const html=await (await page.request.get(base+article)).text();
  const raw=await page.evaluate(html=>{
    const tpl=document.createElement('template');tpl.innerHTML=html;
    return [...tpl.content.querySelectorAll('#article-content img')].map(img=>({
      src:img.getAttribute('src'),loading:img.getAttribute('loading'),gallery:Boolean(img.closest('[data-type="gallery"]'))}));
  },html);
  const figures=raw.filter(x=>!x.gallery);
  assert.ok(figures.length>=2 && raw.some(x=>x.gallery),'sample needs two ordinary figures plus a gallery');
  const farPath=new URL(figures.at(-1).src,base).pathname, requests=[];
  page.on('request',req=>{if(req.resourceType()==='image' && new URL(req.url()).pathname===farPath) requests.push(req.url());});
  await page.evaluate(()=>{window.__readerSourceFrame=document.querySelector('[data-window-content-root]');});
  await page.evaluate(article=>window.pjax.loadUrl(article),base+article);
  const post=page.locator('#article-content[data-swup-post-native-media]');
  await post.waitFor({state:'visible',timeout:10000});
  assert.ok(await page.evaluate(()=>window.__readerSourceFrame && window.__readerSourceFrame!==document.querySelector('[data-window-content-root]')),'the real enhanced visit replaced the frame without a document navigation');
  const attrs=await post.locator('img').evaluateAll(imgs=>imgs.map(img=>({src:img.getAttribute('src'),loading:img.getAttribute('loading')})));
  for (const image of raw) {
    const match=attrs.find(x=>x.src===image.src);
    assert.ok(match,'original source must survive the enhanced visit');
    const untouched=image.gallery || image===figures[0] || image.loading!==null;
    assert.equal(match.loading,untouched?image.loading:'lazy');
  }
  // Link widgets can inject icons later: locate the exact far figure by src.
  const figure=post.locator('figure[data-content-type="image"] img').last();
  assert.equal(await figure.getAttribute('src'),figures.at(-1).src);
  await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
  assert.deepEqual(requests,[],'far figure not requested while still outside the reading pane');
  await figure.scrollIntoViewIfNeeded(); await figure.evaluate(img=>img.decode());
  assert.ok(requests.length>0 && await figure.evaluate(img=>img.naturalWidth>0));
  console.log(JSON.stringify({passed:true,article,server:raw,enhanced:attrs.filter(x=>raw.some(a=>a.src===x.src)),
    farRequestsBeforeScroll:0,farRequestsAfterScroll:requests},null,2));
} finally {await browser.close();}
