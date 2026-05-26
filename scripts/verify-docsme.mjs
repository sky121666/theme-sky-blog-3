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
const sampleDocPath = 'docs/测试样本数据.md';

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
  return new URL(target, `${baseUrl}/`).toString();
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
        path: `${window.location.pathname}${window.location.search}`,
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
    await page.waitForTimeout(900);
    const result = await page.evaluate(() => {
      const root = document.querySelector('[data-app-root="docsme"]');
      const article = document.querySelector('.docsme-article');
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
        rawPreCode: article ? article.querySelectorAll('pre code, pre, code').length : 0,
        renderScripts: Array.from(document.querySelectorAll('script[data-pjax]'))
          .filter((script) => script.textContent.includes('renderCodeBlock')).length,
        replayScripts: document.querySelectorAll('script[data-theme-shiki-replay]').length,
        katex: document.querySelectorAll('.katex, [math-inline], [math-display]').length,
        mermaid: document.querySelectorAll('text-diagram[data-type="mermaid"], .mermaid').length,
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
      katex: result.katex ?? 0,
      articleTextLength: result.articleTextLength ?? 0,
      consoleErrors: result.consoleErrors || [],
      hint: '若 KaTeX 失败，检查公式语法、Docsme 插件输出和数学渲染插件资源是否加载。'
    };
  }
  if (check.name === 'mermaid-sample') {
    return {
      path: check.path || '',
      mermaid: result.mermaid ?? 0,
      articleTextLength: result.articleTextLength ?? 0,
      consoleErrors: result.consoleErrors || [],
      hint: '若 Mermaid 失败，检查 fenced code 语言是否为 mermaid、图表插件 DOM 和 PJAX 后重绘。'
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const report = {
    baseUrl,
    checks: []
  };
  const failures = [];

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

  const codePath = explicitCodePath || chooseSample(candidateDocs, inspections, (result) => result.shikiCode > 0 || result.rawPreCode > 0 || result.renderScripts > 0);
  if (codePath) {
    const result = inspections.get(codePath) || await inspectDocsPage(page, codePath);
    const checkFailures = assertDocsProtocol(result, 'code sample');
    if (result.shikiCode === 0 && result.rawPreCode === 0 && result.renderScripts === 0) {
      checkFailures.push('code sample: no code-related DOM or Shiki render script detected');
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

  const katexPath = explicitKatexPath || chooseSample(candidateDocs, inspections, (result) => result.katex > 0);
  if (katexPath) {
    const result = inspections.get(katexPath) || await inspectDocsPage(page, katexPath);
    const checkFailures = assertDocsProtocol(result, 'katex sample');
    if (result.katex === 0) checkFailures.push('katex sample: no KaTeX DOM detected');
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

  const mermaidPath = explicitMermaidPath || chooseSample(candidateDocs, inspections, (result) => result.mermaid > 0);
  if (mermaidPath) {
    const result = inspections.get(mermaidPath) || await inspectDocsPage(page, mermaidPath);
    const checkFailures = assertDocsProtocol(result, 'mermaid sample');
    if (result.mermaid === 0) checkFailures.push('mermaid sample: no Mermaid DOM detected');
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
  } else {
    report.checks.push(skippedCheck('mermaid-sample', 'No Docsme document with Mermaid content was found.'));
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
