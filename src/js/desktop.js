import Pjax from 'pjax';
import NProgress from 'nprogress';

let archiveSidebarCleanup = null;

function replayPjaxScripts(root) {
  if (!root) return;

  root.querySelectorAll('script[data-pjax]').forEach((oldScript) => {
    const script = document.createElement('script');

    Array.from(oldScript.attributes).forEach((attr) => {
      script.setAttribute(attr.name, attr.value);
    });

    script.textContent = oldScript.textContent;
    oldScript.replaceWith(script);
  });
}

function stripClonedIdsAndAlpine(node) {
  if (!node || !node.querySelectorAll) return;
  
  // Recursively strip IDs and Alpine bindings to prevent framework conflicts
  const elements = [node, ...node.querySelectorAll('*')];
  elements.forEach(el => {
    el.removeAttribute('id');
    // Strip Alpine directives (e.g. x-data, x-show, @click)
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('x-') || attr.name.startsWith('@')) {
        el.removeAttribute(attr.name);
      }
    });
  });
}

function createGenieGhost(sourceWindowEl) {
  const ghostWrapper = document.createElement('div');
  const ghostInner = sourceWindowEl.cloneNode(true);

  stripClonedIdsAndAlpine(ghostInner);

  ghostWrapper.className = 'genie-ghost-wrapper';
  ghostInner.classList.add('genie-ghost-window');

  Object.assign(ghostWrapper.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    zIndex: '10001',
    pointerEvents: 'none',
    overflow: 'visible'
  });

  Object.assign(ghostInner.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    resize: 'none',
    pointerEvents: 'none',
    visibility: 'visible',
    overflow: 'hidden'
  });

  ghostWrapper.appendChild(ghostInner);
  document.body.appendChild(ghostWrapper);

  return { ghostWrapper, ghostInner };
}

function runGenieAnimation({ windowEl, dockEl, action, duration = 420 }) {
  if (!windowEl || !dockEl) return Promise.resolve(false);

  const windowRect = windowEl.getBoundingClientRect();
  const targetGraphic = dockEl.querySelector('svg') || dockEl;
  const dockRect = targetGraphic.getBoundingClientRect();
  const { ghostWrapper, ghostInner } = createGenieGhost(windowEl);

  ghostWrapper.style.left = `${windowRect.left}px`;
  ghostWrapper.style.top = `${windowRect.top}px`;
  ghostWrapper.style.width = `${windowRect.width}px`;
  ghostWrapper.style.height = `${windowRect.height}px`;

  const windowCenterX = windowRect.left + windowRect.width / 2;
  const windowCenterY = windowRect.top + windowRect.height / 2;
  const dockCenterX = dockRect.left + dockRect.width / 2;
  const dockCenterY = dockRect.top + dockRect.height / 2;

  const destX = dockCenterX - windowCenterX;
  const destY = dockCenterY - windowCenterY;
  const scaleX = dockRect.width / windowRect.width;
  const scaleY = dockRect.height / windowRect.height;

  const easeIn = 'cubic-bezier(0.7, 0, 1, 1)';
  const easeOut = 'cubic-bezier(0, 0, 0.3, 1)';

  const yFrames = action === 'minimize'
    ? [{ transform: 'translateY(0px)' }, { transform: `translateY(${destY}px)` }]
    : [{ transform: `translateY(${destY}px)` }, { transform: 'translateY(0px)' }];

  const xFrames = action === 'minimize'
    ? [
        { transform: 'translateX(0px) scale(1, 1)' },
        { transform: `translateX(${destX}px) scale(${scaleX}, ${scaleY})` }
      ]
    : [
        { transform: `translateX(${destX}px) scale(${scaleX}, ${scaleY})` },
        { transform: 'translateX(0px) scale(1, 1)' }
      ];

  const wrapperAnimation = ghostWrapper.animate(yFrames, {
    duration,
    easing: action === 'minimize' ? easeIn : easeOut,
    fill: 'forwards'
  });

  const innerAnimation = ghostInner.animate(xFrames, {
    duration,
    easing: action === 'minimize' ? easeOut : easeIn,
    fill: 'forwards'
  });

  return new Promise((resolve) => {
    innerAnimation.onfinish = () => {
      wrapperAnimation.cancel();
      innerAnimation.cancel();
      ghostWrapper.remove();
      resolve(true);
    };

    innerAnimation.oncancel = () => {
      ghostWrapper.remove();
      resolve(false);
    };
  });
}

