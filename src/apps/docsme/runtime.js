import { classifyLinkClick } from '../../shared/navigation-link-policy.js';
import { initializeDocsSwup } from '../../shared/docs-swup-loader.js';
import { openSearchWidget } from '../../shared/search-widget.js';

function getDocsmeRoot(root) {
  return root?.querySelector?.('.docsme-app') || root?.closest?.('.docsme-app') || null;
}

function docsmeWindowWidth(app) {
  return app?.clientWidth || window.innerWidth;
}

const DOCSME_TOC_PIN_KEY = 'docsme-toc-pinned';
const DOCSME_TOC_PIN_MIN_WIDTH = 1080;

function isFloatingDocsmeToc(app) {
  const width = docsmeWindowWidth(app);
  // A fixed column must leave useful reading space beside the document tree.
  // 248px tree + 220px TOC + paper insets still leave about 500px for text.
  return width < DOCSME_TOC_PIN_MIN_WIDTH
    || app?._docsmeTocPinnedPreference === false;
}

function isCompactDocsmeSidebar(app) {
  return docsmeWindowWidth(app) <= 768;
}

function docsmeFocusable(root) {
  return Array.from(root?.querySelectorAll('button, a[href], input, select, textarea, [tabindex]') || [])
    .filter((node) => !node.disabled && node.tabIndex >= 0 && !node.closest('[inert]') && node.getClientRects().length);
}

function releaseDocsmeModal(app) {
  app._docsmeModalInert?.forEach((previous, node) => { node.inert = previous; });
  app._docsmeModalInert = null;
}

function syncDocsmePanelAccessibility(app) {
  // Both drawers own the same background. Restore before recomputing so switching
  // panels, resizing or disposing never saves the other panel's temporary lock.
  releaseDocsmeModal(app);
  if (app._docsmeDisposed) return;
  const compact = isCompactDocsmeSidebar(app);
  const sidebar = app.querySelector('.docsme-sidebar');
  const toc = app.querySelector('[data-docsme-toc]');
  const sidebarOpen = compact && app.classList.contains('is-sidebar-open');
  const tocOpen = toc && !app.classList.contains('is-toc-empty')
    && (isFloatingDocsmeToc(app)
      ? app.classList.contains('is-mobile-toc-open')
      : !app.classList.contains('is-toc-collapsed'));
  const modal = compact ? (sidebarOpen ? sidebar : tocOpen ? toc : null) : null;
  if (sidebar) {
    sidebar.inert = compact && !sidebarOpen;
    sidebar.setAttribute('aria-hidden', String(sidebar.inert));
  }
  if (toc) {
    toc.inert = !tocOpen;
    toc.setAttribute('aria-hidden', String(toc.inert));
  }
  for (const panel of [sidebar, toc].filter(Boolean)) {
    if (panel === modal) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', panel === toc ? '本页目录'
        : app.classList.contains('docsme-app--projects') ? '资料库侧栏' : '文档目录');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('aria-label');
    }
  }
  if (!modal) return;
  const saved = new Map();
  // Include the desktop controls outside the app, not just the article. Inert
  // excludes them from both pointer interaction and the keyboard tab sequence.
  for (let branch = modal; branch && branch !== document.body; branch = branch.parentElement) {
    for (const sibling of branch.parentElement?.children || []) {
      if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.matches('script, style, link')) continue;
      saved.set(sibling, sibling.inert);
      sibling.inert = true;
    }
  }
  app._docsmeModalInert = saved;
  if (!modal.contains(document.activeElement)) docsmeFocusable(modal)[0]?.focus({ preventScroll: true });
}

function trapDocsmePanelFocus(event, panel) {
  const controls = docsmeFocusable(panel);
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function bindProjectFilter(app) {
  const input = app.querySelector('[data-docsme-project-filter]');
  if (!input || input.dataset.docsmeFilterBound === 'true') return;
  input.dataset.docsmeFilterBound = 'true';
  const entries = Array.from(app.querySelectorAll('.docsme-project-card'), card => ({
    card,
    text: card.querySelector('.docsme-project-card__body')?.textContent.trim().toLocaleLowerCase() || ''
  }));
  const empty = app.querySelector('[data-docsme-filter-empty]');
  const status = app.querySelector('[data-docsme-library-status]');
  const reset = app.querySelector('[data-docsme-filter-clear]');
  const apply = () => {
    const words = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const { card, text } of entries) {
      card.hidden = !words.every(word => text.includes(word));
      if (!card.hidden) visible++;
    }
    if (empty) empty.hidden = visible > 0 || !words.length;
    if (reset) reset.hidden = !input.value;
    if (status) status.textContent = words.length ? `显示 ${visible} / ${entries.length} 个项目` : `${entries.length} 个项目`;
  };
  input.addEventListener('input', apply);
  input.addEventListener('search', apply);
  const clear = () => { input.value = ''; apply(); input.focus({ preventScroll: true }); };
  input.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !input.value) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  });
  reset?.addEventListener('click', clear);
  apply();
}

function bindLibraryView(app) {
  const picker = app.querySelector('.docsme-view-picker');
  if (!picker || picker.dataset.docsmeBound) return;
  picker.dataset.docsmeBound = 'true';
  const key = 'sky-blog-3:docsme:library-view';
  const buttons = picker.querySelectorAll('[data-docsme-view]');
  const select = view => {
    const mode = view === 'list' ? 'list' : 'covers';
    app.dataset.libraryView = mode;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.docsmeView === mode)));
  };
  let previous;
  try { previous = sessionStorage.getItem(key); } catch { /* Private windows can still switch views. */ }
  select(previous);
  picker.hidden = false;
  buttons.forEach(button => button.addEventListener('click', () => {
    select(button.dataset.docsmeView);
    try { sessionStorage.setItem(key, app.dataset.libraryView); } catch { /* View remains active in this window. */ }
  }));
}

