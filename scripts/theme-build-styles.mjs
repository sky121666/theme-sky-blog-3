// The same Vite writeBundle pass supplies both this fragment and the manifest.
// Halo's /assets route resolves the active theme, independent of its name.
export function renderBuildStyles(manifest) {
  const { version, revision, query } = manifest?.__meta || {};
  const expected = version && revision
    ? new URLSearchParams({ v: version, r: revision }).toString()
    : '';
  if (!expected || query !== expected) throw new Error('Build styles identity mismatch');

  const stylesheet = (appId, conditional = false) => {
    const css = manifest[appId]?.css;
    if (!Array.isArray(css) || css.length !== 1) throw new Error(`Missing build CSS: ${appId}`);
    const url = String(css[0]);
    const marker = '/assets/';
    const offset = url.indexOf(marker);
    if (offset < 0 || !/^\/assets\/css\/[a-z0-9/-]+\.css$/.test(url.slice(offset))) {
      throw new Error(`Unexpected build CSS: ${appId}`);
    }
    const route = url.slice(offset);
    const href = `@{'${route}?${expected.replaceAll('&', '&amp;')}'}`;
    return conditional
      ? `  <link rel="stylesheet" th:if="\${pageApp == '${appId}'}" data-app-css="${appId}" th:href="${href}" />`
      : `  <link id="shell-core-style" rel="stylesheet" th:href="${href}" />`;
  };

  const apps = Object.keys(manifest).filter((id) => id !== '__meta' && id !== 'shell-core').sort();
  return `<th:block xmlns:th="https://www.thymeleaf.org" th:fragment="styles(pageApp)">\n${[
    stylesheet('shell-core'),
    ...apps.map((id) => stylesheet(id, true))
  ].join('\n')}\n</th:block>\n`;
}
