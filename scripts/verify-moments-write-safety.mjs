import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Same operations in both modes. Source mode serves the ESM owners directly;
// live mode uses only the served UI. No business write leaves the browser.
const repo = fileURLToPath(new URL('../', import.meta.url));
const live = process.argv.includes('--live');
const site = live ? new URL(process.env.SMOKE_BASE_URL || 'http://localhost:8090').origin : 'http://moments-fixture.test';
const identity = live ? await (await import('./lib/live-build-context.mjs')).readLiveBuildContext(site) : null;
const base = '/apis/moment.halo.run/v1alpha1/moments';
const tracker = '/apis/api.halo.run/v1alpha1/trackers/upvote';
const html = `<!doctype html><meta charset=utf-8><div class="moments-window" data-app-root="moments">
<button data-moments-publish-open>发布</button><dialog data-moments-publish-dialog><form method="dialog" data-moments-publish-form>
<textarea data-moments-publish-content></textarea><span data-moments-publish-count></span><span data-moments-publish-status></span>
<div data-moments-publish-preview></div><div data-moments-publish-tags></div><input type=file data-moments-publish-file>
<button type=button data-moments-publish-close>取消</button><button type=button data-moments-publish-new hidden>另写新稿</button><button type=submit data-moments-publish-submit>发表</button></form></dialog>
<section class="moments-feed-list"><article data-moment-card data-moment-name="fixture" data-comment-count="0" data-upvote-count="2">
<a href="/moments/fixture" class="moment-feed-time-link pjax-link">详情</a><div class="moment-feed-actions"><button data-moment-action-toggle>更多</button>
<div data-moment-action-popover hidden><button data-moment-comments-toggle>评论</button><button data-moment-upvote><span data-moment-upvote-label>赞</span></button></div></div>
<section data-moment-comments-panel><div data-moment-comments-status></div><div data-moment-comments-list></div>
<form data-moment-comment-form><textarea data-moment-comment-input></textarea><button data-moment-comment-submit></button></form></section></article></section>
</div><script type=module>
import {setupMomentPublish} from '/src/apps/moments/publish.js';import {setupMomentInteractions} from '/src/apps/moments/interactions.js';
import {installCommentDraftGuard} from '/src/shell/desktop-shell/runtime/desktop/pjax/comment-draft-guard.js';
import {createNavigationAdmission} from '/src/shell/desktop-shell/runtime/desktop/pjax/navigation-admission.js';
const admission=createNavigationAdmission({eventTarget:window});admission.registerNavigationGuard(installCommentDraftGuard());
window.__admission=admission;window.pjax={loadUrl(){}};window.__exitPublish=setupMomentPublish();setupMomentInteractions(document);
document.querySelector('.moment-feed-time-link').onclick=e=>{e.preventDefault();const vote=admission.prepareNavigation({url:e.currentTarget.href});if(vote.kind==='accepted' && admission.commitNavigation(vote.permit,()=>true)==='committed')document.querySelector('[data-moment-card]').remove();};
window.__ready=true;</script>`;
const browser=await chromium.launch();
const entries=[];
async function scenario(name, run, width=390){
  if(process.env.MOMENTS_SAFETY_CASE && !new RegExp(process.env.MOMENTS_SAFETY_CASE).test(name))return;
  const context=await browser.newContext({viewport:{width,height:width===390?844:950},serviceWorkers:'block',reducedMotion:'reduce'});
  const record={name,width,confirmed:[],requests:[],untouchedWrites:[],errors:[]};
  const records=new Map();const seen=[];
  let updateMode='ack';let readerMode='found';let voteStatus=204;let paused;let acceptPrompt=false;
  const gate=new Promise(resolve=>{paused=resolve;});
  const page=await context.newPage();page.setDefaultTimeout(6000);
  page.on('pageerror',e=>record.errors.push(e.message));
  page.on('dialog',async d=>{record.confirmed.push(d.type()+':'+d.message());if(acceptPrompt)await d.accept();else await d.dismiss();});
  const respond=(route,status,json)=>route.fulfill(status===204?{status,body:''}:{status,contentType:'application/json',body:JSON.stringify(json)});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()), p=url.pathname,m=req.method();
    if(url.origin!==site){
      if(!['GET','HEAD','OPTIONS'].includes(m))record.untouchedWrites.push(m+' '+url.origin+p);
      return route.abort();
    }
    if(p==='/apis/api.console.halo.run/v1alpha1/users/-' && m==='GET')return respond(route,200,{metadata:{name:'spec-user'},spec:{displayName:'隔离作者'}});
    if(p==='/apis/uc.api.storage.halo.run/v1alpha1/attachments/-/upload' && m==='POST'){
      record.requests.push({kind:'upload'});return respond(route,200,{metadata:{name:'only-in-memory'},status:{permalink:'/__probe_img.gif'}});
    }
    if(p==='/__probe_img.gif' && m==='GET')return route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64')});
    if(p==='/apis/storage.halo.run/v1alpha1/attachments/only-in-memory' && m==='DELETE'){record.requests.push({kind:'delete'});return respond(route,204);}
    if(p===base && m==='POST'){
      const obj=req.postDataJSON();seen.push(obj);
      const entry={kind:'create',name:obj.metadata.name,mode:updateMode,
        payloadSha256:createHash('sha256').update(JSON.stringify(obj)).digest('hex')};
      record.requests.push(entry);
      const reply=(status,body)=>{entry.status=status;return respond(route,status,body);};
      if(updateMode==='reject')return reply(403,{status:403,detail:'Forbidden'});
      if(updateMode==='redirect'){entry.status=307;return route.fulfill({status:307,headers:{Location:'/__must-not-replay-write'}});}
      if(updateMode==='paused'){entry.status='held';await gate;return route.abort().catch(()=>{});}
      if(updateMode==='absent')return reply(504,{});
      if(records.has(obj.metadata.name))return reply(409,{});
      records.set(obj.metadata.name,obj);
      return updateMode==='unknown'?reply(504,{}):reply(201,obj);
    }
    if(p.startsWith(base+'/') && m==='GET'){
      const name=decodeURIComponent(p.slice(base.length+1)),item=records.get(name);
      const entry={kind:'check',name,mode:readerMode};record.requests.push(entry);
      const reply=(status,body)=>{entry.status=status;return respond(route,status,body);};
      if(readerMode==='forbidden')return reply(403,{});
      if(readerMode==='login'){entry.status=200;return route.fulfill({status:200,contentType:'text/html',body:'<form>login</form>'});}
      if(readerMode==='unrecognized404')return reply(404,{});
      if(readerMode==='wrong' && item)return reply(200,{...item,spec:{...item.spec,content:{...item.spec.content,raw:'另一份内容'}}});
      return item?reply(200,item):reply(404,{status:404,reason:'NotFound'});
    }
    if(p===tracker && m==='POST'){
      record.requests.push({kind:'vote',status:voteStatus});
      if(voteStatus==='redirect')return route.fulfill({status:307,headers:{Location:'/__must-not-replay-write'}});
      return voteStatus===0?route.abort():respond(route,voteStatus,{});
    }
    if(p==='/apis/api.halo.run/v1alpha1/trackers/counter' && m==='POST')return respond(route,204);
    if(!['GET','HEAD','OPTIONS'].includes(m)){record.untouchedWrites.push(p);return route.abort();}
    if(live)return route.continue();
    if(p.startsWith('/src/')&&p.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:await fs.readFile(path.join(repo,p.slice(1)))});
    if(p==='/moments')return route.fulfill({contentType:'text/html',body:html});
    return respond(route,200,{items:[],page:1,total:0,size:5,hasNext:false});
  });
  const visit=async()=>{
    await page.goto(site+'/moments',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(live=>live?window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId==='moments'&&!window.__THEME_STARTUP__?.active&&!document.querySelector('[data-theme-startup-layer]'):window.__ready,live,{timeout:20000});
  };
  try{
    await visit();const card=page.locator('[data-moment-card]').first(),dialog=page.locator('[data-moments-publish-dialog]'), submit=dialog.locator('[data-moments-publish-submit]'), close=dialog.locator('[data-moments-publish-close]'), input=dialog.locator('[data-moments-publish-content]'),status=dialog.locator('[data-moments-publish-status]');
    const open=()=>page.locator('[data-moments-publish-open]').first().click();
    const withMedia=async()=>{await open();await input.fill('仅保存在浏览器替身的原稿');await dialog.locator('[data-moments-publish-file]').setInputFiles({name:'test.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});await dialog.locator('[data-moments-publish-preview][data-count="1"]').waitFor();};
    const action=async selector=>{const a=card.locator(selector);if(!await a.isVisible())await card.locator('[data-moment-action-toggle]').click();return a;};
    await run({page,record,records,seen,visit,open,withMedia,card,dialog,submit,close,input,status,action,setMode:v=>updateMode=v,setReader:v=>readerMode=v,setVote:v=>voteStatus=v,setConfirm:v=>acceptPrompt=v});
    assert.deepEqual(record.untouchedWrites,[]);assert.deepEqual(record.errors,[]);record.result='PASS';
  }catch(e){record.result='FAIL';record.error=e.message;}
  finally{paused();await context.close();entries.push(record);console.log(record.result,name,record.error||'');}
}
try{
  await scenario('已创建但网关返回504：关闭、刷新再核对只发GET，不删附件',async c=>{
    c.setMode('unknown');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();
    assert.equal(await c.input.evaluate(n=>n.readOnly),true);await c.input.focus();await c.page.keyboard.press('Escape');
    await c.visit();await c.open();assert.match(await c.input.inputValue(),/原稿/);await c.submit.click();
    await c.dialog.waitFor({state:'hidden'});assert.deepEqual(c.record.requests.map(r=>r.kind),['upload','create','check']);assert.equal(c.records.size,1);
  },1440);
  await scenario('核对拒绝或登录页不能重发；真实404后手动重试复用同一份原稿',async c=>{
    c.setMode('absent');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();
    for(const mode of ['forbidden','login','unrecognized404']){c.setReader(mode);await c.submit.click();await c.page.waitForFunction(()=>!document.querySelector('[data-moments-publish-submit]').disabled);assert.equal(c.seen.length,1);assert.match(await c.submit.innerText(),/核对/);}
    c.setReader('found');await c.submit.click();await c.submit.filter({hasText:'重试'}).waitFor();assert.equal(c.seen.length,1);
    c.setMode('ack');await c.submit.click();await c.dialog.waitFor({state:'hidden'});assert.deepEqual(c.seen[0],c.seen[1]);assert.equal(c.records.size,1);assert.ok(!c.record.requests.some(r=>r.kind==='delete'));
  });
  await scenario('在途发布离开后重开须核对；明确拒绝和从未发布的草稿可清附件',async c=>{
    await c.withMedia();await c.close.click();await c.page.waitForTimeout(80);assert.equal(c.record.requests.filter(r=>r.kind==='delete').length,1);
    c.setMode('reject');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'无权限发布'}).waitFor();assert.equal(await c.input.evaluate(n=>n.readOnly),false);await c.close.click();await c.page.waitForTimeout(80);
    assert.equal(c.record.requests.filter(r=>r.kind==='delete').length,2);
    c.setMode('paused');await c.withMedia();await c.submit.click();await c.page.waitForTimeout(50);await c.close.click();await c.open();
    assert.equal(await c.input.evaluate(n=>n.readOnly),true);assert.match(await c.submit.innerText(),/核对/);assert.equal(c.record.requests.filter(r=>r.kind==='delete').length,2);
  });
  await scenario('同名但不同内容不能认作成功；明确另写才产生新名字并保留原附件',async c=>{
    c.setMode('unknown');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();
    c.setReader('wrong');await c.submit.click();await c.page.waitForFunction(()=>!document.querySelector('[data-moments-publish-submit]').disabled);
    assert.match(await c.submit.innerText(),/核对/);assert.equal(c.seen.length,1);
    const next=c.dialog.locator('[data-moments-publish-new]');await next.click();assert.match(await c.input.inputValue(),/原稿/);
    c.setConfirm(true);await next.click();assert.equal(await c.input.inputValue(),'');assert.equal(await c.input.isEditable(),true);
    await c.input.fill('另一条内容');c.setMode('ack');await c.submit.click();await c.dialog.waitFor({state:'hidden'});
    assert.equal(c.record.confirmed.length,2);assert.equal(c.seen.length,2);assert.notEqual(c.seen[0].metadata.name,c.seen[1].metadata.name);
    assert.equal(c.records.size,2);assert.equal(c.seen[1].spec.content.medium,undefined);assert.ok(!c.record.requests.some(r=>r.kind==='delete'));
  });
  await scenario('核对404后原请求才到达：同名重试得到409，再核对只留一条',async c=>{
    c.setMode('absent');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();
    await c.submit.click();await c.submit.filter({hasText:'重试'}).waitFor();
    c.records.set(c.seen[0].metadata.name,c.seen[0]);c.setMode('ack');
    await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();await c.submit.click();await c.dialog.waitFor({state:'hidden'});
    assert.deepEqual(c.seen[0],c.seen[1]);assert.equal(c.records.size,1);
    assert.deepEqual(c.record.requests.map(r=>r.kind),['upload','create','check','create','check']);
  });
  await scenario('未确认时直接切走、重进仍可核对，不清理可能已发表的附件',async c=>{
    c.setMode('unknown');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();
    if(live) {
      await c.page.evaluate(()=>window.pjax.loadUrl('/archives'));await c.page.waitForURL('**/archives');
      await c.page.goBack();await c.page.waitForFunction(()=>window.__THEME_PAGE_APP_REGISTRY__?.activeApp?.appId==='moments');
    } else {
      await c.page.evaluate(()=>window.__exitPublish());await c.visit();
    }
    await c.open();assert.equal(await c.input.isEditable(),false);await c.submit.click();await c.dialog.waitFor({state:'hidden'});
    assert.deepEqual(c.record.requests.map(r=>r.kind),['upload','create','check']);
  });
  await scenario('自建评论真实输入、否决离页，仍留在原卡片',async c=>{
    const show=await c.action('[data-moment-comments-toggle]');await show.click();const draft=c.card.locator('[data-moment-comment-input]');await draft.fill('本地临时草稿');
    await c.card.locator('.moment-feed-time-link').first().click();
    await c.page.waitForTimeout(160);assert.match(c.record.confirmed.join(' '),/未完成|草稿/);assert.equal(await draft.inputValue(),'本地临时草稿');assert.equal(new URL(c.page.url()).pathname,'/moments');
    if(!live) {
      assert.deepEqual(await c.page.evaluate(()=>{const t=document.querySelector('[data-moment-comment-input]');window.confirm=()=>true;const adm=window.__admission, permit=adm.prepareNavigation({url:'/next'});t.value+=' changed';const stale=adm.commitNavigation(permit.permit,()=>true);const ev=new Event('beforeunload',{cancelable:true});window.dispatchEvent(ev);t.closest('form').setAttribute('aria-busy','true');return [stale,ev.defaultPrevented,adm.prepareNavigation({url:'/next'}).kind];}),['cancelled',true,'cancelled']);
    } else {
      const detail=c.card.locator('.moment-feed-time-link').first();
      const target=new URL(await detail.getAttribute('href'),site);
      c.setConfirm(true);await detail.click();await c.page.waitForURL(target.href);
      await c.page.locator('.moment-comments--custom[data-moment-card]').waitFor();
      await (await c.action('[data-moment-comments-toggle]')).click();
      const reply=c.page.locator('.moment-comments--custom [data-moment-comment-input]');
      await reply.fill('详情返回前保留的草稿');c.setConfirm(false);
      const veto=c.page.waitForEvent('dialog',{predicate:d=>d.type()==='confirm'});
      await c.page.evaluate(()=>history.back());await veto;await c.page.waitForURL(target.href);
      assert.equal(await reply.inputValue(),'详情返回前保留的草稿');
      c.setConfirm(true);await c.page.evaluate(()=>history.back());await c.page.waitForURL(site+'/moments');
      await c.page.locator('.moments-feed-list [data-moment-card]').first().waitFor();
      assert.equal(c.record.confirmed.length,4,'each accepted or rejected leave must prompt exactly once');
    }
  });
  await scenario('点赞504防重并跨重挂；明确403可重试，204才增加计数',async c=>{
    c.setVote(403);const b=await c.action('[data-moment-upvote]');await b.click();await c.card.locator('[data-moment-comments-status]').filter({hasText:'点赞失败'}).waitFor();const retry=await c.action('[data-moment-upvote]');assert.equal(await retry.isEnabled(),true);
    c.setVote(504);await retry.click();await c.card.locator('[data-moment-comments-status]').filter({hasText:'待确认'}).waitFor();
    const locked=await c.action('[data-moment-upvote]');assert.equal(await locked.isEnabled(),false);const before=await c.card.getAttribute('data-upvote-count');await c.visit();
    assert.equal(await (await c.action('[data-moment-upvote]')).isEnabled(),false);assert.equal(await c.card.getAttribute('data-upvote-count'),before);assert.equal(c.record.requests.filter(r=>r.kind==='vote').length,2);
  });
  await scenario('点赞成功204只加一次',async c=>{c.setVote(204);const before=Number(await c.card.getAttribute('data-upvote-count')||0);await (await c.action('[data-moment-upvote]')).click();await c.page.waitForFunction(n=>Number(document.querySelector('[data-moment-card]').dataset.upvoteCount)===n,before+1);assert.equal(await(await c.action('[data-moment-upvote]')).isEnabled(),false);});
  await scenario('307不得自动重放发布或点赞 POST',async c=>{
    c.setMode('redirect');await c.withMedia();await c.submit.click();await c.status.filter({hasText:'待确认'}).waitFor();
    await c.close.click();c.setVote('redirect');await (await c.action('[data-moment-upvote]')).click();
    await c.card.locator('[data-moment-comments-status]').filter({hasText:'待确认'}).waitFor();
    assert.deepEqual(c.record.requests.map(r=>r.kind),['upload','create','vote']);
    assert.equal(c.record.untouchedWrites.length,0);
  });
}finally{await browser.close();}
if(process.env.MOMENTS_SAFETY_REPORT)await fs.writeFile(process.env.MOMENTS_SAFETY_REPORT,JSON.stringify({
  mode:live?'8090 browser with blocked writes':'isolated production source ESM',
  ...(identity&&{build:identity.build,buildInputRevision:identity.buildInputRevision,halo:identity.halo,
    plugins:identity.plugins.filter(p=>['PluginMoments','PluginCommentWidget'].includes(p.name)),verifiedAssets:identity.verifiedAssets}),
  cases:entries
},null,2));
if(entries.some(r=>r.result!=='PASS'))process.exitCode=1;
