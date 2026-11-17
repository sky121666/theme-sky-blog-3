import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The guest SSR deliberately omits the panel. These write-isolated UI
// tests simulate a signed-in user. Assemble the same static controls from the
// theme, never a copy of an administrator's page or session. Fail closed if a
// pane starts depending on any new server-side expression.
const shell = new URL('../../templates/modules/shell/', import.meta.url);
const include = /<th:block\s+th:replace="~\{modules\/shell\/([a-z/-]+) :: [a-z-]+\}"\s*(?:\/>|><\/th:block>)/g;
async function expand(source, base) {
  let result = '';
  let end = 0;
  for (const match of source.matchAll(include)) {
    result += source.slice(end, match.index) + await expand(await fs.readFile(new URL(match[1] + '.html', shell), 'utf8'), base);
    end = match.index + match[0].length;
  }
  return (result + source.slice(end)).replace(/<\/?th:block\b[^>]*>/g, '')
    .replace(/\s+(?:xmlns:th|th:fragment)="[^"]*"/g, '')
    .replace(/th:src="\$\{#theme\.assets\('(\/images\/[a-z0-9/.-]+)'\)\}"/g, (_, path) => `src="${base}${path}"`);
}

export async function signedInSettingsFixture(html) {
  const protocol = /<span\b[^>]*\bdata-theme-settings-protocol\b[^>]*>[\s\S]*?<\/span>/g;
  assert.equal([...html.matchAll(protocol)].length, 1, 'the served document must provide one settings protocol');
  const authenticated = html.replace(protocol, tag => {
    assert.match(tag, /\bdata-authenticated="/);
    return tag.replace(/\bdata-authenticated="[^"]*"/, 'data-authenticated="true"');
  });
  if (authenticated.includes('class="theme-settings-layer"')) return authenticated;
  const base = html.match(/(?:src|href)="([^"?]*\/themes\/[^/"]+\/assets)\//)?.[1];
  assert.ok(base, 'theme asset URL missing from served document');
  const template = await fs.readFile(new URL('theme-settings.html', shell), 'utf8');
  const start = template.indexOf('<div th:if="${authenticated}" class="theme-settings-layer"');
  assert.notEqual(start, -1, 'settings guest/auth visibility contract changed');
  const panel = await expand(template.slice(start).replace('th:if="${authenticated}" ', ''), base);
  assert.doesNotMatch(panel, /\bth:[\w-]+=|<\/?th:/, 'use an authenticated SSR snapshot when the fixture cannot render a dynamic control');
  return authenticated.replace(protocol, tag => tag + panel);
}
