import assert from 'node:assert/strict';
import './verify-docsme-reporting.mjs';
import './verify-docsme-rich-content-lifecycle.mjs';
import { renderWidget } from '../src/widgets/plugin/docsme-quick/render.js';
import {
  normalizeDocsPath,
  discoverDocsRoutes,
  inspectDocsCandidates,
  missingDocsSampleReason
} from './lib/docsme-sample-discovery.mjs';

const baseUrl = 'http://localhost:8090';
const checks = [];

assert.equal(normalizeDocsPath('/docs/project?version=v2&_docsme_verify=1&language=en#toc', baseUrl), '/docs/project?version=v2&language=en');
assert.notEqual(normalizeDocsPath('/docs/project?language=en', baseUrl), normalizeDocsPath('/docs/project?language=zh', baseUrl));
assert.equal(normalizeDocsPath('https://other.example/docs/project', baseUrl), '');
assert.equal(normalizeDocsPath('http://user:password@localhost:8090/docs/project', baseUrl), '');
assert.equal(normalizeDocsPath('/docs-not-a-route', baseUrl), '');
checks.push('normalize only cache-buster/hash; preserve meaningful queries; reject other origins/credentials/non-docs');

const visits = [];
const discovery = await discoverDocsRoutes({
  baseUrl,
  visit: async (pathname) => {
    visits.push(pathname);
    const links = pathname === '/docs'
      ? ['/docs?_docsme_verify=1', '/docs/project?_docsme_verify=2', '/docs/project?_docsme_verify=3', 'https://other.example/docs/external']
      : ['/docs/project?_docsme_verify=4#heading', '/docs/project?language=en&_docsme_verify=5'];
    return { status: 200, path: `${pathname}${pathname.includes('?') ? '&' : '?'}_docsme_verify=6`, scene: pathname === '/docs' ? 'projects' : 'document', links };
  }
});
assert.deepEqual(visits, ['/docs', '/docs/project', '/docs/project?language=en']);
assert.deepEqual(discovery.documents, ['/docs/project', '/docs/project?language=en']);
assert.equal(discovery.truncated, false);
checks.push('changing cache-busters cannot consume the route budget or duplicate documents');

const bounded = await discoverDocsRoutes({ baseUrl, limit: 2, visit: async (pathname) => ({
  status: 200, path: pathname, scene: 'document', links: ['/docs/a', '/docs/b', '/docs/c']
}) });
assert.deepEqual(bounded.visited, ['/docs', '/docs/a']);
assert.deepEqual(bounded.remaining, ['/docs/b', '/docs/c']);
assert.equal(bounded.truncated, true);
checks.push('route limit exposes pending routes rather than implying complete coverage');

const failed = await discoverDocsRoutes({ baseUrl, visit: async (pathname) => {
  if (pathname === '/docs/broken') throw new Error('navigation timeout');
  if (pathname === '/docs/123') return { status: 404 };
  return { path: pathname, status: 200, links: ['/docs/broken', '/docs/123'] };
} });
assert.deepEqual(failed.navigationErrors, [{ path: '/docs/broken', message: 'navigation timeout' }]);
assert.deepEqual(failed.responses.at(-1), { path: '/docs/123', status: 404 });
assert.equal(failed.documents.length, 0);
checks.push('navigation exceptions and HTTP errors remain evidence, not accepted documents');

const candidates = Array.from({ length: 20 }, (_, index) => `/docs/project/doc-${index + 1}`);
const sample = await inspectDocsCandidates(candidates, async (pathname) => ({
  katexSource: pathname === candidates[17] ? 1 : 0,
  mermaidSource: pathname === candidates[18] ? 1 : 0
}));
assert.equal(sample.inspections.size, 20);
assert.equal(sample.inspections.get(candidates[17]).katexSource, 1);
assert.equal(sample.inspections.get(candidates[18]).mermaidSource, 1);
assert.equal(sample.summary.truncated, false);
checks.push('realistic tail samples beyond the former first 12 candidates are inspected');

const limitedSamples = await inspectDocsCandidates(candidates, async () => ({}), 3);
assert.equal(limitedSamples.inspections.size, 3);
assert.equal(limitedSamples.summary.remaining.length, 17);
const reason = missingDocsSampleReason('KaTeX content', bounded, limitedSamples.summary);
assert.match(reason, /3\/20/);
assert.match(reason, /2 queued routes and 17 documents uninspected/);
assert.match(reason, /does not establish that the site has no matching content/);
checks.push('bounded no-match message includes observed/uninspected counts and cannot assert site-wide absence');

const widgetCases = [];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
for (const size of ['small', 'medium', 'large']) {
  for (const sample of [
    { name: 'catalog-only', totalDocs: 0, permalink: '/docs/catalog-only', mode: 'desktop', navigable: true },
    { name: 'no-link', totalDocs: 0, permalink: '', mode: 'desktop', navigable: false },
    { name: 'with-docs', totalDocs: 5, permalink: '/docs/with-docs', mode: 'desktop', navigable: true },
    { name: 'preview', totalDocs: 0, permalink: '/docs/catalog-only', mode: 'preview', navigable: false }
  ]) {
    const html = renderWidget({
      sources: { docsmeAvailable: true, docsmeUrl: '/docs', docsmeProjects: [{
        metadata: { name: sample.name }, spec: { displayName: sample.name },
        status: { totalDocs: sample.totalDocs, permalink: sample.permalink }
      }] },
      escapeHtml,
      mode: sample.mode
    }, { size });
    const links = [...html.matchAll(/<a\b([^>]*)>/g)].map((match) => ({
      href: match[1].match(/\bhref="([^"]*)"/)?.[1],
      app: match[1].match(/\bdata-pjax-app="([^"]*)"/)?.[1]
    }));
    assert.equal(links.some((link) => link.href === sample.permalink && link.app === 'docsme'), sample.navigable, `${size}: ${sample.name}`);
    assert.ok(html.includes(sample.name), `${size}: ${sample.name} remains readable`);
    if (sample.totalDocs === 0) assert.match(html, /0 Docs|<span>0<\/span>/);
    widgetCases.push({ size, case: sample.name, status: 'passed' });
  }
}
checks.push('3 widget sizes preserve zero-document catalog navigation, missing-link fallback and preview isolation');

const mixedProjects = [
  { spec: { displayName: 'catalog-only' }, status: { totalDocs: 0, permalink: '/docs/catalog-only' } },
  { spec: { displayName: 'with-docs' }, status: { totalDocs: 19, permalink: '/docs/with-docs' } }
];
for (const [projectTitle, expectedHref] of [['', '/docs/with-docs'], ['catalog-only', '/docs/catalog-only']]) {
  const html = renderWidget({
    sources: { docsmeAvailable: true, docsmeProjects: mixedProjects }, escapeHtml, mode: 'desktop'
  }, { size: 'small', meta: { projectTitle } });
  assert.equal(html.match(/<a\b[^>]*href="([^"]*)"/)?.[1], expectedHref);
  widgetCases.push({ size: 'small', case: projectTitle ? 'explicit-zero-docs-selection' : 'prefer-positive-docs-default', status: 'passed' });
}
checks.push('small default prefers a project with documents; explicit catalog-only selection is preserved');

console.log(JSON.stringify({ status: 'passed', checks, widgetCases }, null, 2));
