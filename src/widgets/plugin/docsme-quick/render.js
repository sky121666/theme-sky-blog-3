import { buildWidgetPjaxLink } from '../../shared/link.js';

function toCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function normalizeProject(project = {}) {
  const spec = project.spec || {};
  const status = project.status || {};
  const metadata = project.metadata || {};
  const title = String(spec.displayName || metadata.name || '文档项目').trim();
  const href = String(status.permalink || '').trim();
  const totalDocs = toCount(status.totalDocs);

  return {
    title,
    description: String(spec.description || '').trim(),
    icon: String(spec.icon || '').trim(),
    href,
    totalDocs,
    disabled: totalDocs <= 0 || !href
  };
}

function renderProjectIcon(escapeHtml, project, className = '') {
  if (project?.icon) {
    return `
      <span class="wg-docsme-icon ${className}">
        <img src="${escapeHtml(project.icon)}" alt="${escapeHtml(project.title)}" loading="lazy">
      </span>
    `;
  }

  return `
    <span class="wg-docsme-icon ${className} is-fallback" aria-hidden="true">
      <span class="icon-[lucide--book]"></span>
    </span>
  `;
}

function renderUnavailable(escapeHtml) {
  return `
    <div class="wg-docsme wg-docsme--empty">
      <span class="wg-docsme-icon wg-docsme-icon--error" aria-hidden="true">
        <span class="icon-[lucide--alert-triangle]"></span>
      </span>
      <strong>${escapeHtml('Docsme 不可用')}</strong>
      <span>${escapeHtml('需要 Docsme 1.4.0+ 才能展示文档项目。')}</span>
    </div>
  `;
}

function renderNoProjects(escapeHtml, href, mode, size) {
  return buildWidgetPjaxLink({
    href,
    app: 'docsme',
    className: `wg-docsme wg-docsme--${size} wg-docsme--empty-projects`,
    attrs: `aria-label="${escapeHtml('打开文档中心')}"`,
    disabled: mode === 'preview',
    innerHtml: `
      <span class="wg-docsme-header">
        <span>
          <strong>${escapeHtml('文档中心')}</strong>
          <em>${escapeHtml('Documentation')}</em>
        </span>
        <span class="wg-docsme-open" aria-hidden="true">
          <span class="icon-[lucide--arrow-up-right]"></span>
        </span>
      </span>
      <span class="wg-docsme-empty-content">
        <span class="wg-docsme-empty-icon-wrap" aria-hidden="true">
          <span class="icon-[lucide--book-open]"></span>
        </span>
        <span class="wg-docsme-empty-text">${escapeHtml('暂无可展示的文档项目')}</span>
      </span>
    `
  });
}

/* Redesigned horizontal list row project item */
function renderProjectRowLink({ escapeHtml, mode }, project) {
  const descHtml = project.description
    ? `<span class="wg-docsme-row-desc">${escapeHtml(project.description)}</span>`
    : '';

  const content = `
    <span class="wg-docsme-row-indicator" aria-hidden="true"></span>
    ${renderProjectIcon(escapeHtml, project, 'wg-docsme-icon--row')}
    <span class="wg-docsme-row-body">
      <strong class="wg-docsme-row-title">${escapeHtml(project.title)}</strong>
      ${descHtml}
    </span>
    <span class="wg-docsme-row-side">
      <span class="wg-docsme-doc-pill">
        <span class="icon-[lucide--file-text]" aria-hidden="true"></span>
        <span>${project.totalDocs}</span>
      </span>
      <span class="icon-[lucide--chevron-right] wg-docsme-row-arrow" aria-hidden="true"></span>
    </span>
  `;

  if (project.disabled || mode === 'preview') {
    return `<span class="wg-docsme-row-item is-disabled">${content}</span>`;
  }

  return buildWidgetPjaxLink({
    href: escapeHtml(project.href),
    app: 'docsme',
    className: 'wg-docsme-row-item',
    attrs: `aria-label="${escapeHtml(`打开${project.title}`)}"`,
    innerHtml: content
  });
}

/* Redesigned clean horizontal list placeholder */
function renderRowPlaceholder(escapeHtml) {
  return `
    <div class="wg-docsme-row-item wg-docsme-row-item--placeholder" aria-hidden="true">
      <span class="icon-[lucide--folder-plus] wg-docsme-placeholder-plus"></span>
      <span>${escapeHtml('添加项目以展示')}</span>
    </div>
  `;
}

function pickDesignatedProject(projects, projectTitle) {
  if (projectTitle) {
    const found = projects.find(p => p.title === projectTitle);
    if (found) return found;
  }
  return projects.find((project) => !project.disabled) || projects[0] || null;
}

