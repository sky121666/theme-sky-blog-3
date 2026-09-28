export const DOCSME_DISCOVERY_LIMIT = 30;
export const DOCSME_INSPECTION_LIMIT = DOCSME_DISCOVERY_LIMIT + 4;

// Ignore only our cache buster. Language/version queries remain distinct routes.
export function normalizeDocsPath(value, baseUrl) {
  try {
    const base = new URL(baseUrl);
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password) return '';
    if (url.pathname !== '/docs' && !url.pathname.startsWith('/docs/')) return '';
    url.searchParams.delete('_docsme_verify');
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

export async function discoverDocsRoutes({ baseUrl, visit, startPath = '/docs', limit = DOCSME_DISCOVERY_LIMIT }) {
  const start = normalizeDocsPath(startPath, baseUrl);
  const queue = start ? [start] : [];
  const visited = new Set();
  const documents = new Set();
  const catalogs = new Set();
  const navigationErrors = [];
  const responses = [];
  while (queue.length && visited.size < limit) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    let snapshot;
    try {
      snapshot = await visit(current);
    } catch (error) {
      navigationErrors.push({ path: current, message: error?.message || String(error) });
      continue;
    }
    responses.push({ path: current, status: snapshot?.status ?? null });
    if (!snapshot || snapshot.status >= 400) continue;
    const canonical = normalizeDocsPath(snapshot.path || current, baseUrl);
    if (canonical && snapshot.scene === 'document') documents.add(canonical);
    if (canonical && snapshot.scene === 'catalog') catalogs.add(canonical);
    for (const link of snapshot.links || []) {
      const next = normalizeDocsPath(link, baseUrl);
      if (next && !visited.has(next) && !queue.includes(next)) queue.push(next);
    }
  }
  return {
    limit,
    visited: [...visited],
    documents: [...documents],
    catalogs: [...catalogs],
    remaining: queue,
    truncated: queue.length > 0,
    navigationErrors,
    responses
  };
}

export async function inspectDocsCandidates(paths, inspect, limit = DOCSME_INSPECTION_LIMIT) {
  const candidates = [...new Set(paths.filter(Boolean))];
  const inspections = new Map();
  for (const candidate of candidates.slice(0, limit)) {
    inspections.set(candidate, await inspect(candidate));
  }
  return {
    inspections,
    summary: {
      limit,
      candidates,
      inspected: [...inspections.keys()],
      remaining: candidates.slice(limit),
      truncated: candidates.length > limit
    }
  };
}

export function missingDocsSampleReason(label, discovery, scan) {
  return `No ${label} observed in ${scan.inspected.length}/${scan.candidates.length} discovered/explicit document candidates inspected; `
    + `route discovery visited ${discovery.visited.length}/${discovery.limit}, with ${discovery.remaining.length} queued routes and ${scan.remaining.length} documents uninspected. `
    + 'This bounded scan does not establish that the site has no matching content.';
}
