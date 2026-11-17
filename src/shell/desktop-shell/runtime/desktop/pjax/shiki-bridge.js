let shikiRenderDescriptor = null;
let shikiReplaySequence = 0;
let shikiMomentsListenerInstalled = false;
let initialized = false;

function createShikiIncrementalBridge() {
  return {
    version: 1,
    descriptorKey: '',
    config: null,
    configure(config, descriptorKey) {
      this.config = config && typeof config === 'object' ? config : null;
      this.descriptorKey = String(descriptorKey || '');
    },
    render(root = document) {
      if (!this.config || !root || typeof root.querySelectorAll !== 'function') return 0;
      if (root !== document && !root.isConnected) return 0;

      const excluded = Array.isArray(this.config.excludedLanguages)
        ? this.config.excludedLanguages.map((language) => String(language).toLowerCase())
        : [];
      const candidates = Array.from(root.querySelectorAll('pre > code'));
      let rendered = 0;

      candidates.forEach((codeElement) => {
        if (codeElement.closest('shiki-code')) return;

        const languageClass = Array.from(codeElement.classList)
          .find((className) => className.startsWith('language-') || className.startsWith('lang-'));
        const language = languageClass
          ? languageClass.replace(/^(?:language-|lang-)/, '').toLowerCase()
          : '';
        if (language && excluded.includes(language)) return;

        const preElement = codeElement.parentElement;
        const parent = preElement?.parentElement;
        if (!preElement || preElement.tagName !== 'PRE' || !parent) return;

        const shikiElement = document.createElement('shiki-code');
        shikiElement.setAttribute('light-theme', String(this.config.lightTheme || ''));
        shikiElement.setAttribute('dark-theme', String(this.config.darkTheme || ''));
        shikiElement.setAttribute('variant', String(this.config.variant || ''));
        shikiElement.setAttribute('font-size', String(this.config.fontSize || ''));
        parent.insertBefore(shikiElement, preElement);
        shikiElement.appendChild(preElement);
        rendered += 1;
      });

      return rendered;
    }
  };
}

function readShikiRenderDescriptor(targetDoc) {
  const shikiScript = Array.from(targetDoc?.head?.querySelectorAll?.('script[data-pjax]') || [])
    .find((script) => script.textContent?.includes('renderCodeBlock')
      && script.textContent.includes('/plugins/shiki/assets/static/shiki-code.js'));

  if (!shikiScript) return null;

  const source = shikiScript.textContent || '';
  const importMatch = source.match(/import\s+\{\s*renderCodeBlock\s*\}\s+from\s+['"]([^'"]+)['"]/);
  const configMatch = source.match(/renderCodeBlock\s*\((\{[\s\S]*?\})\s*\)/);
  const importPath = importMatch?.[1];
  const renderConfig = configMatch?.[1];

  if (!importPath || !renderConfig) return null;

  return {
    importPath,
    renderConfig,
    key: `${importPath}\n${renderConfig}`
  };
}

function queueShikiBridgeRender(descriptor, root) {
  if (!descriptor || !root || typeof root.querySelectorAll !== 'function') return;
  if (root !== document && !root.isConnected) return;

  const activeBridge = window.__themeShikiBridge;
  if (activeBridge?.descriptorKey === descriptor.key && typeof activeBridge.render === 'function') {
    activeBridge.render(root);
    return;
  }

  const script = document.createElement('script');
  const replayId = `shiki-${Date.now()}-${++shikiReplaySequence}`;
  const pendingRoots = window.__themeShikiPendingRoots instanceof Map
    ? window.__themeShikiPendingRoots
    : new Map();
  window.__themeShikiPendingRoots = pendingRoots;
  pendingRoots.set(replayId, root);

  script.type = 'module';
  script.dataset.pjax = 'true';
  script.dataset.themeShikiReplay = 'true';
  script.dataset.themeShikiReplayId = replayId;
  script.textContent = [
    `import ${JSON.stringify(descriptor.importPath)};`,
    `const pendingRoots = window.__themeShikiPendingRoots;`,
    `const renderRoot = pendingRoots?.get(${JSON.stringify(replayId)});`,
    `pendingRoots?.delete(${JSON.stringify(replayId)});`,
    `if (renderRoot?.isConnected) {`,
    `  const bridge = window.__themeShikiBridge;`,
    `  bridge?.configure?.(${descriptor.renderConfig}, ${JSON.stringify(descriptor.key)});`,
    `  bridge?.render?.(renderRoot);`,
    `}`,
    `document.querySelector('script[data-theme-shiki-replay-id="${replayId}"]')?.remove?.();`
  ].join('\n');
  script.addEventListener('error', () => {
    pendingRoots.delete(replayId);
    script.remove();
  }, { once: true });
  document.head.appendChild(script);
}

export function runShikiExtraPathRenderer(responseText, root, parsed) {
  // A new page has taken ownership of the content. The previous page's
  // pending module may still resolve against the same, still-connected root.
  window.__themeShikiPendingRoots?.clear();
  if (!responseText) {
    shikiRenderDescriptor = null;
    return;
  }

  const targetDoc = parsed || new DOMParser().parseFromString(responseText, 'text/html');
  shikiRenderDescriptor = readShikiRenderDescriptor(targetDoc);
  if (!shikiRenderDescriptor) return;
  queueShikiBridgeRender(shikiRenderDescriptor, root);
}

function installMomentsShikiBridge() {
  if (shikiMomentsListenerInstalled) return;
  shikiMomentsListenerInstalled = true;
  if (window.__themeShikiBridge?.version !== 1) {
    window.__themeShikiBridge = createShikiIncrementalBridge();
  }

  window.addEventListener('moments:feed-updated', (event) => {
    const root = event?.detail?.root;
    if (!root || typeof root.querySelectorAll !== 'function' || !root.isConnected) return;

    const currentMomentsRoot = document.querySelector('[data-app-root="moments"]');
    if (!currentMomentsRoot || (root !== currentMomentsRoot && !currentMomentsRoot.contains(root))) return;
    if (!shikiRenderDescriptor) return;

    const descriptor = shikiRenderDescriptor;
    const renderIncrement = () => {
      const liveMomentsRoot = document.querySelector('[data-app-root="moments"]');
      if (!root.isConnected || !liveMomentsRoot || !liveMomentsRoot.contains(root)) return;
      if (shikiRenderDescriptor?.key !== descriptor.key) return;
      queueShikiBridgeRender(descriptor, root);
    };
    if (document.readyState === 'loading') {
      // plugin-shiki's own DOMContentLoaded renderer owns the initial pass. Run
      // afterwards so restored waterfall cards cannot be wrapped twice.
      document.addEventListener('DOMContentLoaded', () => setTimeout(renderIncrement, 0), { once: true });
      return;
    }
    renderIncrement();
  });
}

export function initializeShikiBridge(reconcileInitial = true) {
  if (initialized) return;
  initialized = true;
  shikiRenderDescriptor = reconcileInitial ? readShikiRenderDescriptor(document) : null;
  installMomentsShikiBridge();
  if (!reconcileInitial) return;
  // Loading this optional bridge can finish after the initial feed event.
  // Reconcile the live root after the official initial renderer has run.
  const render = () => {
    const root = document.querySelector('[data-app-root="moments"]');
    if (root) queueShikiBridgeRender(shikiRenderDescriptor, root);
  };
  if (document.readyState !== 'complete') {
    window.addEventListener('load', render, { once: true });
  } else render();
}
