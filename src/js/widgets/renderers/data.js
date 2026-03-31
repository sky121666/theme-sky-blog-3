/**
 * widgets/renderers/data.js
 * 数据处理与选择函数（分类、标签、作者信息）
 */

// ── Category ──────────────────────────────────────────────

function extractCategoryCount(category) {
  return Number(
    category?.postCount
    ?? category?.status?.postCount
    ?? category?.status?.visiblePostCount
    ?? 0
  ) || 0;
}

export function flattenCategoryTree(nodes, depth = 0, bucket = []) {
  if (!Array.isArray(nodes)) return bucket;

  nodes.forEach((node) => {
    if (!node) return;
    bucket.push({
      key: node?.metadata?.name || `category-${bucket.length + 1}`,
      name: node?.spec?.displayName || node?.metadata?.name || '分类',
      permalink: node?.status?.permalink || '#',
      description: node?.spec?.description || '',
      cover: node?.spec?.cover || '',
      count: extractCategoryCount(node),
      depth
    });

    if (Array.isArray(node.children) && node.children.length) {
      flattenCategoryTree(node.children, depth + 1, bucket);
    }
  });

  return bucket;
}

export function selectTopCategories(nodes, limit) {
  return flattenCategoryTree(nodes)
    .filter((item) => item.permalink !== '#')
    .sort((left, right) => right.count - left.count || left.depth - right.depth || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, Math.max(limit || 0, 1));
}

// ── Author ────────────────────────────────────────────────

function normalizeWidgetOwner(owner, siteProfile = {}) {
  const avatar = owner?.avatar || owner?.spec?.avatar || siteProfile.logo || '';
  const displayName = owner?.displayName || owner?.spec?.displayName || siteProfile.title || '站点作者';
  const summary = owner?.bio || owner?.spec?.bio || siteProfile.subtitle || '持续发布博客内容';
  return {
    displayName,
    summary,
    avatar,
    permalink: owner?.permalink || siteProfile.url || '#'
  };
}

export function resolveDesktopAuthorProfile(sources) {
  const owner = [
    ...(Array.isArray(sources?.latestPosts) ? sources.latestPosts : []),
    ...(Array.isArray(sources?.popularPosts) ? sources.popularPosts : [])
  ].map((post) => post?.owner).find(Boolean);

  const profile = normalizeWidgetOwner(owner, sources?.siteProfile || {});
  const stats = sources?.siteStats || {};

  return {
    ...profile,
    posts: Number(stats?.post ?? (Array.isArray(sources?.latestPosts) ? sources.latestPosts.length : 0) ?? 0) || 0,
    comments: Number(stats?.comment ?? 0) || 0,
    visits: Number(stats?.visit ?? 0) || 0,
    moments: Array.isArray(sources?.recentMoments) ? sources.recentMoments.length : 0
  };
}

// ── Tags ──────────────────────────────────────────────────

function extractTagCount(tag) {
  return Number(tag?.status?.visiblePostCount ?? tag?.status?.postCount ?? tag?.postCount ?? 0) || 0;
}

function normalizeWidgetTag(tag) {
  const count = extractTagCount(tag);
  return {
    name: tag?.spec?.displayName || tag?.metadata?.name || '标签',
    permalink: tag?.status?.permalink || '#',
    count
  };
}

function createSeedFromString(input) {
  let hash = 2166136261;
  const source = String(input || '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function selectDailyRandomTags(tags, limit) {
  const normalized = Array.isArray(tags)
    ? tags.map((tag) => normalizeWidgetTag(tag)).filter((tag) => tag.permalink !== '#' && tag.count > 0)
    : [];

  if (!normalized.length) return [];

  const random = createSeededRandom(createSeedFromString(`${new Date().toISOString().slice(0, 10)}:${limit}`));
  return normalized
    .map((tag) => ({ tag, score: random() + Math.min(tag.count, 40) / 100 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.tag)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'));
}
