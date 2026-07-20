import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'playwright');
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const explicitDocPath = (process.env.DOCSME_DOC_SAMPLE_PATH || '').trim();
const explicitCodePath = (process.env.DOCSME_CODE_SAMPLE_PATH || '').trim();
const explicitKatexPath = (process.env.DOCSME_KATEX_SAMPLE_PATH || '').trim();
const explicitMermaidPath = (process.env.DOCSME_MERMAID_SAMPLE_PATH || '').trim();
const fixtureOnly = process.env.DOCSME_FIXTURE_ONLY === 'true';
const sampleDocPath = 'docs/测试样本数据.md';
const docsmeRuntimePath = path.join(root, 'src', 'apps', 'docsme', 'runtime.js');

const SAMPLE_GUIDES = {
  document: {
    env: 'DOCSME_DOC_SAMPLE_PATH',
    target: '创建或选择一篇可公开访问的 Docsme 正文页',
    command: 'DOCSME_DOC_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme',
    hint: '脚本会从 /docs 自动发现文档；发现不到时再手动指定路径。'
  },
  'code-sample': {
    env: 'DOCSME_CODE_SAMPLE_PATH',
    target: '创建或选择一篇带 fenced code block 的 Docsme 文档',
    command: 'DOCSME_CODE_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme',
    hint: `可复用 ${sampleDocPath} 中的代码块样本。`
  },
  'katex-sample': {
    env: 'DOCSME_KATEX_SAMPLE_PATH',
    target: '创建一篇包含行内公式和块级公式的 Docsme 文档',
    command: 'DOCSME_KATEX_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme',
    hint: `样本内容见 ${sampleDocPath} 的「Docsme KaTeX 样本」。`
  },
  'mermaid-sample': {
    env: 'DOCSME_MERMAID_SAMPLE_PATH',
    target: '创建一篇包含 mermaid flowchart 的 Docsme 文档',
    command: 'DOCSME_MERMAID_SAMPLE_PATH=/docs/<project>/<doc> pnpm run verify:docsme',
    hint: `样本内容见 ${sampleDocPath} 的「Docsme Mermaid 样本」。`
  }
};

function absoluteUrl(target) {
  const url = new URL(target, `${baseUrl}/`);
  url.searchParams.set('_docsme_verify', String(Date.now()));
  return url.toString();
}

