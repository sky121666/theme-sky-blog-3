import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const baseUrl = (process.env.MOTION_AUDIT_BASE_URL || process.env.HALO_BASE_URL || process.env.SMOKE_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
const outputDir = path.join(root, 'output', 'audit', 'notification-motion');
const screenDir = path.join(outputDir, 'screens');
const headless = process.env.HEADLESS === '1';
const scenarioTimeout = 20_000;

const watchedEvents = [
  'theme-notification-widget-drop-state',
  'theme-widget-drag-state',
  'theme-notification-widgets-change',
  'theme-notification-widget-drag-start',
  'theme-notification-widget-drag-end'
];

const thresholds = {
  p95FrameInterval: 28,
  maxFrameInterval: 50,
  longTaskMaxMs: 80,
  animationsPeak: 40,
  animationsAfterSettle: 8,
  ghostMaxJump: 48,
  previewMaxJump: 32,
  panelSizeDriftMax: 3,
  dropStatePerPointerMove: 0.2
};

function absoluteUrl(target = '/') {
  return new URL(target, `${baseUrl}/`).toString();
}

function round(value, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function safeName(value) {
  return String(value || 'scenario').replace(/[^a-zA-Z0-9-_]+/g, '-');
}

async function ensureDirs() {
  await fs.mkdir(screenDir, { recursive: true });
}

async function launchBrowser() {
  try {
    return {
      browser: await chromium.launch({ channel: 'chrome', headless }),
      browserName: 'chrome'
    };
  } catch (error) {
    return {
      browser: await chromium.launch({ headless }),
      browserName: `chromium-fallback (${error.message})`
    };
  }
}

function createNotificationItems({ read = false } = {}) {
  const now = new Date();
  const iso = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return [
    {
      metadata: { name: read ? 'read-notification-1' : 'unread-notification-1', creationTimestamp: iso(7) },
      spec: {
        unread: !read,
        title: read ? '已读评论通知' : '未读评论通知',
        reasonType: 'comment',
        htmlContent: '<p>Eren：通知中心交互审计测试。</p>'
      }
    },
    {
      metadata: { name: read ? 'read-notification-2' : 'unread-notification-2', creationTimestamp: iso(11) },
      spec: {
        unread: !read,
        title: read ? '已读插件通知' : '未读插件通知',
        reasonType: 'plugin',
        htmlContent: '<p>Douban 小组件状态同步。</p>'
      }
    }
  ];
}

async function installRoutes(page) {
  await page.route('**/apis/api.console.halo.run/v1alpha1/users/-', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { metadata: { name: 'sky' }, spec: { disabled: false } } })
    });
  });

  await page.route('**/apis/api.notification.halo.run/v1alpha1/userspaces/*/notifications**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    page.__motionAuditRequests.push({ method, url });

    if (method === 'PUT' && url.includes('/mark-as-read')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (method === 'DELETE') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (method === 'GET') {
      const unreadOnly = url.includes('spec.unread%3Dtrue') || url.includes('spec.unread=true');
      const read = !unreadOnly;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 2, items: createNotificationItems({ read }) })
      });
      return;
    }

    await route.fulfill({ status: 204, body: '' });
  });
}

