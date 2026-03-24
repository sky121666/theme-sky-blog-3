import Pjax from 'pjax';
import NProgress from 'nprogress';

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
      if (title) this.title = title;
      this.show = true;
      this.minimized = false;
      this.sync();
    },
    
    hide() {
      this.show = false;
      this.minimized = false;
      this.sync();
    },
    
    minimize() {
      this.show = false;
      this.minimized = true;
      this.sync();
    },
    
    restore() {
      this.show = true;
      this.minimized = false;
      this.sync();
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

    init() {
      this.windowEl = this.$el;
      this.updateMeasurements();
      
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
