import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'playwright');
const baseUrl = (process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const explicitCodePath = (process.env.MOMENTS_CODE_SAMPLE_PATH || '').trim();
const explicitCommentPath = (process.env.MOMENTS_COMMENT_SAMPLE_PATH || '').trim();

function absoluteUrl(target) {
  return new URL(target, `${baseUrl}/`).toString();
}

function isCodeLike(content = {}) {
  const value = `${content.html || ''}\n${content.raw || ''}`;
  return /<(pre|code|shiki-code)\b/i.test(value)
    || /```/.test(value)
    || /data-language=|language-/.test(value);
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

function sampleMeta(moment) {
  if (!moment) return null;
  return {
    name: moment.metadata?.name || '',
    title: moment.spec?.content?.raw?.slice(0, 80) || moment.spec?.content?.html?.replace(/<[^>]*>/g, '').slice(0, 80) || '',
    stats: moment.stats || {}
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
  await page.waitForTimeout(1200);

  const result = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    mode: document.body.dataset.pageMode || '',
    appId: document.body.dataset.appId || '',
    windowVariant: document.body.dataset.windowVariant || '',
    detailRoot: Boolean(document.querySelector('.moments-app--detail')),
    shikiCode: document.querySelectorAll('shiki-code').length,
    rawPreCode: document.querySelectorAll('pre code, pre, code').length,
    renderScripts: Array.from(document.querySelectorAll('script[data-pjax]'))
      .filter((script) => script.textContent.includes('renderCodeBlock')).length,
    replayScripts: document.querySelectorAll('script[data-theme-shiki-replay]').length,
    commentWidget: document.querySelectorAll('comment-widget, .halo-comment-widget').length,
    commentShell: Boolean(document.querySelector('.moment-comments-shell')),
    visibleCommentText: document.body.innerText.includes('评论')
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

async function main() {
  const moments = await discoverMoments();
  const codeMoment = explicitCodePath
    ? null
    : moments.find((moment) => isCodeLike(moment.spec?.content));
  const commentMoment = explicitCommentPath
    ? null
    : moments.find((moment) => Number(moment.stats?.approvedComment ?? 0) > 0);

  const codePath = explicitCodePath || toMomentPath(codeMoment);
  const commentPath = explicitCommentPath || toMomentPath(commentMoment);
  const report = {
    baseUrl,
    totalMoments: moments.length,
    checks: []
  };
  const failures = [];
  const apiCheck = await inspectApiContract(moments);
  failures.push(...apiCheck.failures);
  report.checks.push({ name: 'api-contract', ...apiCheck });

  if (codePath) {
    const result = await inspectPage(codePath);
    const checkFailures = assertMomentPage(result, 'code sample');
    if (result.shikiCode === 0 && result.rawPreCode === 0 && result.renderScripts === 0) {
      checkFailures.push('code sample: no code-related DOM or Shiki render script detected');
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'code-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: codePath,
      sample: sampleMeta(codeMoment),
      result,
      failures: checkFailures
    });
  } else {
    report.checks.push({
      name: 'code-sample',
      status: 'skipped',
      reason: 'No Moments content with code block was found. Set MOMENTS_CODE_SAMPLE_PATH after adding one.'
    });
  }

  if (commentPath) {
    const result = await inspectPage(commentPath);
    const checkFailures = assertMomentPage(result, 'comment sample');
    if (!result.commentShell) {
      checkFailures.push('comment sample: missing comment shell');
    }
    failures.push(...checkFailures);
    report.checks.push({
      name: 'comment-sample',
      status: checkFailures.length ? 'failed' : 'passed',
      path: commentPath,
      sample: sampleMeta(commentMoment),
      expectedApprovedComment: Number(commentMoment?.stats?.approvedComment ?? 0) || null,
      result,
      failures: checkFailures
    });
  } else {
    report.checks.push({
      name: 'comment-sample',
      status: 'skipped',
      reason: 'No Moments item with approved comments was found. Set MOMENTS_COMMENT_SAMPLE_PATH after adding one.'
    });
  }

  const reportFile = await writeReport(report);
  if (failures.length > 0) {
    console.error(`Moments verification failed:\n- ${failures.join('\n- ')}\nReport: ${reportFile}`);
    process.exit(1);
  }

  const skipped = report.checks.filter((check) => check.status === 'skipped');
  const passed = report.checks.filter((check) => check.status === 'passed');
  console.log(`Moments verification completed: ${passed.length} passed, ${skipped.length} skipped`);
  skipped.forEach((check) => console.log(`- skipped ${check.name}: ${check.reason}`));
  console.log(`Report: ${reportFile}`);
}

main().catch((error) => {
  console.error(`verify:moments failed: ${error.message}`);
  process.exit(1);
});