async function installPageInstrumentation(page) {
  await page.addInitScript(({ events }) => {
    window.__notificationMotionAudit = {
      frames: [],
      longTasks: [],
      events: Object.fromEntries(events.map((eventName) => [eventName, 0])),
      pointerMoves: 0,
      running: false,
      rafId: 0,
      scenario: '',
      startedAt: 0
    };

    const originalDispatchEvent = window.dispatchEvent.bind(window);
    window.dispatchEvent = (event) => {
      if (event?.type && window.__notificationMotionAudit?.events && event.type in window.__notificationMotionAudit.events) {
        window.__notificationMotionAudit.events[event.type] += 1;
      }
      return originalDispatchEvent(event);
    };

    window.addEventListener('pointermove', () => {
      if (window.__notificationMotionAudit?.running) {
        window.__notificationMotionAudit.pointerMoves += 1;
      }
    }, { capture: true, passive: true });

    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          if (!window.__notificationMotionAudit?.running) return;
          list.getEntries().forEach((entry) => {
            window.__notificationMotionAudit.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration
            });
          });
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (_error) {}
    }

    const rectFor = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return null;
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        layoutWidth: el.offsetWidth || rect.width,
        layoutHeight: el.offsetHeight || rect.height,
        right: rect.right,
        bottom: rect.bottom
      };
    };

    const sample = () => {
      const audit = window.__notificationMotionAudit;
      if (!audit?.running) return;
      const animations = document.getAnimations?.() || [];
      audit.frames.push({
        t: performance.now(),
        animations: animations.filter((animation) => animation.playState === 'running').length,
        bodyClass: document.body.className,
        panel: rectFor('#notification-center-panel'),
        ghost: rectFor('.desktop-widget-drag-ghost'),
        notificationPreview: rectFor('.notification-widget-insert-preview'),
        desktopPreview: rectFor('.desktop-widget-drop-preview'),
        dragSource: rectFor('.desktop-node-slot.is-drag-source, [data-notification-widget-card].is-drag-source')
      });
      audit.rafId = requestAnimationFrame(sample);
    };

    window.__startNotificationMotionScenario = (scenario) => {
      const audit = window.__notificationMotionAudit;
      if (!audit) return;
      if (audit.rafId) cancelAnimationFrame(audit.rafId);
      audit.frames = [];
      audit.longTasks = [];
      audit.events = Object.fromEntries(events.map((eventName) => [eventName, 0]));
      audit.pointerMoves = 0;
      audit.running = true;
      audit.scenario = scenario;
      audit.startedAt = performance.now();
      audit.rafId = requestAnimationFrame(sample);
    };

    window.__stopNotificationMotionScenario = () => {
      const audit = window.__notificationMotionAudit;
      if (!audit) return null;
      audit.running = false;
      if (audit.rafId) cancelAnimationFrame(audit.rafId);
      audit.rafId = 0;
      return {
        scenario: audit.scenario,
        startedAt: audit.startedAt,
        stoppedAt: performance.now(),
        frames: audit.frames,
        longTasks: audit.longTasks,
        events: audit.events,
        pointerMoves: audit.pointerMoves,
        animationsAfterSettle: document.getAnimations?.().filter((animation) => animation.playState === 'running').length || 0
      };
    };
  }, { events: watchedEvents });
}

function analyzeRectJumps(frames, key) {
  let previous = null;
  let maxJump = 0;
  let maxSizeDrift = 0;
  for (const frame of frames) {
    const rect = frame[key];
    if (!rect) continue;
    if (previous) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const previousX = previous.left + previous.width / 2;
      const previousY = previous.top + previous.height / 2;
      maxJump = Math.max(maxJump, Math.hypot(centerX - previousX, centerY - previousY));
      const width = rect.layoutWidth ?? rect.width;
      const height = rect.layoutHeight ?? rect.height;
      const previousWidth = previous.layoutWidth ?? previous.width;
      const previousHeight = previous.layoutHeight ?? previous.height;
      maxSizeDrift = Math.max(maxSizeDrift, Math.abs(width - previousWidth), Math.abs(height - previousHeight));
    }
    previous = rect;
  }
  return { maxJump: round(maxJump, 1), maxSizeDrift: round(maxSizeDrift, 1) };
}

function analyzeAudit(raw) {
  const frames = raw?.frames || [];
  const intervals = [];
  for (let index = 1; index < frames.length; index += 1) {
    intervals.push(frames[index].t - frames[index - 1].t);
  }

  const ghost = analyzeRectJumps(frames, 'ghost');
  const notificationPreview = analyzeRectJumps(frames, 'notificationPreview');
  const desktopPreview = analyzeRectJumps(frames, 'desktopPreview');
  const panel = analyzeRectJumps(frames, 'panel');
  const longTasks = raw?.longTasks || [];
  const dropStateEvents = raw?.events?.['theme-notification-widget-drop-state'] || 0;
  const pointerMoves = raw?.pointerMoves || 0;

  return {
    durationMs: round((raw?.stoppedAt || 0) - (raw?.startedAt || 0), 1),
    frames: frames.length,
    avgFrameInterval: round(intervals.reduce((sum, item) => sum + item, 0) / Math.max(1, intervals.length), 1),
    p95FrameInterval: round(percentile(intervals, 0.95), 1),
    maxFrameInterval: round(Math.max(0, ...intervals), 1),
    longTasks: longTasks.length,
    longTaskTotalMs: round(longTasks.reduce((sum, item) => sum + (item.duration || 0), 0), 1),
    longTaskMaxMs: round(Math.max(0, ...longTasks.map((item) => item.duration || 0)), 1),
    pointerMoves,
    dropStateEvents,
    dropStatePerPointerMove: round(dropStateEvents / Math.max(1, pointerMoves), 3),
    animationsPeak: Math.max(0, ...frames.map((frame) => frame.animations || 0)),
    animationsAfterSettle: raw?.animationsAfterSettle || 0,
    ghostMaxJump: ghost.maxJump,
    notificationPreviewMaxJump: notificationPreview.maxJump,
    desktopPreviewMaxJump: desktopPreview.maxJump,
    panelMaxJump: panel.maxJump,
    panelSizeDriftMax: panel.maxSizeDrift
  };
}

