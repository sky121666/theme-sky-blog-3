// Real, uncached anonymous link clicks. Count foreground application parses of
// the destination HTML, not parsing by the browser's initial document loader.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium, webkit} from 'playwright';

const base=new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
const out=path.resolve(process.env.NAV_DOCUMENT_OUTPUT || 'output/navigation-document');
const repeats=Number(process.env.NAV_DOCUMENT_REPEATS || 3);
assert.ok(Number.isInteger(repeats) && repeats>0);
const engine=process.env.NAV_DOCUMENT_ENGINE || 'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const cases=[
  ['/docs','.docsme-project-card','docsme'],
  ['/archives','.archive-entry--file','reader'],
  ['/photos','.photo-card','photos'],
  ['/tags','.tags-sidebar-item.pjax-link:not([href="/tags"])','explorer-tags'],
  ['/bangumis','a[href*="status=1"]','bangumis'],
  ['/docs','a.dock-icon[href="/links"]','links'],
  ['/links','a.dock-icon[href="/"]','']
];
const browser=await ({chromium,webkit})[engine].launch(), result=[];
try {
  for(let round=0;round<repeats;round++) for (const [from,css,app] of cases) {
    const ctx=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',
      extraHTTPHeaders:{'Cache-Control':'no-cache'}});
    const p=await ctx.newPage(), row={round,engine,from,app,errors:[],localAssetErrors:[]}; result.push(row);
    try {
      await ctx.route('**/*',r=>{
        const q=r.request(), u=new URL(q.url());
        if(u.origin!==base) return r.abort('blockedbyclient');
        if(!['GET','HEAD','OPTIONS'].includes(q.method())) {
          if(u.pathname.endsWith('/trackers/counter')) return r.fulfill({status:204,body:''});
          row.errors.push('Unexpected write: '+q.method()+' '+u.pathname); return r.abort();
        }
        return r.continue();
      });
      await ctx.addInitScript(()=>{
        Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:true,effectiveType:'4g'}});
        const orig=DOMParser.prototype.parseFromString;
        DOMParser.prototype.parseFromString=function(input,...args){
          const t=performance.now(),doc=orig.call(this,input,...args);
          const parsedMs=performance.now()-t;
          if(window.__docVisit && args[0]==='text/html' && doc.getElementById('shell-core-style'))
            window.__docVisit.parses.push({app:doc.body.dataset.pageApp||'',chars:input.length,ms:parsedMs});
          return doc;
        };
        document.addEventListener('theme:navigation-accepted',()=>{if(window.__docVisit)window.__docVisit.start=performance.now();});
        document.addEventListener('theme:pjax-ready',()=>{if(window.__docVisit)window.__docVisit.ready=performance.now();});
      });
      p.on('pageerror',e=>row.errors.push(e.message));
      p.on('response',r=>{
        const url=new URL(r.url());
        if(url.origin===base && url.pathname.startsWith('/themes/') && r.status()>=400)
          row.localAssetErrors.push({path:url.pathname,status:r.status()});
      });
      assert.equal((await p.goto(base+from,{waitUntil:'domcontentloaded'})).status(),200);
      await p.waitForFunction(()=>window.pjax && !document.querySelector('[data-theme-startup-layer]'));
      const link=p.locator(css+':visible').first();
      row.to=await link.evaluate(a=>new URL(a.href).pathname+new URL(a.href).search);
      await p.evaluate(()=>{window.__docVisit={desktop:document.querySelector('.desktop-surface'),parses:[]};});
      await link.click(); await p.waitForFunction(expected=>window.__docVisit?.ready &&
        location.pathname+location.search===expected,row.to,{timeout:15000});
      const snapshot=await p.evaluate(()=>{
        const {desktop,parses,start,ready}=window.__docVisit;
        const targetRequests=performance.getEntriesByType('resource').filter(entry=>{
          if (!['fetch','xmlhttprequest'].includes(entry.initiatorType) || entry.startTime<start-2 || entry.responseEnd>ready+2) return false;
          const dest=new URL(entry.name);
          return dest.origin===location.origin && dest.pathname===location.pathname && dest.search===location.search;
        }).map(entry=>({dispatchMs:Math.round(entry.startTime-start),firstByteMs:Math.round(entry.responseStart-start),
          htmlDoneMs:Math.round(entry.responseEnd-start),afterHtmlMs:Math.round(ready-entry.responseEnd)}));
        return {parses,readyMs:Math.round(ready-start),desktopRetained:!!desktop && desktop===document.querySelector('.desktop-surface'),
          targetRequests,
          revision:window.__THEME_ASSET_IDENTITY__?.revision,
          canonical:document.querySelector('head link[rel=canonical]')?.href,
          renderedApp:document.body.dataset.pageApp||''};
      }); Object.assign(row,snapshot);
      assert.equal(row.renderedApp,app); assert.ok(row.desktopRetained); assert.ok(row.canonical);
      assert.deepEqual(row.errors,[]); assert.deepEqual(row.localAssetErrors,[]);
      // Swup 4 creates its own visit.to.document; cache eligibility also
      // validates public responses separately from foreground navigation.
      const count=row.parses.filter(x=>x.app===app).length;
      assert.ok(count>=1 && count<=3,'No per-plugin reparsing of the full destination HTML');
      row.pass=true;
    } catch(e){
      row.pass=false;row.error=e.message.split('\n')[0];
      row.state=await p.evaluate(()=>({url:location.pathname,shell:!!window.pjax,
        revision:window.__THEME_ASSET_IDENTITY__?.revision,startup:!!document.querySelector('[data-theme-startup-layer]'),
        visitStarted:!!window.__docVisit?.start,visitReady:!!window.__docVisit?.ready})).catch(()=>null);
    }
    finally {await ctx.close();}
    console.log(row.pass?'PASS':'FAIL',from,'→',row.to,row.parses?.length,'parses,',row.readyMs,'ms',row.error||'');
  }
} finally {await browser.close();await mkdir(out,{recursive:true});await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');}
if(result.some(r=>!r.pass)) process.exitCode=1;
