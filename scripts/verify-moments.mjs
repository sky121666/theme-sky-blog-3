import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'playwright');
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const explicitCodePath = (process.env.MOMENTS_CODE_SAMPLE_PATH || '').trim();
const explicitCommentPath = (process.env.MOMENTS_COMMENT_SAMPLE_PATH || '').trim();
const sampleDocPath = 'docs/测试样本数据.md';

const SAMPLE_GUIDES = {
  'code-sample': {
    env: 'MOMENTS_CODE_SAMPLE_PATH',
    target: '创建一条带 fenced code block 的 Moments 瞬间',
    command: 'MOMENTS_CODE_SAMPLE_PATH=/moments/<moment-name> pnpm run verify:moments',
    hint: `样本内容见 ${sampleDocPath} 的「Moments 代码块样本」。`
  },
  'comment-sample': {
    env: 'MOMENTS_COMMENT_SAMPLE_PATH',
    target: '选择一条已有已审核评论的 Moments 详情页',
    command: 'MOMENTS_COMMENT_SAMPLE_PATH=/moments/<moment-name> pnpm run verify:moments',
    hint: '如果后台已有已审核评论，通常脚本会自动发现；否则指定详情路径。'
  }
};

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
}

function isCodeLike(content = {}) {
  const html = String(content.html || '');
  return /<shiki-code\b/i.test(html)
    || /<pre\b[^>]*>[\s\S]*?<code\b/i.test(html);
}

async function fetchJson(target) {
  const response = await fetch(absoluteUrl(target), {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`${target} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function discoverMoments() {
  const data = await fetchJson('/apis/api.moment.halo.run/v1alpha1/moments?page=1&size=100');
  return Array.isArray(data.items) ? data.items : [];
}

async function inspectApiContract(moments) {
  const failures = [];
  if (!Array.isArray(moments)) {
    failures.push('api contract: moments list is not an array');
    return { status: 'failed', failures };
  }

  const first = moments[0];
  if (!first) {
    failures.push('api contract: moments list is empty');
    return { status: 'failed', failures };
  }

  if (!first.metadata?.name) failures.push('api contract: missing metadata.name');
  if (!first.spec?.content) failures.push('api contract: missing spec.content');
  if (!first.stats) failures.push('api contract: missing stats');
  if (first.stats && !Object.hasOwn(first.stats, 'approvedComment')) failures.push('api contract: missing stats.approvedComment');
  if (first.stats && !Object.hasOwn(first.stats, 'totalComment')) failures.push('api contract: missing stats.totalComment');
  if (first.stats && !Object.hasOwn(first.stats, 'upvote')) failures.push('api contract: missing stats.upvote');

  const detailPath = `/apis/api.moment.halo.run/v1alpha1/moments/${encodeURIComponent(first.metadata.name)}`;
  const detail = await fetchJson(detailPath);
  if (detail.metadata?.name !== first.metadata.name) {
    failures.push(`api contract: detail name mismatch for ${first.metadata.name}`);
  }
  if (!detail.spec?.content) failures.push('api contract: detail missing spec.content');
  if (!detail.stats) failures.push('api contract: detail missing stats');

  return {
    status: failures.length ? 'failed' : 'passed',
    path: '/apis/api.moment.halo.run/v1alpha1/moments',
    detailPath,
    sample: sampleMeta(detail),
    listCount: moments.length,
    failures
  };
}

function toMomentPath(moment) {
  const name = moment?.metadata?.name;
  return name ? `/moments/${encodeURIComponent(name)}` : '';
}

function findMomentByPath(moments, pathname) {
  if (!pathname) return null;
  let normalized = '';
  try {
    normalized = new URL(pathname, `${baseUrl}/`).pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
  return moments.find((moment) => toMomentPath(moment).replace(/\/$/, '') === normalized) || null;
}

function sampleMeta(moment) {
  if (!moment) return null;
  return {
    name: moment.metadata?.name || '',
    title: moment.spec?.content?.raw?.slice(0, 80) || moment.spec?.content?.html?.replace(/<[^>]*>/g, '').slice(0, 80) || '',
    stats: moment.stats || {}
  };
}

function codeContentStats(moment) {
  const content = moment?.spec?.content || {};
  const value = `${content.html || ''}\n${content.raw || ''}`;
  return {
    rawLength: String(content.raw || '').length,
    htmlLength: String(content.html || '').length,
    hasFence: /```/.test(value),
    hasPreOrCode: /<shiki-code\b/i.test(value)
      || /<pre\b[^>]*>[\s\S]*?<code\b/i.test(value),
    hasLanguageMarker: /data-language=|language-/.test(value)
  };
}

async function clickMomentLink(page, pathname) {
  const normalizedPathname = new URL(pathname, `${baseUrl}/`).pathname;
  const clicked = await page.evaluate((targetPathname) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const target = anchors.find((anchor) => {
      try {
        return new URL(anchor.getAttribute('href'), window.location.href).pathname === targetPathname;
      } catch {
        return false;
      }
    });
    if (!target) return false;
    target.click();
    return true;
  }, normalizedPathname);

  if (!clicked) return false;
  await page.waitForFunction(
    (targetPathname) => window.location.pathname === targetPathname,
    normalizedPathname,
    { timeout: 5000 }
  );
  return true;
}