function buildFindings(scenario, metrics, errors = []) {
  const findings = [];
  const add = (severity, metric, threshold, actual, owner, suggestion) => {
    findings.push({ scenario, severity, metric, threshold, actual, owner, suggestion });
  };

  errors.forEach((error) => {
    add('P0', 'console/page error', '0', error.slice(0, 180), 'src/shell/desktop-shell/runtime/desktop/*', '先消除运行时错误，否则动态评分不可信。');
  });

  if (metrics.longTaskMaxMs > thresholds.longTaskMaxMs) {
    add('P1', 'longTaskMaxMs', `<= ${thresholds.longTaskMaxMs}ms`, `${metrics.longTaskMaxMs}ms`, 'runtime/widgets 或 notification-center-motion', '把同步 DOM 读写拆到 RAF/idle，避免动画期间重计算。');
  }
  if (metrics.animationsPeak > thresholds.animationsPeak) {
    add('P1', 'animationsPeak', `<= ${thresholds.animationsPeak}`, metrics.animationsPeak, 'notification-center-motion.js', '减少同帧并发动画数量，优先用容器级 FLIP 或 stagger 批处理。');
  }
  if (metrics.ghostMaxJump > thresholds.ghostMaxJump && metrics.dropStatePerPointerMove > thresholds.dropStatePerPointerMove) {
    add('P1', 'ghostMaxJump', `<= ${thresholds.ghostMaxJump}px`, `${metrics.ghostMaxJump}px`, 'surface/drag.js', '检查拖拽 offset、ghost 尺寸锁定和 pointermove 中的布局读写顺序。');
  }
  if (metrics.notificationPreviewMaxJump > thresholds.previewMaxJump && metrics.dropStatePerPointerMove > thresholds.dropStatePerPointerMove) {
    add('P1', 'notificationPreviewMaxJump', `<= ${thresholds.previewMaxJump}px`, `${metrics.notificationPreviewMaxJump}px`, 'surface/drag.js', 'drop preview 只在目标索引变化时更新，避免鼠标移动造成重复抖动。');
  }
  if (metrics.desktopPreviewMaxJump > thresholds.previewMaxJump && metrics.dropStatePerPointerMove > thresholds.dropStatePerPointerMove) {
    add('P1', 'desktopPreviewMaxJump', `<= ${thresholds.previewMaxJump}px`, `${metrics.desktopPreviewMaxJump}px`, 'surface/drag.js / surface/grid.js', '桌面预览应按格点稳定吸附，避免反复重算到不同 cell。');
  }
  if (metrics.panelSizeDriftMax > thresholds.panelSizeDriftMax) {
    add('P1', 'panelSizeDriftMax', `<= ${thresholds.panelSizeDriftMax}px`, `${metrics.panelSizeDriftMax}px`, 'notification-center.css', '通知中心展开后宽高应稳定，内部滚动而不是容器随内容伸缩。');
  }
  if (metrics.dropStatePerPointerMove > thresholds.dropStatePerPointerMove) {
    add('P1', 'dropStatePerPointerMove', `<= ${thresholds.dropStatePerPointerMove}`, metrics.dropStatePerPointerMove, 'surface/drag.js', 'drop-state 事件密度过高，说明相同落点仍在重复派发。');
  }
  if (metrics.maxFrameInterval > thresholds.maxFrameInterval && metrics.p95FrameInterval > 20) {
    add('P2', 'maxFrameInterval', `<= ${thresholds.maxFrameInterval}ms`, `${metrics.maxFrameInterval}ms`, 'motion/runtime', '检查该场景是否存在资源加载、同步测量或过多 transition。');
  }
  if (metrics.p95FrameInterval > thresholds.p95FrameInterval) {
    add('P2', 'p95FrameInterval', `<= ${thresholds.p95FrameInterval}ms`, `${metrics.p95FrameInterval}ms`, 'motion/runtime', 'P95 帧间隔偏高，动画观感可能不稳定。');
  }
  if (metrics.animationsAfterSettle > thresholds.animationsAfterSettle) {
    add('P2', 'animationsAfterSettle', `<= ${thresholds.animationsAfterSettle}`, metrics.animationsAfterSettle, 'notification-center-motion.js / CSS animations', '交互结束后仍有较多动画运行，检查未 cancel 的 WAAPI/CSS animation。');
  }
  return findings;
}