function openSearchWidget() {
  if (typeof window.SearchWidget?.open === 'function') {
    window.SearchWidget.open();
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('search-modal').forEach(injectSearchModalStyles);
      }, 0);
    });
    return true;
  }
  return false;
}

function injectSearchModalStyles(modalEl) {
  const root = modalEl?.shadowRoot;
  if (!root || root.getElementById('mac-search-style')) return;

  const style = document.createElement('style');
  style.id = 'mac-search-style';
  style.textContent = `
    :host {
      --mac-search-panel-border-light: rgba(255, 255, 255, 0.55);
      --mac-search-panel-border-dark: rgba(255, 255, 255, 0.08);
      --mac-search-panel-shadow-light: 0 36px 88px rgba(15, 23, 42, 0.20);
      --mac-search-panel-shadow-dark: 0 36px 96px rgba(0, 0, 0, 0.55);
      --mac-search-form-light: rgba(255, 255, 255, 0.72);
      --mac-search-form-dark: rgba(44, 44, 46, 0.82);
      --mac-search-list-hover-light: rgba(15, 23, 42, 0.045);
      --mac-search-list-hover-dark: rgba(255, 255, 255, 0.06);
      --mac-search-kbd-light: rgba(255, 255, 255, 0.78);
      --mac-search-kbd-dark: rgba(58, 58, 60, 0.92);
      color-scheme: light;
    }

    :host-context(.dark),
    :host-context([data-color-scheme='dark']) {
      color-scheme: dark;
    }

    .modal__wrapper {
      align-items: flex-start !important;
      justify-content: center !important;
      padding: clamp(68px, 12vh, 120px) 16px 24px !important;
    }

    .modal__layer {
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    .modal__content {
      width: min(720px, calc(100vw - 32px)) !important;
      max-height: min(78vh, 760px) !important;
      overflow: hidden !important;
      border-radius: 24px !important;
      border: 1px solid var(--mac-search-panel-border-light) !important;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.76), rgba(248, 248, 250, 0.82)) !important;
      box-shadow: var(--mac-search-panel-shadow-light), inset 0 1px 0 rgba(255, 255, 255, 0.42) !important;
      backdrop-filter: blur(34px) saturate(180%) !important;
      -webkit-backdrop-filter: blur(34px) saturate(180%) !important;
    }

    :host-context(.dark) .modal__content,
    :host-context([data-color-scheme='dark']) .modal__content {
      border-color: var(--mac-search-panel-border-dark) !important;
      background: linear-gradient(to bottom, rgba(34, 34, 36, 0.82), rgba(28, 28, 30, 0.88)) !important;
      box-shadow: var(--mac-search-panel-shadow-dark), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
    }

    .modal__content > div:first-child,
    .modal__content > div:last-child {
      background: transparent !important;
    }

    .modal__content > div:first-child {
      border-bottom-width: 1px !important;
      border-bottom-color: var(--halo-search-widget-divider-color) !important;
      padding: 16px !important;
    }

    .modal__content > div:last-child {
      border-top-width: 1px !important;
      border-top-color: var(--halo-search-widget-divider-color) !important;
      padding: 12px 16px !important;
    }

    .modal__content form {
      height: 54px !important;
      border-radius: 16px !important;
      background: var(--mac-search-form-light) !important;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45) !important;
      backdrop-filter: blur(20px) saturate(150%) !important;
      -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
    }

    :host-context(.dark) .modal__content form,
    :host-context([data-color-scheme='dark']) .modal__content form {
      background: var(--mac-search-form-dark) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
    }

    .modal__content input {
      font-size: 15px !important;
      letter-spacing: -0.01em !important;
    }

    .modal__content input::placeholder {
      color: var(--halo-search-widget-muted-color) !important;
    }

    .modal__content li[data-index] {
      border: 1px solid transparent !important;
      border-radius: 14px !important;
      transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease !important;
      background: var(--halo-search-widget-hit-bg-color) !important;
      box-shadow: none !important;
    }

    .modal__content li[data-index]:hover {
      transform: translateY(-1px) !important;
      background: var(--mac-search-list-hover-light) !important;
      border-color: rgba(15, 23, 42, 0.06) !important;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06) !important;
    }

    :host-context(.dark) .modal__content li[data-index]:hover,
    :host-context([data-color-scheme='dark']) .modal__content li[data-index]:hover {
      background: var(--mac-search-list-hover-dark) !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22) !important;
    }

    .modal__content li[data-index][class*='!bg-primary'] {
      border-color: transparent !important;
      box-shadow: 0 10px 22px color-mix(in srgb, var(--halo-search-widget-primary-color) 20%, transparent) !important;
    }

    .modal__content kbd {
      min-width: 28px !important;
      min-height: 28px !important;
      border-radius: 10px !important;
      background: var(--mac-search-kbd-light) !important;
      border-color: var(--halo-search-widget-kbd-border-color) !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.36), var(--halo-search-widget-kbd-shadow) !important;
    }

    :host-context(.dark) .modal__content kbd,
    :host-context([data-color-scheme='dark']) .modal__content kbd {
      background: var(--mac-search-kbd-dark) !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05), var(--halo-search-widget-kbd-shadow) !important;
    }

    .modal__content mark {
      color: var(--halo-search-widget-primary-color) !important;
      background: transparent !important;
    }
  `;

  root.appendChild(style);
}

