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

    // 拦截全局所有的 a 链接点击，保证就算 pjax 未触发生效，也能立刻弹出隐藏的阅读器
    document.body.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);

  // =========== 2. 菜单栏 ===========
  Alpine.data('menuBar', () => ({
    timeStr: '',
    appName: 'Finder',
    init() {
      this.tick();
      setInterval(() => this.tick(), 1000);
    },
    tick() {
      const d = new Date();
      this.timeStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        + '  ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
  }));

  // =========== 4. Dock 物理级高斯放大引擎 (1:1 标定) ===========
  Alpine.data('dock', () => ({
    init() {
      const dockBar = this.$refs.dockBar;
      if (!dockBar) return;
      
      const icons = Array.from(dockBar.querySelectorAll('.dock-icon'));
      const baseSize = 48; // 固定底宽
      const maxSize = 64;  // 原生极限宽（1.33x克制放大）
      const range = 140;   // 影响半径：约辐射左右各2~3个图标

      this.$el.addEventListener('mousemove', (e) => {
        requestAnimationFrame(() => {
          icons.forEach(icon => {
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
          icons.forEach(icon => {
            // 鼠标移出时归还控制权给 CSS Transition 的 ease-out 0.25s 曲线
            icon.classList.add('dock-animating');
            icon.style.width = `${baseSize}px`;
            icon.style.height = `${baseSize}px`;
          });
        });
      });
    }
  }));

  // =========== 5. 桌面图标管理 ===========
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