function scoreScenario(metrics, findings, skipped) {
  if (skipped) return null;
  let score = 10;
  findings.forEach((finding) => {
    if (finding.severity === 'P0') score -= 3;
    if (finding.severity === 'P1') score -= 1.2;
    if (finding.severity === 'P2') score -= 0.45;
  });
  if (metrics.frames < 8) score -= 0.8;
  return round(Math.max(0, score), 1);
}

async function waitForShell(page) {
  await page.waitForSelector('.menubar-time', { timeout: 12_000 });
  await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data="menuBar"]')?._x_dataStack?.[0], null, { timeout: 12_000 });
}

async function openPanel(page) {
  await page.locator('.menubar-time').click();
  await page.waitForSelector('#notification-center-panel', { state: 'visible', timeout: 8_000 });
  await page.waitForTimeout(520);
}

async function closePanel(page) {
  const panel = page.locator('#notification-center-panel');
  if (await panel.isVisible().catch(() => false)) {
    const close = page.locator('.notification-center-close').first();
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await page.waitForTimeout(300);
    }
  }
}

async function ensurePanelOpen(page) {
  if (!(await page.locator('#notification-center-panel').isVisible().catch(() => false))) {
    await openPanel(page);
  }
}

async function ensureExpandedGroup(page) {
  await ensurePanelOpen(page);
  const preview = page.locator('.notification-center-stack-preview').first();
  if (await preview.isVisible().catch(() => false)) {
    await preview.click();
    await page.waitForTimeout(260);
  }
}

async function injectNotificationState(page, { read = false } = {}) {
  await page.evaluate(({ read }) => {
    const menu = document.querySelector('[x-data="menuBar"]')?._x_dataStack?.[0];
    if (!menu) throw new Error('menuBar Alpine state not found');
    const now = Date.now();
    const item = {
      id: read ? 'read-notification-1' : 'unread-notification-1',
      key: read ? 'read-notification-1' : 'unread-notification-1',
      typeKey: 'comments',
      typeLabel: '评论回复',
      icon: 'icon-[lucide--messages-square]',
      title: read ? '已读评论通知' : '未读评论通知',
      body: read ? '用于验证已读 x 触发 DELETE。' : '用于验证未读 x 触发 mark-as-read。',
      href: '',
      unread: !read,
      dismissed: false,
      createdAtMs: now,
      time: '刚刚'
    };
    menu.notificationUsername = 'sky';
    menu.notificationShowRead = read;
    menu.notificationLoaded = true;
    menu.notificationLoading = false;
    menu.notificationExpandedGroupKey = 'comments';
    menu.notificationGroups = [{
      key: 'comments',
      label: '评论回复',
      icon: 'icon-[lucide--messages-square]',
      unreadCount: read ? 0 : 1,
      latestAtMs: now,
      items: [item]
    }];
    menu.notificationUnreadCount = read ? 0 : 1;
    menu.notificationTotalCount = 1;
    menu.setNotificationState?.('ready', '');
  }, { read });
  await page.waitForTimeout(160);
}