function syncDocsmeSidebarState(app, { restoreHiddenFocus = true } = {}) {
  const sidebar = app?.querySelector('.docsme-sidebar');
  if (!sidebar) return;
  const compact = isCompactDocsmeSidebar(app);
  const label = app.classList.contains('docsme-app--projects') ? '资料库侧栏' : '文档目录';
  if (!compact) app.classList.remove('is-sidebar-open');
  const open = compact && app.classList.contains('is-sidebar-open');
  const focusWasInSidebar = sidebar.contains(document.activeElement);
  app.querySelectorAll('[data-docsme-toggle-sidebar]').forEach((button) => {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', (open ? '关闭' : '打开') + label);
  });
  syncDocsmePanelAccessibility(app);
  if (restoreHiddenFocus && sidebar.inert && focusWasInSidebar && !app.classList.contains('is-mobile-toc-open')) {
    app.querySelector('[data-docsme-toggle-sidebar]')?.focus({ preventScroll: true });
  }
}

function closeDocsmeSidebar(app, { restoreFocus = true } = {}) {
  if (!app?.querySelector('.docsme-sidebar')) return;
  const wasOpen = app.classList.contains('is-sidebar-open');
  app.classList.remove('is-sidebar-open');
  syncDocsmeSidebarState(app, { restoreHiddenFocus: restoreFocus });
  if (wasOpen && restoreFocus) app.querySelector('[data-docsme-toggle-sidebar]')?.focus({ preventScroll: true });
}

function syncDocsmeTocState(app, { restoreHiddenFocus = true } = {}) {
  if (!app) return;
  const toc = app.querySelector('[data-docsme-toc]');
  if (!toc) return;
  const floating = isFloatingDocsmeToc(app);
  app.classList.toggle('is-toc-pinned', !floating);
  app.classList.toggle('is-toc-floating', floating);
  if (!floating) app.classList.remove('is-mobile-toc-open');
  const hidden = app.classList.contains('is-toc-empty')
    || (floating
      ? !app.classList.contains('is-mobile-toc-open')
      : app.classList.contains('is-toc-collapsed'));
  const ownedFocus = toc.contains(document.activeElement);
  syncDocsmePanelAccessibility(app);
  app.querySelectorAll('[data-docsme-toggle-toc]').forEach(button => {
    const label = hidden ? '展开本页目录' : '收起本页目录';
    button.setAttribute('aria-expanded', String(!hidden));
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  });
  const pin = toc.querySelector('[data-docsme-pin-toc]');
  if (pin) {
    pin.hidden = docsmeWindowWidth(app) < DOCSME_TOC_PIN_MIN_WIDTH;
    pin.setAttribute('aria-pressed', String(!floating));
    pin.title = floating ? '将本页目录固定在右侧' : '取消固定本页目录';
    if (pin.hidden && pin === document.activeElement && !hidden) {
      toc.querySelector('[data-docsme-toggle-toc]')?.focus({ preventScroll: true });
    }
  }
  if (hidden && ownedFocus && restoreHiddenFocus) {
    docsmeFocusable(app).find((node) => node.matches('[data-docsme-toggle-toc]') && !toc.contains(node))
      ?.focus({ preventScroll: true });
  }
}

function enhanceDocsmeLinks(root) {
  // Alpine can run before pushState. A relative link belongs to the document
  // just inserted, not the previous address that is still in the location bar.
  const source = new URL(root.closest('[data-pjax-target-url]')?.dataset.pjaxTargetUrl || location.href, location.href);
  const explicitBase = root.ownerDocument.querySelector('base[href]')?.getAttribute('href');
  let base = source;
  try { if (explicitBase) base = new URL(explicitBase, source); } catch { /* Invalid base uses the document URL. */ }
  const baseTarget = root.ownerDocument.querySelector('base[target]')?.getAttribute('target') || '';
  const preview = source.searchParams.get('preview-theme');
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const rawHref = anchor.getAttribute('href');
    let target;
    try { target = new URL(rawHref, base); } catch { return; }
    if (!/^\/docs(?:\/|$)/.test(target.pathname) || target.username || target.password) return;
    const policy = classifyLinkClick({ event: { button: 0 }, runtimeReady: true, currentUrl: source.href, baseTarget,
      link: { rawHref, resolvedHref: target.href, classOptIn: true, hasDownload: anchor.hasAttribute('download'),
        targetPresent: anchor.hasAttribute('target'), target: anchor.getAttribute('target') } });
    if (policy.kind !== 'managed') return;
    if (preview && !target.searchParams.has('preview-theme')) target.searchParams.set('preview-theme', preview);
    if (anchor.href !== target.href) anchor.href = target.href;
    anchor.classList.add('pjax-link');
    anchor.dataset.pjaxApp = 'docsme';
  });
}

function bindSwitchers(root) {
  root.querySelectorAll('[data-docsme-switcher]').forEach((select) => {
    if (select.dataset.docsmeSwitcherBound === 'true') return;
    select.dataset.docsmeSwitcherBound = 'true';
    const committedIndex = select.selectedIndex;
    let pending = false;
    select.addEventListener('change', async () => {
      if (pending) return;
      const option = select.selectedOptions?.[0];
      const nextLink = option?.dataset.link || '';
      if (!nextLink) return;

      const currentLink = select.dataset.currentLink || '';
      const current = new URL(window.location.href);
      const next = new URL(nextLink, current);
      if (currentLink) {
        const prefix = new URL(currentLink, current).pathname.replace(/\/$/, '');
        if (current.pathname === prefix || current.pathname.startsWith(prefix + '/')) {
          next.pathname = next.pathname.replace(/\/$/, '') + current.pathname.slice(prefix.length);
        }
      }
      const targetKeys = new Set(next.searchParams.keys());
      current.searchParams.forEach((value, key) => { if (!targetKeys.has(key)) next.searchParams.append(key, value); });
      next.hash ||= current.hash;

      pending = true;
      select.disabled = true;
      select.setAttribute('aria-busy', 'true');
      const status = root.querySelector?.('[data-docsme-switch-status]');
      if (status) { status.hidden = false; status.textContent = '正在切换…'; }
      if (window.pjax?.loadUrl) {
        let completed = false;
        try {
          completed = await window.pjax.loadUrl(next.href, { triggerElement: select });
        } catch {
          // The current document stays readable; expose recovery beside the control.
        } finally {
          // A veto/error leaves this root mounted. Its selected value must still
          // describe the document being read, rather than the failed target.
          if (select.isConnected) select.selectedIndex = committedIndex;
          select.disabled = false;
          select.removeAttribute('aria-busy');
          pending = false;
          if (status && select.isConnected) {
            status.hidden = completed !== false;
            status.textContent = completed === false ? '切换未完成，请重新选择以重试。' : '';
          }
        }
      } else {
        window.location.href = next.href;
      }
    });
  });
}