function observeSearchWidget() {
  const scan = () => {
    document.querySelectorAll('search-modal').forEach(injectSearchModalStyles);
  };

  scan();

  const observer = new MutationObserver(() => {
    scan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function initArchiveSidebar(root = document) {
  const sidebarLinks = Array.from(root.querySelectorAll('[data-archive-sidebar-link]'));
  const yearGroups = Array.from(root.querySelectorAll('[data-archive-year-group]'));

  if (!sidebarLinks.length || !yearGroups.length) return;

  const setActiveYear = (year) => {
    sidebarLinks.forEach((link) => {
      const active = link.dataset.archiveYear === year;
      link.classList.toggle('is-active', active);
      link.setAttribute('aria-current', active ? 'true' : 'false');
    });
  };

  const pickClosestYear = () => {
    const threshold = 120;
    let currentYear = yearGroups[0]?.dataset.archiveYear;

    yearGroups.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= threshold) {
        currentYear = section.dataset.archiveYear;
      }
    });

    if (currentYear) setActiveYear(currentYear);
  };

  const syncFromHash = () => {
    const hash = decodeURIComponent(window.location.hash || '');
    const matched = hash.match(/^#archive-year-(.+)$/);
    if (matched?.[1]) {
      setActiveYear(matched[1]);
      return true;
    }
    return false;
  };

  sidebarLinks.forEach((link) => {
    if (link.dataset.archiveSidebarBound === 'true') return;

    link.dataset.archiveSidebarBound = 'true';
    link.addEventListener('click', () => {
      const year = link.dataset.archiveYear;
      if (year) setActiveYear(year);
    });
  });

  if (!syncFromHash()) {
    pickClosestYear();
  }

  const onScroll = () => pickClosestYear();
  const onHashChange = () => syncFromHash() || pickClosestYear();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', onHashChange);

  if (typeof archiveSidebarCleanup === 'function') {
    archiveSidebarCleanup();
  }

  archiveSidebarCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('hashchange', onHashChange);
  };
}

/**
 * macOS 简易单主窗静态渲染框架 + Pjax 获取
 */