async function injectStackedNotificationState(page) {
  await page.evaluate(() => {
    const menu = document.querySelector('[x-data="menuBar"]')?._x_dataStack?.[0];
    if (!menu) throw new Error('menuBar Alpine state not found');
    const now = Date.now();
    const items = Array.from({ length: 3 }, (_, index) => ({
      id: `stacked-comment-${index + 1}`,
      key: `stacked-comment-${index + 1}`,
      typeKey: 'comments',
      typeLabel: '评论回复',
      icon: 'icon-[lucide--messages-square]',
      title: index === 0 ? '新的评论回复' : `评论回复 ${index + 1}`,
      body: [
        'Eren：我需要用劣质 token 过渡一下，先把交互和样式跑通。',
        'Sky：折叠态需要显示真正的叠卡层次。',
        '系统：展开和收回需要保持空间连续。'
      ][index],
      href: '',
      unread: true,
      dismissed: false,
      createdAtMs: now - index * 60_000,
      time: index === 0 ? '刚刚' : `${index + 1}分钟前`
    }));
    menu.notificationUsername = 'sky';
    menu.notificationShowRead = false;
    menu.notificationLoaded = true;
    menu.notificationLoading = false;
    menu.notificationExpandedGroupKey = '';
    menu.notificationGroups = [{
      key: 'comments',
      label: '评论回复',
      icon: 'icon-[lucide--messages-square]',
      unreadCount: items.length,
      latestAtMs: now,
      items
    }];
    menu.notificationUnreadCount = items.length;
    menu.notificationTotalCount = items.length;
    menu.setNotificationState?.('ready', '');
  });
  await page.waitForTimeout(180);
}

async function ensureWidgetEditState(page) {
  await page.evaluate(async () => {
    const el = document.querySelector('[x-data="desktopWidgets"]');
    const desktop = el?._x_dataStack?.[0];
    if (!desktop) throw new Error('desktopWidgets Alpine state not found');
    desktop.enabled = true;
    desktop.isHome = true;
    desktop.editEnabled = true;
    desktop.canManageDefaultDesktopLayout = true;
    desktop.serverLayoutAccessReady = true;
    desktop.syncViewportState?.();
    desktop.syncGridMetrics?.();
    desktop.enterEditMode?.('decorate');
    desktop.isEditing = true;
    desktop.editStage = 'decorate';
    desktop.syncResponsiveVisibility?.();
    const hasVisibleDesktopWidget = desktop.visibleDesktopNodes?.some?.((node) => node.kind !== 'icon') === true;
    if (!hasVisibleDesktopWidget) {
      await desktop._doAddWidget?.('system.calendar', 'medium', 'system.calendar:medium', {});
      const added = desktop.widgets[desktop.widgets.length - 1];
      if (added) {
        added.surface = 'desktop';
        added.hidden = false;
        const placement = desktop.findNearestAvailablePlacement?.(added, 3, 1, added.key);
        if (placement) {
          added.x = placement.x;
          added.y = placement.y;
          added.baseX = placement.x;
          added.baseY = placement.y;
          added.w = placement.w;
          added.h = placement.h;
        }
      }
      desktop.syncResponsiveVisibility?.();
    }
    desktop.isEditing = true;
    desktop.editStage = 'decorate';
    desktop.syncWidgetRuntimes?.();
    desktop.syncDesktopBodyState?.();
  });
  await page.waitForSelector('.desktop-widgets-grid .desktop-widget-card', { timeout: 8_000 });
}

async function ensureNotificationWidget(page) {
  await ensureWidgetEditState(page);
  await ensurePanelOpen(page);
  await page.evaluate(() => {
    const el = document.querySelector('[x-data="desktopWidgets"]');
    const desktop = el?._x_dataStack?.[0];
    if (!desktop) throw new Error('desktopWidgets Alpine state not found');
    const candidate = desktop.widgets.find((widget) => !widget.hidden && widget.surface !== 'notification-center');
    if (candidate) {
      candidate.surface = 'notification-center';
      candidate.order = 1;
      desktop.dispatchNotificationWidgetsChange?.();
      desktop.syncResponsiveVisibility?.();
      desktop.syncWidgetRuntimes?.();
    }
  });
  await page.waitForSelector('[data-notification-widget-card]', { timeout: 8_000 });
}

async function dragLocator(page, locator, to, steps = 48) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('drag source bounding box not found');
  const from = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 72) };
  await locator.evaluate((el, point) => {
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y
    }));
  }, from);
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const clientX = from.x + (to.x - from.x) * ratio;
    const clientY = from.y + (to.y - from.y) * ratio;
    await page.evaluate(({ clientX, clientY }) => {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        buttons: 1,
        clientX,
        clientY
      }));
    }, { clientX, clientY });
    await page.waitForTimeout(8);
  }
  await page.evaluate(({ clientX, clientY }) => {
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY
    }));
  }, { clientX: to.x, clientY: to.y });
  await page.waitForTimeout(260);
}