function bindDocsmeSearch(app) {
  const button = app.querySelector('[data-docsme-search], #btn-search');
  if (!button || app.dataset.docsmeSearchEnabled !== 'true' || app._docsmeSearchHandler) return;
  const handler = () => {
    const includeCategoryNames = [
      ['project', app.dataset.docsmeProject],
      ['version', app.dataset.docsmeVersion],
      // Docsme 1.10.2's DocumentConverter indexes language as `lang:…`.
      // Its bundled example template still says `language:…`; follow the index.
      ['lang', app.dataset.docsmeLanguage]
    ].filter(([, value]) => value).map(([key, value]) => `${key}:${value}`);
    openSearchWidget({ includeCategoryNames });
  };
  button.addEventListener('click', handler);
  app._docsmeSearchButton = button;
  app._docsmeSearchHandler = handler;
}

function bindMobileSidebar(root) {
  const app = getDocsmeRoot(root);

  if (app && app.dataset.docsmeDismissBound !== 'true') {
    app.dataset.docsmeDismissBound = 'true';
    app.addEventListener('click', (event) => {
      if (event.target.closest('[data-docsme-all-projects]')) {
        if (app.classList.contains('is-sidebar-open')) closeDocsmeSidebar(app);
        const filter = app.querySelector('[data-docsme-project-filter]');
        if (filter) { filter.value = ''; filter.dispatchEvent(new Event('input')); filter.focus({ preventScroll: true }); }
        return;
      }
      if (event.target.closest('[data-docsme-close-sidebar]')) { closeDocsmeSidebar(app); return; }
      if (!app.classList.contains('is-sidebar-open') && !app.classList.contains('is-mobile-toc-open')) return;
      if (event.target.closest('.docsme-sidebar, .docsme-toc, .docsme-toolbar-actions, [data-docsme-toggle-sidebar]')) return;

      closeDocsmeSidebar(app);
      app.classList.remove('is-mobile-toc-open');
      syncDocsmeTocState(app);
    });
  }

  root.querySelectorAll('[data-docsme-toggle-sidebar]').forEach((button) => {
    if (button.dataset.docsmeSidebarBound === 'true') return;
    button.dataset.docsmeSidebarBound = 'true';
    button.addEventListener('click', () => {
      const app = getDocsmeRoot(root);
      if (!app) return;
      app.classList.remove('is-mobile-toc-open');
      app.classList.toggle('is-sidebar-open');
      syncDocsmeSidebarState(app);
      syncDocsmeTocState(app);
      if (app.classList.contains('is-sidebar-open')) {
        docsmeFocusable(app.querySelector('.docsme-sidebar'))[0]?.focus({ preventScroll: true });
      }
    });
  });

  // A committed navigation replaces this root (disposing its sidebar). Keep
  // the current chapter and its focus available while a request can still fail.

  if (app && !app._docsmeSidebarKeyHandler) {
    app._docsmeSidebarKeyHandler = (event) => {
      if (isFloatingDocsmeToc(app) && app.classList.contains('is-mobile-toc-open')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          app.classList.remove('is-mobile-toc-open');
          syncDocsmeTocState(app);
        } else if (event.key === 'Tab' && isCompactDocsmeSidebar(app)) {
          trapDocsmePanelFocus(event, app.querySelector('[data-docsme-toc]'));
        }
        return;
      }
      const open = isCompactDocsmeSidebar(app) && app.classList.contains('is-sidebar-open');
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDocsmeSidebar(app);
      } else if (event.key === 'Tab') {
        trapDocsmePanelFocus(event, app.querySelector('.docsme-sidebar'));
      }
    };
    app.addEventListener('keydown', app._docsmeSidebarKeyHandler);
  }
  if (app) syncDocsmeSidebarState(app);
}

function bindTreeToggles(root) {
  const syncCollapseButtons = () => {
    const nodes = Array.from(root.querySelectorAll('[data-docsme-tree-node]'));
    const hasOpenNode = nodes.some((node) => node.classList.contains('is-open'));
    root.querySelectorAll('[data-docsme-tree-collapse-all]').forEach((button) => {
      button.setAttribute('aria-expanded', hasOpenNode ? 'true' : 'false');
      button.textContent = hasOpenNode ? '全部收起' : '全部展开';
    });
  };

  root.querySelectorAll('[data-docsme-tree-toggle]').forEach((button) => {
    if (button.dataset.docsmeTreeToggleBound === 'true') return;
    button.dataset.docsmeTreeToggleBound = 'true';
    button.addEventListener('click', () => {
      const node = button.closest('[data-docsme-tree-node]');
      if (!node) return;

      const isOpen = node.classList.toggle('is-open');
      button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      syncCollapseButtons();
    });
  });

  root.querySelectorAll('[data-docsme-tree-collapse-all]').forEach((button) => {
    if (button.dataset.docsmeTreeCollapseBound === 'true') return;
    button.dataset.docsmeTreeCollapseBound = 'true';
    button.addEventListener('click', () => {
      const nodes = Array.from(root.querySelectorAll('[data-docsme-tree-node]'));
      const shouldOpen = !nodes.some((node) => node.classList.contains('is-open'));
      nodes.forEach((node) => {
        node.classList.toggle('is-open', shouldOpen);
        node
          .querySelector(':scope > .docsme-tree-row [data-docsme-tree-toggle]')
          ?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      });
      syncCollapseButtons();
    });
  });

  syncCollapseButtons();
}

