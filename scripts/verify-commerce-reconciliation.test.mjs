import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertCurrentBuild } from './lib/build-identity.mjs';
import { bundleCommerceFixture } from './fixtures/commerce-source-bundle.mjs';
import { api, cartItems, checkout, contextId, csrf, products } from './fixtures/commerce-data.mjs';

const origin = 'https://commerce-readback.test';
const cartPath = api + '/cart-items', contextPath = '/shop/checkout/' + contextId + '/context';
const plan = { id: 591, variantId: 1901, tier: '标准', tierId: 1, name: '标准年付', billingMode: 'SUBSCRIPTION', billingPeriod: 'YEARLY', price: 12, minQuantity: 1, maxQuantity: 1 };
const root = fileURLToPath(new URL('../',import.meta.url));
const assetPrefix = '/themes/theme-sky-blog-3/assets/';
const compiled = process.env.COMMERCE_RECONCILIATION_COMPILED === '1';
const evidenceDir = process.env.COMMERCE_RECONCILIATION_OUTPUT && path.resolve(root,process.env.COMMERCE_RECONCILIATION_OUTPUT);
let browser, script, manifest;
async function capture(page, name) {
  if(evidenceDir) await page.screenshot({path:path.join(evidenceDir,name+'.png'), animations:'disabled',fullPage:true});
}
before(async () => {
  if(evidenceDir) {
    assert.ok(evidenceDir.startsWith(path.resolve(root,'output')+path.sep),'evidence must stay inside output/');
    await mkdir(evidenceDir,{recursive:true});
  }
  if(compiled) {
    manifest=assertCurrentBuild(root);
    script=`import '${manifest.shop.js[0]}'; window.__THEME_PAGE_APP_REGISTRY__.appLifecycles.shop.hydrate(document.querySelector('[data-app-root="shop"]'));`;
  } else script = await bundleCommerceFixture(`
    import { mount } from 'svelte';
    import './src/apps/shop/commerce-ui/pages/Cart.svelte';
    import './src/apps/shop/commerce-ui/pages/Checkout.svelte';
    import Subscription from './src/apps/shop/commerce-ui/components/SubscriptionBuyBox.svelte';
    import { hydrateShop } from './src/apps/shop/runtime.js';
    if (document.getElementById('subscription')) mount(Subscription, {target: document.getElementById('subscription'), props: {plans: ${JSON.stringify([plan])}, csrfToken: ${JSON.stringify(csrf)}}});
    hydrateShop(document);
  `);
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, component, handle, {locale = 'zh-CN', cookie, navigation = false} = {}) {
  const context = await browser.newContext({locale, viewport:{width:390,height:844}, reducedMotion:'reduce', serviceWorkers:'block'});
  if (cookie) await context.addCookies([{name:'language',value:cookie,url:origin}]);
  const page = await context.newPage(), unexpected=[], errors=[], writes=[];
  t.after(async()=>{await context.close();assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);});
  page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(returnValue=>{
    window.visits=[];window.pjax={async loadUrl(url, options) {window.visits.push({url,method:options?.requestOptions?.requestMethod});return returnValue;}};
  }, navigation);
  const content = component==='subscription' ? (compiled ? `<shop-buy-box id="903" csrftoken="${csrf}"></shop-buy-box>` : '<div id="subscription"></div>') :
    `<shop-page-${component} csrftoken="${csrf}" contextid="${contextId}" authenticated="true" storefrontapi="true"></shop-page-${component}>`;
  await context.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),method=q.method(),key=method+' '+u.pathname;
    if (u.origin!==origin) {unexpected.push(key);return r.abort();}
    if (key === 'GET /fixture') {
      const styles = compiled ? [assetPrefix + 'css/shell-core/index.css', ...manifest.shop.css] : [];
      return r.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
          ${styles.map(href => '<link rel="stylesheet" href="' + href + '">').join('')}
          <style>body{padding:12px;margin:0;font-family:system-ui}*,::before,::after{box-sizing:border-box}</style></head>
          <body class="shop-window"><main class="shop-app" data-app-root="shop">${content}</main>
          <script type="module" src="/fixture.js"></script></body></html>`,
      });
    }
    if (key==='GET /fixture.js') return r.fulfill({contentType:'text/javascript',body:script});
    if (key==='GET /shop/cart') return r.fulfill({contentType:'text/html',body:'<main>Fixture cart</main>'});
    if(compiled && method==='GET' && u.pathname.startsWith(assetPrefix)) {
      const file=path.resolve(root,'templates/assets',u.pathname.slice(assetPrefix.length));
      assert.ok(file.startsWith(path.resolve(root,'templates/assets')+path.sep));
      return r.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:await readFile(file)});
    }
    if(compiled && component==='subscription' && method==='GET') {
      if(u.pathname===api+'/products/903') return r.fulfill({json:{...products[1],id:903,productType:'SUBSCRIPTION',productVariants:[],specDefinition:[]}});
      if(u.pathname===api+'/ecommerceconfigs/shop') return r.fulfill({json:{anonymousPurchaseEnabled:true}});
      if(u.pathname===api+'/subscription-products/903') return r.fulfill({json:{plans:[plan],subscriptions:[],singleSubscription:true}});
    }
    if (method!=='GET') writes.push(key);
    const response = await handle?.(method,u.pathname,q);
    if (response) return r.fulfill(response);
    if (u.pathname.startsWith('/fixture/images/') && method==='GET') return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
    if (method==='GET' && [api+'/user-addresses','/shop/coupons/mine'].includes(u.pathname)) return r.fulfill({json:[]});
    unexpected.push(key);return r.abort();
  });
  await page.goto(origin+'/fixture');
  return {page,writes};
}

test('a rejected typed quantity returns to the server quantity before checkout is available',async t=>{
  const {page,writes}=await fixture(t,'cart',(m,p)=>{
    if(m==='GET'&&p===cartPath)return {json:[cartItems[0]]};
    if(m==='PUT'&&p===cartPath+'/2901')return {status:422,json:{detail:'fixture: not allowed'}};
  });
  const qty=page.locator('.shop-quantity__input');
  await qty.fill('4');await qty.press('Tab');await page.locator('.shop-cart-item[data-operation-state="error"]').waitFor();
  const data = await page.evaluate(() => ({
    seen: document.querySelector('.shop-quantity__input').value,
    posted: new FormData(document.querySelector('.shop-cart-summary form')).get('items[0].quantity'),
    amount: document.querySelector('.shop-cart-item__total').innerText,
    canCheckout: !document.querySelector('.shop-cart-summary button').disabled,
  }));
  assert.deepEqual(data,{seen:'2',posted:'2',amount:'¥58.00',canCheckout:true});
  await capture(page,'quantity-restored');
  assert.deepEqual(writes,['PUT '+cartPath+'/2901']);
});

for(const recovery of ['read-again','keep']) test(`a DELETE acknowledgement with a surviving row needs review; explicit ${recovery} never replays DELETE`,async t=>{
  let reads=0;const refresh=gate(), reached=gate();
  const {page,writes}=await fixture(t,'cart',async(m,p)=>{
    if(m==='GET'&&p===cartPath){
      reads++;
      if(reads===2){reached.resolve();await refresh.promise;}
      return {json:(reads>=3&&recovery==='read-again')?[cartItems[1]]:cartItems};
    }
    if(m==='DELETE'&&p===cartPath+'/2901')return {status:204,body:''};
  });
  const row=page.locator('.shop-cart-item').first(), submit=page.locator('.shop-cart-summary button');
  await row.locator('.shop-cart-item__remove').click();await reached.promise;
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
  const waiting=await row.getAttribute('data-operation-state');refresh.resolve();
  assert.equal(waiting,'pending','do not show a check mark based on DELETE alone');
  await row.getByRole('alert').waitFor();assert.ok(await submit.isDisabled(),'a cart that would buy the unwanted item is not ready');
  await page.locator('.shop-cart-summary form').evaluate(f=>f.requestSubmit());
  assert.equal(await page.evaluate(()=>window.visits.length),0,'form itself must refuse stale cart submission');
  if(recovery==='read-again') {
    await capture(page,'deletion-needs-review');
    await row.getByRole('button',{name:'重新核对',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.shop-cart-item').length===1);
    assert.deepEqual(await page.locator('input[name$=".cartItemId"]').evaluateAll(nodes=>nodes.map(n=>n.value)),['2902']);
  } else {
    await row.getByRole('button',{name:'保留商品',exact:true}).click();
    assert.equal(await page.locator('.shop-cart-item').count(),2);assert.equal(reads,2);
  }
  await page.waitForFunction(()=>!document.querySelector('.shop-cart-summary button').disabled);
  assert.deepEqual(writes,['DELETE '+cartPath+'/2901']);
});

test('a failed reconciliation read can remount the surviving row without losing its checkout hold', async t => {
  let reads = 0;
  const { page, writes } = await fixture(t, 'cart', (method, url) => {
    if (method === 'DELETE' && url === cartPath + '/2901') return { status: 204, body: '' };
    if (method === 'GET' && url === cartPath) {
      if (++reads === 2) return { status: 422, json: { detail: 'fixture: read unavailable' } };
      return { json: cartItems };
    }
  });
  await page.locator('.shop-cart-item__remove').first().click();
  await page.locator('.shop-cart__error').getByRole('button', { name: '重试' }).click();
  const row = page.locator('.shop-cart-item').first();
  await row.getByRole('button', { name: '保留商品' }).waitFor();
  assert.equal(await page.locator('.shop-cart-summary button').isDisabled(), true);
  assert.deepEqual(writes, ['DELETE ' + cartPath + '/2901']);
});

for(const operation of ['apply','remove','coupons']) test(`an accepted ${operation} followed by a failed summary read only retries the GET`,async t=>{
  let reads=0, recovering=false;const saved={...checkout,isShippingRequired:false};
  saved.calculateResult={...checkout.calculateResult,...(operation==='remove'?{discountAmount:2,discountCode:'SAVE',discountName:'折扣'}:{})};
  const {page,writes}=await fixture(t,'checkout',(m,p)=>{
    if(m==='GET'&&p===contextPath) return ++reads>1&&!recovering?{status:422,json:{detail:'fixture: summary not available'}}:{json:saved};
    if(m==='GET'&&p==='/shop/coupons/mine')return {json:[{id:93,status:'AVAILABLE',couponName:'示例券'}]};
    if(m===({apply:'POST',remove:'DELETE',coupons:'PUT'})[operation] && p===(operation==='coupons'?api+'/checkout/'+contextId+'/coupons':'/shop/checkout/'+contextId+'/discount'))return {json:saved};
  });
  await page.waitForFunction(()=>document.querySelector('.shop-checkout')?.getAttribute('aria-busy')==='false');
  await page.evaluate(()=>{
    window.messages = [];
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
        const msg = toast.innerText.trim();
        if (msg && !window.messages.includes(msg)) window.messages.push(msg);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const card=page.locator('.shop-checkout-discount-card').first();
  if(operation==='apply'){await card.locator('input').fill('SAVE');await card.locator('input').press('Enter');}
  if(operation==='remove')await card.getByRole('button',{name:'移除',exact:true}).click();
  if(operation==='coupons'){const coupons=page.locator('.shop-checkout-discount-card').last();await coupons.locator('input[type=checkbox]').check();await coupons.locator('button').last().click();}
  const summary=page.locator('.shop-checkout__actions');await summary.getByRole('alert').waitFor({timeout:15000});
  assert.ok(await summary.locator('button[type=submit]').isDisabled());
  assert.doesNotMatch(await page.evaluate(()=>window.messages.join(' ')),/无效|过期|移除失败|应用失败|更新失败|fixture: summary not available/,'a read error must not appear as a rejected write');
  if(operation==='apply') await capture(page,'checkout-refresh-failed');
  const readsBeforeRetry=reads;recovering=true;await summary.getByRole('button',{name:'重试',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.shop-checkout button[type=submit]')?.disabled);
  assert.equal(reads,readsBeforeRetry+1);assert.equal(writes.length,1);
});

for(const outcome of [504,201]) test(`subscription POST ${outcome}: an explicit cart check is a GET, with no second add or purchase`,async t=>{
  const {page,writes}=await fixture(t,'subscription',(m,p)=>m==='POST'&&p===cartPath?{status:outcome,json:{}}:undefined);
  const add=page.locator('.shop-subscription__actions > button'), buy=page.locator('.shop-subscription form button[type=submit]');
  const settled=page.waitForResponse(r=>r.request().method()==='POST');await add.click();await settled;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok(await add.isDisabled(),'same mounted purchase cannot repeat the write');assert.ok(await buy.isDisabled());
  await add.evaluate(n=>n.click());await buy.evaluate(n=>n.form.requestSubmit());
  assert.equal(await page.locator('.shop-subscription a[href="/shop/cart"]').count(),1);
  const feedback=await page.locator('.shop-subscription').innerText();
  if(outcome===201){assert.match(feedback,/已加入购物车/);assert.doesNotMatch(feedback,/结果尚不确定/);}
  else assert.match(feedback,/结果尚不确定/);
  assert.deepEqual(await page.evaluate(()=>window.visits.map(v=>v.url)),outcome===201?['/shop/cart']:[]);
  await capture(page,'subscription-'+outcome);
  const checking=page.waitForRequest(request=>new URL(request.url()).pathname==='/shop/cart');
  await page.locator('.shop-subscription a[href="/shop/cart"]').click();
  assert.equal((await checking).method(),'GET');
  assert.deepEqual(writes,['POST '+cartPath]);
});

for(const [locale,cookie,label] of [['es-ES',null,'Agregar al carrito'],['en-GB','es-MX','Agregar al carrito'],['es-ES','zh-TW','加入購物車']]) {
  test(`subscription controls use the supported language for browser ${locale} / cookie ${cookie??'—'}`,async t=>{
    const {page}=await fixture(t,'subscription',null,{locale,cookie});
    const add=page.locator('.shop-subscription__actions > button');await add.waitFor();
    assert.equal((await add.innerText()).trim(),label);
    if (locale==='es-ES'&&!cookie) await capture(page,'spanish-regional');
  });
}
