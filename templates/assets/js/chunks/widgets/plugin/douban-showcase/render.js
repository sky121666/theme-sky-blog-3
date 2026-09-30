import{n as c}from"../../../rolldown-runtime.js?v=0.9.46&r=f4cc217c2418";import{r as g}from"../../halo/author-card/render.js?v=0.9.46&r=f4cc217c2418";var k=c({renderWidget:()=>m}),v=new Set(["auto","movie","book","music","game","drama"]),w=new Set(["auto","all","mark","doing","done"]);function i(d,a,t){const n=String(d||"").trim();return a.has(n)?n:t}function m({sources:d,escapeHtml:a,mode:t},n){if(!d.doubanAvailable)return'<div class="desktop-widget-empty">未安装豆瓣插件。</div>';const s=n?.meta||{},e=i(s.type,v,"auto"),r=i(s.status,w,"auto"),u=a(d.doubanApiBase||"/apis/api.douban.moony.la/v1alpha1/doubanmovies"),o=a(d.doubanUrl||"/douban"),b=a(n?.title||"豆瓣"),l=t==="preview"?"true":"false",p=g({href:o,app:"douban",className:"wg-douban-main",attrs:`data-douban-content aria-label="${a("打开豆瓣归档")}"`,disabled:t==="preview",innerHtml:`
      <div class="wg-douban-poster is-loading" data-douban-poster>
        <span class="icon-[lucide--image]" aria-hidden="true"></span>
      </div>
      <div class="wg-douban-copy">
        <div class="wg-douban-meta-row">
          <span data-douban-status-label>收藏精选</span>
          <span data-douban-count>-- 条</span>
        </div>
        <h3 data-douban-title>豆瓣收藏</h3>
        <p class="wg-douban-sub" data-douban-subtitle>正在加载收藏。</p>
        <div class="wg-douban-scoreline">
          <span data-douban-score>豆瓣 --</span>
          <span data-douban-stars>我的评分 --</span>
        </div>
        <p class="wg-douban-remark" data-douban-remark>组件会自动轮播当前集合，悬停下方条目可快速预览。</p>
      </div>
    `});return`
    <section class="wg-douban"
             data-douban-showcase
             data-douban-type="${a(e)}"
             data-douban-status="${a(r)}"
             data-douban-api="${u}"
             data-douban-url="${o}"
             data-douban-preview="${l}"
             aria-label="${b}">
      <div class="wg-douban-bg" data-douban-bg></div>
      <div class="wg-douban-glow" aria-hidden="true"></div>

      <header class="wg-douban-head">
        <div class="wg-douban-brand">
          <span class="wg-douban-mark"><span class="icon-[lucide--clapperboard]" aria-hidden="true"></span></span>
          <div>
            <p>豆瓣</p>
            <strong data-douban-heading>正在读取收藏</strong>
          </div>
        </div>
        <a class="wg-douban-link pjax-link" data-pjax-app="douban" href="${o}" aria-label="打开豆瓣归档">
          <span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>
        </a>
      </header>

      ${p}

      <footer class="wg-douban-foot">
        <div class="wg-douban-rail" data-douban-rail aria-label="收藏条目"></div>
        <button type="button" class="desktop-widget-data-retry" data-douban-retry hidden>重试</button>
      </footer>
    </section>
  `}export{k as t};