function bindTocToggles(root) {
  const app = getDocsmeRoot(root);
  if (!app) return;

  if (app._docsmeTocPinnedPreference === undefined) {
    let saved;
    try { saved = sessionStorage.getItem(DOCSME_TOC_PIN_KEY); } catch { /* The current window remains usable without storage. */ }
    app._docsmeTocPinnedPreference = saved === 'true' ? true : saved === 'false' ? false : null;
  }
  const syncTocButtons = () => syncDocsmeTocState(app);

  app.querySelectorAll('[data-docsme-pin-toc]').forEach((button) => {
    if (button.dataset.docsmePinBound === 'true') return;
    button.dataset.docsmePinBound = 'true';
    button.addEventListener('click', () => {
      if (docsmeWindowWidth(app) < DOCSME_TOC_PIN_MIN_WIDTH) return;
      const pinned = isFloatingDocsmeToc(app);
      app._docsmeTocPinnedPreference = pinned;
      document.documentElement.dataset.docsmeTocPinned = String(pinned);
      try { sessionStorage.setItem(DOCSME_TOC_PIN_KEY, String(pinned)); } catch { /* Keep the local preference. */ }
      app.classList.remove('is-toc-collapsed');
      app.classList.toggle('is-mobile-toc-open', !pinned);
      syncTocButtons();
    });
  });

  app.querySelectorAll('[data-docsme-toggle-toc]').forEach((button) => {
    if (button.dataset.docsmeTocToggleBound === 'true') return;
    button.dataset.docsmeTocToggleBound = 'true';
    button.addEventListener('click', () => {
      if (isFloatingDocsmeToc(app)) {
        closeDocsmeSidebar(app, { restoreFocus: false });
        app.classList.remove('is-toc-collapsed');
        app.classList.toggle('is-mobile-toc-open');
      } else {
        app.classList.remove('is-mobile-toc-open');
        app.classList.toggle('is-toc-collapsed');
      }
      syncTocButtons();
      if (isFloatingDocsmeToc(app) && app.classList.contains('is-mobile-toc-open')) {
        docsmeFocusable(app.querySelector('[data-docsme-toc]'))[0]?.focus({ preventScroll: true });
      }
    });
  });

  if (!app._docsmeLayoutCleanup) {
    const syncLayout = () => {
      syncDocsmeSidebarState(app);
      syncTocButtons();
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(syncLayout);
      observer.observe(app);
      app._docsmeLayoutCleanup = () => observer.disconnect();
    } else {
      window.addEventListener('resize', syncLayout);
      app._docsmeLayoutCleanup = () => window.removeEventListener('resize', syncLayout);
    }
  }
  syncTocButtons();
}

function slugifyHeading(text, index) {
  const base = (text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base || `section-${index + 1}`;
}

function renderToc(root) {
  root._docsmeTocObserver?.disconnect?.();
  root._docsmeTocObserver = null;
  const content = root.querySelector('[data-toc-content]');
  const list = root.querySelector('[data-docsme-toc-list]');
  if (!content || !list) return;

  const headings = Array.from(content.querySelectorAll('h2, h3')).filter((heading) => {
    return heading.textContent.trim().length > 0;
  });

  list.innerHTML = '';
  if (headings.length === 0) {
    list.closest('[data-docsme-toc]')?.classList.add('is-empty');
    const app = getDocsmeRoot(root);
    app?.classList.add('is-toc-empty');
    syncDocsmeTocState(app);
    return;
  }

  list.closest('[data-docsme-toc]')?.classList.remove('is-empty');
  getDocsmeRoot(root)?.classList.remove('is-toc-empty');
  const headingNodes = new Set(headings);
  const existingIdNodes = new Set([
    ...content.ownerDocument.querySelectorAll('[id]'),
    ...content.querySelectorAll('[id]')
  ]);
  const usedIds = new Set(Array.from(existingIdNodes, (node) => node.id).filter(Boolean));
  const nonHeadingIds = new Set(Array.from(existingIdNodes)
    .filter((node) => !headingNodes.has(node))
    .map((node) => node.id)
    .filter(Boolean));
  const assignedHeadingIds = new Set();
  const tocLinks = new Map();
  const selectLink = active => {
    for (const link of tocLinks.values()) {
      link.classList.toggle('is-active', link === active);
      if (link === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  headings.forEach((heading, index) => {
    if (!heading.id || nonHeadingIds.has(heading.id) || assignedHeadingIds.has(heading.id)) {
      const slug = slugifyHeading(heading.textContent, index);
      let id = slug;
      let suffix = 2;
      while (usedIds.has(id)) id = `${slug}-${suffix++}`;
      heading.id = id;
      usedIds.add(id);
    }
    assignedHeadingIds.add(heading.id);

    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.className = `docsme-toc__link docsme-toc__link--${heading.tagName.toLowerCase()}`;
    link.textContent = heading.textContent.trim();
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      selectLink(link);
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      const scroller = heading.closest('.docsme-main');
      const toolbar = scroller?.querySelector(':scope > .docsme-toolbar');
      if (scroller && toolbar) {
        // Scroll only this document and keep the heading below its sticky toolbar.
        // Measure on click because responsive layout can change the toolbar height.
        const top = scroller.scrollTop + heading.getBoundingClientRect().top
          - scroller.getBoundingClientRect().top - scroller.clientTop
          - toolbar.getBoundingClientRect().height - 12;
        scroller.scrollTo({ top: Math.max(0, top), behavior });
      } else {
        heading.scrollIntoView({ behavior, block: 'start' });
      }
      history.replaceState(history.state, '', `#${heading.id}`);
      const app = getDocsmeRoot(root);
      if (app && isFloatingDocsmeToc(app)) {
        app.classList.remove('is-mobile-toc-open');
        syncDocsmeTocState(app, { restoreHiddenFocus: false });
        if (!heading.hasAttribute('tabindex')) {
          heading.setAttribute('tabindex', '-1');
          heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
        }
        heading.focus({ preventScroll: true });
      }
    });
    tocLinks.set(heading.id, link);
    list.append(link);
  });

  if (tocLinks.size > 0) {
    selectLink(list.querySelector('.docsme-toc__link'));
  }
  syncDocsmeTocState(getDocsmeRoot(root));

  if ('IntersectionObserver' in window && tocLinks.size > 0) {
    root._docsmeTocObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible?.target?.id) return;

        selectLink(tocLinks.get(visible.target.id));
      },
      {
        root: root.querySelector('.docsme-main'),
        rootMargin: '-18% 0px -68% 0px',
        threshold: 0
      }
    );
    headings.forEach((heading) => root._docsmeTocObserver.observe(heading));
  }
}