async function dispatchDragMoves(page, from, to, steps = 48) {
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const clientX = from.x + (to.x - from.x) * ratio;
    const clientY = from.y + (to.y - from.y) * ratio;
    await page.evaluate(({ clientX, clientY }) => {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        buttons: 1,
        clientX,
        clientY
      }));
    }, { clientX, clientY });
    await page.waitForTimeout(8);
  }
  await page.evaluate(({ clientX, clientY }) => {
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY
    }));
  }, { clientX: to.x, clientY: to.y });
  await page.waitForTimeout(260);
}

async function beginDesktopWidgetDrag(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('desktop drag source bounding box not found');
  const from = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 72) };
  await locator.evaluate((card, point) => {
    const desktop = document.querySelector('[x-data="desktopWidgets"]')?._x_dataStack?.[0];
    const slot = card.closest('[data-desktop-key]');
    const widget = desktop?.widgets?.find?.((entry) => entry.key === slot?.dataset?.desktopKey);
    if (!desktop || !widget) throw new Error('desktop widget drag source state not found');
    desktop.beginWidgetDrag(widget, {
      button: 0,
      target: card,
      currentTarget: card,
      clientX: point.x,
      clientY: point.y,
      preventDefault() {}
    });
  }, from);
  return from;
}

async function dragDesktopWidgetIntoPanel(page) {
  await ensureWidgetEditState(page);
  await ensurePanelOpen(page);
  const before = await page.locator('[data-notification-widget-card]').count();
  const source = page.locator('.desktop-widgets-grid .desktop-node-slot--widget .desktop-widget-card').first();
  const panelBox = await page.locator('#notification-center-panel').boundingBox();
  if (!panelBox) throw new Error('notification panel box not found');
  const from = await beginDesktopWidgetDrag(page, source);
  await dispatchDragMoves(page, from, { x: panelBox.x + panelBox.width / 2, y: panelBox.y + panelBox.height * 0.72 }, 72);
  const after = await page.locator('[data-notification-widget-card]').count();
  if (after <= before) {
    throw new Error(`desktop widget was not moved into notification center: before=${before} after=${after}`);
  }
}

async function dragNotificationWidgetToDesktop(page) {
  await ensureNotificationWidget(page);
  const before = await page.locator('[data-notification-widget-card]').count();
  const source = page.locator('[data-notification-widget-card]').first();
  const gridBox = await page.locator('.desktop-widgets-grid').boundingBox();
  if (!gridBox) throw new Error('desktop grid box not found');
  await dragLocator(page, source, { x: gridBox.x + Math.min(gridBox.width - 120, 420), y: gridBox.y + 170 }, 72);
  const after = await page.locator('[data-notification-widget-card]').count();
  if (after >= before) {
    throw new Error(`notification widget was not moved back to desktop: before=${before} after=${after}`);
  }
}

async function dragNotificationWidgetReorder(page) {
  await ensureWidgetEditState(page);
  await ensurePanelOpen(page);
  await page.evaluate(async () => {
    const el = document.querySelector('[x-data="desktopWidgets"]');
    const desktop = el?._x_dataStack?.[0];
    if (!desktop) throw new Error('desktopWidgets Alpine state not found');
    const visible = desktop.widgets.filter((widget) => !widget.hidden);
    while (visible.filter((widget) => widget.surface === 'notification-center').length < 2) {
      await desktop._doAddWidget?.('system.calendar', 'medium', 'system.calendar:medium', {});
      const candidate = desktop.widgets.find((widget) => widget.surface !== 'notification-center' && !widget.hidden);
      if (!candidate) break;
      candidate.surface = 'notification-center';
      candidate.order = visible.length + 1;
      visible.push(candidate);
    }
    desktop.dispatchNotificationWidgetsChange?.();
    desktop.syncResponsiveVisibility?.();
    desktop.syncWidgetRuntimes?.();
  });
  await page.waitForSelector('[data-notification-widget-card]', { timeout: 8_000 });
  const before = await page.evaluate(() => Array.from(document.querySelectorAll('[data-notification-widget-card]')).map((card) => card.dataset.notificationWidgetKey).join('|'));
  const source = page.locator('[data-notification-widget-card]').first();
  const listBox = await page.locator('.notification-center-widget-list').boundingBox();
  if (!listBox) throw new Error('notification widget list box not found');
  await dragLocator(page, source, { x: listBox.x + listBox.width / 2, y: listBox.y + listBox.height + 80 }, 72);
  const after = await page.evaluate(() => Array.from(document.querySelectorAll('[data-notification-widget-card]')).map((card) => card.dataset.notificationWidgetKey).join('|'));
  if (before === after) {
    throw new Error(`notification widgets were not reordered: order=${after}`);
  }
}

