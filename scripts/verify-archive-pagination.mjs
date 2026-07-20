import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const template = fs.readFileSync(path.join(root, 'templates/modules/browser-explorer/archives.html'), 'utf8');

assert.match(template, /archiveIndex=\$\{postFinder\.archives\(1, archiveIndexSize\)\}/, '归档年月索引必须独立于路由分页结果');
assert.match(template, /data-archive-index-complete=\$\{!archiveIndex\.hasNext\(\)\}/, '完整年月索引必须暴露未截断断言');
assert.match(template, /data-month-count/, '月份索引必须提供完整月文章数量');
assert.match(template, /data-archive-post-list/, '文章分页必须使用独立文章列表容器');
assert.match(template, /data-archive-loadmore/, '文章栏必须提供月内继续加载入口');
assert.match(template, /\/page\//, '继续加载必须输出 Halo 原生 path 分页路由');
assert.match(template, /postStat\.index < archives\.page \* archivePageSize/, '月分页深链必须累计渲染第 1 页到当前页');
assert.match(template, /x-show="hasMore && !loading && !loadError"/, '失败时只能显示一个重试入口');
assert.match(template, /aria-live="polite"/, '追加状态必须向辅助技术播报');
assert.match(template, /:aria-busy="loading \? 'true' : 'false'"/, '加载期间文章栏必须暴露 busy 状态');
assert.match(template, /th:href="\$\{archiveBase \+ '\/' \+ archive\.year\}"/, '年份链接必须使用可配置归档前缀');
assert.match(template, /nextArchiveUrl=\$\{archiveBase \+ '\/'/, '月分页链接必须使用可配置归档前缀');
assert.ok(!template.includes('class="archive-pagination"'), '不得保留归档工作区外层全局分页');
assert.ok(!template.includes('archives.prevUrl'), '不得继续输出全局归档上一页');
assert.ok(!template.includes('archives.nextUrl'), '不得继续输出全局归档下一页');

const postsColumnIndex = template.indexOf('archive-column archive-column--posts');
const loadMoreIndex = template.indexOf('data-archive-loadmore');
const previewColumnIndex = template.indexOf('archive-column archive-column--preview');
assert.ok(postsColumnIndex < loadMoreIndex && loadMoreIndex < previewColumnIndex, '继续加载必须位于文章栏内部');

let replacedHistory = null;
globalThis.window = {
  Alpine: {
    initTree() {}
  },
  location: {
    href: 'https://theme.test/archives/2024/12',
    search: ''
  },
  history: {
    state: { uid: 'pjax-state' },
    replaceState(state, _title, url) {
      this.state = state;
      replacedHistory = { state, url };
    }
  }
};
globalThis.document = { body: { dataset: {} } };

const runtimeUrl = pathToFileURL(path.join(root, 'src/apps/explorer/archives/runtime.js')).href;
const { registerArchiveExplorer } = await import(runtimeUrl);

let factory = null;
registerArchiveExplorer({
  data(name, candidate) {
    assert.equal(name, 'archiveExplorer');
    factory = candidate;
  }
});
assert.equal(typeof factory, 'function', 'archiveExplorer 必须成功注册');

function createPost(key) {
  return {
    dataset: {
      postKey: key,
      postTitle: key,
      postDate: '2024.12.01',
      postComments: '0',
      postExcerpt: `${key}-excerpt`,
      postParentName: '2024 年 / 12 月',
      postAuthor: 'Sky'
    },
    href: `/archives/${key}`,
    classList: {
      add() {}
    }
  };
}

function createRoot({ keys, nextUrl = '/archives/2024/12/page/2', page = 1 } = {}) {
  const list = {
    nodes: keys.map(createPost),
    appendChild(node) {
      this.nodes.push(node);
    },
    querySelectorAll(selector) {
      return selector === '[data-archive-post-option]' ? this.nodes : [];
    }
  };
  const trigger = nextUrl ? { dataset: { nextUrl }, href: nextUrl } : null;
  const rootNode = {
    dataset: {
      activeYear: '2024',
      activeYearLabel: '2024 年',
      activeMonthKey: '2024-12',
      activeMonthLabel: '2024 年 12 月',
      currentPage: String(page),
      pageSize: '10'
    },
    querySelector(selector) {
      if (selector === '[data-archive-loadmore]') return trigger;
      if (selector === '[data-archive-post-list]') return list;
      if (selector === '[data-archive-post-option]') return list.nodes[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-archive-post-option]' ? list.nodes : [];
    }
  };
  return { rootNode, list, trigger };
}

function createParsedPage({ keys, nextUrl = '', page = 2, monthKey = '2024-12' }) {
  const posts = keys.map(createPost);
  const trigger = nextUrl ? { dataset: { nextUrl }, href: nextUrl } : null;
  return {
    querySelector(selector) {
      if (selector === '[data-app-root="explorer-archives"] .archive-workspace') {
        return { dataset: { activeMonthKey: monthKey, currentPage: String(page) } };
      }
      if (selector === '[data-archive-loadmore]') return trigger;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-archive-post-list] > [data-archive-post-option]' ? posts : [];
    }
  };
}

let parsedPage = null;
globalThis.DOMParser = class DOMParser {
  parseFromString() {
    return parsedPage;
  }
};

const firstPageKeys = Array.from({ length: 10 }, (_, index) => `post-${index + 1}`);
const fixture = createRoot({ keys: firstPageKeys });
const instance = factory();
instance.$root = fixture.rootNode;
instance.init();

assert.equal(instance.activeMonthKey, '2024-12', '初始化必须恢复服务端激活月份');
assert.equal(instance.loadedCount, 10, '初始化必须读取当前月文章数');
assert.equal(instance.nextUrl, '/archives/2024/12/page/2', '下一页必须使用原生月归档路径');

parsedPage = createParsedPage({
  keys: ['post-10', 'post-11', 'post-12', 'post-13', 'post-14']
});
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async text() { return '<html></html>'; }
});

