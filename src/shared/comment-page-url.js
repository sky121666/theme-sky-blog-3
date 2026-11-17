// CommentWidget 3.5.1 owns this one query parameter. Invalid/ambiguous values
// must not broaden the theme's same-document history or draft ownership.
export function readCommentPageUrl(value, base) {
  try {
    const url = new URL(value, base);
    const values = url.searchParams.getAll('comment-page');
    if (values.length > 1 || (values.length === 1 && !/^[1-9]\d*$/.test(values[0]))) return null;
    const page = values.length ? Number(values[0]) : 1;
    if (!Number.isSafeInteger(page)) return null;
    const href = url.href;
    // The widget itself uses URLSearchParams, which also serializes untouched
    // values (for example %20 becomes +). Compare both sides in that form.
    url.searchParams.delete('comment-page');
    return { href, documentUrl: url.href, page, hasCommentPage: values.length === 1 };
  } catch {
    return null;
  }
}

export function isCommentPageOnlyNavigation(source, target) {
  const from = readCommentPageUrl(source);
  const to = readCommentPageUrl(target);
  return Boolean(from && to && from.href !== to.href
    && (from.hasCommentPage || to.hasCommentPage) && from.documentUrl === to.documentUrl);
}