async function runScenario(page, scenario, fn) {
  const errors = [];
  const onPageError = (error) => errors.push(error.message || String(error));
  const onConsole = (message) => {
    if (message.type() === 'error') errors.push(message.text());
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  let skipped = '';
  let screenshot = '';
  let raw = null;
  try {
    await page.evaluate((name) => window.__startNotificationMotionScenario?.(name), scenario.name);
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`scenario timeout after ${scenarioTimeout}ms`)), scenarioTimeout))
    ]);
  } catch (error) {
    skipped = scenario.optional ? error.message : '';
    if (!scenario.optional) errors.push(error.message || String(error));
  } finally {
    await page.waitForTimeout(560).catch(() => {});
    raw = await page.evaluate(() => window.__stopNotificationMotionScenario?.()).catch(() => null);
    const file = path.join(screenDir, `${safeName(scenario.name)}.png`);
    await page.screenshot({ path: file, fullPage: false }).catch(() => {});
    screenshot = file;
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }

  const metrics = analyzeAudit(raw);
  const findings = buildFindings(scenario.name, metrics, errors);
  const score = scoreScenario(metrics, findings, Boolean(skipped));
  return {
    name: scenario.name,
    label: scenario.label,
    skipped,
    score,
    metrics,
    findings,
    screenshot
  };
}