await instance.loadNext();
assert.equal(fixture.list.nodes.length, 14, '第二页只应追加 4 篇新文章');
assert.equal(new Set(fixture.list.nodes.map((post) => post.dataset.postKey)).size, 14, '追加后文章 key 不得重复');
assert.equal(instance.loadedCount, 14, '追加后计数必须同步');
assert.equal(instance.hasMore, false, '无下一页时必须结束加载');
assert.equal(instance.nextUrl, '', '无下一页时必须清空 nextUrl');
assert.equal(replacedHistory?.url, 'https://theme.test/archives/2024/12/page/2', '继续加载后必须同步原生月分页深链');
assert.deepEqual(replacedHistory?.state, {
  uid: 'pjax-state',
  url: 'https://theme.test/archives/2024/12/page/2'
}, 'URL 同步必须保留既有 PJAX history state');

const retryFixture = createRoot({ keys: firstPageKeys });
const retryInstance = factory();
retryInstance.$root = retryFixture.rootNode;
retryInstance.init();
globalThis.fetch = async () => ({ ok: false, status: 503, async text() { return ''; } });
await retryInstance.loadNext();
assert.equal(retryInstance.loadError, true, 'HTTP 失败必须保留可重试错误态');
assert.equal(retryInstance.hasMore, true, 'HTTP 失败不得误判为已全部加载');
assert.equal(retryInstance.nextUrl, '/archives/2024/12/page/2', 'HTTP 失败不得丢失重试地址');

let releaseResponse;
const staleFixture = createRoot({ keys: firstPageKeys });
const staleInstance = factory();
staleInstance.$root = staleFixture.rootNode;
staleInstance.init();
parsedPage = createParsedPage({ keys: ['post-11', 'post-12'] });
globalThis.fetch = () => new Promise((resolve) => {
  releaseResponse = () => resolve({ ok: true, status: 200, async text() { return '<html></html>'; } });
});
const staleRequest = staleInstance.loadNext();
staleInstance.destroy();
releaseResponse();
await staleRequest;
assert.equal(staleFixture.list.nodes.length, 10, '销毁后的延迟响应不得污染旧月份 DOM');
assert.equal(staleInstance.loading, false, '销毁后必须释放 loading 状态');

console.log('归档月内分页契约通过');