function isDocsmeDebugEnabled() {
  return document.body?.dataset?.debug === 'true';
}

function warnDocsmeRender(label, payload = {}) {
  if (!isDocsmeDebugEnabled()) return;
  console.warn(`[docsme] ${label}`, payload);
}

const DOCSME_KATEX_SELECTOR = [
  '.math-inline',
  '.math-display',
  '[math-inline]',
  '[math-display]',
  '.katex-inline',
  '.katex-block'
].join(', ');
const DOCSME_MERMAID_SELECTOR = 'text-diagram[data-type="mermaid"], .mermaid';
const DOCSME_KATEX_ASSET = '/plugins/plugin-katex/assets/static/katex.min.js?version=3.0.0';
const DOCSME_MERMAID_ASSET = '/plugins/text-diagram/assets/static/mermaid.min.js?version=1.5.2';
const docsmeResourceLoads = new Map();
const docsmeRichContentJobs = new WeakMap();
const DOCSME_LAYOUT_WAIT_MS = 2_000;

export function resolveDocsmeRichContentTheme(doc = document) {
  const html = doc?.documentElement;
  const body = doc?.body;
  const isDark = html?.dataset?.theme === 'dark'
    || html?.dataset?.colorScheme === 'dark'
    || html?.classList?.contains('dark')
    || body?.dataset?.theme === 'dark'
    || body?.dataset?.colorScheme === 'dark'
    || body?.classList?.contains('dark');
  return isDark ? 'dark' : 'default';
}

function hasRenderedKatex(node) {
  return node?.matches?.('.katex, .katex-display')
    || node?.querySelector?.('.katex, .katex-display, math') != null;
}

function readKatexSource(node) {
  const saved = node.dataset.docsmeKatexSource;
  if (saved) return saved;

  const source = node.getAttribute('data-content')
    || node.getAttribute('content')
    || node.textContent
    || '';
  const normalized = source.trim();
  if (normalized) node.dataset.docsmeKatexSource = normalized;
  return normalized;
}

function hasUsableMermaidSvg(node) {
  // Text Diagram 1.5.2's bundled Mermaid renderer leaves an error SVG before rejecting. Its temporary
  // render container is also not a completed diagram: run() commits a direct SVG.
  const svg = node.querySelector(':scope > svg');
  return Boolean(svg && !svg.querySelector('.error-icon, .error-text'));
}

function readMermaidSource(node) {
  const saved = node.dataset.docsmeMermaidSource;
  if (saved) return saved;

  const source = node.getAttribute('data-content')
    || (node.querySelector('svg') ? '' : node.textContent)
    || '';
  const normalized = source.trim();
  if (normalized) node.dataset.docsmeMermaidSource = normalized;
  return normalized;
}

function clearRichContentFallback(node) {
  node.classList.remove('docsme-rich-content-fallback');
  node.removeAttribute('data-docsme-render-error');
  if (node.hasAttribute('data-docsme-original-title')) {
    const originalTitle = node.dataset.docsmeOriginalTitle || '';
    if (originalTitle) {
      node.setAttribute('title', originalTitle);
    } else {
      node.removeAttribute('title');
    }
    node.removeAttribute('data-docsme-original-title');
  }
}

function markRichContentFallback(node, message, source = '') {
  if (source) node.textContent = source;
  if (!node.hasAttribute('data-docsme-original-title')) {
    node.dataset.docsmeOriginalTitle = node.getAttribute('title') || '';
  }
  node.classList.add('docsme-rich-content-fallback');
  node.dataset.docsmeRenderError = message;
  node.title = message;
  node.setAttribute('aria-busy', 'false');
}

function renderKatexNodes(root, katexRuntime) {
  const nodes = Array.from(root.querySelectorAll(DOCSME_KATEX_SELECTOR));
  const result = {
    total: nodes.length,
    preRendered: 0,
    rendered: 0,
    pending: 0,
    failed: 0
  };

  nodes.forEach((node) => {
    if (hasRenderedKatex(node)) {
      node.dataset.docsmeKatexRendered = 'true';
      node.dataset.docsmeKatexState ||= 'pre-rendered';
      clearRichContentFallback(node);
      result.preRendered += 1;
      return;
    }

    const source = readKatexSource(node);
    if (!source) return;
    if (!katexRuntime?.render) {
      result.pending += 1;
      return;
    }

    const displayMode = node.classList.contains('math-display')
      || node.classList.contains('katex-block')
      || node.hasAttribute('math-display');
    node.setAttribute('aria-busy', 'true');
    try {
      katexRuntime.render(source, node, {
        displayMode,
        throwOnError: false
      });
      if (!hasRenderedKatex(node)) {
        throw new Error('KaTeX 未生成可识别的渲染 DOM');
      }
      node.dataset.docsmeKatexRendered = 'true';
      node.dataset.docsmeKatexState = 'rendered';
      node.setAttribute('aria-busy', 'false');
      clearRichContentFallback(node);
      result.rendered += 1;
    } catch (error) {
      node.dataset.docsmeKatexRendered = 'false';
      node.dataset.docsmeKatexState = 'error';
      markRichContentFallback(node, '公式暂时无法渲染，已显示原始内容。', source);
      warnDocsmeRender('KaTeX 渲染失败。', {
        displayMode,
        message: error?.message || String(error || '')
      });
      result.failed += 1;
    }
  });

  return { nodes, result };
}