function toPathname(value) {
  try {
    const url = new URL(value, `${baseUrl}/`);
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

async function writeReport(report) {
  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, 'docsme-report.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

async function collectDocsLinks(page, startPath = '/docs') {
  const queue = [startPath];
  const visited = new Set();
  const documents = [];
  const catalogs = [];

  while (queue.length > 0 && visited.size < 30) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const response = await page.goto(absoluteUrl(current), { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
    if (!response || response.status() >= 400) continue;
    await page.waitForTimeout(500);

    const snapshot = await page.evaluate(() => {
      const root = document.querySelector('[data-app-root="docsme"]');
      return {
        path: (() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('_docsme_verify');
          const query = url.searchParams.toString();
          return `${url.pathname}${query ? `?${query}` : ''}`;
        })(),
        scene: root?.dataset.docsmeScene || '',
        links: Array.from(document.querySelectorAll('a[href]'))
          .map((anchor) => anchor.href)
          .filter(Boolean)
      };
    });

    if (snapshot.scene === 'document') documents.push(snapshot.path);
    if (snapshot.scene === 'catalog') catalogs.push(snapshot.path);

    for (const href of snapshot.links) {
      const pathname = toPathname(href);
      if (!pathname || pathname === '/docs' || !pathname.startsWith('/docs/')) continue;
      if (!visited.has(pathname) && !queue.includes(pathname)) queue.push(pathname);
    }
  }

  return {
    visited: Array.from(visited),
    documents: Array.from(new Set(documents)),
    catalogs: Array.from(new Set(catalogs))
  };
}

async function inspectDocsPage(page, target) {
  const consoleErrors = [];
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  page.on('console', onConsole);
  try {
    const response = await page.goto(absoluteUrl(target), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1_800);
    const result = await page.evaluate(() => {
      const root = document.querySelector('[data-app-root="docsme"]');
      const article = document.querySelector('.docsme-article');
      const richContentRoot = article || root || document;
      const katexNodes = Array.from(richContentRoot.querySelectorAll([
        '.math-inline',
        '.math-display',
        '[math-inline]',
        '[math-display]',
        '.katex-inline',
        '.katex-block'
      ].join(', ')));
      const mermaidNodes = Array.from(
        richContentRoot.querySelectorAll('text-diagram[data-type="mermaid"], .mermaid')
      );
      return {
        url: window.location.href,
        title: document.title,
        status: 'ok',
        mode: document.body.dataset.pageMode || '',
        appId: document.body.dataset.appId || '',
        windowVariant: document.body.dataset.windowVariant || '',
        scene: root?.dataset.docsmeScene || '',
        templateId: root?.dataset.docsmeTemplateId || '',
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        projectCards: document.querySelectorAll('.docsme-project-card').length,
        treeLinks: document.querySelectorAll('.docsme-tree a').length,
        tocLinks: document.querySelectorAll('[data-docsme-toc-list] a').length,
        commentShell: Boolean(document.querySelector('.docsme-comment')),
        switchers: document.querySelectorAll('[data-docsme-switcher]').length,
        hasAuthorizeMarker: document.body.innerText.includes('需要授权'),
        shikiCode: document.querySelectorAll('shiki-code').length,
        rawPreCode: article ? article.querySelectorAll('pre > code').length : 0,
        renderScripts: Array.from(document.querySelectorAll('script[data-pjax]'))
          .filter((script) => script.textContent.includes('renderCodeBlock')).length,
        replayScripts: document.querySelectorAll('script[data-theme-shiki-replay]').length,
        katexSource: katexNodes.length,
        katexRendered: katexNodes.filter((node) => {
          return node.matches('.katex, .katex-display')
            || node.querySelector('.katex, .katex-display, math');
        }).length,
        katexFallback: katexNodes.filter((node) => node.hasAttribute('data-docsme-render-error')).length,
        katexStates: katexNodes.map((node) => node.dataset.docsmeKatexState || ''),
        mermaidSource: mermaidNodes.length,
        mermaidRendered: mermaidNodes.filter((node) => node.querySelector('svg')).length,
        mermaidFallback: mermaidNodes.filter((node) => node.hasAttribute('data-docsme-render-error')).length,
        mermaidSvgCounts: mermaidNodes.map((node) => node.querySelectorAll('svg').length),
        mermaidStates: mermaidNodes.map((node) => node.dataset.docsmeMermaidState || ''),
        mermaidThemes: mermaidNodes.map((node) => node.dataset.docsmeMermaidTheme || ''),
        articleTextLength: article?.innerText?.trim?.().length || 0
      };
    });
    return { ...result, httpStatus: response.status(), consoleErrors };
  } finally {
    page.off('console', onConsole);
  }
}

function assertDocsProtocol(result, label) {
  const failures = [];
  if (result.mode !== 'browser-docsme') failures.push(`${label}: pageMode=${result.mode}`);
  if (result.appId !== 'docsme') failures.push(`${label}: appId=${result.appId}`);
  if (result.windowVariant !== 'docsme') failures.push(`${label}: windowVariant=${result.windowVariant}`);
  if (result.replayScripts !== 0) failures.push(`${label}: replay script leaked`);
  return failures;
}

function chooseSample(paths, inspections, predicate) {
  return paths.find((pathname) => {
    const result = inspections.get(pathname);
    return result && predicate(result);
  }) || '';
}

function diagnosticsForCheck(check) {
  if (!check) return {};
  const result = check.result || {};
  if (check.name === 'projects') {
    return {
      scene: result.scene || '',
      projectCards: result.projectCards ?? 0,
      mode: result.mode || '',
      appId: result.appId || '',
      hint: '若项目页失败，先检查 /docs 是否由 Docsme 接管、data-app-root="docsme" 和 data-docsme-scene 是否输出。'
    };
  }
  if (check.name === 'document') {
    return {
      path: check.path || '',
      scene: result.scene || '',
      templateId: result.templateId || '',
      metaDescription: Boolean(result.metaDescription),
      articleTextLength: result.articleTextLength ?? 0,
      tocLinks: result.tocLinks ?? 0,
      commentShell: Boolean(result.commentShell),
      hint: '若正文失败，检查 Docsme _templateId、文档 meta description、.docsme-article 和官方模块输出。'
    };
  }
  if (check.name === 'code-sample') {
    return {
      path: check.path || '',
      shikiCode: result.shikiCode ?? 0,
      rawPreCode: result.rawPreCode ?? 0,
      renderScripts: result.renderScripts ?? 0,
      replayScripts: result.replayScripts ?? 0,
      consoleErrors: result.consoleErrors || [],
      hint: '若代码块失败，检查 Docsme 正文是否输出 pre/code，Shiki 插件 extra-path 是否包含 Docsme，PJAX 后 replay 是否清理。'
    };
  }
  if (check.name === 'katex-sample') {
    return {
      path: check.path || '',
      katexSource: result.katexSource ?? 0,
      katexRendered: result.katexRendered ?? 0,
      katexFallback: result.katexFallback ?? 0,
      katexStates: result.katexStates || [],
      articleTextLength: result.articleTextLength ?? 0,
      consoleErrors: result.consoleErrors || [],
      hint: '若 KaTeX 失败，检查 3.0.0 输出的 .katex-inline / .katex-block 或 math-* 源节点、KaTeX 资源和回退状态。'
    };
  }
  if (check.name === 'mermaid-sample') {
    return {
      path: check.path || '',
      mermaidSource: result.mermaidSource ?? 0,
      mermaidRendered: result.mermaidRendered ?? 0,
      mermaidFallback: result.mermaidFallback ?? 0,
      mermaidSvgCounts: result.mermaidSvgCounts || [],
      mermaidStates: result.mermaidStates || [],
      mermaidThemes: result.mermaidThemes || [],
      articleTextLength: result.articleTextLength ?? 0,
      consoleErrors: result.consoleErrors || [],
      hint: '若 Mermaid 失败，检查 text-diagram 1.5.2 的 data-content、资源懒加载、html[data-theme] 和 PJAX 后重绘。'
    };
  }
  if (check.name === 'rich-content-runtime') {
    return {
      ...result,
      hint: '若 fixture 失败，优先检查 KaTeX 预渲染保护、Mermaid 单实例重绘、原始内容回退和主题切换。'
    };
  }
  if (check.name === 'mermaid-pjax-theme') {
    return {
      path: check.path || '',
      cycles: result.cycles || [],
      light: result.light || {},
      dark: result.dark || {},
      hint: '若生命周期失败，检查 /docs 到正文的同应用 PJAX、Mermaid 资源懒加载、重复 SVG 和主题观察器。'
    };
  }
  return {};
}

function skippedCheck(name, reason) {
  const guide = SAMPLE_GUIDES[name] || {};
  return {
    name,
    status: 'skipped',
    reason,
    nextSteps: guide
  };
}

function printCheckHints(checks) {
  const failed = checks.filter((check) => check.status === 'failed');
  const skipped = checks.filter((check) => check.status === 'skipped');

  failed.forEach((check) => {
    console.error(`- failed ${check.name}:`);
    (check.failures || []).forEach((failure) => console.error(`  - ${failure}`));
    if (check.diagnostics?.hint) console.error(`  hint: ${check.diagnostics.hint}`);
    if (check.diagnostics) console.error(`  diagnostics: ${JSON.stringify(check.diagnostics)}`);
  });

  skipped.forEach((check) => {
    console.log(`- skipped ${check.name}: ${check.reason}`);
    if (check.nextSteps?.target) console.log(`  需要：${check.nextSteps.target}`);
    if (check.nextSteps?.command) console.log(`  指定路径：${check.nextSteps.command}`);
    if (check.nextSteps?.hint) console.log(`  提示：${check.nextSteps.hint}`);
  });
}

async function inspectRichContentRuntime(browser) {
  const page = await browser.newPage();
  const runtimeSource = await fs.readFile(docsmeRuntimePath, 'utf8');

  try {
    // Establish a same-origin URL without booting the full theme runtime; async
    // homepage scripts could otherwise mutate this isolated fixture document.
    await page.goto(`${baseUrl}/themes/theme-sky-blog-3/assets/asset-manifest.json`, {
      waitUntil: 'load',
      timeout: 20_000
    });
    await page.setContent(`<!doctype html>
      <html data-theme="light">
        <head><title>Docsme rich content fixture</title></head>
        <body>
          <main class="docsme-app">
            <span id="pre-rendered" class="katex-inline" title="作者标题"><span class="katex"><math></math></span></span>
            <span id="raw-inline" math-inline>x + y</span>
            <div id="raw-block" math-display>x^2 + y^2</div>
            <text-diagram id="diagram" data-type="mermaid" data-content="graph TD;A--&gt;B">graph TD;A--&gt;B</text-diagram>
          </main>
        </body>
      </html>`);
    await page.addScriptTag({
      type: 'module',
      content: `${runtimeSource}\nwindow.__DOCSME_RUNTIME_FIXTURE__ = { renderDocsmeRichContent, resolveDocsmeRichContentTheme };`
    });
    await page.waitForFunction(() => Boolean(window.__DOCSME_RUNTIME_FIXTURE__));

    const fixtureResult = await page.evaluate(async () => {
      const { renderDocsmeRichContent, resolveDocsmeRichContentTheme } = window.__DOCSME_RUNTIME_FIXTURE__;
      const app = document.querySelector('.docsme-app');
      const preRendered = document.querySelector('#pre-rendered');
      const preRenderedHtml = preRendered.innerHTML;
      const katexCalls = [];
      const mermaidThemes = [];
      let mermaidRuns = 0;
      let dedupeRuns = 0;
      const dedupeRunSnapshots = [];

      const katex = {
        render(source, node, options) {
          katexCalls.push({ source, displayMode: options.displayMode });
          node.innerHTML = '<span class="katex"><math></math></span>';
        }
      };
      const mermaid = {
        initialize(options) {
          mermaidThemes.push(options.theme);
        },
        async run({ nodes }) {
          mermaidRuns += 1;
          const theme = mermaidThemes.at(-1) || '';
          nodes.forEach((node) => {
            node.innerHTML = `<svg data-fixture-theme="${theme}" data-fixture-run="${mermaidRuns}"></svg>`;
            node.dataset.processed = 'true';
          });
        }
      };

      const first = await renderDocsmeRichContent(app, { katex, mermaid, allowResourceLoad: false });
      const second = await renderDocsmeRichContent(app, { katex, mermaid, allowResourceLoad: false });
      const lightSnapshot = {
        theme: resolveDocsmeRichContentTheme(),
        svgCount: document.querySelector('#diagram').querySelectorAll('svg').length,
        renderedTheme: document.querySelector('#diagram').dataset.docsmeMermaidTheme || ''
      };

      document.documentElement.dataset.theme = 'dark';
      const darkResult = await renderDocsmeRichContent(app, { katex, mermaid, allowResourceLoad: false });
      const darkSnapshot = {
        theme: resolveDocsmeRichContentTheme(),
        svgCount: document.querySelector('#diagram').querySelectorAll('svg').length,
        renderedTheme: document.querySelector('#diagram').dataset.docsmeMermaidTheme || ''
      };

      const dedupeDiagram = document.createElement('text-diagram');
      dedupeDiagram.id = 'dedupe-diagram';
      dedupeDiagram.dataset.type = 'mermaid';
      dedupeDiagram.dataset.content = 'graph LR;C-->D';
      dedupeDiagram.textContent = 'graph LR;C-->D';
      app.append(dedupeDiagram);
      const delayedMermaid = {
        initialize() {},
        async run({ nodes }) {
          dedupeRuns += 1;
          dedupeRunSnapshots.push(nodes.map((node) => ({
            id: node.id,
            theme: node.dataset.docsmeMermaidTheme || '',
            state: node.dataset.docsmeMermaidState || '',
            svgCount: node.querySelectorAll('svg').length
          })));
          await new Promise((resolve) => window.setTimeout(resolve, 25));
          nodes.forEach((node) => {
            node.innerHTML = '<svg data-dedupe="true"></svg>';
          });
        }
      };
      const firstJob = renderDocsmeRichContent(app, { katex, mermaid: delayedMermaid, allowResourceLoad: false });
      const secondJob = renderDocsmeRichContent(app, { katex, mermaid: delayedMermaid, allowResourceLoad: false });
      const sharedJob = firstJob === secondJob;
      await Promise.all([firstJob, secondJob]);
      await new Promise((resolve) => window.setTimeout(resolve, 60));

      const changingApp = document.createElement('main');
      changingApp.className = 'docsme-app';
      changingApp.innerHTML = '<text-diagram id="changing-first" data-type="mermaid" data-content="graph TD;G-->H">graph TD;G-->H</text-diagram>';
      document.body.appendChild(changingApp);
      let changingRuns = 0;
      const changingMermaid = {
        initialize() {},
        async run({ nodes }) {
          changingRuns += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 25));
          nodes.forEach((node) => {
            node.innerHTML = `<svg data-changing-run="${changingRuns}"></svg>`;
          });
        }
      };
      const changingFirstJob = renderDocsmeRichContent(changingApp, {
        katex,
        mermaid: changingMermaid,
        allowResourceLoad: false
      });
      const changingLate = document.createElement('text-diagram');
      changingLate.id = 'changing-late';
      changingLate.dataset.type = 'mermaid';
      changingLate.dataset.content = 'graph TD;I-->J';
      changingLate.textContent = 'graph TD;I-->J';
      changingApp.appendChild(changingLate);
      const changingSecondJob = renderDocsmeRichContent(changingApp, {
        katex,
        mermaid: changingMermaid,
        allowResourceLoad: false
      });
      const changingPromisesDiffer = changingFirstJob !== changingSecondJob;
      await changingSecondJob;
      const changedDuringJob = {
        promisesDiffer: changingPromisesDiffer,
        runs: changingRuns,
        firstSvgCount: changingApp.querySelector('#changing-first').querySelectorAll('svg').length,
        lateSvgCount: changingLate.querySelectorAll('svg').length
      };

      const continuationApp = document.createElement('main');
      continuationApp.className = 'docsme-app';
      continuationApp.innerHTML = '<text-diagram id="continuation-first" data-type="mermaid" data-content="graph TD;K-->L">graph TD;K-->L</text-diagram>';
      document.body.appendChild(continuationApp);
      let continuationRuns = 0;
      let continuationActiveRuns = 0;
      let continuationMaxConcurrent = 0;
      const continuationMermaid = {
        initialize() {},
        async run({ nodes }) {
          continuationRuns += 1;
          continuationActiveRuns += 1;
          continuationMaxConcurrent = Math.max(continuationMaxConcurrent, continuationActiveRuns);
          await new Promise((resolve) => window.setTimeout(resolve, 25));
          nodes.forEach((node) => {
            node.innerHTML = `<svg data-continuation-run="${continuationRuns}"></svg>`;
          });
          continuationActiveRuns -= 1;
        }
      };
      const continuationOptions = {
        katex,
        mermaid: continuationMermaid,
        allowResourceLoad: false
      };
      const continuationFirstJob = renderDocsmeRichContent(continuationApp, continuationOptions);
      const earlierContinuation = continuationFirstJob.then(() => {
        const finalNode = document.createElement('text-diagram');
        finalNode.id = 'continuation-final';
        finalNode.dataset.type = 'mermaid';
        finalNode.dataset.content = 'graph TD;O-->P';
        finalNode.textContent = 'graph TD;O-->P';
        continuationApp.appendChild(finalNode);
        return renderDocsmeRichContent(continuationApp, continuationOptions);
      });
      const queuedNode = document.createElement('text-diagram');
      queuedNode.id = 'continuation-queued';
      queuedNode.dataset.type = 'mermaid';
      queuedNode.dataset.content = 'graph TD;M-->N';
      queuedNode.textContent = 'graph TD;M-->N';
      continuationApp.appendChild(queuedNode);
      const queuedContinuationJob = renderDocsmeRichContent(continuationApp, continuationOptions);
      await Promise.all([queuedContinuationJob, earlierContinuation]);
      const continuationRace = {
        runs: continuationRuns,
        maxConcurrent: continuationMaxConcurrent,
        svgCounts: Array.from(continuationApp.querySelectorAll('text-diagram'), (node) => node.querySelectorAll('svg').length)
      };

      const brokenMath = document.createElement('span');
      brokenMath.id = 'broken-math';
      brokenMath.setAttribute('math-inline', '');
      brokenMath.textContent = '\\bad';
      const brokenDiagram = document.createElement('text-diagram');
      brokenDiagram.id = 'broken-diagram';
      brokenDiagram.dataset.type = 'mermaid';
      brokenDiagram.dataset.content = 'graph broken';
      brokenDiagram.textContent = 'graph broken';
      app.append(brokenMath, brokenDiagram);
      await renderDocsmeRichContent(app, {
        katex: { render() { throw new Error('fixture katex failure'); } },
        mermaid: { initialize() {}, async run() { throw new Error('fixture mermaid failure'); } },
        allowResourceLoad: false
      });
      const thrownFallback = {
        katex: brokenMath.classList.contains('docsme-rich-content-fallback')
          && brokenMath.textContent === '\\bad',
        mermaid: brokenDiagram.classList.contains('docsme-rich-content-fallback')
          && brokenDiagram.textContent === 'graph broken'
      };

      const missingMath = document.createElement('div');
      missingMath.id = 'missing-math';
      missingMath.setAttribute('math-display', '');
      missingMath.textContent = 'a / b';
      const missingDiagram = document.createElement('text-diagram');
      missingDiagram.id = 'missing-diagram';
      missingDiagram.dataset.type = 'mermaid';
      missingDiagram.dataset.content = 'graph TD;E-->F';
      missingDiagram.textContent = 'graph TD;E-->F';
      app.append(missingMath, missingDiagram);
      const unavailable = await renderDocsmeRichContent(app, {
        katex: null,
        mermaid: null,
        allowResourceLoad: false
      });

      return {
        first,
        second,
        darkResult,
        unavailable,
        preRenderedUntouched: preRendered.innerHTML === preRenderedHtml,
        authorTitlePreserved: preRendered.getAttribute('title') === '作者标题',
        katexCalls,
        mermaidRuns,
        mermaidThemes,
        lightSnapshot,
        darkSnapshot,
        sharedJob,
        dedupeRuns,
        dedupeRunSnapshots,
        dedupeSvgCount: dedupeDiagram.querySelectorAll('svg').length,
        changedDuringJob,
        continuationRace,
        thrownFallback,
        unavailableFallback: {
          katex: missingMath.classList.contains('docsme-rich-content-fallback')
            && missingMath.dataset.docsmeKatexState === 'unavailable',
          mermaid: missingDiagram.classList.contains('docsme-rich-content-fallback')
            && missingDiagram.dataset.docsmeMermaidState === 'unavailable'
        }
      };
    });

    await page.evaluate(() => {
      window.katex = undefined;
      window.mermaid = undefined;
      document.querySelectorAll('script[src*="/plugins/plugin-katex/"], script[src*="/plugins/text-diagram/"]')
        .forEach((script) => script.remove());
    });

    const actualPluginRuntime = await page.evaluate(async () => {
      const { renderDocsmeRichContent } = window.__DOCSME_RUNTIME_FIXTURE__;
      document.documentElement.dataset.theme = 'light';
      const app = document.createElement('main');
      app.className = 'docsme-app';
      app.id = 'actual-plugin-runtime';
      app.innerHTML = `
        <span id="actual-inline" math-inline>c = \\sqrt{a^2 + b^2}</span>
        <div id="actual-block" math-display>\\int_0^1 x^2 \\, dx</div>
        <text-diagram id="actual-diagram" data-type="mermaid" data-content="flowchart LR;A--&gt;B">flowchart LR;A--&gt;B</text-diagram>
      `;
      document.body.appendChild(app);

      const first = await renderDocsmeRichContent(app);
      const light = {
        katex: app.querySelectorAll('.katex').length,
        math: app.querySelectorAll('math').length,
        svg: app.querySelectorAll('#actual-diagram svg').length,
        mermaidTheme: app.querySelector('#actual-diagram')?.dataset.docsmeMermaidTheme || ''
      };

      document.documentElement.dataset.theme = 'dark';
      const darkResult = await renderDocsmeRichContent(app, { allowResourceLoad: false });
      const dark = {
        katex: app.querySelectorAll('.katex').length,
        math: app.querySelectorAll('math').length,
        svg: app.querySelectorAll('#actual-diagram svg').length,
        mermaidTheme: app.querySelector('#actual-diagram')?.dataset.docsmeMermaidTheme || ''
      };

      return {
        katexVersion: String(window.katex?.version || ''),
        mermaidAvailable: typeof window.mermaid?.run === 'function',
        runtimeSources: Array.from(document.querySelectorAll('script[data-docsme-plugin-runtime]'), (script) => script.src),
        first,
        darkResult,
        light,
        dark
      };
    });

    return { ...fixtureResult, actualPluginRuntime };
  } finally {
    await page.close();
  }
}

async function navigateWithPjax(page, target) {
  const targetUrl = new URL(target, `${baseUrl}/`).toString();
  await page.evaluate((url) => new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener('pjax:complete', onComplete);
      document.removeEventListener('pjax:same-variant-complete', onComplete);
      document.removeEventListener('pjax:error', onError);
    };
    const onComplete = () => {
      cleanup();
      resolve();
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(event?.detail?.error?.message || `PJAX navigation failed: ${url}`));
    };

    document.addEventListener('pjax:complete', onComplete);
    document.addEventListener('pjax:same-variant-complete', onComplete);
    document.addEventListener('pjax:error', onError);
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`PJAX navigation timeout: ${url}`));
    }, 15_000);

    if (!window.pjax?.loadUrl) {
      cleanup();
      reject(new Error('window.pjax.loadUrl is unavailable'));
      return;
    }
    Promise.resolve(window.pjax.loadUrl(url)).catch(onError);
  }), targetUrl);
  await page.waitForTimeout(500);
}

