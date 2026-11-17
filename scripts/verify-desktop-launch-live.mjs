import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const origin = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
const dir = path.resolve(process.env.LAUNCH_OUTPUT || 'output/desktop-launch');
const meta = JSON.parse(await fs.readFile('templates/assets/asset-manifest.json','utf8')).__meta;
await fs.mkdir(dir,{recursive:true});
const engine=process.env.LAUNCH_ENGINE || 'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const browser=await ({chromium,webkit}[engine]).launch(), results=[];
const scenarios = [
  { name:'dock-links', width:1440, dest:'/links' },
  { name:'docs-placement', width:1440, dest:'/docs', fixtureLink:true },
  { name:'dock-shop', width:1440, dest:'/shop/products' },
  ...['photos','moments','steam','douban','equipments','bangumis','archives'].map(app=>({name:app+'-placement',width:1440,dest:'/'+app,fixtureLink:true})),
  { name:'remembered-docs-window', width:1440, dest:'/docs', fixtureLink:true, saved:true },
  { name:'dock-failure-reduced', width:1440, dest:'/links', fail:true, reduce:true },
  { name:'mobile-no-desktop-preview', width:390, dest:'/links', mobile:true }
];
const selected=process.env.LAUNCH_CASE ? scenarios.filter(s=>s.name===process.env.LAUNCH_CASE) : scenarios;
assert.ok(selected.length,'No matching open-window case');
for (const s of selected) {
  const ctx=await browser.newContext({viewport:{width:s.width,height:s.mobile?844:900},isMobile:!!s.mobile,hasTouch:!!s.mobile,reducedMotion:s.reduce?'reduce':'no-preference',serviceWorkers:'block',extraHTTPHeaders:{'Cache-Control':'no-cache'}});
  const rec={...s, engine, version:browser.version(), errors:[], writes:[], revision:meta.revision};results.push(rec);
  let start=false,release;const gate=new Promise(r=>{release=r;});
  try {
    await ctx.addInitScript(()=>{
      window.__openTrace=[];
      const trace=(type,extra)=>window.__openTrace.push({type,t:performance.now(),...extra});
      for(const type of ['theme:navigation-accepted','theme:pjax-ready','theme:navigation-settled']) document.addEventListener(type,e=>trace(type,{intent:e.detail.intentId,outcome:e.detail.outcome||e.detail.status}));
      new MutationObserver(rs=>{if(rs.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&n.matches('[data-launch-preview]'))))trace('preview');}).observe(document,{childList:true,subtree:true});
    });
    await ctx.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)return route.abort('blockedbyclient');
      if(!['GET','HEAD','OPTIONS'].includes(req.method())){if(url.pathname.endsWith('/trackers/counter'))return route.fulfill({status:204,body:''});rec.writes.push(req.method()+' '+url.pathname);return route.abort();}
      if(start&&url.pathname===s.dest){await gate;if(s.fail)return route.fulfill({status:503,contentType:'text/html',body:'<html><body>unavailable</body></html>'});}
      return route.continue();
    });
    const p=await ctx.newPage();p.setDefaultTimeout(18000);p.on('pageerror',e=>rec.errors.push(e.message));
    const resp=await p.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:45000});
    assert.ok((await resp.text()).includes('r='+meta.revision));
    await p.waitForFunction(()=>document.body.dataset.pageMode==='browser-home'&&window.Alpine?.store('windowManager')&&!window.__THEME_STARTUP__?.active&&!document.querySelector('[data-theme-startup-layer]'));
    const link=p.locator(`a.dock-icon[href="${s.dest}"]`).first();
    if (s.fixtureLink || (s.mobile && !await link.isVisible())) {
      // The configured desktop Dock has a real links item; docs and phone test the
      // same click path using an explicit public test link, without editing site settings.
      await p.evaluate(dest=>{const a=document.createElement('a');a.className='pjax-link';a.href=dest;a.id='launch-fixture';a.textContent='测试入口';Object.assign(a.style,{position:'fixed',top:'60px',left:'10px',zIndex:9999});document.body.append(a);},s.dest);
      rec.fixtureLink=true;
    }
    const trigger=rec.fixtureLink?p.locator('#launch-fixture'):link;
    const before=p.url(); await p.evaluate(()=>{window.__launchDoc=document;window.__openTrace=[];});start=true;
    if(s.saved)await p.evaluate(()=>localStorage.setItem('theme-window-metrics-docsme',JSON.stringify({x:95,y:120,width:850,height:550})));
    if(s.mobile) await trigger.tap(); else {await trigger.focus();await trigger.press('Enter');}
    await p.waitForFunction(()=>window.__openTrace.some(x=>x.type==='theme:navigation-accepted'));
    const preview=p.locator('[data-launch-preview]');
    if(s.mobile){assert.equal(await preview.count(),0);}
    else {
      await preview.waitFor({state:'visible'});assert.equal(p.url(),before);
      assert.equal(await p.locator('#window-frame-root [data-window-surface]').count(),0);
      // The pending surface cannot activate a widget underneath. The surrounding Dock remains usable.
      assert.ok(await preview.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
      rec.animations=await preview.evaluate(el=>el.getAnimations().length);
      await preview.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
      rec.earlyRect=await preview.boundingBox();
      if(s.reduce)assert.equal(rec.animations,0);
      rec.previewMs=await p.evaluate(()=>{const a=window.__openTrace.find(x=>x.type==='theme:navigation-accepted'),b=window.__openTrace.find(x=>x.type==='preview');return Math.round(b.t-a.t);});
      if(s.name==='dock-links')await p.screenshot({path:path.join(dir,'dock-links-pending.png')});
    }
    release();
    await p.waitForFunction(()=>window.__openTrace.some(x=>x.type==='theme:navigation-settled'));
    assert.equal(await preview.count(),0);
    if(s.fail){assert.equal(p.url(),before);assert.equal(await p.locator('body').getAttribute('data-page-mode'),'browser-home');}
    else {
      await p.waitForURL(origin+s.dest,{waitUntil:'commit'});const surface=p.locator('#window-frame-root [data-window-surface]');await surface.waitFor({state:'visible'});
      if(!s.mobile){rec.finalRect=await surface.boundingBox();for(const k of ['x','y','width','height'])assert.ok(Math.abs(rec.earlyRect[k]-rec.finalRect[k])<=2,'placement '+k+': '+JSON.stringify([rec.earlyRect,rec.finalRect]));}
      if(s.name==='dock-links')await p.screenshot({path:path.join(dir,'dock-links-ready.png')});
    }
    assert.ok(await p.evaluate(()=>document===window.__launchDoc)); assert.deepEqual(rec.errors,[]);assert.deepEqual(rec.writes,[]);
    rec.events=await p.evaluate(()=>window.__openTrace);rec.pass=true;
  }catch(e){rec.pass=false;rec.error=e.message;}
  finally{release();await ctx.close();await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(results,null,2));console.log(rec.pass?'PASS':'FAIL',s.name,rec.previewMs,rec.error||'');}
}
await browser.close();if(results.some(r=>!r.pass))process.exitCode=1;
