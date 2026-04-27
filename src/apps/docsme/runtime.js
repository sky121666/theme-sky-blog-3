function getDocsmeRoot(root) {
  return root?.querySelector?.('.docsme-app') || root?.closest?.('.docsme-app') || null;
}

function isInternalDocsmeLink(anchor) {
  if (!anchor?.href) return false;

  try {
    const url = new URL(anchor.href, window.location.href);
    return url.origin === window.location.origin && /^\/docs(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function enhanceDocsmeLinks(root) {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    if (!isInternalDocsmeLink(anchor)) return;
    anchor.classList.add('pjax-link');
    anchor.dataset.pjaxApp = 'docsme';
  });

  const links = Array.from(root.querySelectorAll('a.pjax-link'));
  if (window.pjax && typeof window.pjax.attachLinks === 'function' && links.length > 0) {
    window.pjax.attachLinks(links);
  }
}

function bindSwitchers(root) {
  root.querySelectorAll('[data-docsme-switcher]').forEach((select) => {
    if (select.dataset.docsmeSwitcherBound === 'true') return;
    select.dataset.docsmeSwitcherBound = 'true';
    select.addEventListener('change', () => {
      const option = select.selectedOptions?.[0];
      const nextLink = option?.dataset.link || '';
      if (!nextLink) return;

      const currentLink = select.dataset.currentLink || '';
      let nextHref = nextLink;
      if (currentLink && window.location.pathname.includes(currentLink)) {
        nextHref = window.location.pathname.replace(currentLink, nextLink) + window.location.search;
      }

      if (window.pjax?.loadUrl) {
        window.pjax.loadUrl(nextHref);
      } else {
        window.location.href = nextHref;
      }
    });
  });
}

function bindMobileSidebar(root) {
  const app = getDocsmeRoot(root);

  if (app && app.dataset.docsmeDismissBound !== 'true') {
    app.dataset.docsmeDismissBound = 'true';
    app.addEventListener('click', (event) => {
      if (!app.classList.contains('is-sidebar-open') && !app.classList.contains('is-mobile-toc-open')) return;
      if (event.target.closest('.docsme-sidebar, .docsme-toc, .docsme-toolbar-actions')) return;

      app.classList.remove('is-sidebar-open', 'is-mobile-toc-open');
      app.querySelectorAll('[data-docsme-toggle-toc]').forEach((button) => {
        button.setAttribute('aria-expanded', 'false');
      });
    });
  }

  root.querySelectorAll('[data-docsme-toggle-sidebar]').forEach((button) => {
    if (button.dataset.docsmeSidebarBound === 'true') return;
    button.dataset.docsmeSidebarBound = 'true';
    button.addEventListener('click', () => {
      const app = getDocsmeRoot(root);
      if (!app) return;
      app.classList.remove('is-mobile-toc-open');
      app.querySelectorAll('[data-docsme-toggle-toc]').forEach((tocButton) => {
        tocButton.setAttribute('aria-expanded', 'false');
      });
      app.classList.toggle('is-sidebar-open');
    });
  });

  root.querySelectorAll('.docsme-tree a').forEach((link) => {
    if (link.dataset.docsmeSidebarCloseBound === 'true') return;
    link.dataset.docsmeSidebarCloseBound = 'true';
    link.addEventListener('click', () => getDocsmeRoot(root)?.classList.remove('is-sidebar-open'));
  });
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
  const isCompactToc = () => window.matchMedia?.('(max-width: 1080px)').matches;

  const syncTocButtons = () => {
    const isCollapsed = app.classList.contains('is-toc-collapsed');
    const isMobileOpen = app.classList.contains('is-mobile-toc-open');
    app.querySelectorAll('[data-docsme-toggle-toc]').forEach((button) => {
      button.setAttribute('aria-expanded', isCompactToc() ? (isMobileOpen ? 'true' : 'false') : (isCollapsed ? 'false' : 'true'));
    });
  };

  app.querySelectorAll('[data-docsme-toggle-toc]').forEach((button) => {
    if (button.dataset.docsmeTocToggleBound === 'true') return;
    button.dataset.docsmeTocToggleBound = 'true';
    button.addEventListener('click', () => {
      if (isCompactToc()) {
        app.classList.remove('is-sidebar-open');
        app.classList.remove('is-toc-collapsed');
        app.classList.toggle('is-mobile-toc-open');
      } else {
        app.classList.remove('is-mobile-toc-open');
        app.classList.toggle('is-toc-collapsed');
      }
      syncTocButtons();
    });
  });

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
  const content = root.querySelector('[data-toc-content]');
  const list = root.querySelector('[data-docsme-toc-list]');
  if (!content || !list) return;

  const headings = Array.from(content.querySelectorAll('h2, h3')).filter((heading) => {
    return heading.textContent.trim().length > 0;
  });

  list.innerHTML = '';
  if (headings.length === 0) {
    list.closest('[data-docsme-toc]')?.classList.add('is-empty');
    getDocsmeRoot(root)?.classList.add('is-toc-empty');
    return;
  }

  list.closest('[data-docsme-toc]')?.classList.remove('is-empty');
  getDocsmeRoot(root)?.classList.remove('is-toc-empty');
  const seen = new Map();
  const tocLinks = new Map();
  headings.forEach((heading, index) => {
    if (!heading.id) {
      const slug = slugifyHeading(heading.textContent, index);
      const count = seen.get(slug) || 0;
      seen.set(slug, count + 1);
      heading.id = count > 0 ? `${slug}-${count + 1}` : slug;
    }

    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.className = `docsme-toc__link docsme-toc__link--${heading.tagName.toLowerCase()}`;
    link.textContent = heading.textContent.trim();
    link.addEventListener('click', (event) => {
      event.preventDefault();
      list.querySelectorAll('.is-active').forEach((item) => item.classList.remove('is-active'));
      link.classList.add('is-active');
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${heading.id}`);
    });
    tocLinks.set(heading.id, link);
    list.append(link);
  });

  if (tocLinks.size > 0) {
    list.querySelector('.docsme-toc__link')?.classList.add('is-active');
  }

  root._docsmeTocObserver?.disconnect?.();
  if ('IntersectionObserver' in window && tocLinks.size > 0) {
    root._docsmeTocObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible?.target?.id) return;

        list.querySelectorAll('.is-active').forEach((item) => item.classList.remove('is-active'));
        tocLinks.get(visible.target.id)?.classList.add('is-active');
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

function renderMathAndDiagrams(root) {
  if (window.mermaid?.run) {
    const mermaidNodes = Array.from(root.querySelectorAll('text-diagram[data-type="mermaid"], .mermaid')).filter((node) => {
      if (node.dataset.docsmeMermaidRendered === 'true') return false;
      node.dataset.docsmeMermaidRendered = 'true';
      return true;
    });

    if (mermaidNodes.length > 0) {
      window.mermaid.run({ nodes: mermaidNodes }).catch(() => {
        mermaidNodes.forEach((node) => {
          node.dataset.docsmeMermaidRendered = 'false';
        });
      });
    }
  }

  if (window.katex?.render) {
    root.querySelectorAll('[math-inline], [math-display]').forEach((el) => {
      if (el.dataset.docsmeKatexRendered === 'true') return;
      const displayMode = el.hasAttribute('math-display');
      try {
        window.katex.render(el.innerText, el, {
          displayMode,
          throwOnError: false
        });
        el.dataset.docsmeKatexRendered = 'true';
      } catch {
        el.dataset.docsmeKatexRendered = 'false';
      }
    });
  }
}

function setPjaxLoading(loading) {
  document.querySelectorAll('[data-app-root="docsme"]').forEach((root) => {
    root.classList.toggle('is-pjax-loading', loading);
  });
}

function enhanceDocsmeApp(root) {
  const app = getDocsmeRoot(root);
  if (!app) return;

  enhanceDocsmeLinks(app);
  bindSwitchers(app);
  bindMobileSidebar(app);
  bindTreeToggles(app);
  bindTocToggles(app);
  renderToc(app);
  renderMathAndDiagrams(app);
}

export function registerDocsmeApp(Alpine) {
  Alpine.data('docsmeApp', () => ({
    init() {
      enhanceDocsmeApp(this.$root);
      this._onPjaxSend = () => setPjaxLoading(true);
      this._onPjaxComplete = () => {
        setPjaxLoading(false);
        enhanceDocsmeApp(document);
      };

      document.addEventListener('pjax:send', this._onPjaxSend);
      document.addEventListener('pjax:same-variant-send', this._onPjaxSend);
      document.addEventListener('pjax:complete', this._onPjaxComplete);
      document.addEventListener('pjax:same-variant-complete', this._onPjaxComplete);
    },

    destroy() {
      document.removeEventListener('pjax:send', this._onPjaxSend);
      document.removeEventListener('pjax:same-variant-send', this._onPjaxSend);
      document.removeEventListener('pjax:complete', this._onPjaxComplete);
      document.removeEventListener('pjax:same-variant-complete', this._onPjaxComplete);
    }
  }));
}