function renderMarkdown(report) {
  const rows = report.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.skipped ? `skipped: ${scenario.skipped}` : 'ok'} | ${scenario.score ?? '-'} | ${scenario.metrics.p95FrameInterval} | ${scenario.metrics.maxFrameInterval} | ${scenario.metrics.longTaskMaxMs} | ${scenario.metrics.dropStateEvents}/${scenario.metrics.pointerMoves} | ${scenario.metrics.ghostMaxJump} | ${scenario.metrics.notificationPreviewMaxJump} | ${scenario.metrics.panelSizeDriftMax} |`).join('\n');
  const findingRows = report.findings.length
    ? report.findings.map((finding) => `| ${finding.severity} | ${finding.scenario} | ${finding.metric} | ${finding.threshold} | ${finding.actual} | ${finding.owner} | ${finding.suggestion} |`).join('\n')
    : '| - | - | - | - | - | - | 未发现超过阈值的问题 |';
  const screenRows = report.scenarios.map((scenario) => `- ${scenario.name}: ${scenario.screenshot}`).join('\n');

  return [
    '# 通知中心动效自动化审计',
    '',
    `- Base URL: ${report.baseUrl}`,
    `- Browser: ${report.browserName}`,
    `- Generated at: ${report.generatedAt}`,
    `- Overall score: ${report.overallScore}/10`,
    '',
    '## 场景指标',
    '',
    '| 场景 | 状态 | 分数 | P95 帧间隔(ms) | 最大帧间隔(ms) | 最大 Long Task(ms) | DropState/PointerMove | Ghost 跳变(px) | 通知预览跳变(px) | Panel 尺寸漂移(px) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows,
    '',
    '## 问题清单',
    '',
    '| 等级 | 场景 | 指标 | 阈值 | 实际值 | 可能归属 | 修复建议 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    findingRows,
    '',
    '## 截图',
    '',
    screenRows,
    '',
    '## 说明',
    '',
    '- 该报告能发现明显闪烁、跳动、长任务、事件风暴、API 误触发和布局漂移。',
    '- Liquid Glass 质感、macOS 26 视觉拟真度、动效节奏是否“舒服”，仍需人工基于截图和实机交互评审。',
    ''
  ].join('\n');
}

async function writeReport(report) {
  await ensureDirs();
  const jsonFile = path.join(outputDir, 'notification-motion-report.json');
  const mdFile = path.join(outputDir, 'notification-motion-report.md');
  await fs.writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(mdFile, renderMarkdown(report), 'utf8');
  return { jsonFile, mdFile };
}

async function main() {
  await ensureDirs();
  const { browser, browserName } = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference'
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.__motionAuditRequests = [];
  await installRoutes(page);
  await installPageInstrumentation(page);

  const scenarios = [
    {
      name: 'open-close',
      label: '点击时间打开，再关闭通知中心',
      fn: async () => {
        await closePanel(page);
        await openPanel(page);
        await closePanel(page);
      }
    },
    {
      name: 'filter-switch',
      label: '未读 / 全部 segmented control 切换',
      fn: async () => {
        await ensurePanelOpen(page);
        await page.locator('.notification-center-segment', { hasText: '全部' }).click();
        await page.waitForTimeout(360);
        await page.locator('.notification-center-segment', { hasText: '未读' }).click();
        await page.waitForTimeout(360);
      }
    },
    {
      name: 'group-expand-collapse',
      label: '通知类型折叠组展开和收起',
      fn: async () => {
        await ensurePanelOpen(page);
        await injectStackedNotificationState(page);
        const preview = page.locator('.notification-center-stack-preview').first();
        await preview.click();
        await page.waitForTimeout(320);
        await page.locator('.notification-center-group-less').first().click();
        await page.waitForTimeout(260);
      }
    },
    {
      name: 'notification-dismiss-unread',
      label: '未读通知 x 触发 mark-as-read',
      fn: async () => {
        await ensurePanelOpen(page);
        await injectNotificationState(page, { read: false });
        const before = page.__motionAuditRequests.length;
        await page.locator('.notification-center-card-read').first().click();
        await page.waitForTimeout(420);
        const calls = page.__motionAuditRequests.slice(before);
        const hasPut = calls.some((request) => request.method === 'PUT' && request.url.includes('/mark-as-read'));
        const hasDelete = calls.some((request) => request.method === 'DELETE');
        if (!hasPut || hasDelete) {
          throw new Error(`unread dismiss API mismatch: PUT=${hasPut} DELETE=${hasDelete}`);
        }
      }
    },
    {
      name: 'notification-delete-read',
      label: '已读通知 x 触发 DELETE',
      fn: async () => {
        await ensurePanelOpen(page);
        await injectNotificationState(page, { read: true });
        const before = page.__motionAuditRequests.length;
        await page.locator('.notification-center-card-read').first().click();
        await page.waitForTimeout(420);
        const calls = page.__motionAuditRequests.slice(before);
        const hasDelete = calls.some((request) => request.method === 'DELETE' && request.url.includes('/read-notification-1'));
        const hasPut = calls.some((request) => request.method === 'PUT');
        if (!hasDelete || hasPut) {
          throw new Error(`read delete API mismatch: DELETE=${hasDelete} PUT=${hasPut}`);
        }
      }
    },
    {
      name: 'drag-widget-into-notification',
      label: '桌面小组件拖入通知中心',
      fn: async () => {
        await dragDesktopWidgetIntoPanel(page);
      }
    },
    {
      name: 'drag-widget-out-to-desktop',
      label: '通知中心小组件拖回桌面',
      fn: async () => {
        await dragNotificationWidgetToDesktop(page);
      }
    },
    {
      name: 'drag-widget-reorder-notification',
      label: '通知中心内部小组件重排',
      fn: async () => {
        await dragNotificationWidgetReorder(page);
      }
    }
  ];

  await page.goto(absoluteUrl('/?v=motion-audit'), {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await waitForShell(page);
  await page.waitForTimeout(800);
  await openPanel(page);
  await closePanel(page);
  await page.waitForTimeout(500);

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(page, scenario, () => scenario.fn()));
  }

  const traceFile = path.join(outputDir, 'trace.zip');
  await context.tracing.stop({ path: traceFile }).catch(() => {});
  await browser.close();

  const scored = results.filter((scenario) => typeof scenario.score === 'number');
  const overallScore = scored.length
    ? round(scored.reduce((sum, scenario) => sum + scenario.score, 0) / scored.length, 1)
    : 0;

  const report = {
    baseUrl,
    browserName,
    generatedAt: new Date().toISOString(),
    overallScore,
    traceFile,
    thresholds,
    scenarios: results,
    findings: results.flatMap((scenario) => scenario.findings)
  };
  const files = await writeReport(report);

  console.log(`通知中心动效审计完成：${overallScore}/10`);
  console.log(`JSON: ${files.jsonFile}`);
  console.log(`Markdown: ${files.mdFile}`);
  console.log(`Trace: ${traceFile}`);
  if (report.findings.length) {
    console.log(`Findings: ${report.findings.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
