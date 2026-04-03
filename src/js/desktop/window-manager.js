/**
 * 全局窗口状态管理 Store + 菜单栏 + 主题 + Dock
 */

import { resolveThemeMode, applyRootThemeState } from '../shared/theme.js';
import { openSearchWidget } from './search.js';
import { runGenieAnimation } from './window.js';
import { createLogger } from '../shared/debug.js';

const { log: wmLog } = createLogger('window');

export function registerWindowManager(Alpine) {
  // =========== 主题管理 ===========
  Alpine.store('theme', {
    mode: 'system',
    isDark: false,
    
    init() {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.mode === 'system') {
          this.applyTheme();
        }
      });

      this.refresh();

      window.addEventListener('pageshow', () => {
        this.refresh();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refresh();
        }
      });

      document.addEventListener('pjax:complete', () => {
        this.refresh();
      });
    },

    setMode(newMode) {
      this.mode = newMode;
      localStorage.setItem('theme', newMode);
      this.applyTheme();
    },

    refresh() {
      this.mode = resolveThemeMode();
      this.applyTheme();
    },

    applyTheme() {
      this.isDark = applyRootThemeState(this.mode, this.mediaQuery);
    }
  });

  // =========== 菜单栏 ===========
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

  // =========== 全局窗口控制 Store ===========
  Alpine.store('windowManager', {
    show: false,
    minimized: false,
    title: document.title,
    isAnimating: false,
    animationToken: 0,
    pendingOpenTitle: '',
    pendingOpenRequested: false,
    
    init() {
      try {
        const stored = localStorage.getItem('theme-macOS-window-state');
        if (stored) {
          const state = JSON.parse(stored);
          this.show = state.show;
          this.minimized = state.minimized;
        }
      } catch(e) {}

      if (window.location.pathname === '/') {
        this.showDesktop();
      }
      wmLog('init', { show: this.show, minimized: this.minimized, path: window.location.pathname });
    },

    sync() {
       localStorage.setItem('theme-macOS-window-state', JSON.stringify({
          show: this.show,
          minimized: this.minimized
       }));
    },

    queueOpen(title) {
      this.pendingOpenRequested = true;
      this.pendingOpenTitle = title || document.title || this.title;
    },

    flushPendingOpen() {
      if (!this.pendingOpenRequested) return;
      const nextTitle = this.pendingOpenTitle;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.open(nextTitle);
    },

    restoreWindowSurface() {
      const winEl = document.querySelector('.macos-window');
      if (!winEl) return null;

      winEl.style.visibility = 'visible';
      winEl.style.opacity = '1';
      winEl.style.pointerEvents = 'auto';

      if (window.innerWidth >= 768) {
        winEl.style.transform = 'none';
      } else {
        winEl.style.transform = '';
        winEl.style.left = '';
        winEl.style.top = '';
      }

      const titlebar = winEl.querySelector('.window-titlebar');
      if (titlebar) {
        titlebar.style.opacity = '';
        titlebar.style.backdropFilter = '';
        titlebar.style.webkitBackdropFilter = '';
      }

      return winEl;
    },

    prepareWindowSurfaceForRestore(winEl = document.querySelector('.macos-window')) {
      if (!winEl) return null;

      const titlebar = winEl.querySelector('.window-titlebar');
      if (titlebar) {
        titlebar.style.opacity = '';
        titlebar.style.backdropFilter = '';
        titlebar.style.webkitBackdropFilter = '';
      }

      return winEl;
    },

    invalidateAnimation() {
      this.animationToken += 1;
      this.isAnimating = false;
    },

    revealAfterNavigation(title) {
      if (title) this.title = title;
      this.invalidateAnimation();
      this.show = true;
      this.minimized = false;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.restoreWindowSurface();
      this.sync();
    },

    showDesktop() {
      wmLog('showDesktop');
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.animationToken += 1;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.sync();
    },

    open(title) {
      wmLog('open', { title, show: this.show, minimized: this.minimized, isAnimating: this.isAnimating });
      if (title) this.title = title;
      if (this.isAnimating) {
        this.queueOpen(title);
        return;
      }
      if (this.minimized) {
        this.show = true;
        void this.restore(title);
        return;
      }
      this.show = true;
      this.minimized = false;
      this.sync();

      setTimeout(() => {
        const winEl = this.restoreWindowSurface();
        if (winEl) {
          winEl.style.transition = 'none';
        }
      }, 0);
    },
    
    hide() {
      wmLog('hide');
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.sync();
    },
    
    async minimize() {
      wmLog('minimize');
      if (this.isAnimating || this.minimized) return;
      const winEl = document.querySelector('.macos-window');
      if (!winEl) return;
      const animationToken = ++this.animationToken;

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
        this.flushPendingOpen();
        return;
      }

      const animPromise = runGenieAnimation({
        windowEl: winEl,
        dockEl: dockIcon,
        action: 'minimize'
      });
      winEl.style.visibility = 'hidden';
      const titlebar = winEl.querySelector('.window-titlebar');
      if (titlebar) {
        titlebar.style.opacity = '0';
        titlebar.style.backdropFilter = 'none';
        titlebar.style.webkitBackdropFilter = 'none';
      }

      const animated = await animPromise;

      if (animationToken !== this.animationToken) {
        return;
      }

      if (animated) {
        winEl.style.visibility = 'hidden';
        winEl.style.opacity = '1';
        winEl.style.transform = 'none';
        winEl.style.pointerEvents = 'none';
      }

      this.isAnimating = false;
      this.flushPendingOpen();
    },
    
    async restore(nextTitle) {
       wmLog('restore', { nextTitle });
       if (nextTitle) this.title = nextTitle;
       if (this.isAnimating || !this.minimized) return;
       const animationToken = ++this.animationToken;
       this.isAnimating = true;
       this.show = true;

       const winEl = document.querySelector('.macos-window');
       const dockIcon = document.getElementById('minimized-dock-icon');

       if (winEl && dockIcon) {
         dockIcon.style.opacity = '0';

         this.prepareWindowSurfaceForRestore(winEl);

         winEl.style.visibility = 'hidden';
         winEl.style.opacity = '1';
         winEl.style.transform = 'none';

         await runGenieAnimation({
           windowEl: winEl,
           dockEl: dockIcon,
           action: 'restore',
           onBeforeFinish: () => {
             if (animationToken === this.animationToken) {
               this.restoreWindowSurface();
             }
           }
         });

         if (animationToken !== this.animationToken) {
           return;
         }

         this.minimized = false;
         this.isAnimating = false;
         this.sync();
       } else {
         if (animationToken !== this.animationToken) {
           return;
         }
         this.restoreWindowSurface();
         this.minimized = false;
         this.isAnimating = false;
         this.sync();
       }

       this.flushPendingOpen();
    }
  });

  // =========== Dock 物理级高斯放大引擎 ===========
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
}