/* Redesigned Small Dashboard widget (2x2) */
function renderSmall(context, widget, href, projects, totalDocs) {
  const { escapeHtml, mode } = context;
  const projectTitle = widget?.meta?.projectTitle || '';
  const primary = pickDesignatedProject(projects, projectTitle);
  const targetHref = primary && !primary.disabled ? escapeHtml(primary.href) : href;
  const title = primary?.title || '文档中心';
  const progressPercent = primary ? Math.min(100, Math.max(12, (primary.totalDocs / Math.max(1, totalDocs)) * 100)) : 0;

  const sublineHtml = primary 
    ? `<span class="icon-[lucide--file-text]" aria-hidden="true"></span> ${primary.totalDocs} Docs`
    : 'Documentation';

  return buildWidgetPjaxLink({
    href: targetHref,
    app: 'docsme',
    className: `wg-docsme wg-docsme--small${primary?.disabled ? ' is-disabled' : ''}`,
    attrs: `aria-label="${escapeHtml(`打开${title}`)}"`,
    disabled: mode === 'preview' || primary?.disabled,
    innerHtml: `
      <span class="wg-docsme-small-top">
        ${primary ? renderProjectIcon(escapeHtml, primary, 'wg-docsme-icon--small') : `<span class="wg-docsme-icon wg-docsme-icon--small"><span class="icon-[lucide--book-open]"></span></span>`}
        <span class="wg-docsme-capsule" aria-hidden="true">
          <span class="icon-[lucide--bookmark]"></span>
        </span>
      </span>
      <span class="wg-docsme-small-copy">
        <strong>${escapeHtml(title)}</strong>
        <em>${sublineHtml}</em>
      </span>
      <span class="wg-docsme-small-foot">
        <span class="wg-docsme-progress-track">
          <span class="wg-docsme-progress-bar" style="width: ${progressPercent}%"></span>
        </span>
      </span>
    `
  });
}

/* Redesigned Medium List widget (2x4) */
function renderMedium(context, href, projects, totalDocs) {
  const { escapeHtml, mode } = context;

  const displayProjects = projects.slice(0, 2);
  const rowsHtml = [];
  displayProjects.forEach((project) => {
    rowsHtml.push(renderProjectRowLink(context, project));
  });
  while (rowsHtml.length < 2) {
    rowsHtml.push(renderRowPlaceholder(escapeHtml));
  }

  return `
    <div class="wg-docsme wg-docsme--medium wg-docsme-list-view">
      <span class="wg-docsme-header">
        <span class="wg-docsme-header-left">
          <span class="wg-docsme-header-icon" aria-hidden="true"><span class="icon-[lucide--book-open]"></span></span>
          <strong>${escapeHtml('文档中心')}</strong>
          <span class="wg-docsme-header-stats-pill" aria-label="${escapeHtml(`${projects.length}个项目`)}">
            <span class="icon-[lucide--layers]" aria-hidden="true"></span>
            <span>${projects.length}</span>
          </span>
        </span>
        ${buildWidgetPjaxLink({
          href,
          app: 'docsme',
          className: 'wg-docsme-open',
          attrs: `aria-label="${escapeHtml('查看全部文档项目')}"`,
          disabled: mode === 'preview',
          innerHtml: '<span class="icon-[lucide--arrow-up-right]" aria-hidden="true"></span>'
        })}
      </span>
      <div class="wg-docsme-list-stack">
        ${rowsHtml.join('')}
      </div>
    </div>
  `;
}

/* Redesigned Large List widget (4x4) */
function renderLarge(context, href, projects, totalDocs) {
  const { escapeHtml, mode } = context;

  const displayProjects = projects.slice(0, 4);
  const rowsHtml = [];
  displayProjects.forEach((project) => {
    rowsHtml.push(renderProjectRowLink(context, project));
  });
  while (rowsHtml.length < 4) {
    rowsHtml.push(renderRowPlaceholder(escapeHtml));
  }

  return `
    <div class="wg-docsme wg-docsme--large wg-docsme-list-view">
      <span class="wg-docsme-header">
        <span class="wg-docsme-header-left">
          <span class="wg-docsme-header-icon" aria-hidden="true"><span class="icon-[lucide--library]"></span></span>
          <strong>${escapeHtml('文档中心')}</strong>
        </span>
        ${buildWidgetPjaxLink({
          href,
          app: 'docsme',
          className: 'wg-docsme-view-all',
          attrs: `aria-label="${escapeHtml('查看全部文档项目')}"`,
          disabled: mode === 'preview',
          innerHtml: `查看全部 <span class="icon-[lucide--chevron-right] wg-docsme-view-all-arrow" aria-hidden="true"></span>`
        })}
      </span>

      <div class="wg-docsme-list-stack">
        ${rowsHtml.join('')}
      </div>

      <span class="wg-docsme-footer">
        <span><span class="icon-[lucide--layers]" aria-hidden="true"></span> ${projects.length} Projects</span>
        <span><span class="icon-[lucide--file-text]" aria-hidden="true"></span> ${totalDocs} Docs</span>
      </span>
    </div>
  `;
}

export function renderWidget(context, widget) {
  const { sources, escapeHtml, mode } = context;
  if (!sources.docsmeAvailable) {
    return renderUnavailable(escapeHtml);
  }

  const size = widget?.size || 'medium';
  const href = escapeHtml(sources.docsmeUrl || '/docs');
  const projects = Array.isArray(sources.docsmeProjects)
    ? sources.docsmeProjects.map(normalizeProject).filter((project) => project.title)
    : [];
  const totalDocs = projects.reduce((sum, project) => sum + project.totalDocs, 0);

  if (!projects.length) {
    return renderNoProjects(escapeHtml, href, mode, size === 'large' ? 'large' : size);
  }

  if (size === 'large') return renderLarge(context, href, projects, totalDocs);
  if (size === 'medium') return renderMedium(context, href, projects, totalDocs);
  return renderSmall(context, widget, href, projects, totalDocs);
}
