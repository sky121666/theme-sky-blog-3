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
      history.replaceState(history.state, '', `#${heading.id}`);
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
    const timeout = window.setTimeout(() => {
      reject(new Error(`${key} 资源加载超时`));
    }, 6_000);
    const finish = (error = null) => {
      window.clearTimeout(timeout);
      if (error) {
        reject(error);
      } else if (isReady()) {
        resolve();
      } else {
        reject(new Error(`${key} 资源已加载但运行时不可用`));
      }
    };

    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.docsmePluginRuntime = key;
    script.addEventListener('load', () => finish(), { once: true });
    script.addEventListener('error', () => finish(new Error(`${key} 资源加载失败`)), { once: true });
    document.head.appendChild(script);
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

async function renderMermaidNodes(root, mermaidRuntime, theme) {
  const nodes = Array.from(root.querySelectorAll(DOCSME_MERMAID_SELECTOR));
  const result = {
    total: nodes.length,
    preRendered: 0,
    rendered: 0,
    pending: 0,
    failed: 0
  };
  const renderable = [];

  nodes.forEach((node) => {
    const source = readMermaidSource(node);
    const hasSvg = node.querySelector('svg') != null;
    const renderedTheme = node.dataset.docsmeMermaidTheme || '';

    if (hasSvg && (!renderedTheme || renderedTheme === theme)) {
      node.dataset.docsmeMermaidTheme = theme;
      node.dataset.docsmeMermaidState ||= 'pre-rendered';
      node.setAttribute('aria-busy', 'false');
      clearRichContentFallback(node);
      result.preRendered += 1;
      return;
    }

    if (!source) return;
    if (!mermaidRuntime?.run) {
      result.pending += 1;
      return;
    }

    node.textContent = source;
    node.removeAttribute('data-processed');
    node.dataset.docsmeMermaidState = 'rendering';
    node.setAttribute('aria-busy', 'true');
    clearRichContentFallback(node);
    renderable.push({ node, source });
  });

  if (renderable.length === 0) return { nodes, result };

  mermaidRuntime.initialize?.({
    startOnLoad: false,
    theme
  });

  let renderError = null;
  try {
    await mermaidRuntime.run({ nodes: renderable.map(({ node }) => node) });
  } catch (error) {
    renderError = error;
    warnDocsmeRender('Mermaid 渲染失败。', {
      nodes: renderable.length,
      message: error?.message || String(error || '')
    });
  }

  renderable.forEach(({ node, source }) => {
    if (node.querySelector('svg')) {
      node.dataset.docsmeMermaidTheme = theme;
      node.dataset.docsmeMermaidState = 'rendered';
      node.setAttribute('aria-busy', 'false');
      clearRichContentFallback(node);
      result.rendered += 1;
      return;
    }

    node.dataset.docsmeMermaidState = 'error';
    markRichContentFallback(node, '图表暂时无法渲染，已显示源内容。', source);
    result.failed += 1;
  });

  if (renderError && result.failed === 0) {
    warnDocsmeRender('Mermaid 报告异常，但可识别图表均已生成。', {
      message: renderError?.message || String(renderError || '')
    });
  }
  return { nodes, result };
}

async function performDocsmeRichContentRender(app, options = {}) {
  const allowResourceLoad = options.allowResourceLoad !== false;
  let katexRuntime = Object.hasOwn(options, 'katex') ? options.katex : window.katex;
  let mermaidRuntime = Object.hasOwn(options, 'mermaid') ? options.mermaid : window.mermaid;
  let katex = renderKatexNodes(app, katexRuntime);
  const mermaidTheme = resolveDocsmeRichContentTheme(app.ownerDocument || document);
  let mermaid = await renderMermaidNodes(app, mermaidRuntime, mermaidTheme);

  if (katex.result.pending > 0 && allowResourceLoad) {
    try {
      katexRuntime = await ensureKatexRuntime();
      katex = renderKatexNodes(app, katexRuntime);
    } catch (error) {
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
      mermaid = await renderMermaidNodes(app, mermaidRuntime, mermaidTheme);
    } catch (error) {
      const unavailableNodes = mermaid.nodes.filter((node) => {
        return node.querySelector('svg') == null && readMermaidSource(node);
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
      return node.querySelector('svg') == null && readMermaidSource(node);
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

  return { katex: katex.result, mermaid: mermaid.result, mermaidTheme };
}

function docsmeRichContentFingerprint(app) {
  return [
    resolveDocsmeRichContentTheme(app.ownerDocument || document),
    app.querySelectorAll(DOCSME_KATEX_SELECTOR).length,
    app.querySelectorAll(DOCSME_MERMAID_SELECTOR).length
  ].join(':');
}

function enqueueDocsmeRichContentJob(app, options, fingerprint, generation, state) {
  const previousJob = state.tailPromise;
  const execute = () => {
    if (generation !== Number(app._docsmeRichContentGeneration || 0)
      || app._docsmeDisposed
      || !app.isConnected) {
      return null;
    }
    return performDocsmeRichContentRender(app, options);
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

  app._docsmeDisposed = false;
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
  return enqueueDocsmeRichContentJob(app, options, fingerprint, generation, state);
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
  app._docsmeRichContentGeneration = Number(app._docsmeRichContentGeneration || 0) + 1;
  app._docsmeThemeObserver?.disconnect?.();
  app._docsmeTocObserver?.disconnect?.();
  app._docsmeThemeObserver = null;
  app._docsmeTocObserver = null;
}

function setPjaxLoading(loading) {
  document.querySelectorAll('[data-app-root="docsme"]').forEach((root) => {
    root.classList.toggle('is-pjax-loading', loading);
  });
}

function enhanceDocsmeApp(root) {
  const app = getDocsmeRoot(root);
  if (!app) return;

  app._docsmeDisposed = false;
  enhanceDocsmeLinks(app);
  bindSwitchers(app);
  bindMobileSidebar(app);
  bindTreeToggles(app);
  bindTocToggles(app);
  bindRichContentTheme(app);
  renderToc(app);
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
      disposeDocsmeEnhancements(this._docsmeAppRoot || this.$root);
    }
  }));
}
