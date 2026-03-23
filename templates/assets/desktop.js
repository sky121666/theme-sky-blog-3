/**
 * macOS Desktop – Alpine.js Components + interact.js Window Manager
 * 替代 React + Zustand + Framer Motion + react-rnd
 */

/* ========== 窗口状态管理 (替代 Zustand) ========== */
document.addEventListener('alpine:init', () => {
  let nextZ = 100;

  Alpine.store('windows', {
    list: [],
    activeId: null,

    open(id, title, url) {
      const existing = this.list.find(w => w.id === id);
      nextZ++;
      if (existing) {
        existing.isMinimized = false;
        existing.zIndex = nextZ;
        if (url) existing.url = url;
        if (title) existing.title = title;
        this.activeId = id;
        return;
      }
      this.list.push({
        id,
        title: title || 'Window',
        url: url || '',
        zIndex: nextZ,
        isMinimized: false,
        isMaximized: false,
        x: 80 + Math.random() * 120,
        y: 60 + Math.random() * 80,
        w: 820,
        h: 520,
      });
      this.activeId = id;
    },

    close(id) {
      this.list = this.list.filter(w => w.id !== id);
      if (this.activeId === id) this.activeId = null;
    },

    focus(id) {
      if (this.activeId === id) return;
      nextZ++;
      const win = this.list.find(w => w.id === id);
      if (win) {
        win.zIndex = nextZ;
        win.isMinimized = false;
      }
      this.activeId = id;
    },

    minimize(id) {
      const win = this.list.find(w => w.id === id);
      if (win) win.isMinimized = true;
      if (this.activeId === id) this.activeId = null;
    },

    toggleMaximize(id) {
      const win = this.list.find(w => w.id === id);
      if (win) win.isMaximized = !win.isMaximized;
    },

    isOpen(id) {
      return this.list.some(w => w.id === id);
    }
  });
});

/* ========== MenuBar 组件 ========== */
function menuBar() {
  return {
    timeStr: '',
    init() {
      this.tick();
      setInterval(() => this.tick(), 1000);
    },
    tick() {
      const d = new Date();
      this.timeStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        + '  ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    },
    get appName() {
      const store = Alpine.store('windows');
      if (!store.activeId) return 'Finder';
      const win = store.list.find(w => w.id === store.activeId);
      return win ? win.title : 'Finder';
    }
  };
}

/* ========== Dock 放大动效 (替代 Framer Motion) ========== */
function dock() {
  return {
    mouseX: Infinity,

    onMove(e) {
      this.mouseX = e.clientX;
      this.$nextTick(() => {
        this.$el.querySelectorAll('.dock-icon').forEach(icon => {
          const rect = icon.getBoundingClientRect();
          const center = rect.x + rect.width / 2;
          const dist = Math.abs(this.mouseX - center);
          const scale = Math.max(1, 1.65 - dist / 150);
          icon.style.setProperty('--dock-scale', scale);
        });
      });
    },

    onLeave() {
      this.mouseX = Infinity;
      this.$el.querySelectorAll('.dock-icon').forEach(icon => {
        icon.style.setProperty('--dock-scale', 1);
      });
    },

    openApp(id, label, url) {
      Alpine.store('windows').open(id, label, url || '');
    }
  };
}

/* ========== 桌面图标 ========== */
function desktopIcons() {
  return {
    selectedId: null,

    select(id) {
      this.selectedId = id;
    },

    openItem(id, name, url) {
      Alpine.store('windows').open(id, name, url || '');
      this.selectedId = null;
    },

    handleOutsideClick(e) {
      if (!e.target.closest('.desktop-icon')) {
        this.selectedId = null;
      }
    }
  };
}

/* ========== 窗口管理 (interact.js 拖拽 + 缩放) ========== */
function windowManager() {
  return {
    get windows() { return Alpine.store('windows').list; },
    get activeId() { return Alpine.store('windows').activeId; },

    close(id) { Alpine.store('windows').close(id); },
    minimize(id) { Alpine.store('windows').minimize(id); },
    toggleMaximize(id) { Alpine.store('windows').toggleMaximize(id); },

    focus(id) { Alpine.store('windows').focus(id); },

    /* interact.js 绑定 —— 在窗口元素挂载后调用 */
    initInteract(el, winId) {
      const store = Alpine.store('windows');

      interact(el)
        .draggable({
          allowFrom: '.window-titlebar',
          modifiers: [
            interact.modifiers.restrictRect({ restriction: 'parent' })
          ],
          listeners: {
            start: () => store.focus(winId),
            move: (event) => {
              const win = store.list.find(w => w.id === winId);
              if (!win || win.isMaximized) return;
              win.x += event.dx;
              win.y += event.dy;
            }
          }
        })
        .resizable({
          edges: { left: true, right: true, bottom: true, top: true },
          modifiers: [
            interact.modifiers.restrictSize({ min: { width: 380, height: 280 } }),
            interact.modifiers.restrictEdges({ outer: 'parent' })
          ],
          listeners: {
            start: () => store.focus(winId),
            move: (event) => {
              const win = store.list.find(w => w.id === winId);
              if (!win || win.isMaximized) return;
              win.w = event.rect.width;
              win.h = event.rect.height;
              win.x += event.deltaRect.left;
              win.y += event.deltaRect.top;
            }
          }
        });
    }
  };
}
