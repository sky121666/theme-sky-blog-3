/**
 * 窗口拖拽/缩放引擎 + 标题栏 + Genie 最小化动画
 */

import QRCode from 'qrcode';

function readHeadAttribute(selectors, attribute = 'content') {
  for (const selector of selectors) {
    const node = document.head.querySelector(selector);
    const value = node?.getAttribute(attribute)?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function getSharePayload() {
  const url =
    readHeadAttribute(["link[rel='canonical']"], 'href') ||
    window.location.href;

  return {
    url
  };
}

function getShareMetadata() {
  const url = getSharePayload().url;
  const title =
    readHeadAttribute(["meta[property='og:title']", "meta[name='twitter:title']"]) ||
    document.title;
  const description =
    readHeadAttribute([
      "meta[property='og:description']",
      "meta[name='twitter:description']",
      "meta[name='description']"
    ]) || '';
  const image =
    readHeadAttribute(["meta[property='og:image']", "meta[name='twitter:image']"]) || '';

  let host = '';
  try {
    host = new URL(url, window.location.origin).host;
  } catch (_error) {
    host = window.location.host;
  }

  return {
    url,
    title,
    description,
    image,
    host
  };
}

async function copyTextFallback(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }

  return copied;
}

function stripClonedIdsAndAlpine(node) {
  if (!node || !node.querySelectorAll) return;
  
  const elements = [node, ...node.querySelectorAll('*')];
  elements.forEach(el => {
    el.removeAttribute('id');
    Array.from(el.attributes).forEach(attr => {
      if (
        attr.name.startsWith('x-')
        || attr.name.startsWith('@')
        || attr.name.startsWith(':')
      ) {
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

export function runGenieAnimation({ windowEl, dockEl, action, duration = 480, onBeforeFinish }) {
  if (!windowEl || !dockEl) return Promise.resolve(false);

  const windowRect = windowEl.getBoundingClientRect();
  const targetGraphic = dockEl.querySelector('svg') || dockEl;
  const dockRect = targetGraphic.getBoundingClientRect();
  const { ghostWrapper, ghostInner } = createGenieGhost(windowEl);

  const sourceWidth = Math.max(windowRect.width, 1);
  const sourceHeight = Math.max(windowRect.height, 1);
  const targetWidth = Math.max(dockRect.width, 1);
  const targetHeight = Math.max(dockRect.height, 1);

  ghostWrapper.style.left = `${windowRect.left}px`;
  ghostWrapper.style.top = `${windowRect.top}px`;
  ghostWrapper.style.width = `${sourceWidth}px`;
  ghostWrapper.style.height = `${sourceHeight}px`;

  const windowCenterX = windowRect.left + sourceWidth / 2;
  const windowCenterY = windowRect.top + sourceHeight / 2;
  const dockCenterX = dockRect.left + targetWidth / 2;
  const dockCenterY = dockRect.top + targetHeight / 2;

  const destX = dockCenterX - windowCenterX;
  const destY = dockCenterY - windowCenterY;
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  const easeIn = 'cubic-bezier(0.62, 0, 1, 1)';
  const easeOut = 'cubic-bezier(0, 0, 0.22, 1)';

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
      if (typeof onBeforeFinish === 'function') {
        onBeforeFinish();
      }
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

export function registerWindowComponents(Alpine) {
  Alpine.data('windowTitlebar', () => ({
    title: document.title,
    shareOpen: false,
    shareView: 'actions',
    shareFeedback: '',
    shareFeedbackTimer: null,
    wechatQrDataUrl: '',
    wechatQrLoading: false,
    wechatQrError: '',
    shareMeta: {
      url: '',
      title: '',
      description: '',
      image: '',
      host: ''
    },

    init() {
      this.sync();
    },

    sync() {
      this.title = document.title;
      const previousUrl = this.shareMeta.url;
      this.shareMeta = getShareMetadata();
      if (previousUrl && previousUrl !== this.shareMeta.url) {
        this.wechatQrDataUrl = '';
        this.wechatQrError = '';
      }
    },

    setShareFeedback(message) {
      this.shareFeedback = message || '';
      if (this.shareFeedbackTimer) {
        window.clearTimeout(this.shareFeedbackTimer);
        this.shareFeedbackTimer = null;
      }

      if (!this.shareFeedback) return;

      this.shareFeedbackTimer = window.setTimeout(() => {
        this.shareFeedback = '';
        this.shareFeedbackTimer = null;
      }, 1800);
    },

    openSharePanel() {
      this.sync();
      this.shareView = 'actions';
      this.shareOpen = true;
    },

    closeSharePanel() {
      this.shareOpen = false;
      this.shareView = 'actions';
    },

    toggleSharePanel() {
      if (this.shareOpen) {
        this.closeSharePanel();
        return;
      }

      this.openSharePanel();
    },

    async copyLink(feedback = '链接已复制') {
      try {
        const copied = await copyTextFallback(this.shareMeta.url);
        this.setShareFeedback(copied ? feedback : '复制失败');
        if (copied) {
          this.closeSharePanel();
        }
        return copied;
      } catch (_error) {
        this.setShareFeedback('复制失败');
        return false;
      }
    },

    backToShareActions() {
      this.shareView = 'actions';
    },

    async openWeChatShare() {
      this.sync();
      this.shareView = 'wechat';
      this.wechatQrError = '';

      if (this.wechatQrDataUrl || this.wechatQrLoading) {
        return;
      }

      this.wechatQrLoading = true;
      try {
        this.wechatQrDataUrl = await QRCode.toDataURL(this.shareMeta.url, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 264,
          color: {
            dark: '#111827',
            light: '#0000'
          }
        });
      } catch (_error) {
        this.wechatQrError = '二维码生成失败';
      } finally {
        this.wechatQrLoading = false;
      }
    },

    async saveWeChatQr() {
      if (!this.wechatQrDataUrl) {
        await this.openWeChatShare();
      }

      if (!this.wechatQrDataUrl) {
        this.setShareFeedback('暂无可保存二维码');
        return;
      }

      const safeTitle = (this.shareMeta.title || 'share')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40) || 'share';

      const link = document.createElement('a');
      link.href = this.wechatQrDataUrl;
      link.download = `${safeTitle}-wechat-qrcode.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      this.setShareFeedback('二维码已保存');
    },

    async shareToQQ() {
      await this.copyLink('已复制链接，请在 QQ 中粘贴发送');
    },

    openExternalShare(url) {
      if (!url) return;

      const width = 720;
      const height = 640;
      const left = Math.max(0, Math.round((window.innerWidth - width) / 2));
      const top = Math.max(0, Math.round((window.innerHeight - height) / 2));
      window.open(
        url,
        'share-panel',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no,scrollbars=yes,resizable=yes`
      );
      this.closeSharePanel();
    },

    shareToTelegram() {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(this.shareMeta.url)}`;
      this.openExternalShare(shareUrl);
    },

    shareToX() {
      const shareUrl =
        `https://twitter.com/intent/tweet?url=${encodeURIComponent(this.shareMeta.url)}` +
        `&text=${encodeURIComponent(this.shareMeta.title)}`;
      this.openExternalShare(shareUrl);
    },

    shareToEmail() {
      const body = this.shareMeta.description
        ? `${this.shareMeta.title}\n\n${this.shareMeta.description}\n\n${this.shareMeta.url}`
        : `${this.shareMeta.title}\n\n${this.shareMeta.url}`;
      window.location.href =
        `mailto:?subject=${encodeURIComponent(this.shareMeta.title)}&body=${encodeURIComponent(body)}`;
      this.closeSharePanel();
    },

    async shareCurrent() {
      const payload = getSharePayload();

      try {
        if (navigator.share) {
          await navigator.share(payload);
          this.setShareFeedback('已调起分享');
          this.closeSharePanel();
          return;
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
      }

      try {
        await this.copyLink();
      } catch (_error) {}
    }
  }));

  // draggableWindow - 窗口拖拽与缩放引擎
  Alpine.data('draggableWindow', () => ({
    isDragging: false,
    isResizing: false,
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
    resizeDirection: '',
    resizeStartWidth: 0,
    resizeStartHeight: 0,
    resizeStartWindowX: 0,
    resizeStartWindowY: 0,
    isDesktop: window.innerWidth > 768,
    windowEl: null,
    metricsKey: 'none',

    applyResizeMode() {
      if (!this.windowEl) return;

      this.windowEl.style.resize = 'none';

      if (!this.isDesktop) {
        this.windowEl.style.borderRadius = '';
        return;
      }

      if (this.isMaximized) {
        this.windowEl.style.borderRadius = '0';
        return;
      }

      this.windowEl.style.borderRadius = '';
    },

    getMinWidth() {
      if (!this.windowEl) return 400;
      const computed = Number.parseFloat(window.getComputedStyle(this.windowEl).minWidth);
      return Number.isFinite(computed) && computed > 0 ? computed : 400;
    },

    getMinHeight() {
      if (!this.windowEl) return 400;
      const computed = Number.parseFloat(window.getComputedStyle(this.windowEl).minHeight);
      return Number.isFinite(computed) && computed > 0 ? computed : 400;
    },

    getResizeCursor(direction) {
      if (direction === 'n' || direction === 's') return 'ns-resize';
      if (direction === 'e' || direction === 'w') return 'ew-resize';
      if (direction === 'ne' || direction === 'sw') return 'nesw-resize';
      return 'nwse-resize';
    },

    setWindowRect({ x = this.x, y = this.y, width = this.width, height = this.height } = {}) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;

      if (!this.windowEl || !this.isDesktop) return;

      this.windowEl.style.left = `${this.x}px`;
      this.windowEl.style.top = `${this.y}px`;
      this.windowEl.style.width = `${this.width}px`;
      this.windowEl.style.height = `${this.height}px`;
      this.windowEl.style.transform = 'none';
    },

    syncState() {
      this.syncNarrowState();
      if (!this.isDesktop) return;
      if (this.metricsKey === 'none') return;
      localStorage.setItem(`theme-window-metrics-${this.metricsKey}`, JSON.stringify({
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

    syncNarrowState() {
      if (!this.isDesktop || (this.width > 0 && this.width < 768)) {
        this.windowEl.dataset.windowNarrow = 'true';
      } else {
        delete this.windowEl.dataset.windowNarrow;
      }
    },

    init() {
      this.windowEl = this.$el;
      this.metricsKey = this.windowEl.dataset.windowMetricsKey || 'none';
      
      try {
        if (this.metricsKey !== 'none') {
          const storedStr = localStorage.getItem(`theme-window-metrics-${this.metricsKey}`);
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
        }
      } catch(e) {}

      // ENFORCE mandatory width if axis restricts horizontal resizing
      if (this.windowEl.dataset.windowWidth) {
         const forcedWidth = parseInt(this.windowEl.dataset.windowWidth, 10);
         const resizableMode = this.windowEl.dataset.windowResizable || 'true';
         if (!isNaN(forcedWidth) && forcedWidth > 0 && (resizableMode === 'y' || resizableMode === 'false')) {
            const expectedWidth = Math.min(forcedWidth, window.innerWidth);
            if (this.width !== expectedWidth && this.width !== 0) {
               // Re-center around current X if width changes aggressively
               const centerDiff = (this.width - expectedWidth) / 2;
               this.width = expectedWidth;
               this.x += centerDiff;
            }
         }
      }

      if (this.width === 0) this.updateMeasurements();
      else if (this.isDesktop) {
         this.windowEl.style.width = `${this.width}px`;
         this.windowEl.style.height = `${this.height}px`;
         this.applyTransform();
      }

      this.syncNarrowState();
      this.applyResizeMode();

      if (this.isDesktop && window.ResizeObserver) {
        let resizeTimeout;
        const ro = new ResizeObserver(() => {
          /* 视口 resize 期间跳过，防止 clipped offsetWidth 污染 this.width */
          if (this._viewportResizing || !this.isDesktop || this.isMaximized || this.isResizing) return;
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

      /* ── viewport resize: 暂停 ResizeObserver + 处理 maximized ── */
      this._viewportResizing = false;
      let vpTimer;
      window.addEventListener('resize', () => {
        this._viewportResizing = true;
        clearTimeout(vpTimer);
        vpTimer = setTimeout(() => {
          this._viewportResizing = false;
          /* maximized 窗口跟随视口 */
          if (this.isDesktop && this.isMaximized) {
            this.width = window.innerWidth;
            this.height = window.innerHeight - 28;
            this.windowEl.style.width = `${this.width}px`;
            this.windowEl.style.height = `${this.height}px`;
            this.syncState();
          }
          if (this.isDesktop) {
            this.clampPositions();
            this.applyTransform();
          }
          this.applyResizeMode();
        }, 150);
      });

      /* ── matchMedia: 精确检测 mobile ↔ desktop 阈值跨越 ── */
      const mql = window.matchMedia('(min-width: 769px)');
      const onModeChange = (e) => {
        this.isDesktop = e.matches;
        this.syncNarrowState();
        if (!this.isDesktop) {
          /* → mobile: this.width/height 保持不动 */
          this.isDragging = false;
          this.isResizing = false;
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          this.windowEl.style.transform = '';
          this.windowEl.style.left = '';
          this.windowEl.style.top = '';
          this.windowEl.style.width = '100%';
          this.windowEl.style.height = '100%';
        } else {
          /* → desktop: 从未被污染的 this.width/height 恢复 */
          if (this.width === 0) {
            this.updateMeasurements();
          } else {
            if (this.isMaximized) {
              this.width = window.innerWidth;
              this.height = window.innerHeight - 28;
            } else {
              const maxW = window.innerWidth - 40;
              const maxH = window.innerHeight - 68;
              const forcedW = parseInt(this.windowEl.dataset.windowWidth, 10);
              if (forcedW > 0 && (this.windowEl.dataset.windowResizable === 'y' || this.windowEl.dataset.windowResizable === 'false')) {
                this.width = Math.min(forcedW, maxW);
              }
              if (this.width > maxW) this.width = maxW;
              if (this.height > maxH) this.height = maxH;
              if (this.x < 0 || this.x + this.width > window.innerWidth) {
                this.x = Math.max(0, (window.innerWidth - this.width) / 2);
              }
            }
            this.windowEl.style.width = `${this.width}px`;
            this.windowEl.style.height = `${this.height}px`;
            this.clampPositions();
            this.applyTransform();
            this.syncState();
          }
        }
        this.applyResizeMode();
      };
      mql.addEventListener('change', onModeChange);

      const isHome = window.location.pathname === '/';

      if (!isHome) {
        this.$store.windowManager.minimized = false;
        this.$store.windowManager.open(document.title);
      } else {
        this.$store.windowManager.showDesktop();
        this.windowEl.style.transition = 'none';
        this.windowEl.style.opacity = '0';
        this.windowEl.style.visibility = 'hidden';
        this.windowEl.style.pointerEvents = 'none';
        this.windowEl.style.transform = 'none';
      }
    },

    updateMeasurements() {
       if (this.isDesktop) {
         let width = Math.min(1200, window.innerWidth * 0.85);
         let height = Math.min(900, Math.max(500, window.innerHeight * 0.85));
         
         if (this.windowEl.dataset.windowWidth) {
            const w = parseInt(this.windowEl.dataset.windowWidth, 10);
            if (!isNaN(w) && w > 0) width = Math.min(w, window.innerWidth);
         }
         
         if (this.windowEl.dataset.windowHeight) {
            const h = parseInt(this.windowEl.dataset.windowHeight, 10);
            if (!isNaN(h) && h > 0) height = Math.min(h, window.innerHeight - 28);
         }

         const x = (window.innerWidth - width) / 2;
         const y = Math.max(28, (window.innerHeight - height) / 2);

         this.setWindowRect({ x, y, width, height });
         this.applyResizeMode();
         this.syncState();
       }
    },

    clampPositions() {
       if (!this.isDesktop || this.isMaximized) return;
       const maxX = window.innerWidth - 80;
       const maxY = window.innerHeight - 40;
       const minX = -this.width + 80;
       const minY = 28;

       if (this.x > maxX) this.x = maxX;
       if (this.x < minX) this.x = minX;
       if (this.y > maxY) this.y = maxY;
       if (this.y < minY) this.y = minY;
    },

    applyTransform() {
       if (!this.isDesktop) return;
       this.setWindowRect();
    },

    toggleMaximize() {
      if (!this.isDesktop || !this.windowEl) return;
      if (this.windowEl.dataset.windowMaximizable === 'false') return;
      
      const winEl = this.windowEl;
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
      if (this.isResizing || e.target.closest('button, a, .traffic-lights, svg, .desktop-icon, .window-resize-handle')) return;
      
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.initialX = this.x;
      this.initialY = this.y;
      document.body.style.userSelect = 'none';
      
      if (this.windowEl) this.windowEl.style.transition = 'none';
    },

    startResize(direction, e) {
      if (!this.isDesktop || this.isMaximized || !this.windowEl) return;
      if (this.windowEl.dataset.windowResizable === 'false') return;

      this.isResizing = true;
      this.resizeDirection = direction;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.resizeStartWidth = this.windowEl.offsetWidth;
      this.resizeStartHeight = this.windowEl.offsetHeight;
      this.resizeStartWindowX = this.x;
      this.resizeStartWindowY = this.y;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = this.getResizeCursor(direction);
      this.windowEl.style.transition = 'none';
    },

    onPointerMove(e) {
      if (this.isResizing) {
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        const direction = this.resizeDirection;
        const minWidth = this.getMinWidth();
        const minHeight = this.getMinHeight();
        const resizableMode = this.windowEl.dataset.windowResizable || 'true';

        let nextX = this.resizeStartWindowX;
        let nextY = this.resizeStartWindowY;
        let nextWidth = this.resizeStartWidth;
        let nextHeight = this.resizeStartHeight;

        if (resizableMode !== 'y' && resizableMode !== 'false') {
          if (direction.includes('e')) nextWidth = this.resizeStartWidth + dx;
          if (direction.includes('w')) {
            nextWidth = this.resizeStartWidth - dx;
            nextX = this.resizeStartWindowX + dx;
          }
        }
        
        if (resizableMode !== 'x' && resizableMode !== 'false') {
          if (direction.includes('s')) nextHeight = this.resizeStartHeight + dy;
          if (direction.includes('n')) {
            nextHeight = this.resizeStartHeight - dy;
            nextY = this.resizeStartWindowY + dy;
          }
        }

        if (nextWidth < minWidth) {
          if (direction.includes('w')) nextX += nextWidth - minWidth;
          nextWidth = minWidth;
        }

        if (nextHeight < minHeight) {
          if (direction.includes('n')) nextY += nextHeight - minHeight;
          nextHeight = minHeight;
        }

        const maxHeight = window.innerHeight - 44; // 28(menubar) + 16(padding)
        if (nextHeight > maxHeight) {
          if (direction.includes('n')) nextY += nextHeight - maxHeight;
          nextHeight = maxHeight;
        }

        if (direction.includes('n') && nextY < 28) {
          nextHeight += nextY - 28;
          nextY = 28;
          if (nextHeight < minHeight) nextHeight = minHeight;
        }

        this.setWindowRect({
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight
        });
        return;
      }

      if (!this.isDragging) return;

      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;

      this.x = this.initialX + dx;
      this.y = this.initialY + dy;

      this.clampPositions();
      this.applyTransform();
    },

    onPointerEnd() {
      if (!this.isDragging && !this.isResizing) return;

      this.isDragging = false;
      this.isResizing = false;
      this.resizeDirection = '';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
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
}
