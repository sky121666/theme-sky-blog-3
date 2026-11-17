import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const origin = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin;
const article = process.env.READING_ARTICLE_PATH || '/archives/mac-restart-podman-container-start';
const dir = path.resolve(process.env.CONTINUITY_OUTPUT || 'output/window-continuity');
await mkdir(dir, { recursive: true });
const rows = [];
const draftState = p => p.locator('comment-widget comment-form base-form').evaluateAll(forms =>
  forms.map(form => ({ dirty:Boolean(form.getDraftSnapshot().content), busy:Boolean(form.uploading || form.submitting) })));
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CONTINUITY_ENGINE && process.env.CONTINUITY_ENGINE !== name) continue;
  const browser = await engine.launch();
  try {
    for (const mobile of [false, true]) {
      if (process.env.CONTINUITY_INPUT && process.env.CONTINUITY_INPUT !== (mobile?'touch':'desktop')) continue;
      const row = { name, version: browser.version(), mobile, errors: [], writes: [] }; rows.push(row);
      const ctx = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1440,height:900},
        isMobile:mobile, hasTouch:mobile, reducedMotion:mobile ? 'reduce' : 'no-preference', extraHTTPHeaders:{'Cache-Control':'no-cache'} });
      let p;
      try {
        await ctx.route('**/*', route => {
          const req = route.request(), url = new URL(req.url());
          if (url.origin !== origin) return route.abort('blockedbyclient');
          if (!['GET','HEAD','OPTIONS'].includes(req.method())) {
            if (url.pathname.endsWith('/trackers/counter')) return route.fulfill({status:204,body:''});
            row.writes.push(url.pathname); return route.abort();
          }
          return route.continue();
        });
        p = await ctx.newPage(); p.setDefaultTimeout(9000);
        p.on('pageerror', e => row.errors.push(e.message));
        const r = await p.goto(new URL(article,origin).href, { waitUntil:'domcontentloaded' });
        assert.equal(r.status(),200);
        await p.waitForFunction(() => !!window.Alpine?.store('windowManager') && !!window.pjax);
        row.revision = await p.locator('#shell-core-style').evaluate(el => new URL(el.href).searchParams.get('r'));
        await p.evaluate(() => {
          window.__continuityDesktop = document.querySelector('.desktop-surface');
          window.__continuityVisits = [];
          document.addEventListener('theme:pjax-ready', () => window.__continuityVisits.push(location.href));
          window.__continuityTrace = [];
          for (const type of ['theme:navigation-accepted','theme:navigation-settled','theme:pjax-ready']) {
            document.addEventListener(type,e=>window.__continuityTrace.push({
              type,at:performance.now(),url:e.detail?.url,outcome:e.detail?.outcome,reason:e.detail?.reason,
              live:location.href,app:document.body.dataset.pageApp
            }));
          }
          window.addEventListener('popstate',()=>window.__continuityTrace.push({type:'popstate',at:performance.now(),url:location.href}));
        });
        if (!mobile) {
          const surface = p.locator('#window-frame-root [data-window-surface]').first();
          const bar = p.locator('#window-frame-root [data-window-titlebar]').first();
          const before = await surface.boundingBox(), b = await bar.boundingBox();
          const x = Math.round(b.x+b.width*.51), y = Math.round(b.y+b.height*.45);
          await p.evaluate(() => {
            window.__dragFrames = []; window.__draggingProbe = true;
            const frame = t => {window.__dragFrames.push(t); if(window.__draggingProbe)requestAnimationFrame(frame);};
            requestAnimationFrame(frame);
          });
          await p.mouse.move(x,y); await p.mouse.down();
          for(let i=1;i<=20;i++){await p.mouse.move(x+i*2,y+i);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
          await p.mouse.up();
          const after = await surface.boundingBox();
          assert.ok(Math.abs(after.x-before.x)>12 || Math.abs(after.y-before.y)>12, 'titlebar drag moved window');
          row.drag = await p.evaluate(() => {window.__draggingProbe=false; const ts=window.__dragFrames;
            const deltas=ts.slice(1).map((t,i)=>t-ts[i]).sort((a,b)=>a-b);
            return { intervals:deltas.length, p75Ms:deltas[Math.ceil(deltas.length*.75)-1], maxMs:deltas.at(-1) };});
        }
        const comments=p.locator('#post-comments'); await comments.scrollIntoViewIfNeeded();
        const editor=p.locator('comment-widget comment-form [contenteditable="true"]').first();
        // WebKit's locator.fill on this shadow contenteditable can leave the
        // editor's draft empty. Exercise real input and confirm the official
        // component sees it before testing either branch of the leave guard.
        const draft = 'local unsubmitted draft';
        if (mobile) await editor.tap(); else await editor.click();
        await editor.pressSequentially(draft);
        const form = p.locator('comment-widget comment-form base-form').first();
        row.stage='official draft';
        await p.waitForFunction(({form,draft}) => form.getDraftSnapshot().content.includes(draft),
          {form:await form.elementHandle(),draft});
        const dest=p.locator('a[href="/links"]:visible').first();
        if(!await dest.count()) {
          // The mobile Dock can be collapsed; use a normal public article link in the same window.
          assert.ok(await p.locator('#window-frame-root .post-neighbor-title').count());
        }
        const trigger=await dest.count()?dest:p.locator('#window-frame-root a:has(.post-neighbor-title)').first();
        const targetURL=await trigger.evaluate(el=>el.href);
        const prompts=[];
        const activate=async keep=>{
          await Promise.all([p.waitForEvent('dialog').then(async d=>{
            prompts.push(d.type()); if(keep)await d.dismiss();else await d.accept();
          }), mobile ? trigger.tap() : trigger.click()]);
        };
        row.stage='dismiss draft prompt'; await activate(true);
        assert.deepEqual(prompts,['confirm']);
        assert.ok((await editor.innerText()).includes(draft),'declining navigation keeps editor');
        assert.equal(new URL(p.url()).pathname,article);
        row.stage='accept draft prompt'; await activate(false);
        assert.deepEqual(prompts,['confirm','confirm']);
        await p.waitForURL(targetURL,{waitUntil:'commit'});
        const ready = (count,href) => p.waitForFunction(({count,href}) =>
          window.__continuityVisits?.length === count && window.__continuityVisits.at(-1) === href, {count,href});
        row.stage='render destination'; await ready(1,targetURL);
        await p.goBack({waitUntil:'commit'}); await p.waitForURL(new URL(article,origin).href);
        row.stage='render back'; await ready(2,new URL(article,origin).href);
        await p.waitForFunction(()=>document.body.dataset.pageApp==='reader');
        // The window-ready event does not promise the official lazy editor is
        // mounted. Observe its restored draft before a deliberate Forward.
        // The rapid variant keeps that race observable as a separate diagnostic.
        row.rapidForward=process.env.CONTINUITY_RAPID_FORWARD!=='0';
        row.stage='restore draft after back';
        if(!row.rapidForward){
          await comments.scrollIntoViewIfNeeded();
          await p.waitForFunction(({form,draft}) => form.getDraftSnapshot().content.includes(draft),
            {form:await form.elementHandle(),draft});
          row.restoredDraft=true;
        }
        // The official widget can restore its saved draft on Back. If it has
        // mounted before Forward, that is another real guarded leave.
        // Playwright otherwise auto-dismisses it and the user stays in reader.
        row.stage='confirm forward if draft restored';
        row.beforeForwardDrafts=await draftState(p);
        const forwardPrompts=row.forwardPrompts=[];
        const confirmForward=async d=>{
          forwardPrompts.push({type:d.type(), message:d.message()}); await d.accept();
        };
        p.on('dialog',confirmForward);
        await p.goForward({waitUntil:'commit'}); await p.waitForURL(targetURL);
        row.stage='render forward'; await ready(3,targetURL);
        p.off('dialog',confirmForward); row.forwardPrompts=forwardPrompts;
        assert.ok(forwardPrompts.length===1 && forwardPrompts.every(d=>d.type==='confirm' && d.message.includes('评论中有未完成的内容')), 'Forward asks once about the same saved draft');
        row.stage='decline forward after back';
        const sourceURL=new URL(article,origin).href;
        await p.goBack({waitUntil:'commit'}); await ready(4,sourceURL);
        await Promise.all([p.waitForEvent('dialog').then(async d=>{
          assert.equal(d.type(),'confirm');await d.dismiss();
        }),p.goForward({waitUntil:'commit'})]);
        await p.waitForURL(sourceURL,{waitUntil:'commit'});
        assert.deepEqual(await p.evaluate(()=>window.__continuityVisits.length),4);
        await comments.scrollIntoViewIfNeeded();
        await p.waitForFunction(({form,draft})=>form.getDraftSnapshot().content.includes(draft),
          {form:await form.elementHandle(),draft});
        row.declinedForwardKeptDraft=true;
        // A unique read-only target avoids Swup's prior response cache. Hold
        // this real GET until new input reaches the real official draft.
        row.stage='new input during accepted read';
        const pendingURL=new URL(targetURL);pendingURL.searchParams.set('continuity-draft-probe','1');
        let release,hit;const held=new Promise(r=>{release=r;});const started=new Promise(r=>{hit=r;});
        const onRead=async route=>{hit();await held;await route.continue();};
        await p.route(pendingURL.href,onRead);
        let newInputPrompts=0;
        const allowPending=async d=>{newInputPrompts++;await d.accept();};
        p.on('dialog',allowPending);
        try{
          await trigger.evaluate((el,url)=>{el.href=url;el.setAttribute('data-continuity-target','');},pendingURL.href);
          const pendingLink=p.locator('a[data-continuity-target]');
          const requested=p.waitForRequest(r=>r.method()==='GET'&&r.url()===pendingURL.href);
          await Promise.all([requested,mobile?pendingLink.tap():pendingLink.click()]);await started;
          const suffix=' changed during fetch';
          await editor.press('End');await editor.pressSequentially(suffix);
          await p.waitForFunction(({form,suffix})=>form.getDraftSnapshot().content.includes(suffix),
            {form:await form.elementHandle(),suffix});
          release();
          await p.waitForFunction(url=>window.__continuityTrace.some(e=>e.type==='theme:navigation-settled'&&e.url===url&&e.outcome==='cancelled'),pendingURL.href);
          assert.equal(new URL(p.url()).href,sourceURL);assert.ok((await editor.innerText()).includes(suffix));
          assert.equal(newInputPrompts,1,'changed input revokes the existing vote without duplicating it');
          row.newInputKept=true;
        }finally{release();p.off('dialog',allowPending);await p.unroute(pendingURL.href,onRead);}
        await p.waitForFunction(() => window.__continuityDesktop===document.querySelector('.desktop-surface'));
        row.prompts=prompts; row.target=new URL(targetURL).pathname;
        row.renderedHistory=await p.evaluate(()=>window.__continuityVisits.map(href=>new URL(href).pathname));
        assert.deepEqual(row.writes,[]); assert.deepEqual(row.errors,[]); row.pass=true;
      } catch(e){
        row.pass=false;row.error=e.message;row.url=p?.url();
        if(p){row.observedVisits=await p.evaluate(()=>window.__continuityVisits).catch(()=>null);
          row.trace=await p.evaluate(()=>window.__continuityTrace).catch(()=>null);
          row.remainingDrafts=await draftState(p).catch(()=>null);}
      } finally {await ctx.close();}
      console.log(row.pass?'PASS':'FAIL',name,mobile?'touch':'desktop',row.error||'');
    }
  } finally {await browser.close();}
}
await writeFile(path.join(dir,'result.json'), JSON.stringify(rows,null,2)+'\n');
assert.ok(rows.length, 'No supported engine selected');
if(rows.some(r=>!r.pass))process.exitCode=1;
