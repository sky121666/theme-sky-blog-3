import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { collectBrowserRuntimeErrors, runtimeErrorMessages, installReadOnlyGuard } from './lib/browser-runtime-errors.mjs';
import { readLiveBuildContext } from './lib/live-build-context.mjs';
import { normalizeDocsPath, discoverDocsRoutes, inspectDocsCandidates, missingDocsSampleReason, DOCSME_INSPECTION_LIMIT } from './lib/docsme-sample-discovery.mjs';
import { createDocsmeNavigationDiagnostics } from './lib/docsme-navigation-diagnostics.mjs';

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
const reportPath = process.env.DOCSME_REPORT_PATH
  ? path.resolve(root, process.env.DOCSME_REPORT_PATH)
  : path.join(outputDir, 'docsme-report.json');
const navigationObservers = new WeakMap();

function navigationObserver(page) {
  if (!navigationObservers.has(page)) navigationObservers.set(page, createDocsmeNavigationDiagnostics(page));
  return navigationObservers.get(page);
}

async function gotoDocsPage(page, url, options) {
  const waitForParsedDocument = options.waitUntil === 'domcontentloaded';
  // A deferred global plugin script can delay DOMContentLoaded after the
  // Docsme document and theme shell are already interactive. Keep the HTTP
  // response and runtime error gates, then wait for the actual parsed DOM.
  const response = await navigationObserver(page).goto(url, waitForParsedDocument
    ? { ...options, waitUntil: 'commit' }
    : options);
  if (waitForParsedDocument) {
    try {
      await page.waitForFunction(() => document.readyState !== 'loading', null, {
        timeout: options.timeout
      });
    } catch (error) {
      error.docsmeNavigationDiagnostic = await navigationObserver(page).snapshot();
      throw error;
    }
  }
  return response;
}

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

async function writeReport(report) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

async function collectDocsLinks(page, startPath = '/docs') {
  return discoverDocsRoutes({ baseUrl, startPath, visit: async (current) => {
    const response = await gotoDocsPage(page, absoluteUrl(current), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!response) throw new Error(`No navigation response for ${current}`);
    if (response.status() >= 400) return { status: response.status() };
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

    return { ...snapshot, status: response.status() };
  } });
}

async function inspectDocsPage(page, target) {
  const runtimeErrors = collectBrowserRuntimeErrors(page);
  try {
    const response = await gotoDocsPage(page, absoluteUrl(target), { waitUntil: 'domcontentloaded', timeout: 20_000 });
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
        mermaidRendered: mermaidNodes.filter((node) => node.querySelector(':scope > svg') && !node.querySelector('svg .error-icon, svg .error-text')).length,
        mermaidFallback: mermaidNodes.filter((node) => node.hasAttribute('data-docsme-render-error')).length,
        mermaidSvgCounts: mermaidNodes.map((node) => node.querySelectorAll('svg').length),
        mermaidStates: mermaidNodes.map((node) => node.dataset.docsmeMermaidState || ''),
        mermaidThemes: mermaidNodes.map((node) => node.dataset.docsmeMermaidTheme || ''),
        articleTextLength: article?.innerText?.trim?.().length || 0
      };
    });

    let projectCardHover = null;
    const projectCards = page.locator('.docsme-project-card');
    if (await projectCards.count() > 0) {
      const firstCard = projectCards.first();
      const secondCard = projectCards.nth(Math.min(1, (await projectCards.count()) - 1));
      const before = await firstCard.boundingBox();

      for (let index = 0; index < 4; index += 1) {
        await firstCard.hover();
        await secondCard.hover();
      }
      await firstCard.hover();
      await page.waitForTimeout(240);

      const after = await firstCard.boundingBox();
      projectCardHover = await firstCard.evaluate((card, positions) => {
        const cardStyle = getComputedStyle(card);
        const glow = card.querySelector('.docsme-project-card__glow');
        return {
          active: card.matches(':hover'),
          transform: cardStyle.transform,
          glowFilter: glow ? getComputedStyle(glow).filter : '',
          verticalShift: positions.before && positions.after
            ? Math.round((positions.after.y - positions.before.y) * 100) / 100
            : null
        };
      }, { before, after });
      await page.mouse.move(0, 0);
    }

    return { ...result, projectCardHover, httpStatus: response.status(), ...runtimeErrors.snapshot() };
  } finally {
    runtimeErrors.stop();
  }
}

