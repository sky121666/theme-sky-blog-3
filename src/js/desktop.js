import Pjax from 'pjax';
import NProgress from 'nprogress';

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
        // 利用 RequestAnimationFrame 保证 DOM 插入后再生效 CSS
        requestAnimationFrame(() => {
          container.classList.remove('pjax-loading');
        });
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
    appName: 'Finder',
    init() {
      this.tick();
      setInterval(() => this.tick(), 1000);
    },
    tick() {
      const d = new Date();
      const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
      const timeStr = d.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: true });
      this.timeStr = dateStr.replace(/ /g, '') + ' ' + timeStr;
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
         if (this.isMaximized) {
            this.windowEl.style.resize = 'none';
            this.windowEl.style.borderRadius = '0';
         }
         this.windowEl.style.width = `${this.width}px`;
         this.windowEl.style.height = `${this.height}px`;
         this.applyTransform();
      }

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
      };
      // Debounce window resize
      let timeout;
      window.addEventListener('resize', () => {
        clearTimeout(timeout);
        timeout = setTimeout(resizeHandler, 100);
      });

      // 初始化显示逻辑
      if (!localStorage.getItem('theme-macOS-window-state')) {
        const homeBehavior = this.windowEl.dataset.homeBehavior || 'desktop-first';
        const isHome = window.location.pathname === '/';
        const shouldShow = !isHome || homeBehavior === 'window-first';
        
        if (shouldShow) {
          this.$store.windowManager.open(document.title);
        }
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
         this.y = (window.innerHeight - this.height) / 2;
         
         const winEl = document.querySelector('.macos-window');
         if(winEl) {
           winEl.style.width = `${this.width}px`;
           winEl.style.height = `${this.height}px`;
         }
         this.applyTransform();
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
        winEl.style.resize = 'both';
        winEl.style.borderRadius = ''; 
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
        winEl.style.resize = 'none';
        winEl.style.borderRadius = '0';
        this.isMaximized = true;
      }
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
      const closeAction = this.$root.dataset.closeAction || 'return-home';
      const shouldReturnHome = closeAction === 'return-home' && window.location.pathname !== '/';

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
      
      const baseSize = 48; // 固定底宽
      const maxSize = 64;  // 原生极限宽（1.33x克制放大）
      const range = 140;   // 影响半径：约辐射左右各2~3个图标

      const getIcons = () => Array.from(dockBar.querySelectorAll('.dock-icon'));

      this.$el.addEventListener('mousemove', (e) => {
        if (!enableMagnification) return;
        requestAnimationFrame(() => {
          getIcons().forEach(icon => {
            // 在计算期间接触平滑 CSS，交结 GPU 高频绘制
            icon.classList.remove('dock-animating');
            const rect = icon.getBoundingClientRect();
            // 精确计算鼠标X与当前图标几何中心的绝对距离
            const distance = Math.abs(e.clientX - (rect.left + rect.width / 2));
            
            let scale = 1;
            if (distance < range) {
              const ratio = distance / range;
              // 使用经典的余弦曲线 (Cosine Map) 配合 PI/2 生成极致顺滑的凸起钟形
              scale = 1 + (maxSize / baseSize - 1) * Math.cos(ratio * Math.PI / 2);
            }
            // 将平滑比例直接赋给物理宽高度（Flex 容器自带从右往左的顺滑排挤）
            icon.style.width = `${baseSize * scale}px`;
            icon.style.height = `${baseSize * scale}px`;
          });
        });
      });

      this.$el.addEventListener('mouseleave', () => {
        requestAnimationFrame(() => {
          getIcons().forEach(icon => {
            // 鼠标移出时归还控制权给 CSS Transition 的 ease-out 0.25s 曲线
            icon.classList.add('dock-animating');
            icon.style.width = `${baseSize}px`;
            icon.style.height = `${baseSize}px`;
          });
        });
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
}
