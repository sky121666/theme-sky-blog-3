import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const base = 'src/shell/desktop-shell/runtime/desktop/settings-assets/';
assert.ok(existsSync(`${base}icon-svg.js`), '设置图标必须提供 SVG 安全输出模块');
assert.ok(existsSync(`${base}icon-catalog.js`), '设置图标必须提供懒加载目录模块');

const svgModule = await import(`../${base}icon-svg.js`);
assert.equal(svgModule.sanitizeIconSvg('<svg><path d="M0 0h1"/></svg>'), '', '没有 DOMParser 时必须安全拒绝');
assert.equal(svgModule.makeThemeIcon(null), '', '空图标回退主题默认');

const split = await build({
  entryPoints: [`${base}icon-catalog.js`], outdir: 'output/settings-icon-chunks',
  bundle: true, format: 'esm', platform: 'browser', splitting: true, metafile: true, write: false,
});
const runtimeInputs = Object.keys(split.metafile.inputs);
const oversizedCatalog = runtimeInputs.some((input) => input.endsWith('/lucide/icons.json'));

const bundled = await build({
  stdin: {
    contents: `export * from './${base}icon-svg.js'; export * from './${base}icon-catalog.js'; export { default as testCatalog } from '@iconify-json/lucide/icons.json';`,
    resolveDir: process.cwd(),
  },
  bundle: true, format: 'esm', platform: 'browser', write: false,
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('data:text/html,<html><body></body></html>');
  const results = await page.evaluate(async (source) => {
    const api = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    const results = [];
    const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
    const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const valid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" d="M2 2h20v20H2z"/></svg>';

    const icon = api.makeThemeIcon({ name: 'lucide:house', svg: valid }, { color: '#abcdef', width: 32 });
    check(icon.name === 'lucide:house' && icon.width === '32' && icon.color === '#ABCDEF', '兼容 Console 的名称、尺寸和颜色');
    const rendered = parse(icon.value);
    check(rendered.getAttribute('width') === '32' && rendered.getAttribute('height') === '32' && rendered.getAttribute('color') === '#ABCDEF', '尺寸和颜色写入可显示的 SVG');
    check(api.makeThemeIcon({ svg: valid }, { width: 500 }).width === '64', '尺寸上限');
    check(api.makeThemeIcon({ svg: valid }, { width: 1 }).width === '16', '尺寸下限');
    check(api.makeThemeIcon({ svg: valid }, { width: 'bad', color: 'url(https://invalid.example)' }).color === '', '不接受任意 CSS 颜色');
    check(api.makeThemeIcon({ svg: '' }) === '' && api.sanitizeIconSvg(null) === '', '清空图标回退默认');
    check(api.sanitizeIconSvg('<svg><path></svg>') === '' && api.sanitizeIconSvg('<div/>') === '', '拒绝畸形或非 SVG 文档');
    check(api.sanitizeIconSvg('<!DOCTYPE svg [<!ENTITY x "bad">]><svg>&x;</svg>') === '', '拒绝文档实体');

    const attack = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.pwned=1" style="background:url(https://invalid.example)"><script>window.pwned=1</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject><style>@import 'https://invalid.example';</style><image href="https://invalid.example"/><a xlink:href="javascript:alert(1)"><path d="M0 0h1"/></a><path d="M0 0h2" onmouseover="alert(1)" fill="url(https://invalid.example)"/><use href="https://invalid.example/a.svg#x"/><animate attributeName="href" values="javascript:alert(1)"/></svg>`;
    const cleaned = api.sanitizeIconSvg(attack);
    const safe = parse(cleaned);
    check(cleaned && !safe.querySelector('script, foreignObject, style, image, a, animate'), '移除可执行、样式与外链节点');
    check([...safe.querySelectorAll('*'), safe].every((node) => [...node.attributes].every((attr) => !/^on/i.test(attr.name) && attr.name !== 'style' && !/https:\/\/invalid|javascript:/i.test(attr.value))), '移除事件与外链属性');
    document.body.innerHTML = cleaned;
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(!window.pwned, '输出插入 HTML 后不能执行脚本');

    const gradient = api.sanitizeIconSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="paint"><stop offset="0" stop-color="#abc"/><stop offset="1" stop-color="red"/></linearGradient><clipPath id="clip"><rect width="24" height="24"/></clipPath></defs><g clip-path="url(#clip)"><path fill="url(#paint)" d="M0 0h24v24z"/></g><path fill="url(#page-owned-id)" d="M0 0h1"/></svg>');
    const gradientDoc = parse(gradient);
    check(gradientDoc.querySelector('linearGradient stop') && gradientDoc.querySelector('g').getAttribute('clip-path')?.startsWith('url(#'), '保留 SVG 内部渐变和裁切');
    check(!gradient.includes('page-owned-id'), '内部引用不能指向 SVG 外部 DOM');
    check(api.sanitizeIconSvg(gradient) === gradient, '重复清洗保持稳定');
    check(api.sanitizeIconSvg('<svg><path xmlns="http://www.w3.org/1999/xhtml" onload="bad()"/></svg>') === '', '拒绝异命名空间节点');
    check(!api.sanitizeIconSvg('<svg id="page-owned-id"><path d="M0 0h1"/></svg>').includes('page-owned-id'), '根节点 ID 不能覆盖页面已有名称');
    check(api.sanitizeIconSvg(`<svg>${'<g>'.repeat(34)}<path d="M0 0h1"/>${'</g>'.repeat(34)}</svg>`) === '', '限制过深的 SVG 树');
    check(api.sanitizeIconSvg(`<svg>${'<path d="M0 0h1"/>'.repeat(513)}</svg>`) === '', '限制 SVG 节点数量');
    let localCount = 0;
    for (const data of Object.values(api.testCatalog.icons)) {
      const clean = api.sanitizeIconSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${data.body}</svg>`);
      if (!clean || !parse(clean).querySelector('path, rect, circle, ellipse, line, polyline, polygon')) throw new Error('Lucide 目录出现无法显示的图标');
      localCount++;
    }
    check(localCount > 1000, `全部 ${localCount} 个本地图标可通过安全清洗`);

    const nativeFetch = globalThis.fetch;
    const nativeTimeout = globalThis.setTimeout;
    const nativeNow = Date.now;
    const failures = [];
    const fresh = () => import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    const json = (data) => new Response(JSON.stringify(data));
    const body = '<path fill="currentColor" d="M1 2h3v4H1z"/>';
    const batch = (url) => {
      const parsed = new URL(url);
      const prefix = parsed.pathname.slice(1, -5);
      return json({ prefix, width: 24, height: 24, icons: Object.fromEntries(parsed.searchParams.get('icons').split(',').map((name) => [name, { body }])) });
    };
    const tick = () => new Promise((resolve) => nativeTimeout(resolve, 0));
    const scenario = async (label, run) => {
      try { await run(await fresh()); }
      catch (error) { failures.push(`${label}: ${error.message}`); }
      finally { globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; Date.now = nativeNow; }
    };
    await scenario('常用离线入口', async (catalog) => {
      globalThis.fetch = () => { throw new Error('常用图标不应联网'); };
      const common = await catalog.searchIcons();
      check(common.icons.length === 16 && common.total === 16 && common.page === 1 && !common.hasMore,
        '全部空查询仅呈现 16 个离线常用图标');
      check(common.icons[0].name === 'lucide:house' && common.icons.every((icon) => parse(icon.svg).querySelector('path, circle, rect')),
        '离线常用图标能安全显示');
      const later = await catalog.searchIcons({ page: 2 });
      check(later.icons.length === 0 && !later.hasMore, '常用入口不能无限翻页重复');
    });
    await scenario('中文标签与完整名称', async (catalog) => {
      for (const [query, expected] of [['首页','house'], ['主页','house'], ['搜索','search'], ['菜单','menu'],
        ['用户','user'], ['头像','user'], ['设置','settings'], ['图片','image'], ['相册','images'], ['文章','file-text'],
        ['文档','book-open'], ['链接','link'], ['友链','link'], ['通知','bell'], ['太阳','sun'], ['月亮','moon'],
        ['导航','navigation'], ['方向','compass'], ['定位','map-pin'], ['返回','arrow-left']]) {
        check(catalog.normalizeIconQuery(query) === expected, `中文标签 ${query} 归一化`);
      }
      check(catalog.normalizeIconQuery('  首页  搜索 ') === 'house search' && catalog.normalizeIconQuery('未知词') === '未知词', '中文映射保留未知词');
      const calls = [];
      globalThis.fetch = async (url) => { calls.push(String(url)); return batch(url); };
      const exact = await catalog.searchIcons({ query: ' MDI:HOME ' });
      check(exact.icons.length === 1 && exact.icons[0].name === 'mdi:home' && exact.normalizedQuery === 'mdi:home', '完整图标名称精确取一项');
      check(calls.length === 1 && new URL(calls[0]).pathname === '/mdi.json', '完整名称不依赖模糊搜索接口');
      const mismatch = await catalog.searchIcons({ query: 'mdi:home', collection: 'lucide' });
      check(mismatch.icons.length === 0 && calls.length === 1, '完整名称遵守集合筛选');
    });
    await scenario('元数据与缓存', async (catalog) => {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return json({ lucide: { name: 'Lucide', total: 1853, palette: false, license: { title: 'ISC', spdx: 'ISC' } },
          noto: { name: 'Noto Emoji', total: 4000, palette: true }, archived: { name: 'Archived', total: 20, hidden: true },
          '../bad': { name: 'bad', total: 1 } });
      };
      const metadata = await catalog.listIconCollections();
      check(metadata.collections.length === 2 && metadata.collections.find((item) => item.prefix === 'noto').palette,
        '集合目录仅返回有效且未隐藏的集合并保留彩色信息');
      check(metadata.collections.find((item) => item.prefix === 'lucide').license.spdx === 'ISC', '目录保留许可证说明');
      await catalog.listIconCollections();
      check(calls.length === 1 && new URL(calls[0].url).pathname === '/collections', '元数据按需读取并复用缓存');
      check(calls[0].options.credentials === 'omit' && calls[0].options.referrerPolicy === 'no-referrer', '图标服务请求不发送站点凭据或来源');
    });
    await scenario('异常元数据不缓存', async (catalog) => {
      let count = 0;
      globalThis.fetch = async () => (++count === 1 ? json({ bad: { name: 42, total: 'wrong' } })
        : json({ mdi: { name: 'Material Design Icons', total: 100, palette: false } }));
      try { await catalog.listIconCollections(); throw new Error('异常目录未拒绝'); }
      catch (error) { check(error.code === 'ICON_INVALID_RESPONSE', '异常元数据返回明确错误'); }
      check((await catalog.listIconCollections()).collections.length === 1 && count === 2, '元数据错误后可重试');
    });
    await scenario('集合分页与批量加载', async (catalog) => {
      const names = Array.from({ length: 101 }, (_, i) => `icon-${String(i).padStart(3, '0')}`);
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        if (new URL(url).pathname === '/collection') return json({ prefix: 'demo', total: 101,
          categories: { Main: names.slice(0, 75), Overlap: names.slice(40, 90) }, uncategorized: names.slice(90) });
        return batch(url);
      };
      const first = await catalog.searchIcons({ collection: 'demo' });
      check(first.icons.length === 50 && first.total === 101 && first.totalKnown === true && first.hasMore && first.page === 1, '首批只取当前页 50 个图标');
      const firstBatches = requests.filter((url) => url.includes('/demo.json'));
      const requested = firstBatches.flatMap((url) => new URL(url).searchParams.get('icons').split(','));
      check(requested.length === 50 && requested[0] === 'icon-000' && requested[49] === 'icon-049'
        && firstBatches.length < 50 && firstBatches.every((url) => url.length <= 500), '同集合按 URL 限额批量取当前页');
      const before = requests.length;
      await catalog.searchIcons({ collection: 'demo' });
      check(requests.length === before, '重复打开同页不再请求索引或 SVG');
      const second = await catalog.searchIcons({ collection: 'demo', page: 2 });
      check(second.icons.length === 50 && second.icons[0].name === 'demo:icon-050' && second.hasMore, '第二页从第 51 项继续且不重复');
      const third = await catalog.searchIcons({ collection: 'demo', page: 3 });
      check(third.icons.length === 1 && !third.hasMore && third.total === 101, '去重分类后的末页正确结束');
      check(requests.filter((url) => new URL(url).pathname === '/collection').length === 1, '翻页复用集合名字索引');
    });
    await scenario('搜索分页与范围', async (catalog) => {
      const requests = [];
      const names = Array.from({ length: 127 }, (_, i) => `demo:search-${i}`);
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        const parsed = new URL(url);
        if (parsed.pathname === '/search') {
          const start = Number(parsed.searchParams.get('start'));
          const limit = Math.max(32, Math.min(999, Number(parsed.searchParams.get('limit'))));
          if (start >= limit) return new Response('Bad request', { status: 400 });
          // Official Iconify response: limit bounds cumulative matches before slicing at start.
          return json({ icons: names.slice(start, limit), total: Math.min(names.length, limit), limit, start });
        }
        return batch(url);
      };
      const first = await catalog.searchIcons({ query: '导航', collection: 'demo' });
      const second = await catalog.searchIcons({ query: '导航', collection: 'demo', page: 2 });
      const third = await catalog.searchIcons({ query: '导航', collection: 'demo', page: 3 });
      const searches = requests.filter((url) => url.includes('/search?')).map((url) => new URL(url));
      check(searches.length === 3 && searches[0].searchParams.get('query') === 'navigation' && searches[0].searchParams.get('prefix') === 'demo'
        && searches[0].searchParams.get('limit') === '51' && searches[1].searchParams.get('start') === '50'
        && searches[1].searchParams.get('limit') === '101' && searches[2].searchParams.get('start') === '100'
        && searches[2].searchParams.get('limit') === '151', '集合搜索按官方累计上限发出 50 项与单项前探分页参数');
      check(first.icons.length === 50 && first.hasMore && second.icons.length === 50 && second.hasMore
        && second.icons[0].name === 'demo:search-50' && third.icons.length === 27 && !third.hasMore && third.page === 3,
        '搜索超过两页连续返回 50、50 和尾页，不重复不漏项');
      check([first, second, third].every((result) => result.total === null && result.totalKnown === false),
        '搜索 API 的截断计数不能冒充全库总数');
      const svgNames = requests.filter((url) => url.includes('/demo.json')).flatMap((url) => new URL(url).searchParams.get('icons').split(','));
      check(svgNames.length === 127 && new Set(svgNames).size === 127, '单项前探仅下载名字，SVG 始终只取当前页');
      const before = requests.length;
      await catalog.searchIcons({ query: '导航', collection: 'demo', page: 2 });
      check(requests.length === before, '重复搜索页复用名字和 SVG 缓存');
      await catalog.searchIcons({ query: 'navigation' });
      check(!new URL(requests.findLast((url) => url.includes('/search?'))).searchParams.has('prefix'), '全部范围搜索不强加集合前缀');
    });
    await scenario('恰好 50 项的搜索末页', async (catalog) => {
      const names = Array.from({ length: 50 }, (_, i) => `demo:exact-${i}`);
      const hundredNames = Array.from({ length: 100 }, (_, i) => `demo:hundred-${i}`);
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        const parsed = new URL(url);
        if (parsed.pathname === '/search') {
          const start = Number(parsed.searchParams.get('start'));
          const limit = Number(parsed.searchParams.get('limit'));
          const matchingNames = parsed.searchParams.get('query') === 'exact-hundred' ? hundredNames : names;
          return json({ icons: matchingNames.slice(start, limit), total: Math.min(matchingNames.length, limit), limit, start });
        }
        return batch(url);
      };
      const result = await catalog.searchIcons({ query: 'exact-fifty' });
      check(result.icons.length === 50 && result.hasMore === false, '恰好 50 项时单项前探避免出现空下一页');
      const before = requests.length;
      await catalog.searchIcons({ query: 'exact-fifty' });
      check(requests.length === before, '已确认末页的重复搜索不再次联网');
      const hundredFirst = await catalog.searchIcons({ query: 'exact-hundred' });
      const hundredLast = await catalog.searchIcons({ query: 'exact-hundred', page: 2 });
      check(hundredFirst.icons.length === 50 && hundredFirst.hasMore && hundredLast.icons.length === 50 && !hundredLast.hasMore,
        '恰好 100 项的第二页结束时不产生空第三页');
    });
    await scenario('搜索服务上限', async (catalog) => {
      const names = Array.from({ length: 1100 }, (_, i) => `demo:cap-${i}`);
      let searchCalls = 0;
      globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/search') {
          searchCalls++;
          const start = Number(parsed.searchParams.get('start'));
          const limit = Math.max(32, Math.min(999, Number(parsed.searchParams.get('limit'))));
          if (start >= limit) return new Response('Bad request', { status: 400 });
          return json({ icons: names.slice(start, limit), total: Math.min(names.length, limit), limit, start });
        }
        return batch(url);
      };
      const nearEnd = await catalog.searchIcons({ query: 'cap', page: 19 });
      check(nearEnd.icons.length === 50 && nearEnd.hasMore, '接近搜索上限仍按当前页提供 50 项');
      const last = await catalog.searchIcons({ query: 'cap', page: 20 });
      check(last.icons.length === 49 && !last.hasMore && last.notice.includes('细化关键词') && last.total === null,
        '达到官方 999 上限结束分页并说明可细化关键词');
      const outside = await catalog.searchIcons({ query: 'cap', page: 21 });
      check(!outside.icons.length && !outside.hasMore && searchCalls === 2, '超出服务窗口不发出必定失败的 start 请求');
    });
    await scenario('搜索分页字段异常', async (catalog) => {
      globalThis.fetch = async (url) => new URL(url).pathname === '/search'
        ? json({ icons: ['demo:wrong'], total: 51, limit: 51, start: 2 }) : batch(url);
      try { await catalog.searchIcons({ query: 'wrong-offset' }); throw new Error('错误起点未拒绝'); }
      catch (error) { check(error.code === 'ICON_INVALID_RESPONSE', '服务响应起点不匹配时不能重复显示前页'); }
    });
    await scenario('批次顺序与缓存复用', async (catalog) => {
      const batches = [];
      globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/search') return json({ icons: parsed.searchParams.get('query') === 'ordered'
          ? ['demo:alpha', 'demo:beta'] : ['demo:beta', 'demo:alpha'], total: 2, limit: 51, start: 0 });
        batches.push(String(url)); return batch(url);
      };
      const first = await catalog.searchIcons({ query: 'ordered' });
      const second = await catalog.searchIcons({ query: 'reordered' });
      check(first.icons[0].name === 'demo:alpha' && second.icons[0].name === 'demo:beta', '批量传输顺序不覆盖搜索结果排序');
      check(batches.length === 1, '同一批图标名字顺序变化仍复用缓存');
    });
    await scenario('共享请求独立取消', async (catalog) => {
      const calls = [];
      let release;
      let sharedSignal;
      globalThis.fetch = (url, { signal }) => {
        calls.push(String(url)); sharedSignal = signal;
        return new Promise((resolve, reject) => {
          release = () => resolve(batch(url));
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      };
      const one = new AbortController(); const two = new AbortController();
      const first = catalog.searchIcons({ query: 'demo:shared', signal: one.signal }).catch((error) => error);
      const second = catalog.searchIcons({ query: 'demo:shared', signal: two.signal });
      await tick(); one.abort();
      check((await first).name === 'AbortError' && !sharedSignal.aborted, '一个订阅取消不打断其他活跃订阅');
      release();
      check((await second).icons.length === 1 && calls.length === 1, '相同请求只联网一次且剩余订阅收到结果');
    });
    await scenario('最后订阅取消与重试', async (catalog) => {
      let calls = 0; let sharedSignal; let release;
      globalThis.fetch = (url, { signal }) => {
        calls++; sharedSignal = signal;
        return new Promise((resolve) => { release = () => resolve(batch(url)); });
      };
      const controller = new AbortController();
      const canceled = catalog.searchIcons({ query: 'demo:cancel', signal: controller.signal }).catch((error) => error);
      await tick(); controller.abort();
      check((await canceled).name === 'AbortError' && sharedSignal.aborted, '最后订阅离开立即取消底层请求');
      release(); await tick();
      globalThis.fetch = async (url) => { calls++; return batch(url); };
      check((await catalog.searchIcons({ query: 'demo:cancel' })).icons.length === 1 && calls === 2,
        '取消后迟到数据不污染缓存且可重新请求');
      const before = calls;
      const already = new AbortController(); already.abort();
      try { await catalog.searchIcons({ query: 'demo:unused', signal: already.signal }); throw new Error('未取消'); }
      catch (error) { check(error.name === 'AbortError' && calls === before, '开始前取消不联网'); }
    });
    await scenario('失败批次与可用进度', async (catalog) => {
      let releaseSlow;
      const progress = [];
      let announceProgress;
      const progressReady = new Promise((resolve) => { announceProgress = resolve; });
      globalThis.fetch = async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === '/search') return json({ icons: ['ok:one', 'broken:two', 'slow:three'], total: 3, limit: 51, start: 0 });
        if (pathname === '/broken.json') return new Response('', { status: 503 });
        if (pathname === '/slow.json') return new Promise((resolve) => { releaseSlow = () => resolve(batch(url)); });
        return batch(url);
      };
      const waiting = catalog.searchIcons({ query: 'partial', onProgress: (value) => {
        progress.push(value);
        if (value.icons.some((icon) => icon.name === 'ok:one')) announceProgress();
      } });
      await Promise.race([progressReady, new Promise((resolve) => nativeTimeout(resolve, 1000))]);
      check(progress.some((value) => value.icons.some((icon) => icon.name === 'ok:one')), '慢批次未完成前即可收到已加载图标');
      releaseSlow();
      const result = await waiting;
      check(result.icons.length === 2 && result.skippedCount === 1 && result.notice.includes('部分') && !/\d/.test(result.notice), '一个批次失败保留其余结果并提示重试且不显示图标计数');
    });
    await scenario('批量并发上限', async (catalog) => {
      let active = 0; let peak = 0;
      globalThis.fetch = async (url) => {
        if (new URL(url).pathname === '/search') return json({ icons: ['aa:one','bb:two','cc:three','dd:four','ee:five','ff:six'], total: 6, limit: 51, start: 0 });
        active++; peak = Math.max(peak, active); await tick(); active--;
        return batch(url);
      };
      check((await catalog.searchIcons({ query: 'parallel' })).icons.length === 6 && peak <= 3, '批量图标请求最多三路并发');
    });
    await scenario('别名和几何转换', async (catalog) => {
      globalThis.fetch = async () => json({ prefix: 'demo', width: 20, height: 10,
        icons: { original: { body } }, aliases: { turn: { parent: 'original', rotate: 1 }, mirror: { parent: 'turn', hFlip: true } } });
      const result = await catalog.searchIcons({ query: 'demo:mirror' });
      const svg = parse(result.icons[0].svg);
      check(svg.getAttribute('viewBox') === '0 0 10 20' && svg.querySelector('g[transform]') && svg.querySelector('path'),
        '批量 JSON 别名合并父级、翻转和旋转且保留正确画布');
    });
    await scenario('坏图标与网络错误', async (catalog) => {
      globalThis.fetch = async () => new Response('', { status: 503 });
      try { await catalog.searchIcons({ query: 'network-failure' }); throw new Error('未失败'); }
      catch (error) { check(error.code === 'ICON_NETWORK_ERROR' && error.message.includes('503'), '服务错误可展示'); }
      globalThis.fetch = async () => json({});
      try { await catalog.searchIcons({ query: 'bad-response' }); throw new Error('未失败'); }
      catch (error) { check(error.code === 'ICON_INVALID_RESPONSE', '异常搜索格式不伪装空结果'); }
      globalThis.fetch = async () => json({ prefix: 'demo', icons: { unsafe: { body: '<script>bad()</script>' } } });
      try { await catalog.searchIcons({ query: 'demo:unsafe' }); throw new Error('未失败'); }
      catch (error) { check(error.code === 'ICON_INVALID_SVG', '纯可执行 SVG 不进入候选结果'); }
      globalThis.fetch = async (url) => batch(url);
      check((await catalog.searchIcons({ query: 'demo:unsafe' })).icons.length === 1, '坏 SVG 错误不缓存，可恢复重试');
    });
    await scenario('缓存到期和容量', async (catalog) => {
      let calls = 0;
      globalThis.fetch = async (url) => { calls++; return batch(url); };
      await catalog.searchIcons({ query: 'demo:cached' });
      await catalog.searchIcons({ query: 'demo:cached' });
      check(calls === 1, '成功图标复用会话缓存');
      Date.now = () => nativeNow() + 2 * 60 * 60 * 1000;
      await catalog.searchIcons({ query: 'demo:cached' });
      check(calls === 2, '缓存超过 TTL 会重新请求');
      for (let index = 0; index < 150; index++) await catalog.searchIcons({ query: `demo:bounded-${index}` });
      const before = calls;
      await catalog.searchIcons({ query: 'demo:cached' });
      check(calls === before + 1, '会话缓存达到容量后淘汰旧条目');
    });
    await scenario('超时边界', async (catalog) => {
      globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay >= 1000 ? 5 : delay, ...args);
      try { await catalog.searchIcons({ query: 'timeout' }); throw new Error('未超时'); }
      catch (error) { check(error.name === 'TimeoutError' && error.code === 'ICON_TIMEOUT', '请求有明确的 12 秒超时边界'); }
    });
    if (failures.length) throw new Error(failures.join('\n'));
    return results;
  }, bundled.outputFiles[0].text);
  assert.ok(!oversizedCatalog, '完整 Lucide icons.json 不能进入任何运行时分块');
  console.log(`设置图标：${results.length + 3} 项 SVG 安全、按需分页、批量请求和隔离浏览器校验通过。`);
} finally {
  await browser.close();
}