async function inspectPage(pathname) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(absoluteUrl('/moments'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const usedPjax = await clickMomentLink(page, pathname);
  if (!usedPjax) {
    await page.goto(absoluteUrl(pathname), { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(600);
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-moment-card][data-moment-detail-comments]');
    if (!card || Number(card.dataset.commentCount || 0) <= 0) return true;
    const panel = card.querySelector('[data-moment-comments-panel]');
    return !panel?.classList.contains('is-loading');
  }, null, { timeout: 5000 }).catch(() => {});

  const result = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    mode: document.body.dataset.pageMode || '',
    appId: document.body.dataset.appId || '',
    windowVariant: document.body.dataset.windowVariant || '',
    detailRoot: Boolean(document.querySelector('.moments-app--detail')),
    shikiCode: document.querySelectorAll('shiki-code').length,
    rawPreCode: document.querySelectorAll('pre > code').length,
    renderScripts: Array.from(document.querySelectorAll('script[data-pjax]'))
      .filter((script) => script.textContent.includes('renderCodeBlock')).length,
    replayScripts: document.querySelectorAll('script[data-theme-shiki-replay]').length,
    commentWidget: document.querySelectorAll('comment-widget, .halo-comment-widget').length,
    commentShell: Boolean(document.querySelector('.moment-comments-shell')),
    visibleCommentText: document.body.innerText.includes('评论'),
    renderedCommentCount: document.querySelectorAll('[data-moment-comment]').length,
    commentsLoading: Boolean(document.querySelector('[data-moment-comments-panel].is-loading')),
    commentStatus: document.querySelector('[data-moment-comments-status]')?.textContent?.trim() || ''
  }));

  await browser.close();
  return { ...result, usedPjax, consoleErrors };
}

