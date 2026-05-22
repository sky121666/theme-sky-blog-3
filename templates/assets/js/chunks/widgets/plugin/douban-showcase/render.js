import{r as c}from"../../halo/author-card/render.js?v=0.9.35&r=a069d4ef9610";var g=new Set(["auto","movie","book","music","game","drama"]),v=new Set(["auto","all","mark","doing","done"]);function i(d,a,o){const n=String(d||"").trim();return a.has(n)?n:o}function m({sources:d,escapeHtml:a,mode:o},n){if(!d.doubanAvailable)return'<div class="desktop-widget-empty">未安装豆瓣插件。</div>';const t=n?.meta||{},e=i(t.type,g,"auto"),u=i(t.status,v,"auto"),r=a(d.doubanApiBase||"/apis/api.douban.moony.la/v1alpha1/doubanmovies"),s=a(d.doubanUrl||"/douban"),b=a(n?.title||"书影音"),l=o==="preview"?"true":"false",p=c({href:s,app:"douban",className:"wg-douban-main",attrs:`data-douban-content aria-label="${a("打开豆瓣归档")}"`,disabled:o==="preview",innerHtml:`
      <div class="wg-douban-poster is-loading" data-douban-poster>
        <span class="icon-[lucide--image]" aria-hidden="true"></span>
      </div>
      <div class="wg-douban-copy">
        <div class="wg-douban-meta-row">
          <span data-douban-status-label>收藏精选</span>
          <span data-douban-count>-- 条</span>
        </div>
        <h3 data-douban-title>书影音收藏</h3>
        <p class="wg-douban-sub" data-douban-subtitle>从豆瓣插件读取真实收藏数据。</p>
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
             data-douban-status="${a(u)}"
             data-douban-api="${r}"
             data-douban-url="${s}"
             data-douban-preview="${l}"
             aria-label="${b}">
      <div class="wg-douban-bg" data-douban-bg></div>
      <div class="wg-douban-glow" aria-hidden="true"></div>

      <header class="wg-douban-head">
        <div class="wg-douban-brand">
          <span class="wg-douban-mark"><span class="icon-[lucide--clapperboard]" aria-hidden="true"></span></span>
          <div>
            <p>我的书影音</p>
            <strong data-douban-heading>正在读取收藏</strong>
          </div>
        </div>
        <a class="wg-douban-link pjax-link" data-pjax-app="douban" href="${s}" aria-label="打开豆瓣归档">
          <span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>
        </a>
      </header>

      ${p}

      <footer class="wg-douban-foot">
        <div class="wg-douban-rail" data-douban-rail aria-label="收藏条目"></div>
      </footer>
    </section>
  `}export{m as t};