function resolvePluginScriptSource(fragment, fallback) {
  const existing = Array.from(document.querySelectorAll('script[src]'))
    .find((script) => script.src.includes(fragment));
  return existing?.src || new URL(fallback, window.location.origin).toString();
}

function loadPluginRuntime(key, src, isReady) {
  if (isReady()) return Promise.resolve();
  if (docsmeResourceLoads.has(key)) return docsmeResourceLoads.get(key);

  const promise = new Promise((resolve, reject) => {
    const absoluteSrc = new URL(src, window.location.origin).href;
    const existing = Array.from(document.querySelectorAll('script[src]'))
      .find((script) => new URL(script.src, window.location.origin).href === absoluteSrc);
    const script = existing || document.createElement('script');
    let settled = false;
    let timeout;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (error) reject(error);
      else if (isReady()) resolve();
      else reject(new Error(`${key} 资源已加载但运行时不可用`));
    };
    const onLoad = () => finish();
    const onError = () => {
      if (!existing || script.dataset.docsmePluginRuntime === key) script.remove();
      finish(new Error(`${key} 资源加载失败`));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    // A timeout leaves the pending tag in place: a later attempt reuses it,
    // instead of inserting another script while the original is still loading.
    timeout = window.setTimeout(() => finish(new Error(`${key} 资源加载超时`)), 6_000);
    if (!existing) {
      script.src = src;
      script.defer = true;
      script.dataset.docsmePluginRuntime = key;
      document.head.appendChild(script);
    }
    if (isReady()) finish();
  });

  docsmeResourceLoads.set(key, promise);
  promise.catch(() => docsmeResourceLoads.delete(key));
  return promise;
}

async function ensureKatexRuntime() {
  if (window.katex?.render) return window.katex;
  const src = resolvePluginScriptSource(
    '/plugins/plugin-katex/assets/static/katex.min.js',
    DOCSME_KATEX_ASSET
  );
  await loadPluginRuntime('katex', src, () => Boolean(window.katex?.render));
  return window.katex;
}

async function ensureMermaidRuntime() {
  if (window.mermaid?.run) return window.mermaid;
  const src = resolvePluginScriptSource(
    '/plugins/text-diagram/assets/static/mermaid.min.js',
    DOCSME_MERMAID_ASSET
  );
  await loadPluginRuntime('mermaid', src, () => Boolean(window.mermaid?.run));
  return window.mermaid;
}

async function renderMermaidNodes(root, mermaidRuntime, theme, signal) {
  const nodes = Array.from(root.querySelectorAll(DOCSME_MERMAID_SELECTOR));
  const result = { total: nodes.length, preRendered: 0, rendered: 0, pending: 0, failed: 0 };
  let initialized = false;

  // One run per source preserves error attribution when only one of several
  // diagrams fails. Mermaid's batch run rejects with only its first error.
  for (const node of nodes) {
    if (signal?.aborted) break;
    const source = readMermaidSource(node);
    const renderedTheme = node.dataset.docsmeMermaidTheme || '';
    if (hasUsableMermaidSvg(node) && (!renderedTheme || renderedTheme === theme)) {
      node.dataset.docsmeMermaidTheme = theme;
      node.dataset.docsmeMermaidState ||= 'pre-rendered';
      node.setAttribute('aria-busy', 'false');
      clearRichContentFallback(node);
      result.preRendered += 1;
      continue;
    }
    if (!source) {
      if (node.querySelector('svg')) {
        node.dataset.docsmeMermaidState = 'error';
        markRichContentFallback(node, '图表渲染失败，原始内容不可用。');
        result.failed += 1;
      }
      continue;
    }
    if (!mermaidRuntime?.run) {
      result.pending += 1;
      continue;
    }

    node.textContent = source;
    node.removeAttribute('data-processed');
    node.dataset.docsmeMermaidState = 'rendering';
    node.setAttribute('aria-busy', 'true');
    clearRichContentFallback(node);
    try {
      if (!initialized) {
        mermaidRuntime.initialize?.({ startOnLoad: false, theme });
        initialized = true;
      }
      await mermaidRuntime.run({ nodes: [node] });
      if (signal?.aborted) break;
      if (!hasUsableMermaidSvg(node)) throw new Error('Mermaid 未生成有效图表');
      node.dataset.docsmeMermaidTheme = theme;
      node.dataset.docsmeMermaidState = 'rendered';
      node.setAttribute('aria-busy', 'false');
      clearRichContentFallback(node);
      result.rendered += 1;
    } catch (error) {
      if (signal?.aborted) break;
      node.dataset.docsmeMermaidState = 'error';
      markRichContentFallback(node, '图表暂时无法渲染，已显示源内容。', source);
      result.failed += 1;
      warnDocsmeRender('Mermaid 渲染失败。', {
        message: error?.message || String(error || '')
      });
    }
  }
  return { nodes, result };
}