async function writeReport(report) {
  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, 'moments-report.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

function assertMomentPage(result, label) {
  const failures = [];
  if (result.mode !== 'browser-moments') failures.push(`${label}: pageMode=${result.mode}`);
  if (result.appId !== 'moments') failures.push(`${label}: appId=${result.appId}`);
  if (result.windowVariant !== 'moments') failures.push(`${label}: windowVariant=${result.windowVariant}`);
  if (!result.detailRoot) failures.push(`${label}: missing .moments-app--detail`);
  if (result.replayScripts !== 0) failures.push(`${label}: replay script leaked`);
  return failures;
}

function diagnosticsForCheck(check) {
  if (!check) return {};
  if (check.name === 'api-contract') {
    return {
      listCount: check.listCount || 0,
      detailPath: check.detailPath || '',
      hint: '若 API 契约失败，先检查 plugin-moments 是否启用、公开 API 是否返回 JSON、stats 字段是否存在。'
    };
  }
  if (check.name === 'code-sample') {
    return {
      path: check.path || '',
      usedPjax: Boolean(check.result?.usedPjax),
      shikiCode: check.result?.shikiCode ?? 0,
      rawPreCode: check.result?.rawPreCode ?? 0,
      renderScripts: check.result?.renderScripts ?? 0,
      replayScripts: check.result?.replayScripts ?? 0,
      consoleErrors: check.result?.consoleErrors || [],
      hint: '若代码块失败，检查 moment.spec.content.html 是否包含 pre/code，PJAX 后 Shiki replay 是否执行且未残留 replay script。'
    };
  }
  if (check.name === 'comment-sample') {
    return {
      path: check.path || '',
      usedPjax: Boolean(check.result?.usedPjax),
      commentShell: Boolean(check.result?.commentShell),
      commentWidget: check.result?.commentWidget ?? 0,
      visibleCommentText: Boolean(check.result?.visibleCommentText),
      renderedCommentCount: check.result?.renderedCommentCount ?? 0,
      commentsLoading: Boolean(check.result?.commentsLoading),
      commentStatus: check.result?.commentStatus || '',
      expectedApprovedComment: check.expectedApprovedComment || null,
      hint: '若评论失败，检查 moment-comments-shell、comment-widget 资源和 Moments 评论 subject。'
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
  const skipped = checks.filter((check) => check.status === 'skipped');
  const failed = checks.filter((check) => check.status === 'failed');

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
  const moments = await discoverMoments();
  const codeMoment = explicitCodePath
    ? findMomentByPath(moments, explicitCodePath)
    : moments.find((moment) => isCodeLike(moment.spec?.content));
  const commentMoment = explicitCommentPath
    ? findMomentByPath(moments, explicitCommentPath)
    : moments.find((moment) => Number(moment.stats?.approvedComment ?? 0) > 0);

  const codePath = explicitCodePath || toMomentPath(codeMoment);
  const commentPath = explicitCommentPath || toMomentPath(commentMoment);
  const report = {
    baseUrl,
    totalMoments: moments.length,
    discovery: {
      codeCandidates: moments
        .filter((moment) => isCodeLike(moment.spec?.content))
        .slice(0, 5)
        .map((moment) => ({
          path: toMomentPath(moment),
          sample: sampleMeta(moment),
          content: codeContentStats(moment)
        })),
      commentCandidates: moments
        .filter((moment) => Number(moment.stats?.approvedComment ?? 0) > 0)
        .slice(0, 5)
        .map((moment) => ({
          path: toMomentPath(moment),
          sample: sampleMeta(moment)
        }))
    },
    checks: []
  };
  const failures = [];
  const apiCheck = await inspectApiContract(moments);
  failures.push(...apiCheck.failures);
  report.checks.push({ name: 'api-contract', ...apiCheck, diagnostics: diagnosticsForCheck({ name: 'api-contract', ...apiCheck }) });

  if (codePath) {
    const result = await inspectPage(codePath);
    const checkFailures = assertMomentPage(result, 'code sample');
    if (result.shikiCode === 0 && result.rawPreCode === 0) {
      checkFailures.push('code sample: no rendered Shiki host or pre > code block detected');
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'code-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: codePath,
      sample: sampleMeta(codeMoment),
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
    report.checks.push(skippedCheck('code-sample', 'No Moments content with code block was found.'));
  }

  if (commentPath) {
    const result = await inspectPage(commentPath);
    const checkFailures = assertMomentPage(result, 'comment sample');
    const expectedApprovedComment = Number(commentMoment?.stats?.approvedComment ?? 0) || null;
    if (!result.commentShell) {
      checkFailures.push('comment sample: missing comment shell');
    }
    if (result.commentsLoading) {
      checkFailures.push('comment sample: comments remained in loading state');
    }
    if (expectedApprovedComment && result.renderedCommentCount === 0) {
      checkFailures.push(`comment sample: expected ${expectedApprovedComment} approved comments but rendered none`);
    } else if (expectedApprovedComment && result.renderedCommentCount < Math.min(expectedApprovedComment, 10)) {
      checkFailures.push(`comment sample: rendered ${result.renderedCommentCount}, expected at least ${Math.min(expectedApprovedComment, 10)}`);
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'comment-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: commentPath,
      sample: sampleMeta(commentMoment),
      expectedApprovedComment,
      result,
      failures: checkFailures,
      diagnostics: diagnosticsForCheck({
        name: 'comment-sample',
        path: commentPath,
        expectedApprovedComment,
        result,
        failures: checkFailures
      })
    });
  } else {
    report.checks.push(skippedCheck('comment-sample', 'No Moments item with approved comments was found.'));
  }

  const reportFile = await writeReport(report);
  if (failures.length > 0) {
    console.error('Moments verification failed:');
    printCheckHints(report.checks);
    console.error(`Report: ${reportFile}`);
    process.exit(1);
  }

  const skipped = report.checks.filter((check) => check.status === 'skipped');
  const passed = report.checks.filter((check) => check.status === 'passed');
  console.log(`Moments verification completed: ${passed.length} passed, ${skipped.length} skipped`);
  printCheckHints(report.checks);
  console.log(`Report: ${reportFile}`);
}

main().catch((error) => {
  console.error(`verify:moments failed: ${error.message}`);
  process.exit(1);
});