function assertDocsProtocol(result, label) {
  const failures = runtimeErrorMessages(result).map((message) => `${label}: ${message}`);
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
      projectCardHover: result.projectCardHover || null,
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
  const runtimeErrors = collectBrowserRuntimeErrors(page);
  const runtimeSource = await fs.readFile(docsmeRuntimePath, 'utf8');
  const runtimeBundle = await build({
    stdin: {
      contents: `${runtimeSource}\nwindow.__DOCSME_RUNTIME_FIXTURE__ = { renderDocsmeRichContent, resolveDocsmeRichContentTheme, renderToc };`,
      resolveDir: path.dirname(docsmeRuntimePath),
      sourcefile: 'docsme-rich-content-fixture.js',
      loader: 'js'
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent'
  });

  try {
    // Establish a same-origin URL without booting the full theme runtime; async
    // homepage scripts could otherwise mutate this isolated fixture document.
    await gotoDocsPage(page, `${baseUrl}/themes/theme-sky-blog-3/assets/asset-manifest.json`, {
      waitUntil: 'load',
      timeout: 20_000
    });
    await page.setContent(`<!doctype html>
      <html data-theme="light">
        <head><title>Docsme rich content fixture</title></head>
        <body>
          <main class="docsme-app">
            <aside data-docsme-toc><nav data-docsme-toc-list></nav></aside>
            <article data-toc-content><h2>History contract</h2></article>
            <span id="pre-rendered" class="katex-inline" title="作者标题"><span class="katex"><math></math></span></span>
            <span id="raw-inline" math-inline>x + y</span>
            <div id="raw-block" math-display>x^2 + y^2</div>
            <text-diagram id="diagram" data-type="mermaid" data-content="graph TD;A--&gt;B">graph TD;A--&gt;B</text-diagram>
          </main>
        </body>
      </html>`);
    await page.addScriptTag({ content: runtimeBundle.outputFiles[0].text });
    await page.waitForFunction(() => Boolean(window.__DOCSME_RUNTIME_FIXTURE__));

    const fixtureResult = await page.evaluate(async () => {
      const { renderDocsmeRichContent, resolveDocsmeRichContentTheme, renderToc } = window.__DOCSME_RUNTIME_FIXTURE__;
      const app = document.querySelector('.docsme-app');
      history.replaceState({ uid: 'pjax-state', scrollPos: [12, 34] }, '', window.location.href);
      renderToc(app);
      document.querySelector('[data-docsme-toc-list] a')?.click();
      const tocHistory = {
        state: history.state,
        hash: window.location.hash
      };
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
      const continuationNodeIdTrace = [];
      const continuationMermaid = {
        initialize() {},
        async run({ nodes }) {
          const runId = ++continuationRuns;
          continuationNodeIdTrace.push(nodes.map((node) => node.id));
          continuationActiveRuns += 1;
          continuationMaxConcurrent = Math.max(continuationMaxConcurrent, continuationActiveRuns);
          await new Promise((resolve) => window.setTimeout(resolve, 25));
          nodes.forEach((node) => {
            node.innerHTML = `<svg data-continuation-run="${runId}"></svg>`;
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
        nodeIdTrace: continuationNodeIdTrace,
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
        tocHistory,
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

    return { ...fixtureResult, actualPluginRuntime, ...runtimeErrors.snapshot() };
  } finally {
    runtimeErrors.stop();
    navigationObservers.get(page)?.stop();
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

async function inspectSwitcherThemeStyles(page, target) {
  const response = await gotoDocsPage(page, absoluteUrl(target), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(800);

  const switcherCount = await page.locator('.docsme-switcher select').count();
  if (switcherCount < 1) return { available: false, httpStatus: response.status() };

  const originalMode = await page.evaluate(() => document.documentElement.dataset.colorScheme || 'system');
  const inspect = () => page.locator('.docsme-switcher select').first().evaluate((select) => {
    const option = select.querySelector('option');
    const selectStyle = getComputedStyle(select);
    const optionStyle = option ? getComputedStyle(option) : null;
    return {
      colorScheme: selectStyle.colorScheme,
      selectBackgroundColor: selectStyle.backgroundColor,
      selectColor: selectStyle.color,
      optionBackgroundColor: optionStyle?.backgroundColor || '',
      optionColor: optionStyle?.color || ''
    };
  });

  try {
    const lightDriver = await setThemeMode(page, 'light');
    await page.waitForTimeout(180);
    const light = await inspect();
    const darkDriver = await setThemeMode(page, 'dark');
    await page.waitForTimeout(180);
    const dark = await inspect();
    return {
      available: true,
      httpStatus: response.status(),
      originalMode,
      lightDriver,
      darkDriver,
      light,
      dark
    };
  } finally {
    await setThemeMode(page, originalMode);
  }
}

async function inspectMermaidLifecycle(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(
      '.docsme-article text-diagram[data-type="mermaid"], .docsme-article .mermaid'
    ));
    return {
      source: nodes.length,
      rendered: nodes.filter((node) => node.querySelector(':scope > svg') && !node.querySelector('svg .error-icon, svg .error-text')).length,
      fallback: nodes.filter((node) => node.hasAttribute('data-docsme-render-error')).length,
      svgCounts: nodes.map((node) => node.querySelectorAll('svg').length),
      states: nodes.map((node) => node.dataset.docsmeMermaidState || ''),
      themes: nodes.map((node) => node.dataset.docsmeMermaidTheme || ''),
      runtimeScripts: document.querySelectorAll('script[data-docsme-plugin-runtime="mermaid"]').length
    };
  });
}

async function inspectMermaidPjaxTheme(page, target) {
  await gotoDocsPage(page, absoluteUrl('/docs'), { waitUntil: 'domcontentloaded', timeout: 20_000 });
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
        && nodes.every((node) => !node.hasAttribute('data-docsme-render-error') && !node.querySelector('svg .error-icon, svg .error-text'));
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
      && nodes.every((node) => !node.hasAttribute('data-docsme-render-error') && !node.querySelector('svg .error-icon, svg .error-text'));
  }, null, { timeout: 12_000 });
  const dark = await inspectMermaidLifecycle(page);

  return { themeDriver, cycles, light, dark };
}

async function main() {
  const startAt = new Date().toISOString();
  const report = {
    runId: `docsme-${Date.now()}-${process.pid}`, startAt, startedAt: startAt,
    status: 'running', phase: 'environment', baseUrl, buildContext: null,
    blockedWrites: [], checks: [], failures: []
  };
  // Invalidate a prior run before any environment, launch or navigation can fail.
  await writeReport(report);
  const failures = report.failures;
  let browser;
  let page;
  let suiteRuntime;
  try {
  const buildContext = await readLiveBuildContext(baseUrl);
  report.buildContext = buildContext;
  report.phase = 'browser-setup';
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  const blockedWrites = report.blockedWrites;
  await installReadOnlyGuard(context, blockedWrites);
  page = await context.newPage();
  suiteRuntime = collectBrowserRuntimeErrors(page);
  navigationObserver(page);

  report.phase = 'rich-content-runtime';
  try {
    const result = await inspectRichContentRuntime(context);
    const checkFailures = runtimeErrorMessages(result).map((message) => `runtime fixture: ${message}`);
    if (!result.preRenderedUntouched) checkFailures.push('runtime fixture: pre-rendered KaTeX DOM was modified');
    if (!result.authorTitlePreserved) checkFailures.push('runtime fixture: author title attribute was removed');
    if (result.tocHistory?.state?.uid !== 'pjax-state'
      || result.tocHistory?.state?.scrollPos?.join(',') !== '12,34'
      || result.tocHistory?.hash !== '#history-contract') {
      checkFailures.push('runtime fixture: TOC hash navigation destroyed the existing PJAX history state');
    }
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
    const continuationRace = result.continuationRace;
    const continuationExpectedIds = ['continuation-first', 'continuation-queued', 'continuation-final'];
    const continuationTrace = continuationRace?.nodeIdTrace;
    const continuationActualIds = Array.isArray(continuationTrace) ? continuationTrace.flat() : [];
    if (continuationRace?.maxConcurrent !== 1
      || continuationRace?.runs !== continuationExpectedIds.length
      || !Array.isArray(continuationTrace)
      || continuationTrace.length !== continuationExpectedIds.length
      || continuationTrace.some((ids) => !Array.isArray(ids) || ids.length !== 1)
      || continuationActualIds.length !== continuationExpectedIds.length
      || continuationExpectedIds.some((id) => continuationActualIds.filter((actual) => actual === id).length !== 1)
      || continuationRace?.svgCounts?.length !== continuationExpectedIds.length
      || continuationRace.svgCounts.some((count) => count !== 1)) {
      checkFailures.push('runtime fixture: continuation must render each of the three node IDs once, one node per run, with a serialized render tail');
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
      diagnostics: { ...diagnosticsForCheck({ name: 'rich-content-runtime', result: {} }), navigation: error.docsmeNavigationDiagnostic || null }
    });
  }

  if (fixtureOnly) {
    report.fixtureOnly = true;
    report.finalBuildContext = await readLiveBuildContext(baseUrl);
    if (report.finalBuildContext.sourceFingerprint !== buildContext.sourceFingerprint) failures.push('source/build changed during Docsme fixture validation');
    failures.push(...runtimeErrorMessages({ blockedWrites }));
    report.failures = failures;
    const reportFile = await writeReport(report);
    if (failures.length > 0) {
      console.error('Docsme rich-content fixture failed:');
      printCheckHints(report.checks);
      console.error(`Report: ${reportFile}`);
      process.exitCode = 1;
      return;
    }
    console.log('Docsme rich-content fixture passed');
    console.log(`Report: ${reportFile}`);
    return;
  }

  report.phase = 'projects';
  const projects = await inspectDocsPage(page, '/docs');
  const projectFailures = assertDocsProtocol(projects, 'projects');
  if (projects.scene !== 'projects') projectFailures.push(`projects: scene=${projects.scene}`);
  if (projects.projectCards < 1) projectFailures.push('projects: no project cards found');
  if (!projects.projectCardHover?.active) projectFailures.push('projects: project card hover state was not activated');
  if (projects.projectCardHover?.transform !== 'none') {
    projectFailures.push(`projects: hover transform=${projects.projectCardHover?.transform || 'missing'}`);
  }
  if (projects.projectCardHover?.glowFilter !== 'none') {
    projectFailures.push(`projects: glow filter=${projects.projectCardHover?.glowFilter || 'missing'}`);
  }
  if (Math.abs(projects.projectCardHover?.verticalShift || 0) > 0.1) {
    projectFailures.push(`projects: hover vertical shift=${projects.projectCardHover.verticalShift}`);
  }
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

  report.phase = 'route-discovery';
  const links = await collectDocsLinks(page);
  report.discovery = links;
  failures.push(...links.navigationErrors.map((error) => `discovery navigation: ${error.path}: ${error.message}`));
  const candidateDocs = Array.from(new Set([
    explicitDocPath,
    explicitCodePath,
    explicitKatexPath,
    explicitMermaidPath,
    ...links.documents
  ].filter(Boolean).map((value) => {
    const normalized = normalizeDocsPath(value, baseUrl);
    if (!normalized) throw new Error(`Docsme sample must be a same-origin /docs route: ${value}`);
    return normalized;
  })));

  report.phase = 'sample-scan';
  report.sampleScan = { limit: DOCSME_INSPECTION_LIMIT, candidates: candidateDocs, attempted: [], inspected: [], failed: [], remaining: [...candidateDocs], truncated: candidateDocs.length > DOCSME_INSPECTION_LIMIT, complete: false };
  const { inspections, summary: scanSummary } = await inspectDocsCandidates(candidateDocs, async (pathname) => {
    report.sampleScan.active = pathname;
    report.sampleScan.attempted.push(pathname);
    report.sampleScan.remaining = candidateDocs.filter((candidate) => !report.sampleScan.attempted.includes(candidate));
    try {
      const result = await inspectDocsPage(page, pathname);
      report.sampleScan.inspected.push(pathname);
      return result;
    } catch (error) {
      const message = `sample inspection: ${pathname}: ${error.message}`;
      failures.push(message);
      report.sampleScan.failed.push({ path: pathname, message: error.message });
      report.checks.push({ name: 'sample-inspection', path: pathname, status: 'failed', failures: [message], diagnostics: error.docsmeNavigationDiagnostic || null });
      if (page.isClosed() || !browser.isConnected() || /page crashed/i.test(error.message)) throw error;
      // Preserve the failure and inspect other independent candidates once.
      // A failed result is never selected as an observed rich-content sample.
      return {
        status: 'failed', inspectionError: error.message, httpStatus: null,
        scene: '', mode: '', appId: '', windowVariant: '', templateId: '', metaDescription: '',
        replayScripts: 0, articleTextLength: 0, switchers: 0, shikiCode: 0, rawPreCode: 0,
        katexSource: 0, katexRendered: 0, katexFallback: 0, katexStates: [],
        mermaidSource: 0, mermaidRendered: 0, mermaidFallback: 0, mermaidSvgCounts: [], mermaidStates: [], mermaidThemes: []
      };
    }
  });
  const sampleScan = { ...report.sampleScan, remaining: scanSummary.remaining, active: null, complete: true };
  report.sampleScan = sampleScan;
  const missingSample = (label) => missingDocsSampleReason(label, links, sampleScan);

  const switcherPath = chooseSample(candidateDocs, inspections, (result) => result.switchers > 0);
  report.phase = 'switcher-theme';
  if (switcherPath) {
    const result = await inspectSwitcherThemeStyles(page, switcherPath);
    const checkFailures = [];
    const transparentColors = new Set(['transparent', 'rgba(0, 0, 0, 0)']);
    if (!result.available) checkFailures.push('switcher theme: no version or language select was available');
    if (result.light?.colorScheme !== 'light') {
      checkFailures.push(`switcher theme: light color-scheme=${result.light?.colorScheme || 'missing'}`);
    }
    if (result.dark?.colorScheme !== 'dark') {
      checkFailures.push(`switcher theme: dark color-scheme=${result.dark?.colorScheme || 'missing'}`);
    }
    if (transparentColors.has(result.light?.optionBackgroundColor)) {
      checkFailures.push('switcher theme: light option background is transparent');
    }
    if (transparentColors.has(result.dark?.optionBackgroundColor)) {
      checkFailures.push('switcher theme: dark option background is transparent');
    }
    if (result.light?.optionBackgroundColor === result.dark?.optionBackgroundColor) {
      checkFailures.push(`switcher theme: light and dark option backgrounds both use ${result.dark?.optionBackgroundColor || 'missing'}`);
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'switcher-theme',
      status: checkFailures.length ? 'failed' : 'passed',
      path: switcherPath,
      result,
      failures: checkFailures
    });
  } else {
    report.checks.push(skippedCheck('switcher-theme', missingSample('page with multiple versions or languages')));
  }

  const docPath = normalizeDocsPath(explicitDocPath, baseUrl) || candidateDocs[0] || '';
  report.phase = 'document';
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
    report.checks.push(skippedCheck('document', missingSample('accessible document page')));
  }

  const codePath = normalizeDocsPath(explicitCodePath, baseUrl) || chooseSample(
    candidateDocs,
    inspections,
    (result) => result.shikiCode > 0 || result.rawPreCode > 0
  );
  report.phase = 'code-sample';
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
    report.checks.push(skippedCheck('code-sample', missingSample('code block')));
  }

  const katexPath = normalizeDocsPath(explicitKatexPath, baseUrl) || chooseSample(candidateDocs, inspections, (result) => result.katexSource > 0);
  report.phase = 'katex-sample';
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
    report.checks.push(skippedCheck('katex-sample', missingSample('KaTeX content')));
  }

  const mermaidPath = normalizeDocsPath(explicitMermaidPath, baseUrl) || chooseSample(candidateDocs, inspections, (result) => result.mermaidSource > 0);
  report.phase = 'mermaid-sample';
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
      report.phase = 'mermaid-pjax-theme';
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
    report.checks.push(skippedCheck('mermaid-sample', missingSample('Mermaid content')));
    report.checks.push(skippedCheck('mermaid-pjax-theme', missingSample('real text-diagram for PJAX and theme switching')));
  }

  report.discovery = links;
  report.suiteRuntime = suiteRuntime.snapshot();
  failures.push(...runtimeErrorMessages({ ...report.suiteRuntime, blockedWrites }));
  report.finalBuildContext = await readLiveBuildContext(baseUrl);
  if (report.finalBuildContext.sourceFingerprint !== buildContext.sourceFingerprint) failures.push('source/build changed during Docsme validation');
  report.failures = failures;
  const reportFile = await writeReport(report);
  if (failures.length > 0) {
    console.error('Docsme verification failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    printCheckHints(report.checks);
    console.error(`Report: ${reportFile}`);
    process.exitCode = 1;
    return;
  }

  const skipped = report.checks.filter((check) => check.status === 'skipped');
  const passed = report.checks.filter((check) => check.status === 'passed');
  console.log(`Docsme verification completed: ${passed.length} passed, ${skipped.length} skipped`);
  printCheckHints(report.checks);
  console.log(`Report: ${reportFile}`);
  } catch (error) {
    const message = `${report.phase}: ${error?.message || String(error)}`;
    failures.push(message);
    report.fatalError = { name: error?.name || 'Error', message: error?.message || String(error), phase: report.phase };
    report.checks.push({ name: `${report.phase}-exception`, status: 'failed', failures: [message] });
    if (error.docsmeNavigationDiagnostic) report.fatalError.navigationDiagnostic = error.docsmeNavigationDiagnostic;
    console.error(`Docsme verification failed: ${message}`);
    process.exitCode = 1;
  } finally {
    try {
      report.suiteRuntime = suiteRuntime?.snapshot() || {};
      failures.push(...runtimeErrorMessages({ ...report.suiteRuntime, blockedWrites: report.blockedWrites }));
      const navigation = page && navigationObservers.get(page);
      if (navigation) {
        report.navigation = { attempts: navigation.attempts, failures: navigation.failures };
        if (report.fatalError && !report.fatalError.navigationDiagnostic) {
          report.fatalError.navigationDiagnostic = await navigation.snapshot();
        }
      }
      if (report.buildContext && !report.finalBuildContext) {
        try { report.finalBuildContext = await readLiveBuildContext(baseUrl); }
        catch (error) { report.finalBuildContextError = error.message; failures.push(`final environment: ${error.message}`); }
      }
      if (report.finalBuildContext && report.finalBuildContext.sourceFingerprint !== report.buildContext.sourceFingerprint) failures.push('source/build changed during Docsme validation');
      report.failures = [...new Set(failures)];
      report.status = report.failures.length ? 'failed' : 'passed';
      report.finishedAt = new Date().toISOString();
      const reportFile = await writeReport(report);
      if (report.status === 'failed') process.exitCode = 1;
      console.log(`Report (${report.status}, ${report.runId}): ${reportFile}`);
    } finally {
      suiteRuntime?.stop();
      if (page) navigationObservers.get(page)?.stop();
      await browser?.close();
    }
  }
}

main().catch((error) => {
  console.error(`verify:docsme failed: ${error.message}`);
  process.exit(1);
});
