const ALLOWED_TYPES = new Set(['auto', 'movie', 'book', 'music', 'game', 'drama']);
const ALLOWED_STATUS = new Set(['auto', 'all', 'mark', 'doing', 'done']);

function normalizeChoice(value, allowed, fallback) {
  const normalized = String(value || '').trim();
  return allowed.has(normalized) ? normalized : fallback;
}

export function renderWidget({ sources, escapeHtml, mode }, widget) {
  if (!sources.doubanAvailable) {
    return '<div class="desktop-widget-empty">未安装豆瓣插件。</div>';
  }

  const meta = widget?.meta || {};
  const type = normalizeChoice(meta.type, ALLOWED_TYPES, 'auto');
  const status = normalizeChoice(meta.status, ALLOWED_STATUS, 'auto');
  const endpoint = escapeHtml(sources.doubanApiBase || '/apis/api.douban.moony.la/v1alpha1/doubanmovies');
  const href = escapeHtml(sources.doubanUrl || '/douban');
  const title = escapeHtml(widget?.title || '书影音');
  const disabled = mode === 'preview' ? 'true' : 'false';

  return `
    <section class="wg-douban"
             data-douban-showcase
             data-douban-type="${escapeHtml(type)}"
             data-douban-status="${escapeHtml(status)}"
             data-douban-api="${endpoint}"
             data-douban-url="${href}"
             data-douban-preview="${disabled}"
             aria-label="${title}">
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
        <a class="wg-douban-link pjax-link" data-pjax-app="douban" href="${href}" aria-label="打开豆瓣归档">
          <span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>
        </a>
      </header>

      <div class="wg-douban-main" data-douban-content>
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
      </div>

      <footer class="wg-douban-foot">
        <div class="wg-douban-rail" data-douban-rail aria-label="收藏条目"></div>
      </footer>
    </section>
  `;
}