export function registerComponents(Alpine) {
  
  // =========== 1. 全局真单页 Pjax 引擎初始化 ===========
  setTimeout(() => {
    
    // 初始化 Pjax，接管桌面图标和 Dock 的普通 a 链接跳转
    const pjax = new Pjax({
      selectors: ["title", "#pjax-container"],
      cacheBust: false,
      elements: "a:not([target='_blank'])" 
    });
    
    // 把实例抛给 window 供其它行内脚本或 Alpine.js 指令自由调用
    window.pjax = pjax;

    document.addEventListener("pjax:send", () => {
      NProgress.start();
      const container = document.getElementById('pjax-container');
      if (container) container.classList.add('pjax-loading');
    });
    
    document.addEventListener("pjax:complete", () => {
      NProgress.done();
      const container = document.getElementById('pjax-container');
      if (container) {
        replayPjaxScripts(container);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(container);
        }

        // 利用 RequestAnimationFrame 保证 DOM 插入后再生效 CSS
        requestAnimationFrame(() => {
          container.classList.remove('pjax-loading');
        });

        initArchiveSidebar(container);
      }
      
      // 如果不是因为点击关闭按钮而触发的 pjax，正常弹出窗口
      if (window.preventAutoOpen) {
        window.preventAutoOpen = false; // 消耗掉该次状态
      } else {
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });
    document.addEventListener("pjax:error", () => NProgress.done());

    // 拦截主题内部可导航链接，保证切页前先显示主窗口
    document.body.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && !link.target && !link.hasAttribute('download') && !link.href.startsWith('javascript:')) {
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);

  // =========== 2. 主题管理 (Apple Style) ===========
  // 负责全局暗黑模式的状态及系统跟随
  Alpine.store('theme', {
    mode: 'system', // 'light', 'dark', 'system'
    isDark: false,
    
    init() {
      // 1. 获取后端默认配置 (通过 html dataset 获取)
      const defaultTheme = document.documentElement.dataset.defaultTheme || 'system';
      
      // 2. 尝试从 localStorage 获取用户主动选择的偏好
      const savedTheme = localStorage.getItem('theme');
      this.mode = savedTheme || defaultTheme;

      // 3. 监听系统偏好变化
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.mode === 'system') {
          this.applyTheme();
        }
      });

      // 4. 应用主题
      this.applyTheme();
    },

    setMode(newMode) {
      this.mode = newMode;
      localStorage.setItem('theme', newMode);
      this.applyTheme();
    },

    applyTheme() {
      if (this.mode === 'dark') {
        this.isDark = true;
      } else if (this.mode === 'light') {
        this.isDark = false;
      } else {
        // system
        this.isDark = !!this.mediaQuery?.matches;
      }

      if (this.isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  });

  // =========== 3. 菜单栏 ===========
  Alpine.data('menuBar', () => ({
    timeStr: '',
    appName: '',
    init() {
      this.appName = this.$el?.dataset?.siteTitle || '';
      this.tick();
      setInterval(() => this.tick(), 1000);
    },
    openSearch() {
      openSearchWidget();
    },
    tick() {
      const d = new Date();
      const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
      const timeStr = d.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: true });
      this.timeStr = dateStr.replace(/ /g, '') + ' ' + timeStr;
    }
  }));

  Alpine.data('archiveExplorer', () => ({
    activeYear: '',
    activeYearLabel: '',
    activeMonthKey: '',
    activeMonthLabel: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstYear = this.$root.querySelector('[data-archive-year-option]');
      if (!firstYear) return;
      this.selectYear(firstYear.dataset.year, firstYear.dataset.yearLabel);
    },

    selectYear(year, label) {
      this.activeYear = year || '';
      this.activeYearLabel = label || '';

      const firstMonth = Array.from(this.$root.querySelectorAll('[data-archive-month-option]'))
        .find((el) => el.dataset.parentYear === this.activeYear);

      if (firstMonth) {
        this.selectMonth(firstMonth.dataset.monthKey, firstMonth.dataset.monthLabel);
      } else {
        this.activeMonthKey = '';
        this.activeMonthLabel = '';
        this.activePostKey = '';
        this.activePostTitle = '';
      }
    },

    selectMonth(monthKey, label) {
      this.activeMonthKey = monthKey || '';
      this.activeMonthLabel = label || '';

      const firstPost = Array.from(this.$root.querySelectorAll('[data-archive-post-option]'))
        .find((el) => el.dataset.parentMonthKey === this.activeMonthKey);

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('tagsExplorer', () => ({
    activeTagKey: '',
    activeTagPage: 1,
    activeTagName: '',
    activeTagHref: '',
    activeTagCount: '',
    activeTagColor: '',
    activeTagCover: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstTag = this.$root.querySelector('[data-tags-folder]');
      if (!firstTag) return;
      this.selectTag(firstTag.dataset.tagKey, firstTag.dataset.tagName, firstTag.dataset.tagHref, firstTag.dataset.tagCount, firstTag.dataset.tagColor, firstTag.dataset.tagCover);
    },

    selectTag(key, name, href, count, color, cover) {
      this.activeTagKey = key || '';
      this.activeTagPage = 1;
      this.activeTagName = name || '';
      this.activeTagHref = href || '';
      this.activeTagCount = count || '';
      this.activeTagColor = color || '';
      this.activeTagCover = cover || '';
      this.syncTagPosts();
    },

    selectTagPage(page) {
      const nextPage = Number(page) || 1;
      if (nextPage < 1) return;
      this.activeTagPage = nextPage;
      this.syncTagPosts();
    },

    syncTagPosts() {
      const firstPost = Array.from(this.$root.querySelectorAll('[data-tags-post-option]'))
        .find((el) => (
          el.dataset.parentTagKey === this.activeTagKey &&
          Number(el.dataset.tagPage || '1') === this.activeTagPage
        ));

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }

      const postsScroll = this.$root.querySelector('.tag-posts-scroll');
      if (postsScroll) {
        postsScroll.scrollTop = 0;
      }

      const previewScroll = this.$root.querySelector('.tags-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('tagPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstPost = this.$root.querySelector('[data-tag-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('categoriesExplorer', () => ({
    activeCategoryKey: '',
    activeCategoryPage: 1,
    activeCategoryName: '',
    activeCategoryHref: '',
    activeCategoryCount: '',
    activeCategoryDescription: '',
    activeCategoryCover: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstCategory = this.$root.querySelector('[data-categories-folder]');
      if (!firstCategory) return;
      this.selectCategory(
        firstCategory.dataset.categoryKey,
        firstCategory.dataset.categoryName,
        firstCategory.dataset.categoryHref,
        firstCategory.dataset.categoryCount,
        firstCategory.dataset.categoryDescription,
        firstCategory.dataset.categoryCover
      );
    },

    selectCategory(key, name, href, count, description, cover) {
      this.activeCategoryKey = key || '';
      this.activeCategoryPage = 1;
      this.activeCategoryName = name || '';
      this.activeCategoryHref = href || '';
      this.activeCategoryCount = count || '';
      this.activeCategoryDescription = description || '';
      this.activeCategoryCover = cover || '';
      this.syncCategoryPosts();
    },

    selectCategoryPage(page) {
      const nextPage = Number(page) || 1;
      if (nextPage < 1) return;
      this.activeCategoryPage = nextPage;
      this.syncCategoryPosts();
    },

    syncCategoryPosts() {
      const firstPost = Array.from(this.$root.querySelectorAll('[data-categories-post-option]'))
        .find((el) => (
          el.dataset.parentCategoryKey === this.activeCategoryKey &&
          Number(el.dataset.categoryPage || '1') === this.activeCategoryPage
        ));

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }

      const postsScroll = this.$root.querySelector('.category-posts-scroll');
      if (postsScroll) {
        postsScroll.scrollTop = 0;
      }

      const previewScroll = this.$root.querySelector('.categories-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('categoryPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstPost = this.$root.querySelector('[data-category-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  // =========== 4. 全局窗口控制 Store ===========
  Alpine.store('windowManager', {
    show: false,
    minimized: false,
    title: document.title,
    isAnimating: false,
    
    init() {
      try {
        const stored = localStorage.getItem('theme-macOS-window-state');
        if (stored) {
          const state = JSON.parse(stored);
          this.show = state.show;
          this.minimized = state.minimized;
        }
      } catch(e) {}
    },

    sync() {
       localStorage.setItem('theme-macOS-window-state', JSON.stringify({
          show: this.show,
          minimized: this.minimized
       }));
    },

    open(title) {
      if (this.minimized) {
        this.restore();
        return;
      }
      if (title) this.title = title;
      this.show = true;
      this.minimized = false;
      this.sync();

      setTimeout(() => {
        const winEl = document.querySelector('.macos-window');
        if (winEl) {
          winEl.style.transition = 'none';
          winEl.style.transform = 'none';
          winEl.style.opacity = '1';
          winEl.style.visibility = 'visible';
          winEl.style.pointerEvents = 'auto';
        }
      }, 0);
    },
    
    hide() {
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.sync();
    },
    
    async minimize() {
      if (this.isAnimating || this.minimized) return;
      const winEl = document.querySelector('.macos-window');
      if (!winEl) return;

      this.minimized = true;
      this.sync();
      this.isAnimating = true;

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const dockIcon = document.getElementById('minimized-dock-icon');
      if (!dockIcon) {
        winEl.style.visibility = 'hidden';
        winEl.style.opacity = '1';
        winEl.style.transform = 'none';
        winEl.style.pointerEvents = 'none';
        this.isAnimating = false;
        return;
      }

      // 强行同步剔除原身视觉残留，只保留替身演出
      const animPromise = runGenieAnimation({
        windowEl: winEl,
        dockEl: dockIcon,
        action: 'minimize'
      });
      winEl.style.visibility = 'hidden';
      // 修复 titlebar 的独立合成层残留 bug
      const titlebar = winEl.querySelector('.window-titlebar');
      if (titlebar) {
        titlebar.style.opacity = '0';
        titlebar.style.backdropFilter = 'none';
        titlebar.style.webkitBackdropFilter = 'none';
      }

      const animated = await animPromise;

      if (animated) {
        winEl.style.visibility = 'hidden';
        winEl.style.opacity = '1';
        winEl.style.transform = 'none';
        winEl.style.pointerEvents = 'none';
      }

      this.isAnimating = false;
    },
    
    async restore() {
       if (this.isAnimating || !this.minimized) return;
       this.isAnimating = true;

       const winEl = document.querySelector('.macos-window');
       const dockIcon = document.getElementById('minimized-dock-icon');

       if (winEl && dockIcon) {
         // 先剔除 Dock 图标，制造其“脱壳飞出”的视觉假象
         dockIcon.style.opacity = '0';
         
         winEl.style.visibility = 'hidden';
         winEl.style.opacity = '1';
         winEl.style.transform = 'none';

         await runGenieAnimation({
           windowEl: winEl,
           dockEl: dockIcon,
           action: 'restore'
         });

         winEl.style.visibility = 'visible';
         winEl.style.pointerEvents = 'auto';
         
         const titlebar = winEl.querySelector('.window-titlebar');
         if (titlebar) {
           titlebar.style.opacity = '';
           titlebar.style.backdropFilter = '';
           titlebar.style.webkitBackdropFilter = '';
         }
         
         this.minimized = false;
         this.isAnimating = false;
         this.sync();
       } else {
         this.minimized = false;
         this.isAnimating = false;
         this.sync();
       }
    }
  });

  // =========== 4.5 拖拽与缩放窗口引擎 ===========
  Alpine.data('draggableWindow', () => ({
    isDragging: false,
    isMaximized: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    preMaxX: 0,
    preMaxY: 0,
    preMaxWidth: 0,
    preMaxHeight: 0,
    isDesktop: window.innerWidth >= 768,
    windowEl: null,

    applyResizeMode() {
      if (!this.windowEl) return;

      if (!this.isDesktop || this.isMaximized) {
        this.windowEl.style.resize = 'none';
        if (!this.isDesktop) {
          this.windowEl.style.borderRadius = '';
        } else if (this.isMaximized) {
          this.windowEl.style.borderRadius = '0';
        }
        return;
      }

      this.windowEl.style.resize = 'both';
      this.windowEl.style.borderRadius = '';
    },

    syncState() {
      if (!this.isDesktop) return;
      localStorage.setItem('theme-macOS-window-metrics', JSON.stringify({
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        isMaximized: this.isMaximized,
        preMaxX: this.preMaxX,
        preMaxY: this.preMaxY,
        preMaxWidth: this.preMaxWidth,
        preMaxHeight: this.preMaxHeight
      }));
    },

    init() {
      this.windowEl = this.$el;
      
      try {
        const storedStr = localStorage.getItem('theme-macOS-window-metrics');
        if (storedStr) {
          const stored = JSON.parse(storedStr);
          this.x = stored.x || 0;
          this.y = stored.y || 0;
          this.width = stored.width || 0;
          this.height = stored.height || 0;
          this.isMaximized = stored.isMaximized || false;
          this.preMaxX = stored.preMaxX || 0;
          this.preMaxY = stored.preMaxY || 0;
          this.preMaxWidth = stored.preMaxWidth || 0;
          this.preMaxHeight = stored.preMaxHeight || 0;
        }
      } catch(e) {}

      if (this.width === 0) this.updateMeasurements();
      else if (this.isDesktop) {
         this.windowEl.style.width = `${this.width}px`;
         this.windowEl.style.height = `${this.height}px`;
         this.applyTransform();
      }

      this.applyResizeMode();

      if (this.isDesktop && window.ResizeObserver) {
        let resizeTimeout;
        const ro = new ResizeObserver(() => {
          if (this.isMaximized) return;
          const newW = this.windowEl.offsetWidth;
          const newH = this.windowEl.offsetHeight;
          if (newW && newH && (this.width !== newW || this.height !== newH)) {
             this.width = newW;
             this.height = newH;
             clearTimeout(resizeTimeout);
             resizeTimeout = setTimeout(() => this.syncState(), 400);
          }
        });
        ro.observe(this.windowEl);
      }
      
      const resizeHandler = () => {
        this.isDesktop = window.innerWidth >= 768;
        if (!this.isDesktop) {
          this.windowEl.style.transform = '';
          this.windowEl.style.left = '';
          this.windowEl.style.top = '';
          this.windowEl.style.width = '100%';
          this.windowEl.style.height = '100%';
        } else {
           if (this.width === 0) this.updateMeasurements();
           if (this.isMaximized) {
             this.width = window.innerWidth;
             this.height = window.innerHeight - 28;
             this.windowEl.style.width = `${this.width}px`;
             this.windowEl.style.height = `${this.height}px`;
             this.syncState();
           }
           this.clampPositions(); 
           this.applyTransform();
        }
        this.applyResizeMode();
      };
      // Debounce window resize
      let timeout;
      window.addEventListener('resize', () => {
        clearTimeout(timeout);
        timeout = setTimeout(resizeHandler, 100);
      });

      // 初始化显示逻辑
      const isHome = window.location.pathname === '/';

      // 深链接页面必须优先于本地窗口缓存，否则文章/单页会继承首页的关窗或最小化状态。
      if (!isHome) {
        this.$store.windowManager.minimized = false;
        this.$store.windowManager.open(document.title);
      } else if (this.$store.windowManager.minimized) {
        this.windowEl.style.transition = 'none';
        this.windowEl.style.opacity = '0';
        this.windowEl.style.visibility = 'hidden';
        this.windowEl.style.pointerEvents = 'none';
        this.windowEl.style.transform = 'none';
      }
    },

    updateMeasurements() {
       if (this.isDesktop) {
         this.width = Math.min(1200, window.innerWidth * 0.85);
         this.height = Math.min(900, Math.max(500, window.innerHeight * 0.85));
         this.x = (window.innerWidth - this.width) / 2;
         this.y = Math.max(28, (window.innerHeight - this.height) / 2);
         
         const winEl = document.querySelector('.macos-window');
         if(winEl) {
           winEl.style.width = `${this.width}px`;
           winEl.style.height = `${this.height}px`;
         }
         this.applyTransform();
         this.applyResizeMode();
         this.syncState();
       }
    },

    clampPositions() {
       if (!this.isDesktop || this.isMaximized) return;
       const maxX = window.innerWidth - 80;
       const maxY = window.innerHeight - 40;
       const minX = -this.width + 80;
       const minY = 28; // MenuBar margin

       if (this.x > maxX) this.x = maxX;
       if (this.x < minX) this.x = minX;
       if (this.y > maxY) this.y = maxY;
       if (this.y < minY) this.y = minY;
    },

    applyTransform() {
       if (!this.isDesktop) return;
       const winEl = document.querySelector('.macos-window');
       if(winEl) {
         winEl.style.left = `${this.x}px`;
         winEl.style.top = `${this.y}px`;
         winEl.style.transform = 'none';
       }
    },

    toggleMaximize() {
      if (!this.isDesktop) return;
      const winEl = document.querySelector('.macos-window');
      if (!winEl) return;
      
      winEl.style.transition = 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
      if (this.isMaximized) {
        this.width = this.preMaxWidth;
        this.height = this.preMaxHeight;
        this.x = this.preMaxX;
        this.y = this.preMaxY;
        winEl.style.width = `${this.width}px`;
        winEl.style.height = `${this.height}px`;
        this.applyTransform();
        this.isMaximized = false;
      } else {
        this.preMaxWidth = winEl.offsetWidth;
        this.preMaxHeight = winEl.offsetHeight;
        this.preMaxX = this.x;
        this.preMaxY = this.y;
        
        this.width = window.innerWidth;
        this.height = window.innerHeight - 28;
        this.x = 0;
        this.y = 28;
        
        winEl.style.width = `${this.width}px`;
        winEl.style.height = `${this.height}px`;
        this.applyTransform();
        this.isMaximized = true;
      }
      this.applyResizeMode();
      this.syncState();
      
      setTimeout(() => {
        if (!this.isDragging) winEl.style.transition = '';
      }, 300);
    },

    onDragStart(e) {
      if (!this.isDesktop || this.isMaximized) return;
      if (e.target.closest('button, a, .traffic-lights, svg, .desktop-icon')) return;
      
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.initialX = this.x;
      this.initialY = this.y;
      
      const winEl = document.querySelector('.macos-window');
      if(winEl) winEl.style.transition = 'none'; 
    },

    onDragMove(e) {
      if (!this.isDragging) return;
      
      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      
      this.x = this.initialX + dx;
      this.y = this.initialY + dy;
      
      this.clampPositions();
      this.applyTransform();
    },

    onDragEnd() {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.$el.style.transition = ''; 
      
      this.width = this.$el.offsetWidth;
      this.height = this.$el.offsetHeight;
      this.syncState();
    },

    closeWindow() {
      const shouldReturnHome = window.location.pathname !== '/';

      this.$store.windowManager.hide();

      if (shouldReturnHome && window.pjax) {
        window.preventAutoOpen = true;
        window.setTimeout(() => window.pjax.loadUrl('/'), 180);
      }
    }
  }));

  // =========== 5. Dock 物理级高斯放大引擎 (1:1 标定) ===========
  Alpine.data('dock', () => ({
    init() {
      const dockBar = this.$refs.dockBar;
      if (!dockBar) return;
      const enableMagnification = this.$el.dataset.magnification !== 'false';
      const showLabels = this.$el.dataset.showLabels === 'true';
      
      const baseSize = 48;
      const maxSize = 60;
      const range = 120;
      const maxLift = 10;
      let rafId = null;

      const getIcons = () => Array.from(dockBar.querySelectorAll('.dock-icon'));
      const maxScale = maxSize / baseSize;

      const resetIcons = () => {
        getIcons().forEach((icon) => {
          icon.classList.add('dock-animating');
          icon.classList.remove('dock-tooltip-visible');
          icon.style.width = `${baseSize}px`;
          icon.style.height = `${baseSize}px`;
          icon.style.transform = 'translateY(0px)';
          icon.style.zIndex = '';
        });
      };

      const updateDock = (mouseX) => {
        const icons = getIcons();
        let tooltipTarget = null;
        let nearestDistance = Infinity;

        icons.forEach((icon) => {
          icon.classList.remove('dock-animating', 'dock-tooltip-visible');

          const rect = icon.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const distance = Math.abs(mouseX - centerX);

          let scale = 1;
          if (distance < range) {
            const ratio = distance / range;
            const influence = Math.cos(ratio * Math.PI / 2);
            const softenedInfluence = influence * influence;
            scale = 1 + (maxScale - 1) * softenedInfluence;
          }

          const lift = ((scale - 1) / (maxScale - 1)) * maxLift;
          icon.style.width = `${baseSize * scale}px`;
          icon.style.height = `${baseSize * scale}px`;
          icon.style.transform = `translateY(-${lift}px)`;
          icon.style.zIndex = String(10 + Math.round(scale * 10));

          if (distance < nearestDistance) {
            nearestDistance = distance;
            tooltipTarget = icon;
          }
        });

        if (showLabels && tooltipTarget && nearestDistance < range * 0.72) {
          tooltipTarget.classList.add('dock-tooltip-visible');
        }
      };

      this.$el.addEventListener('mousemove', (e) => {
        if (!enableMagnification) return;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => updateDock(e.clientX));
      });

      this.$el.addEventListener('mouseleave', () => {
        cancelAnimationFrame(rafId);
        requestAnimationFrame(resetIcons);
      });
    }
  }));

  // =========== 6. 桌面图标管理 ===========
  Alpine.data('desktopIcons', () => ({
    selectedId: null,

    select(id) { this.selectedId = id; },

    handleOutsideClick(e) {
      if (!e.target.closest('.desktop-icon')) {
        this.selectedId = null;
      }
    }
  }));

  observeSearchWidget();
  initArchiveSidebar(document);

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (openSearchWidget()) {
        event.preventDefault();
      }
    }
  });
}
