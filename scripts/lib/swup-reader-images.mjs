import assert from 'node:assert/strict';

// Reader's manifest excludes same-window content swaps. Both a browser-list
// and a different app reach an article through the real full-frame executor.
export async function verifySwupReaderImages({scenario, html}) {
  for (const from of ['archives', 'photos']) {
    await scenario('article native lazy requests before/after scroll from ' + from, async page => {
      if (from==='photos') await page.evaluate(()=>window.pjax.loadUrl('/photos'));
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"/>';
      const inline='data:image/svg+xml,'+encodeURIComponent(svg);
      const images=[];
      await page.route('**/__reader-img/**', route=>{
        images.push(new URL(route.request().url()).pathname);
        return route.fulfill({contentType:'image/svg+xml',body:svg});
      });
      const article=`<div class="post-reader-frame" data-post-name="story"><article id="article-content" class="post-content" style="height:280px;overflow:auto">
        <figure data-content-type="image"><img src="/__reader-img/first" width="64" height="40"></figure>
        <div style="height:20000px"></div>
        <p><img src="/__reader-img/far" width="64" height="40" alt="far"></p>
        <p><img alt="eager" src="${inline}" loading="eager"><img alt="priority" src="${inline}" fetchpriority="high"></p>
        <a href="/original"><img alt="linked" src="${inline}"></a>
        <div data-type="gallery"><div><img alt="gallery" src="${inline}"></div></div>
        <picture><img alt="picture" src="${inline}"></picture><reader-widget><img alt="widget" src="${inline}"></reader-widget>
      </article></div>`;
      await page.route('**/archives/story',route=>route.fulfill({contentType:'text/html',
        body:html('/archives/story').replace('<h1>/archives/story</h1>',article)}));
      await page.evaluate(()=>{window.__oldContent=document.querySelector('[data-window-content-root]');});
      await page.evaluate(()=>window.pjax.loadUrl('/archives/story'));
      assert.equal(await page.evaluate(()=>window.__oldContent===document.querySelector('[data-window-content-root]')),false);
      const first=page.locator('#article-content img').first(), far=page.locator('img[alt="far"]');
      await first.evaluate(img=>img.decode());
      assert.equal(await first.getAttribute('loading'),null);
      assert.equal(await far.getAttribute('loading'),'lazy');
      assert.equal(await page.locator('img[alt="eager"]').getAttribute('loading'),'eager');
      assert.equal(await page.locator('img[alt="priority"]').getAttribute('fetchpriority'),'high');
      for(const alt of ['priority','linked','gallery','picture','widget']) {
        assert.equal(await page.locator('img[alt="'+alt+'"]').getAttribute('loading'),null);
      }
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.deepEqual(images,['/__reader-img/first'],'parsing, insertion, and first paint must not fetch the distant image');
      await far.scrollIntoViewIfNeeded(); await far.evaluate(img=>img.decode());
      assert.deepEqual(images,['/__reader-img/first','/__reader-img/far']);
      assert.ok(await far.evaluate(img=>img.naturalWidth>0));
    });
  }
}
