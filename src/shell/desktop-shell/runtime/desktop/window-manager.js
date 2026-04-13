/**
 * 全局窗口状态管理 Store + 菜单栏 + 主题 + Dock
 */

import { resolveThemeMode, applyRootThemeState } from '../shared/theme.js';
import { openSearchWidget } from './search.js';
import { runGenieAnimation } from './window.js';
import { createLogger } from '../shared/debug.js';

const { log: wmLog } = createLogger('window');
const HEADER_MOBILE_BREAKPOINT = 640;
const HEADER_TIME_PRESETS = new Set([
  'time-only',
  'time-seconds',
  'date-time',
  'weekday-date-time',
  'month-day-weekday-time'
]);

function parseBooleanData(value, fallback = false) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeHourCycle(value) {
  return String(value) === '24' ? '24' : '12';
}

function normalizeTimePreset(value, fallback = 'time-only') {
  return HEADER_TIME_PRESETS.has(value) ? value : fallback;
}

function formatDayPeriod(hours) {
  return hours < 12 ? '上午' : '下午';
}

function formatHeaderTime(date, preset, hourCycle) {
  const now = date instanceof Date ? date : new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const is24Hour = hourCycle === '24';
  const rawHours = now.getHours();
  const hourNumber = is24Hour ? rawHours : (rawHours % 12 || 12);
  const hourText = is24Hour ? String(hourNumber).padStart(2, '0') : String(hourNumber);
  const dayPeriod = is24Hour ? '' : `${formatDayPeriod(rawHours)} `;
  const timeText = `${dayPeriod}${hourText}:${minutes}`;
  const timeWithSecondsText = `${timeText}:${seconds}`;
  const dateText = `${month}月${day}日`;

  switch (preset) {
    case 'time-seconds':
      return timeWithSecondsText;
    case 'date-time':
      return `${dateText} ${timeText}`;
    case 'weekday-date-time':
      return `${weekday} ${dateText} ${timeText}`;
    case 'month-day-weekday-time':
      return `${dateText} ${weekday} ${timeText}`;
    case 'time-only':
    default:
      return timeText;
  }
}

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
    searchEnabled: true,
    mobileMenuEnabled: true,
    mobileMenuOpen: false,
    timeEnabled: true,
    timeDesktopPreset: 'month-day-weekday-time',
    timeMobilePreset: 'time-only',
    timeHourCycle: '12',
    init() {
      const dataset = this.$el?.dataset || {};
      this.appName = dataset.siteTitle || '';
      this.searchEnabled = parseBooleanData(dataset.searchEnabled, true);
      this.mobileMenuEnabled = parseBooleanData(dataset.mobileMenuEnabled, true);
      this.timeEnabled = parseBooleanData(dataset.timeEnabled, true);
      this.timeDesktopPreset = normalizeTimePreset(dataset.timeDesktopPreset, 'month-day-weekday-time');
      this.timeMobilePreset = normalizeTimePreset(dataset.timeMobilePreset, 'time-only');
      this.timeHourCycle = normalizeHourCycle(dataset.timeHourCycle);

      this.tick();
      this.tickTimer = window.setInterval(() => this.tick(), 1000);
      this.handleResize = () => {
        this.tick();
        if (window.innerWidth >= HEADER_MOBILE_BREAKPOINT) {
          this.closeMobileMenu();
        }
      };
      this.handlePjaxComplete = () => {
        this.closeMobileMenu();
        this.tick();
      };
      this.handleEscape = (event) => {
        if (event.key === 'Escape') {
          this.closeMobileMenu();
        }
      };
      window.addEventListener('resize', this.handleResize);
      document.addEventListener('pjax:complete', this.handlePjaxComplete);
      window.addEventListener('keydown', this.handleEscape);
    },
    openSearch() {
      if (!this.searchEnabled) return;
      this.closeMobileMenu();
      openSearchWidget();
    },
    toggleMobileMenu() {
      if (!this.mobileMenuEnabled) return;
      this.mobileMenuOpen = !this.mobileMenuOpen;
    },
    closeMobileMenu() {
      this.mobileMenuOpen = false;
    },
    currentTimePreset() {
      return window.innerWidth < HEADER_MOBILE_BREAKPOINT
        ? this.timeMobilePreset
        : this.timeDesktopPreset;
    },
    tick() {
      if (!this.timeEnabled) {
        this.timeStr = '';
        return;
      }

      this.timeStr = formatHeaderTime(
        new Date(),
        this.currentTimePreset(),
        this.timeHourCycle
      );
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
      const winEl = document.querySelector('[data-window-surface]');
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

      const titlebar = winEl.querySelector('[data-window-titlebar]');
      if (titlebar) {
        titlebar.style.opacity = '';
        titlebar.style.backdropFilter = '';
        titlebar.style.webkitBackdropFilter = '';
      }

      return winEl;
    },

    prepareWindowSurfaceForRestore(winEl = document.querySelector('[data-window-surface]')) {
      if (!winEl) return null;

      const titlebar = winEl.querySelector('[data-window-titlebar]');
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
      const winEl = document.querySelector('[data-window-surface]');
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
      const titlebar = winEl.querySelector('[data-window-titlebar]');
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

       const winEl = document.querySelector('[data-window-surface]');
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
      const el = this.$el;
      const ds = el.dataset;

      /* ── 从后台设置读取参数 ── */
      const enableMagnification = ds.magnification !== 'false';
      const showLabels = ds.showLabels === 'true';
      const baseSize = Math.max(36, Math.min(64, parseInt(ds.dockIconSize, 10) || 48));
      const iconGap = Math.max(2, Math.min(12, parseInt(ds.dockIconGap, 10) || 4));
      const dockPadding = Math.max(4, Math.min(16, parseInt(ds.dockPadding, 10) || 6));
      const magScale = Math.max(1, Math.min(2, parseFloat(ds.dockMagScale) || 1.4));
      const glassBlur = Math.max(20, Math.min(100, parseInt(ds.dockGlassBlur, 10) || 60));
      const glassOpacity = Math.max(10, Math.min(80, parseInt(ds.dockGlassOpacity, 10) || 28));

      /* ── 计算派生参数 ── */
      const maxSize = Math.round(baseSize * magScale);
      const range = Math.round(baseSize * 2.9);
      const maxLift = Math.round(baseSize * 0.29);
      const maxScale = maxSize / baseSize;
      const glassHeight = baseSize + dockPadding * 2;
      const barHeight = baseSize + dockPadding * 2 + 30;  /* +30 = maxLift headroom，放大时图标上浮预留空间 */

      /* ── 将参数注入 CSS 变量 ── */
      el.style.setProperty('--dock-icon-size', `${baseSize}px`);
      el.style.setProperty('--dock-gap', `${iconGap}px`);
      el.style.setProperty('--dock-padding', `${dockPadding}px`);
      el.style.setProperty('--dock-glass-height', `${glassHeight}px`);
      el.style.setProperty('--dock-bar-height', `${barHeight}px`);
      el.style.setProperty('--dock-blur', `${glassBlur}px`);
      el.style.setProperty('--dock-opacity', `${glassOpacity / 100}`);
      el.style.setProperty('--dock-icon-radius', `${Math.round(baseSize * 0.25)}px`);

      let rafId = null;
      let lastMouseX = null;

      const ac = new AbortController();
      const { signal } = ac;

      const getIcons = () => Array.from(dockBar.querySelectorAll('.dock-icon'));

      const resetIcons = () => {
        lastMouseX = null;
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
            /* cos³ 衰减 — 集中中心隆起，边缘平滑 */
            const influence = Math.cos(ratio * Math.PI / 2);
            const softenedInfluence = influence * influence * influence;
            scale = 1 + (maxScale - 1) * softenedInfluence;
          }

          const lift = maxScale > 1 ? ((scale - 1) / (maxScale - 1)) * maxLift : 0;
          icon.style.width = `${baseSize * scale}px`;
          icon.style.height = `${baseSize * scale}px`;
          icon.style.transform = `translateY(-${lift}px)`;
          icon.style.zIndex = String(10 + Math.round(scale * 10));

          if (distance < nearestDistance) {
            nearestDistance = distance;
            tooltipTarget = icon;
          }
        });

        if (showLabels && tooltipTarget && nearestDistance < range * 0.65) {
          tooltipTarget.classList.add('dock-tooltip-visible');
        }
      };

      /* 初始化图标基础尺寸 */
      requestAnimationFrame(() => {
        getIcons().forEach((icon) => {
          icon.style.width = `${baseSize}px`;
          icon.style.height = `${baseSize}px`;
        });
      });

      el.addEventListener('mousemove', (e) => {
        if (!enableMagnification) return;
        lastMouseX = e.clientX;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (lastMouseX !== null) updateDock(lastMouseX);
        });
      }, { signal });

      el.addEventListener('mouseleave', () => {
        cancelAnimationFrame(rafId);
        requestAnimationFrame(resetIcons);
      }, { signal });

      /* destroy 清理 */
      this._dockCleanup = () => {
        cancelAnimationFrame(rafId);
        ac.abort();
        resetIcons();
      };
    },

    destroy() {
      if (this._dockCleanup) this._dockCleanup();
    }
  }));
}
