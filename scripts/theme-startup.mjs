import { transformSync } from 'esbuild';

export function renderStartupTemplate(controllerSource) {
  const source = controllerSource.replace(/^export /gm, '') + `
    const source = document.currentScript;
    installStartupController(window, document, source.dataset);
  `;
  const { code } = transformSync(source, { minify: true, target: 'es2022', format: 'iife' });
  if (code.includes('</script')) throw new Error('Unexpected closing script in startup controller');
  return `<th:block xmlns:th="https://www.thymeleaf.org" th:fragment="startup(scene)" th:if="\${theme.config.desktop?.startup?.mode == 'boot' and scene != 'none'}">
  <script data-theme-startup data-mode="boot"
    th:data-scene="\${scene}"
    th:data-frequency="\${theme.config.desktop?.startup?.frequency ?: 'tab_once'}"
    th:data-logo-mode="\${theme.config.desktop?.startup?.logo_mode ?: 'apple'}"
    th:data-logo-url="\${theme.config.desktop?.startup?.logo_url ?: ''}"
    th:data-site-logo="\${site.logo != null ? site.logo.toString() : ''}">${code}</script>
</th:block>
`;
}