async function performDocsmeRichContentRender(app, options = {}, signal) {
  const allowResourceLoad = options.allowResourceLoad !== false;
  let katexRuntime = Object.hasOwn(options, 'katex') ? options.katex : window.katex;
  let mermaidRuntime = Object.hasOwn(options, 'mermaid') ? options.mermaid : window.mermaid;
  let katex = renderKatexNodes(app, katexRuntime);
  const mermaidTheme = resolveDocsmeRichContentTheme(app.ownerDocument || document);
  let mermaid = await renderMermaidNodes(app, mermaidRuntime, mermaidTheme, signal);

  if (signal?.aborted) return null;
  if (katex.result.pending > 0 && allowResourceLoad) {
    try {
      katexRuntime = await ensureKatexRuntime();
      if (signal?.aborted) return null;
      katex = renderKatexNodes(app, katexRuntime);
    } catch (error) {
      if (signal?.aborted) return null;
      const unavailableNodes = katex.nodes.filter((node) => {
        return !hasRenderedKatex(node) && readKatexSource(node);
      });
      unavailableNodes.forEach((node) => {
        const source = readKatexSource(node);
        if (!source) return;
        node.dataset.docsmeKatexState = 'unavailable';
        markRichContentFallback(node, '公式渲染插件暂不可用，已显示原始内容。', source);
      });
      katex.result.failed += unavailableNodes.length;
      katex.result.pending = 0;
      warnDocsmeRender('KaTeX 运行时不可用。', {
        message: error?.message || String(error || '')
      });
    }
  } else if (katex.result.pending > 0) {
    const unavailableNodes = katex.nodes.filter((node) => {
      return !hasRenderedKatex(node) && readKatexSource(node);
    });
    unavailableNodes.forEach((node) => {
      const source = readKatexSource(node);
      if (!source) return;
      node.dataset.docsmeKatexState = 'unavailable';
      markRichContentFallback(node, '公式渲染插件暂不可用，已显示原始内容。', source);
    });
    katex.result.failed += unavailableNodes.length;
    katex.result.pending = 0;
  }

  if (mermaid.result.pending > 0 && allowResourceLoad) {
    try {
      mermaidRuntime = await ensureMermaidRuntime();
      if (signal?.aborted) return null;
      mermaid = await renderMermaidNodes(app, mermaidRuntime, mermaidTheme, signal);
    } catch (error) {
      if (signal?.aborted) return null;
      const unavailableNodes = mermaid.nodes.filter((node) => {
        return !hasUsableMermaidSvg(node) && readMermaidSource(node);
      });
      unavailableNodes.forEach((node) => {
        const source = readMermaidSource(node);
        if (!source) return;
        node.dataset.docsmeMermaidState = 'unavailable';
        markRichContentFallback(node, '图表渲染插件暂不可用，已显示源内容。', source);
      });
      mermaid.result.failed += unavailableNodes.length;
      mermaid.result.pending = 0;
      warnDocsmeRender('Mermaid 运行时不可用。', {
        message: error?.message || String(error || '')
      });
    }
  } else if (mermaid.result.pending > 0) {
    const unavailableNodes = mermaid.nodes.filter((node) => {
      return !hasUsableMermaidSvg(node) && readMermaidSource(node);
    });
    unavailableNodes.forEach((node) => {
      const source = readMermaidSource(node);
      if (!source) return;
      node.dataset.docsmeMermaidState = 'unavailable';
      markRichContentFallback(node, '图表渲染插件暂不可用，已显示源内容。', source);
    });
    mermaid.result.failed += unavailableNodes.length;
    mermaid.result.pending = 0;
  }

  if (signal?.aborted) return null;
  return { katex: katex.result, mermaid: mermaid.result, mermaidTheme };
}

function docsmeRichContentFingerprint(app) {
  return [
    resolveDocsmeRichContentTheme(app.ownerDocument || document),
    app.querySelectorAll(DOCSME_KATEX_SELECTOR).length,
    app.querySelectorAll(DOCSME_MERMAID_SELECTOR).length
  ].join(':');
}

function cancelDocsmeRichContent(app) {
  if (!app) return;
  app._docsmeRichContentGeneration = Number(app._docsmeRichContentGeneration || 0) + 1;
  app._docsmeRichContentController?.abort();
  app._docsmeRichContentController = null;
}

function waitForDocsmeLayout(app, signal) {
  return new Promise((resolve, reject) => {
    let pollTimer;
    let deadlineTimer;
    let settled = false;
    const finish = (error, ready = false) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(deadlineTimer);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(ready);
    };
    const onAbort = () => finish(null);
    const check = () => {
      if (signal.aborted || app._docsmeDisposed || !app.isConnected) return finish(null);
      const rect = app.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(app).visibility !== 'hidden') {
        finish(null, true);
      } else {
        pollTimer = window.setTimeout(check, 32);
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    deadlineTimer = window.setTimeout(() => finish(new Error('Docsme 富内容区域等待显示超时')), DOCSME_LAYOUT_WAIT_MS);
    check();
  });
}

function markDocsmeLayoutFailure(app) {
  app.querySelectorAll(DOCSME_MERMAID_SELECTOR).forEach((node) => {
    if (hasUsableMermaidSvg(node)) return;
    node.dataset.docsmeMermaidState = 'layout-timeout';
    markRichContentFallback(node, '内容区域暂未就绪，已显示源内容。', readMermaidSource(node));
  });
  app.querySelectorAll(DOCSME_KATEX_SELECTOR).forEach((node) => {
    if (hasRenderedKatex(node)) return;
    node.dataset.docsmeKatexState = 'layout-timeout';
    markRichContentFallback(node, '内容区域暂未就绪，已显示源内容。', readKatexSource(node));
  });
}

function enqueueDocsmeRichContentJob(app, options, fingerprint, generation, state, signal) {
  const previousJob = state.tailPromise;
  const execute = async () => {
    if (signal.aborted || generation !== Number(app._docsmeRichContentGeneration || 0)
      || app._docsmeDisposed
      || !app.isConnected) {
      return null;
    }
    if (app.querySelector(`${DOCSME_KATEX_SELECTOR}, ${DOCSME_MERMAID_SELECTOR}`)) {
      try {
        if (!await waitForDocsmeLayout(app, signal)) return null;
      } catch (error) {
        if (signal.aborted) return null;
        markDocsmeLayoutFailure(app);
        throw error;
      }
    }
    if (signal.aborted) return null;
    return performDocsmeRichContentRender(app, options, signal);
  };
  const task = previousJob
    ? previousJob.catch(() => null).then(execute)
    : execute();
  const job = Promise.resolve(task).finally(() => {
    if (state.tailPromise === job) {
      docsmeRichContentJobs.delete(app);
    }
  });

  state.tailPromise = job;
  state.lastRequestedFingerprint = fingerprint;
  state.lastRequestedGeneration = generation;
  return job;
}

