function normalizeTitlePart(value) {
  return String(value ?? '').trim();
}

export function stripSteamSiteTitleSuffix(value, siteTitle) {
  let title = normalizeTitlePart(value);
  const site = normalizeTitlePart(siteTitle);
  if (!title || !site) return title;

  const suffix = ` - ${site}`;
  while (title.endsWith(suffix)) {
    title = title.slice(0, -suffix.length).trimEnd();
  }
  return title;
}
