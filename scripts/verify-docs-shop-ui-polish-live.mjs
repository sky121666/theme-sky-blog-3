import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {readLiveBuildContext} from './lib/live-build-context.mjs';
import { collectBrowserRuntimeErrors } from './lib/browser-runtime-errors.mjs';
import { verificationOutput } from './lib/verification-output.mjs';
const base=(process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/,'');
const origin=new URL(base).origin, dir=await verificationOutput('docs-shop-ui-polish-live');
const widths=(process.env.UI_VERIFY_WIDTHS || '1440,390,320').split(',').map(Number);
assert.ok(widths.length && widths.every(width=>Number.isInteger(width)&&width>=320),'UI_VERIFY_WIDTHS requires widths >= 320');
class SampleMissing extends Error {}
const key=value=>{const url=new URL(value,base);url.hash='';url.searchParams.sort();return url.href;};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const identity=await readLiveBuildContext(base);
const report={identity,preservation:[],scope:'实际服务的界面；仅公共浏览及搜索查询，不提交订单、表单或评论',runtime:[],cases:[],missingSamples:[],preloadProbes:[]};
const browser=await chromium.launch({headless:true});
async function ready(page,app){await page.waitForFunction(app=>window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId===app && !document.documentElement.classList.contains('is-animating') && !document.querySelector('[data-theme-startup-layer]') && !window.__THEME_STARTUP__?.active,app);}
try{
for(const width of widths){
 const context=await browser.newContext({viewport:{width,height:width===1440?960:844},reducedMotion:width===320?'reduce':'no-preference'});
 const blockedWrites=[], searchReads=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const readSearch=request.method()==='POST' && url.origin===origin && url.pathname==='/apis/api.halo.run/v1alpha1/indices/-/search';
  if(readSearch){searchReads.push({method:request.method(),url:request.url()});return route.continue();}
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){blockedWrites.push({method:request.method(),url:request.url()});return route.abort('blockedbyclient');}
  return route.continue();
 });
 const page=await context.newPage(); page.setDefaultTimeout(12000);
 const runtime=collectBrowserRuntimeErrors(page);
 async function check(name,fn){try{await fn();report.cases.push({width,name,status:'PASS'});}catch(e){report.cases.push({width,name,status:e instanceof SampleMissing?'sample-missing':'FAIL',message:e.message});await page.screenshot({path:`${dir}/root-live-failure-${width}-${report.cases.length}.png`}).catch(()=>{});}}

 // Fresh document per mode prevents a previous cache from hiding a second GET.
 for(const mode of ['completed','in-flight']) await check('Docsme '+mode+' 预取与点击精确一次 GET',async()=>{
  const arrival=await page.goto(base+'/docs',{waitUntil:'domcontentloaded'});
  if(arrival.status()===404)throw new SampleMissing('Docsme public route is not installed');
  assert.equal(arrival.status(),200);await ready(page,'docsme');
  await page.evaluate(()=>{window.__polishDocument=document;window.__polishDock=document.querySelector('.dock-container');window.__polishWidgets=[...document.querySelectorAll('.desktop-widget-card')];});
  const projects=page.locator('.docsme-project-card');
  const candidates=await projects.evaluateAll((nodes,configured)=>nodes.map((node,index)=>({index,href:node.href})).filter(node=>!configured||node.href===new URL(configured,location.href).href),process.env.DOCSME_PROJECT_URL||'');
  if(!candidates.length)throw new SampleMissing(process.env.DOCSME_PROJECT_URL?'DOCSME_PROJECT_URL is absent from public projects':'No public Docsme project is available');
  const sample=candidates[0],project=projects.nth(sample.index),target=key(sample.href),gets=[],held=deferred(),release=deferred();
  assert.equal(new URL(sample.href).origin,origin,'Project sample must remain same-origin');
  const probe={width,mode,target,requests:[],responses:[],requestFailures:[]};report.preloadProbes.push(probe);
  const onRequest=request=>{if(request.method()==='GET'&&key(request.url())===target){gets.push(request.url());probe.requests.push({url:request.url(),method:request.method(),resourceType:request.resourceType(),at:new Date().toISOString()});}};
  const onResponse=response=>{if(response.request().method()==='GET'&&key(response.url())===target)probe.responses.push({url:response.url(),status:response.status(),cacheControl:response.headers()['cache-control'],at:new Date().toISOString()});};
  const onFailed=request=>{if(key(request.url())===target)probe.requestFailures.push({url:request.url(),error:request.failure()?.errorText,at:new Date().toISOString()});};
  page.on('request',onRequest);
  page.on('response',onResponse);page.on('requestfailed',onFailed);
  let upstreamGets=0, completedNoStore=false, preloadCacheControl='';
  const matcher=url=>key(url.href)===target;
  const routeErrors=[];
  const handler=async route=>{upstreamGets++;try{const response=await route.fetch({timeout:15000});held.resolve();await release.promise;await route.fulfill({response});}catch(error){routeErrors.push(error.message);held.resolve();await route.abort('failed').catch(()=>{});}};
  try{
   if(mode==='in-flight')await page.route(matcher,handler);
   const responseWait=mode==='completed'?page.waitForResponse(response=>response.request().method()==='GET'&&key(response.url())===target):null;
   await project.hover();
   if(responseWait){const response=await responseWait;assert.equal(response.status(),200);assert.equal(await response.finished(),null);preloadCacheControl=response.headers()['cache-control']||'';completedNoStore=/(?:^|,)\s*(?:no-cache|no-store|private)\b/i.test(preloadCacheControl)||Boolean(response.headers().vary);}
   else{let timer;try{await Promise.race([held.promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Hover did not start a project preload')),15000);})]);}finally{clearTimeout(timer);}assert.deepEqual(routeErrors,[],'Real upstream response must be readable');assert.equal(gets.length,1,'Hover starts exactly one GET');}
   if(mode==='in-flight')await page.evaluate(()=>{window.__polishNavigationAccepted=false;document.addEventListener('theme:navigation-accepted',()=>{window.__polishNavigationAccepted=true;},{once:true});});
   await project.click({noWaitAfter:true});
   if(mode==='in-flight'){
    await page.waitForFunction(()=>window.__polishNavigationAccepted===true);
    assert.equal(gets.length,1,'Click must adopt the in-flight GET');release.resolve();
   }
   await page.waitForURL(sample.href);await ready(page,'docsme');
   assert.equal(gets.length,completedNoStore?2:1,completedNoStore?'A completed no-store response must be read again by the foreground navigation':'Preload and click must consume exactly one destination GET');
   if(mode==='in-flight')assert.equal(upstreamGets,1,'The real response is fetched upstream exactly once');
   assert.equal(await page.locator('.docsme-doc-head h1').count(),1);
   const crumbs=(await page.locator('.docsme-breadcrumb').innerText()).trim().split(/\s+/);assert.ok(crumbs.length<2||crumbs.at(-1)!==crumbs.at(-2),'Current breadcrumb must not repeat');
   const preserved=await page.evaluate(()=>({sameDocument:document===window.__polishDocument,sameDock:!window.__polishDock||window.__polishDock===document.querySelector('.dock-container'),widgetCount:window.__polishWidgets.length,widgetsConnected:window.__polishWidgets.every(node=>node.isConnected)}));
   assert.equal(preserved.sameDocument,true);assert.equal(preserved.sameDock,true);assert.equal(preserved.widgetsConnected,true);
   report.preservation.push({width,mode,url:page.url(),getCount:gets.length,upstreamGets:mode==='in-flight'?upstreamGets:null,preloadCacheControl,...preserved});
   if(completedNoStore)throw new SampleMissing('The selected public project forbids completed-response reuse ('+preloadCacheControl+'); fresh foreground GET verified, cacheable completed-preload sample is unavailable');
  }finally{probe.pageGetCount=gets.length;probe.upstreamGets=mode==='in-flight'?upstreamGets:null;release.resolve();if(mode==='in-flight')await page.unroute(matcher,handler);page.off('request',onRequest);page.off('response',onResponse);page.off('requestfailed',onFailed);}
 });
 await check('Docsme 项目搜索实际弹窗、输入与关闭',async()=>{
  if(!await page.locator('.docsme-doc-head h1').count())throw new SampleMissing('A public document is required for scoped search');
  const search=page.locator('[data-docsme-search]');if(!await search.count())throw new SampleMissing('The selected Docsme project exposes no scoped search');
  const term=process.env.DOCSME_SEARCH_KEYWORD||(await page.locator('.docsme-doc-head h1').innerText()).trim();assert.ok(term);
  await search.click();
  const input=page.locator('search-modal search-form input').first();await input.waitFor({state:'visible'});
  const responseWait=page.waitForResponse(r=>new URL(r.url()).pathname==='/apis/api.halo.run/v1alpha1/indices/-/search' && r.request().postDataJSON()?.keyword===term);
  await input.fill(term);const response=await responseWait;assert.equal(response.status(),200);const result=await response.json();if(!result.total){await page.keyboard.press('Escape');await input.waitFor({state:'hidden'});throw new SampleMissing('The actual document search sample has no indexed hits: '+term);}
  const filters=response.request().postDataJSON().includeCategoryNames;assert.ok(Array.isArray(filters)&&filters.length>0,'Actual project search retains its category scope');assert.ok(result.hits.every(h=>filters.every(c=>h.categories.includes(c))),'Every actual result belongs to the selected project/version/language');
  await page.waitForFunction(()=>[...document.querySelectorAll('search-modal')].some(n=>n.shadowRoot?.querySelector('#mac-search-style')));
  await page.screenshot({path:`${dir}/docs-live-search-${width}.png`});
  await page.keyboard.press('Escape');await input.waitFor({state:'hidden'});
 });
 await check('Docsme 版本切换、目录收放与阅读布局',async()=>{
  if(!await page.locator('.docsme-doc-head h1').count())throw new SampleMissing('A public document is required for version switching');
  if(width<769){await page.locator('[data-docsme-toggle-sidebar]').click();await page.locator('.docsme-sidebar').waitFor({state:'visible'});}
  const selects=page.locator('[data-docsme-switcher]');
  const alternatives=await selects.evaluateAll(nodes=>nodes.flatMap((node,selectIndex)=>[...node.options].flatMap((option,optionIndex)=>!option.selected&&option.dataset.link?[{selectIndex,optionIndex,href:option.dataset.link}]:[])));
  if(!alternatives.length)throw new SampleMissing('No alternative public Docsme version or language is available');
  const sample=alternatives[0],before=page.url();await selects.nth(sample.selectIndex).selectOption({index:sample.optionIndex});
  await page.waitForURL(url=>url.href!==before);await ready(page,'docsme');
  assert.equal(await page.locator('[data-docsme-switcher]').nth(sample.selectIndex).locator('option:checked').getAttribute('data-link'),sample.href);
  if(width<769){await page.locator('[data-docsme-toggle-sidebar]').click();await page.keyboard.press('Escape');}
  await page.screenshot({path:`${dir}/docs-live-reading-${width}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 });
 await check('跨插件 Swup 导航保留同一个文档',async()=>{
  assert.equal(await page.evaluate(()=>window.pjax.loadUrl('/shop/products?view=all')),true);await ready(page,'shop');
  {
    const preserved=await page.evaluate(()=>({sameDocument:document===window.__polishDocument,sameDock:!window.__polishDock||window.__polishDock===document.querySelector('.dock-container'),widgetCount:window.__polishWidgets.length,widgetsConnected:window.__polishWidgets.every(n=>n.isConnected)}));
    assert.equal(preserved.sameDocument,true);assert.equal(preserved.sameDock,true);assert.equal(preserved.widgetsConnected,true);report.preservation.push({width,url:page.url(),...preserved});
  }
 });
 await check('商城卡片/列表及大中小切换无刷新，偏好保持',async()=>{
  const cards=page.locator('[data-shop-catalog] .shop-catalog-card');const count=await cards.count();if(!count)throw new SampleMissing('No public products are available');
  await page.getByRole('button',{name:'列表展示',exact:true}).click();
  for(const size of ['large','medium','small']){await page.getByLabel('商品尺寸',{exact:true}).selectOption(size);assert.equal(await page.locator('[data-app-root="shop"]').getAttribute('data-shop-size'),size);assert.equal(await cards.count(),count);}
  await page.getByRole('button',{name:'卡片展示',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'卡片展示',exact:true}).getAttribute('aria-pressed'),'true');
  {
    const preserved=await page.evaluate(()=>({sameDocument:document===window.__polishDocument,sameDock:!window.__polishDock||window.__polishDock===document.querySelector('.dock-container'),widgetCount:window.__polishWidgets.length,widgetsConnected:window.__polishWidgets.every(n=>n.isConnected)}));
    assert.equal(preserved.sameDocument,true);assert.equal(preserved.sameDock,true);assert.equal(preserved.widgetsConnected,true);report.preservation.push({width,url:page.url(),...preserved});
  }
 });
 await check('商城实际分类/排序、空态清除和结果恢复',async()=>{
  const category=page.locator('select[name="categoryId"]');const choices=await category.locator('option').evaluateAll(nodes=>nodes.filter(node=>node.value).map(node=>node.value));if(!choices.length)throw new SampleMissing('No public product category is available');await category.selectOption(choices[0]);await page.waitForFunction(()=>new URL(location.href).searchParams.has('categoryId'));await ready(page,'shop');
  await page.locator('select[name="sort"]').selectOption('minPrice,asc');await page.waitForFunction(()=>new URL(location.href).searchParams.get('sort')==='minPrice,asc');await ready(page,'shop');
  await page.locator('.shop-filter-reset').click();await page.waitForFunction(()=>!new URL(location.href).searchParams.has('categoryId'));await ready(page,'shop');
  const search=page.locator(width<768?'.shop-mobile-search input[type="search"]':'.shop-sidebar input[type="search"]');await search.fill(`__ui_verify_no_match_${Date.now()}__`);await search.press('Enter');
  await page.waitForFunction(()=>new URL(location.href).searchParams.has('keyword'));await ready(page,'shop');
  await page.locator('.shop-empty .pjax-link').click();await page.waitForFunction(()=>!new URL(location.href).searchParams.has('keyword'));await ready(page,'shop');assert.ok(await page.locator('[data-shop-catalog] .shop-catalog-card').count()>0);
 });
 await check('商城商品详情、图片与浏览来源返回',async()=>{
  const links=page.locator('[data-shop-catalog] a[href]');
  const candidates=await links.evaluateAll((nodes,configured)=>nodes.map((node,index)=>({index,href:node.href})).filter(node=>new URL(node.href).pathname.startsWith('/shop/products/')&&(!configured||node.href===new URL(configured,location.href).href)),process.env.SHOP_PRODUCT_URL||'');
  if(!candidates.length)throw new SampleMissing(process.env.SHOP_PRODUCT_URL?'SHOP_PRODUCT_URL is absent from the public catalog':'No public product detail is available');
  const sample=candidates[0],catalogUrl=page.url();assert.equal(new URL(sample.href).origin,origin);
  await links.nth(sample.index).click();await page.waitForURL(sample.href);await ready(page,'shop');
  await page.locator('shop-buy-box button').first().waitFor({state:'visible'});
  const thumbs=page.locator('[data-shop-thumbnail]');if(await thumbs.count()>1){await thumbs.nth(1).click();assert.equal(await thumbs.nth(1).getAttribute('aria-pressed'),'true');}else report.missingSamples.push({width,check:'product thumbnail selection',reason:'The actual public product has fewer than two images',product:sample.href});
  await page.screenshot({path:`${dir}/shop-live-product-${width}.png`});
  await page.locator('[data-shop-return]').click();await page.waitForURL(catalogUrl);await ready(page,'shop');
  {
    const preserved=await page.evaluate(()=>({sameDocument:document===window.__polishDocument,sameDock:!window.__polishDock||window.__polishDock===document.querySelector('.dock-container'),widgetCount:window.__polishWidgets.length,widgetsConnected:window.__polishWidgets.every(n=>n.isConnected)}));
    assert.equal(preserved.sameDocument,true);assert.equal(preserved.sameDock,true);assert.equal(preserved.widgetsConnected,true);report.preservation.push({width,url:page.url(),...preserved});
  }
  await page.screenshot({path:`${dir}/shop-live-catalog-${width}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 });
 const snapshot=runtime.snapshot();
 const externalMedia=value=>new URL(value.url||base).origin!==origin&&['image','media','font'].includes(value.resourceType);
 const externalMediaFailures=[...snapshot.requestFailures,...snapshot.responseErrors].filter(externalMedia),externalUrls=new Set(externalMediaFailures.map(value=>value.url));
 const cancelledReads=snapshot.requestFailures.filter(value=>value.method==='GET'&&value.errorText==='net::ERR_ABORTED');
 const failures=[...snapshot.pageErrors,...snapshot.consoleErrors.filter(value=>!externalUrls.has(value.url)),...snapshot.requestFailures.filter(value=>!externalMedia(value)&&!cancelledReads.includes(value)),...snapshot.responseErrors.filter(value=>!externalMedia(value)),...blockedWrites];
 report.runtime.push({width,...snapshot,externalMediaFailures,cancelledReads,blockedWrites,searchReads,failures});
 runtime.stop();await context.close();
}
}finally{await browser.close();await fs.writeFile(`${dir}/docs-shop-live-report.json`,JSON.stringify(report,null,2),{flag:'wx'});}
console.log(JSON.stringify({report:`${dir}/docs-shop-live-report.json`,build:identity.build,cases:report.cases,missingSamples:report.missingSamples,runtime:report.runtime.map(({width,failures,externalMediaFailures,blockedWrites})=>({width,failures,externalMediaFailures,blockedWrites}))},null,2));
if(report.cases.some(c=>c.status==='FAIL')||report.runtime.some(entry=>entry.failures.length))process.exitCode=1;
else if(report.cases.some(c=>c.status==='sample-missing')||report.missingSamples.length)process.exitCode=2;