export function renderDocsmeRichContent(root, options = {}) {
  const app = getDocsmeRoot(root) || root;
  if (!app?.querySelectorAll) return Promise.resolve(null);

  if (app._docsmeDisposed || app._docsmeRichContentSuspended) return Promise.resolve(null);
  app._docsmeRichContentController ||= new AbortController();
  const signal = app._docsmeRichContentController.signal;
  const generation = Number(app._docsmeRichContentGeneration || 0);
  const fingerprint = docsmeRichContentFingerprint(app);
  let state = docsmeRichContentJobs.get(app);
  if (!state) {
    state = {
      tailPromise: null,
      lastRequestedFingerprint: '',
      lastRequestedGeneration: generation
    };
    docsmeRichContentJobs.set(app, state);
  }

  if (state.tailPromise
    && fingerprint === state.lastRequestedFingerprint
    && generation === state.lastRequestedGeneration) {
    return state.tailPromise;
  }
  return enqueueDocsmeRichContentJob(app, options, fingerprint, generation, state, signal);
}

function bindRichContentTheme(root) {
  const app = getDocsmeRoot(root);
  if (!app || app._docsmeThemeObserver) return;

  let currentTheme = resolveDocsmeRichContentTheme();
  app._docsmeThemeObserver = new MutationObserver(() => {
    const nextTheme = resolveDocsmeRichContentTheme();
    if (nextTheme === currentTheme) return;
    currentTheme = nextTheme;
    renderDocsmeRichContent(app).catch((error) => {
      warnDocsmeRender('主题切换后的富内容重绘失败。', {
        message: error?.message || String(error || '')
      });
    });
  });
  app._docsmeThemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-color-scheme']
  });
}

function disposeDocsmeEnhancements(root) {
  const app = getDocsmeRoot(root) || root;
  if (!app) return;
  app._docsmeDisposed = true;
  releaseDocsmeModal(app);
  cancelDocsmeRichContent(app);
  app._docsmeSearchButton?.removeEventListener('click', app._docsmeSearchHandler);
  app._docsmeSearchButton = null;
  app._docsmeSearchHandler = null;
  app._docsmeThemeObserver?.disconnect?.();
  app._docsmeTocObserver?.disconnect?.();
  app._docsmeLayoutCleanup?.();
  app._docsmeLayoutCleanup = null;
  if (app._docsmeSidebarKeyHandler) app.removeEventListener('keydown', app._docsmeSidebarKeyHandler);
  app._docsmeSidebarKeyHandler = null;
  closeDocsmeSidebar(app, { restoreFocus: false });
  app._docsmeThemeObserver = null;
  app._docsmeTocObserver = null;
}

function setPjaxLoading(root, loading) {
  root?.classList.toggle('is-pjax-loading', loading);
}

function wrapDocsmeTables(root) {
  root.querySelectorAll('.docsme-article table').forEach((table) => {
    if (table.parentElement?.classList.contains('docsme-table-scroll')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'docsme-table-scroll';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '可横向滚动的数据表格');
    wrapper.tabIndex = 0;
    table.before(wrapper);
    wrapper.appendChild(table);
  });
}

function enhanceDocsmeApp(root) {
  const app = getDocsmeRoot(root);
  if (!app) return;

  app._docsmeDisposed = false;
  app._docsmeRichContentSuspended = false;
  enhanceDocsmeLinks(app);
  initializeDocsSwup();
  bindDocsmeSearch(app);
  bindProjectFilter(app);
  bindLibraryView(app);
  bindSwitchers(app);
  bindMobileSidebar(app);
  bindTreeToggles(app);
  bindTocToggles(app);
  bindRichContentTheme(app);
  renderToc(app);
  wrapDocsmeTables(app);
  renderDocsmeRichContent(app).catch((error) => {
    warnDocsmeRender('Docsme 富内容增强失败。', {
      message: error?.message || String(error || '')
    });
  });
}

export function registerDocsmeApp(Alpine) {
  Alpine.data('docsmeApp', () => ({
    init() {
      this._docsmeAppRoot = getDocsmeRoot(this.$root);
      this._docsmeNavigationIntentId = null;
      enhanceDocsmeApp(this.$root);
      this._onNavigationAccepted = (event) => {
        const intentId = event.detail?.intentId;
        if (intentId == null || this._docsmeNavigationIntentId === intentId) return;
        this._docsmeNavigationIntentId = intentId;
        const target = new URL(event.detail.url, location.href);
        setPjaxLoading(this._docsmeAppRoot,
          target.origin === location.origin && /^\/docs(?:\/|$)/.test(target.pathname));
        if (!this._docsmeAppRoot || this._docsmeAppRoot._docsmeRichContentSuspended) return;
        this._docsmeAppRoot._docsmeRichContentSuspended = true;
        cancelDocsmeRichContent(this._docsmeAppRoot);
      };
      this._onPjaxReady = (event) => {
        if (event.detail?.intentId == null
          || event.detail.intentId !== this._docsmeNavigationIntentId) return;
        this._docsmeNavigationIntentId = null;
        setPjaxLoading(this._docsmeAppRoot, false);
        // The destination root runs enhanceDocsmeApp from its own init.
        if (this._docsmeAppRoot) this._docsmeAppRoot._docsmeRichContentSuspended = false;
      };
      this._onNavigationSettled = (event) => {
        const { intentId, outcome } = event.detail || {};
        if (intentId == null || intentId !== this._docsmeNavigationIntentId
          || !['cancelled', 'failed', 'native'].includes(outcome)) return;
        this._docsmeNavigationIntentId = null;
        setPjaxLoading(this._docsmeAppRoot, false);
        if (this._docsmeAppRoot?.isConnected
          && !this._docsmeAppRoot._docsmeDisposed) {
          enhanceDocsmeApp(this._docsmeAppRoot);
        }
      };

      document.addEventListener('theme:navigation-accepted', this._onNavigationAccepted);
      document.addEventListener('theme:pjax-ready', this._onPjaxReady);
      document.addEventListener('theme:navigation-settled', this._onNavigationSettled);
    },

    destroy() {
      document.removeEventListener('theme:navigation-accepted', this._onNavigationAccepted);
      document.removeEventListener('theme:pjax-ready', this._onPjaxReady);
      document.removeEventListener('theme:navigation-settled', this._onNavigationSettled);
      this._docsmeNavigationIntentId = null;
      setPjaxLoading(this._docsmeAppRoot, false);
      disposeDocsmeEnhancements(this._docsmeAppRoot || this.$root);
    }
  }));
}