async function setThemeMode(page, mode) {
  return page.evaluate((nextMode) => {
    const themeStore = window.Alpine?.store?.('theme');
    if (themeStore?.setMode) {
      themeStore.setMode(nextMode);
      return 'alpine-store';
    }

    const root = document.documentElement;
    root.classList.toggle('dark', nextMode === 'dark');
    root.classList.toggle('light', nextMode === 'light');
    root.dataset.colorScheme = nextMode;
    root.dataset.theme = nextMode;
    return 'root-fallback';
  }, mode);
}

async function inspectMermaidLifecycle(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(
      '.docsme-article text-diagram[data-type="mermaid"], .docsme-article .mermaid'
    ));
    return {
      source: nodes.length,
      rendered: nodes.filter((node) => node.querySelector('svg')).length,
      fallback: nodes.filter((node) => node.hasAttribute('data-docsme-render-error')).length,
      svgCounts: nodes.map((node) => node.querySelectorAll('svg').length),
      states: nodes.map((node) => node.dataset.docsmeMermaidState || ''),
      themes: nodes.map((node) => node.dataset.docsmeMermaidTheme || ''),
      runtimeScripts: document.querySelectorAll('script[data-docsme-plugin-runtime="mermaid"]').length
    };
  });
}

async function inspectMermaidPjaxTheme(page, target) {
  await page.goto(absoluteUrl('/docs'), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(800);
  const themeDriver = await setThemeMode(page, 'light');
  const cycles = [];

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await navigateWithPjax(page, target);
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll(
        '.docsme-article text-diagram[data-type="mermaid"], .docsme-article .mermaid'
      ));
      return nodes.length > 0
        && nodes.every((node) => node.querySelectorAll('svg').length === 1)
        && nodes.every((node) => !node.hasAttribute('data-docsme-render-error'));
    }, null, { timeout: 12_000 });
    cycles.push(await inspectMermaidLifecycle(page));
    if (cycle === 0) await navigateWithPjax(page, '/docs');
  }

  const light = await inspectMermaidLifecycle(page);
  await setThemeMode(page, 'dark');
  await page.waitForFunction(() => {
    const nodes = Array.from(document.querySelectorAll(
      '.docsme-article text-diagram[data-type="mermaid"], .docsme-article .mermaid'
    ));
    return nodes.length > 0
      && nodes.every((node) => node.dataset.docsmeMermaidTheme === 'dark')
      && nodes.every((node) => node.querySelectorAll('svg').length === 1)
      && nodes.every((node) => !node.hasAttribute('data-docsme-render-error'));
  }, null, { timeout: 12_000 });
  const dark = await inspectMermaidLifecycle(page);

  return { themeDriver, cycles, light, dark };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const report = {
    baseUrl,
    checks: []
  };
  const failures = [];

  try {
    const result = await inspectRichContentRuntime(browser);
    const checkFailures = [];
    if (!result.preRenderedUntouched) checkFailures.push('runtime fixture: pre-rendered KaTeX DOM was modified');
    if (!result.authorTitlePreserved) checkFailures.push('runtime fixture: author title attribute was removed');
    if (result.katexCalls.length !== 2) checkFailures.push(`runtime fixture: KaTeX rendered ${result.katexCalls.length} times instead of 2`);
    if (!result.katexCalls.some((call) => call.displayMode === false)) checkFailures.push('runtime fixture: inline KaTeX mode was not exercised');
    if (!result.katexCalls.some((call) => call.displayMode === true)) checkFailures.push('runtime fixture: display KaTeX mode was not exercised');
    if (result.mermaidRuns !== 2) checkFailures.push(`runtime fixture: Mermaid rendered ${result.mermaidRuns} times instead of light+dark once each`);
    if (result.lightSnapshot.svgCount !== 1 || result.lightSnapshot.renderedTheme !== 'default') {
      checkFailures.push('runtime fixture: light Mermaid render did not produce exactly one themed SVG');
    }
    if (result.darkSnapshot.svgCount !== 1 || result.darkSnapshot.renderedTheme !== 'dark') {
      checkFailures.push('runtime fixture: dark Mermaid rerender did not replace with exactly one SVG');
    }
    if (!result.sharedJob || result.dedupeRuns !== 1 || result.dedupeSvgCount !== 1) {
      checkFailures.push('runtime fixture: concurrent re-entry was not deduplicated');
    }
    if (!result.changedDuringJob?.promisesDiffer
      || result.changedDuringJob?.runs !== 2
      || result.changedDuringJob?.firstSvgCount !== 1
      || result.changedDuringJob?.lateSvgCount !== 1) {
      checkFailures.push('runtime fixture: a fingerprint-changing caller did not await the queued rerender');
    }
    if (result.continuationRace?.maxConcurrent !== 1
      || result.continuationRace?.runs !== 2
      || result.continuationRace?.svgCounts?.length !== 3
      || result.continuationRace.svgCounts.some((count) => count !== 1)) {
      checkFailures.push('runtime fixture: an earlier completion continuation bypassed the serialized render tail');
    }
    if (!result.thrownFallback.katex || !result.thrownFallback.mermaid) {
      checkFailures.push('runtime fixture: thrown render failure did not restore source content');
    }
    if (!result.unavailableFallback.katex || !result.unavailableFallback.mermaid) {
      checkFailures.push('runtime fixture: missing plugin runtime did not expose a readable fallback');
    }
    if (result.unavailable.katex.pending !== 0 || result.unavailable.mermaid.pending !== 0) {
      checkFailures.push('runtime fixture: unavailable plugin state remained pending');
    }
    if (!result.actualPluginRuntime?.katexVersion) {
      checkFailures.push('runtime fixture: KaTeX 3.0.0 browser runtime did not expose a version');
    }
    if (!result.actualPluginRuntime?.mermaidAvailable) {
      checkFailures.push('runtime fixture: Text Diagram 1.5.2 Mermaid runtime was unavailable');
    }
    if (!result.actualPluginRuntime?.runtimeSources?.some((src) => src.includes('/plugins/plugin-katex/assets/static/katex.min.js?version=3.0.0'))) {
      checkFailures.push('runtime fixture: cold KaTeX load did not use the versioned 3.0.0 asset');
    }
    if (!result.actualPluginRuntime?.runtimeSources?.some((src) => src.includes('/plugins/text-diagram/assets/static/mermaid.min.js?version=1.5.2'))) {
      checkFailures.push('runtime fixture: cold Mermaid load did not use the versioned 1.5.2 asset');
    }
    if (result.actualPluginRuntime?.first?.katex?.rendered !== 2
      || result.actualPluginRuntime?.light?.katex < 2
      || result.actualPluginRuntime?.light?.math < 2) {
      checkFailures.push('runtime fixture: actual KaTeX runtime did not render inline and display formulas');
    }
    if (result.actualPluginRuntime?.light?.svg !== 1
      || result.actualPluginRuntime?.light?.mermaidTheme !== 'default') {
      checkFailures.push('runtime fixture: actual Mermaid runtime did not render one light-theme SVG');
    }
    if (result.actualPluginRuntime?.dark?.svg !== 1
      || result.actualPluginRuntime?.dark?.mermaidTheme !== 'dark') {
      checkFailures.push('runtime fixture: actual Mermaid runtime did not replace the diagram for dark theme');
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'rich-content-runtime',
      status: checkFailures.length ? 'failed' : 'passed',
      result,
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({ name: 'rich-content-runtime', result })
    });
  } catch (error) {
    const checkFailures = [`runtime fixture: ${error?.message || String(error)}`];
    failures.push(...checkFailures);
    report.checks.push({
      name: 'rich-content-runtime',
      status: 'failed',
      result: {},
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({ name: 'rich-content-runtime', result: {} })
    });
  }

  if (fixtureOnly) {
    report.fixtureOnly = true;
    await browser.close();
    const reportFile = await writeReport(report);
    if (failures.length > 0) {
      console.error('Docsme rich-content fixture failed:');
      printCheckHints(report.checks);
      console.error(`Report: ${reportFile}`);
      process.exit(1);
    }
    console.log('Docsme rich-content fixture passed');
    console.log(`Report: ${reportFile}`);
    return;
  }

  const projects = await inspectDocsPage(page, '/docs');
  const projectFailures = assertDocsProtocol(projects, 'projects');
  if (projects.scene !== 'projects') projectFailures.push(`projects: scene=${projects.scene}`);
  if (projects.projectCards < 1) projectFailures.push('projects: no project cards found');
  failures.push(...projectFailures);
  report.checks.push({
    name: 'projects',
    status: projectFailures.length ? 'failed' : 'passed',
    path: '/docs',
    result: projects,
    failures: projectFailures,
    diagnostics: diagnosticsForCheck({
      name: 'projects',
      result: projects,
      failures: projectFailures
    })
  });

  const links = await collectDocsLinks(page);
  const candidateDocs = Array.from(new Set([
    explicitDocPath,
    explicitCodePath,
    explicitKatexPath,
    explicitMermaidPath,
    ...links.documents
  ].filter(Boolean)));

  const inspections = new Map();
  for (const pathname of candidateDocs.slice(0, 12)) {
    inspections.set(pathname, await inspectDocsPage(page, pathname));
  }

  const docPath = explicitDocPath || candidateDocs[0] || '';
  if (docPath) {
    const result = inspections.get(docPath) || await inspectDocsPage(page, docPath);
    const checkFailures = assertDocsProtocol(result, 'document');
    if (result.scene !== 'document') checkFailures.push(`document: scene=${result.scene}`);
    if (!result.templateId) checkFailures.push('document: missing data-docsme-template-id');
    if (!result.metaDescription) checkFailures.push('document: missing meta description');
    if (result.articleTextLength < 1) checkFailures.push('document: empty article');
    failures.push(...checkFailures);
    report.checks.push({
      name: 'document',
      status: checkFailures.length ? 'failed' : 'passed',
      path: docPath,
      result,
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({
        name: 'document',
        path: docPath,
        result,
        failures: checkFailures
      })
    });
  } else {
    report.checks.push(skippedCheck('document', 'No accessible Docsme document page was discovered.'));
  }

  const codePath = explicitCodePath || chooseSample(
    candidateDocs,
    inspections,
    (result) => result.shikiCode > 0 || result.rawPreCode > 0
  );
  if (codePath) {
    const result = inspections.get(codePath) || await inspectDocsPage(page, codePath);
    const checkFailures = assertDocsProtocol(result, 'code sample');
    if (result.shikiCode === 0 && result.rawPreCode === 0) {
      checkFailures.push('code sample: no rendered Shiki host or pre > code block detected');
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'code-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: codePath,
      result,
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({
        name: 'code-sample',
        path: codePath,
        result,
        failures: checkFailures
      })
    });
  } else {
    report.checks.push(skippedCheck('code-sample', 'No Docsme document with code block was found.'));
  }

  const katexPath = explicitKatexPath || chooseSample(candidateDocs, inspections, (result) => result.katexSource > 0);
  if (katexPath) {
    const result = inspections.get(katexPath) || await inspectDocsPage(page, katexPath);
    const checkFailures = assertDocsProtocol(result, 'katex sample');
    if (result.katexSource === 0) checkFailures.push('katex sample: no plugin source container detected');
    if (result.katexRendered < result.katexSource) {
      checkFailures.push(`katex sample: rendered ${result.katexRendered}/${result.katexSource} source containers`);
    }
    if (result.katexFallback > 0) checkFailures.push(`katex sample: ${result.katexFallback} container(s) fell back to source text`);
    failures.push(...checkFailures);
    report.checks.push({
      name: 'katex-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: katexPath,
      result,
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({
        name: 'katex-sample',
        path: katexPath,
        result,
        failures: checkFailures
      })
    });
  } else {
    report.checks.push(skippedCheck('katex-sample', 'No Docsme document with KaTeX content was found.'));
  }

  const mermaidPath = explicitMermaidPath || chooseSample(candidateDocs, inspections, (result) => result.mermaidSource > 0);
  if (mermaidPath) {
    const result = inspections.get(mermaidPath) || await inspectDocsPage(page, mermaidPath);
    const checkFailures = assertDocsProtocol(result, 'mermaid sample');
    if (result.mermaidSource === 0) checkFailures.push('mermaid sample: no text-diagram source DOM detected');
    if (result.mermaidRendered < result.mermaidSource) {
      checkFailures.push(`mermaid sample: rendered ${result.mermaidRendered}/${result.mermaidSource} source containers`);
    }
    if (result.mermaidSvgCounts.some((count) => count !== 1)) {
      checkFailures.push(`mermaid sample: expected one SVG per source, got ${JSON.stringify(result.mermaidSvgCounts)}`);
    }
    if (result.mermaidFallback > 0) checkFailures.push(`mermaid sample: ${result.mermaidFallback} container(s) fell back to source text`);
    failures.push(...checkFailures);
    report.checks.push({
      name: 'mermaid-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: mermaidPath,
      result,
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({
        name: 'mermaid-sample',
        path: mermaidPath,
        result,
        failures: checkFailures
      })
    });

    try {
      const lifecycleResult = await inspectMermaidPjaxTheme(page, mermaidPath);
      const lifecycleFailures = [];
      lifecycleResult.cycles.forEach((cycleResult, index) => {
        if (cycleResult.source === 0 || cycleResult.rendered !== cycleResult.source) {
          lifecycleFailures.push(`mermaid PJAX cycle ${index + 1}: rendered ${cycleResult.rendered}/${cycleResult.source}`);
        }
        if (cycleResult.fallback > 0 || cycleResult.svgCounts.some((count) => count !== 1)) {
          lifecycleFailures.push(`mermaid PJAX cycle ${index + 1}: fallback or duplicate SVG detected`);
        }
      });
      if (lifecycleResult.cycles.length !== 2) lifecycleFailures.push('mermaid PJAX: expected 2 re-entry cycles');
      if (lifecycleResult.light.themes.some((theme) => theme !== 'default')) {
        lifecycleFailures.push(`mermaid theme: light state mismatch ${JSON.stringify(lifecycleResult.light.themes)}`);
      }
      if (lifecycleResult.dark.themes.some((theme) => theme !== 'dark')) {
        lifecycleFailures.push(`mermaid theme: dark state mismatch ${JSON.stringify(lifecycleResult.dark.themes)}`);
      }
      if (lifecycleResult.dark.fallback > 0 || lifecycleResult.dark.svgCounts.some((count) => count !== 1)) {
        lifecycleFailures.push('mermaid theme: dark rerender produced fallback or duplicate SVG');
      }
      failures.push(...lifecycleFailures);
      report.checks.push({
        name: 'mermaid-pjax-theme',
        status: lifecycleFailures.length ? 'failed' : 'passed',
        path: mermaidPath,
        result: lifecycleResult,
        failures: lifecycleFailures,
        diagnostics: diagnosticsForCheck({
          name: 'mermaid-pjax-theme',
          path: mermaidPath,
          result: lifecycleResult
        })
      });
    } catch (error) {
      const lifecycleFailures = [`mermaid PJAX/theme: ${error?.message || String(error)}`];
      failures.push(...lifecycleFailures);
      report.checks.push({
        name: 'mermaid-pjax-theme',
        status: 'failed',
        path: mermaidPath,
        result: {},
        failures: lifecycleFailures,
        diagnostics: diagnosticsForCheck({ name: 'mermaid-pjax-theme', path: mermaidPath, result: {} })
      });
    }
  } else {
    report.checks.push(skippedCheck('mermaid-sample', 'No Docsme document with Mermaid content was found.'));
    report.checks.push(skippedCheck('mermaid-pjax-theme', 'No real text-diagram sample was found for PJAX and theme switching.'));
  }

  report.discovery = links;
  await browser.close();

  const reportFile = await writeReport(report);
  if (failures.length > 0) {
    console.error('Docsme verification failed:');
    printCheckHints(report.checks);
    console.error(`Report: ${reportFile}`);
    process.exit(1);
  }

  const skipped = report.checks.filter((check) => check.status === 'skipped');
  const passed = report.checks.filter((check) => check.status === 'passed');
  console.log(`Docsme verification completed: ${passed.length} passed, ${skipped.length} skipped`);
  printCheckHints(report.checks);
  console.log(`Report: ${reportFile}`);
}

main().catch((error) => {
  console.error(`verify:docsme failed: ${error.message}`);
  process.exit(1);
});
