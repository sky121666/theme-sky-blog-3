import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const navigationTimeoutMs = 30_000;
const transitionName = 'photos-active-photo';
const transitionClass = 'photos-shared-view-transition';
const transitionOwnerAttribute = 'data-photos-view-transition-owner';

function absoluteUrl(pathname) {
  return new URL(pathname, `${baseUrl}/`).toString();
}

function normalizePath(value) {
  const url = new URL(value, `${baseUrl}/`);
  return `${url.pathname}${url.search}`;
}

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error?.message || String(error || '')}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

async function waitForPhotosView(page, expectedUrl, expectedView) {
  const expectedPath = normalizePath(expectedUrl);
  await page.waitForFunction(
    ({ path, view }) => {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const root = document.querySelector('[data-app-root="photos"]');
      const frame = document.getElementById('window-frame-root');
      return currentPath === path
        && document.body?.dataset?.appId === 'photos'
        && root?.dataset?.photosView === view
        && frame
        && !frame.classList.contains('pjax-loading');
    },
    { path: expectedPath, view: expectedView },
    { timeout: navigationTimeoutMs }
  );
}

async function installViewTransitionProbe(page) {
  await page.evaluate(({ ownerAttribute, sharedName, rootClass }) => {
    if (typeof document.startViewTransition !== 'function') {
      throw new Error('当前 Chromium 不支持 document.startViewTransition');
    }

    const nativeStartViewTransition = document.startViewTransition.bind(document);
    const capture = () => {
      const root = document.documentElement;
      const participants = Array.from(document.querySelectorAll(`[${ownerAttribute}]`))
        .filter((element) => element !== root)
        .map((element) => {
          const photo = element.closest('[data-photo-name]');
          const clip = element.closest('.photos-grid-scroll');
          const elementRect = element.getBoundingClientRect();
          const clipRect = clip?.getBoundingClientRect() || null;
          return {
            tagName: element.tagName,
            className: element.className,
            owner: element.getAttribute(ownerAttribute) || '',
            transitionName: element.style.viewTransitionName || '',
            photoName: photo?.dataset?.photoName || '',
            fullyVisible: clipRect
              ? elementRect.width > 0
                && elementRect.height > 0
                && elementRect.top >= clipRect.top - 1
                && elementRect.left >= clipRect.left - 1
                && elementRect.right <= clipRect.right + 1
                && elementRect.bottom <= clipRect.bottom + 1
              : true,
          };
        });

      return {
        rootClassPresent: root.classList.contains(rootClass),
        rootOwner: root.getAttribute(ownerAttribute) || '',
        participants,
        inlineNamedCount: document.querySelectorAll('[style*="view-transition-name"]').length,
        photosView: document.querySelector('[data-app-root="photos"]')?.dataset?.photosView || '',
      };
    };

    window.__PHOTOS_VIEW_TRANSITION_PROBE__ = {
      callCount: 0,
      callbackCount: 0,
      sameVariantCompleteCount: 0,
      records: [],
      sourceElement: null,
      targetElement: null,
    };

    document.addEventListener('pjax:same-variant-complete', () => {
      window.__PHOTOS_VIEW_TRANSITION_PROBE__.sameVariantCompleteCount += 1;
    });

    document.startViewTransition = (callback) => {
      const state = window.__PHOTOS_VIEW_TRANSITION_PROBE__;
      const record = {
        before: capture(),
        afterSwap: null,
      };
      state.callCount += 1;
      state.records.push(record);
      state.sourceElement = document.querySelector(
        `[${ownerAttribute}][style*="${sharedName}"]`
      );

      const transition = nativeStartViewTransition(async () => {
        state.callbackCount += 1;
        const result = await callback();
        record.afterSwap = capture();
        state.targetElement = document.querySelector(
          `[${ownerAttribute}][style*="${sharedName}"]`
        );
        return result;
      });
      return transition;
    };
  }, {
    ownerAttribute: transitionOwnerAttribute,
    sharedName: transitionName,
    rootClass: transitionClass,
  });
}

async function probeState(page) {
  return page.evaluate(({ ownerAttribute, rootClass }) => {
    const state = window.__PHOTOS_VIEW_TRANSITION_PROBE__;
    const source = state?.sourceElement || null;
    const target = state?.targetElement || null;
    return {
      callCount: state?.callCount || 0,
      callbackCount: state?.callbackCount || 0,
      sameVariantCompleteCount: state?.sameVariantCompleteCount || 0,
      records: state?.records || [],
      rootClassPresent: document.documentElement.classList.contains(rootClass),
      rootOwner: document.documentElement.getAttribute(ownerAttribute) || '',
      liveOwnerCount: document.querySelectorAll(`[${ownerAttribute}]`).length,
      inlineNamedCount: document.querySelectorAll('[style*="view-transition-name"]').length,
      sourceCleanup: source
        ? {
            connected: source.isConnected,
            owner: source.getAttribute(ownerAttribute) || '',
            transitionName: source.style.viewTransitionName || '',
          }
        : null,
      targetCleanup: target
        ? {
            connected: target.isConnected,
            owner: target.getAttribute(ownerAttribute) || '',
            transitionName: target.style.viewTransitionName || '',
          }
        : null,
    };
  }, {
    ownerAttribute: transitionOwnerAttribute,
    rootClass: transitionClass,
  });
}

async function waitForSameVariantCompletion(page, previousCount) {
  await page.waitForFunction(
    (count) => window.__PHOTOS_VIEW_TRANSITION_PROBE__?.sameVariantCompleteCount > count,
    previousCount,
    { timeout: navigationTimeoutMs }
  );
}

async function clickSameVariant(page, locator, expectedUrl, expectedView) {
  const previous = await probeState(page);
  await locator.click();
  await waitForSameVariantCompletion(page, previous.sameVariantCompleteCount);
  await waitForPhotosView(page, expectedUrl, expectedView);
}

async function assertTransitionStateIsClean(page, label) {
  await page.waitForFunction(
    ({ ownerAttribute, rootClass }) => {
      const state = window.__PHOTOS_VIEW_TRANSITION_PROBE__;
      const source = state?.sourceElement || null;
      const target = state?.targetElement || null;
      return !document.documentElement.classList.contains(rootClass)
        && !document.documentElement.hasAttribute(ownerAttribute)
        && document.querySelectorAll(`[${ownerAttribute}]`).length === 0
        && document.querySelectorAll('[style*="view-transition-name"]').length === 0
        && (!source || (!source.hasAttribute(ownerAttribute) && !source.style.viewTransitionName))
        && (!target || (!target.hasAttribute(ownerAttribute) && !target.style.viewTransitionName));
    },
    { ownerAttribute: transitionOwnerAttribute, rootClass: transitionClass },
    { timeout: navigationTimeoutMs }
  );

  const state = await probeState(page);
  assert.equal(state.rootClassPresent, false, `${label}: html 过渡 class 必须清理`);
  assert.equal(state.rootOwner, '', `${label}: html owner 必须清理`);
  assert.equal(state.liveOwnerCount, 0, `${label}: DOM 中不得残留过渡 owner`);
  assert.equal(state.inlineNamedCount, 0, `${label}: DOM 中不得残留 view-transition-name`);
  assert.equal(state.sourceCleanup?.owner || '', '', `${label}: 已断开的来源照片 owner 必须清理`);
  assert.equal(state.sourceCleanup?.transitionName || '', '', `${label}: 已断开的来源照片样式必须清理`);
  assert.equal(state.targetCleanup?.owner || '', '', `${label}: 目标照片 owner 必须清理`);
  assert.equal(state.targetCleanup?.transitionName || '', '', `${label}: 目标照片样式必须清理`);
}

async function findPhotoCard(page, { visible }) {
  await page.waitForFunction((shouldBeVisible) => {
    const clip = document.querySelector('.photos-grid-scroll');
    if (!clip) return false;
    const clipRect = clip.getBoundingClientRect();
    return Array.from(document.querySelectorAll('a.photo-card[data-photo-name]')).some((card) => {
      const inner = card.querySelector('.photo-card-inner');
      const image = card.querySelector('img');
      if (!inner) return false;
      const rect = inner.getBoundingClientRect();
      const fullyVisible = rect.width > 0
        && rect.height > 0
        && rect.top >= clipRect.top - 1
        && rect.left >= clipRect.left - 1
        && rect.right <= clipRect.right + 1
        && rect.bottom <= clipRect.bottom + 1;
      if (fullyVisible !== shouldBeVisible) return false;
      return shouldBeVisible ? Boolean(image?.complete && image.naturalWidth > 0) : true;
    });
  }, visible, { timeout: navigationTimeoutMs });

  const cards = page.locator('a.photo-card[data-photo-name]');
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const state = await cards.nth(index).evaluate((card) => {
      const inner = card.querySelector('.photo-card-inner');
      const clip = card.closest('.photos-grid-scroll');
      const image = card.querySelector('img');
      if (!inner || !clip) return null;
      const rect = inner.getBoundingClientRect();
      const clipRect = clip.getBoundingClientRect();
      return {
        href: card.href,
        photoName: card.dataset.photoName || '',
        imageReady: Boolean(image?.complete && image.naturalWidth > 0),
        fullyVisible: rect.width > 0
          && rect.height > 0
          && rect.top >= clipRect.top - 1
          && rect.left >= clipRect.left - 1
          && rect.right <= clipRect.right + 1
          && rect.bottom <= clipRect.bottom + 1,
      };
    });
    if (state && state.fullyVisible === visible && (!visible || state.imageReady)) {
      return { index, ...state };
    }
  }

  throw new Error(`没有找到${visible ? '完整可见且图片已就绪' : '不可见'}的照片卡片`);
}

async function assertDetailLayout(page, expectedSidebarHrefs, expectedPhotoName) {
  const state = await page.evaluate(() => {
    const shell = document.querySelector('.photos-detail-shell');
    const sidebar = shell?.querySelector(':scope > .photos-sidebar[aria-label="图库导航"]');
    const main = shell?.querySelector(':scope > .photos-detail-main');
    const stage = main?.querySelector(':scope > .photos-detail-stage');
    const filmstrip = main?.querySelector(':scope > .photos-detail-filmstrip');
    const current = filmstrip?.querySelectorAll('.photos-detail-neighbor.is-current[aria-current="true"]') || [];
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
      } : null;
    };
    return {
      shell: rect(shell),
      sidebar: rect(sidebar),
      main: rect(main),
      stage: rect(stage),
      filmstrip: rect(filmstrip),
      sidebarHrefs: Array.from(sidebar?.querySelectorAll('a.photos-sidebar-item[href]') || [])
        .map((link) => `${new URL(link.href).pathname}${new URL(link.href).search}`),
      legacySidebarCount: shell?.querySelectorAll(':scope > .photos-detail-sidebar').length || 0,
      filmstripCount: filmstrip?.querySelectorAll('a.photos-detail-neighbor').length || 0,
      currentCount: current.length,
      currentPhotoName: document.querySelector('.photos-detail-figure[data-photo-name]')?.dataset.photoName || '',
      currentHref: current[0]?.getAttribute('href') || '',
      filmstripDisplay: filmstrip ? getComputedStyle(filmstrip).display : 'none',
    };
  });

  assert.ok(state.shell && state.sidebar && state.main, '详情必须保留标准图库侧栏和主内容区');
  assert.deepEqual(state.sidebarHrefs, expectedSidebarHrefs, '详情侧栏链接必须与列表侧栏一致');
  assert.equal(state.legacySidebarCount, 0, '详情不得恢复旧的“附近照片”侧栏');
  assert.ok(state.sidebar.right <= state.main.left + 1, '桌面详情侧栏必须位于主内容左侧');
  assert.ok(Math.abs(state.sidebar.top - state.shell.top) <= 1, '详情侧栏顶部必须与应用内容对齐');
  assert.ok(Math.abs(state.sidebar.bottom - state.shell.bottom) <= 1, '详情侧栏底部必须与应用内容对齐');
  assert.ok(state.filmstrip && state.stage, '详情必须包含主舞台和底部胶片条');
  assert.notEqual(state.filmstripDisplay, 'none', '底部胶片条必须可见');
  assert.ok(state.filmstripCount > 1, '底部胶片条必须提供附近照片');
  assert.equal(state.currentCount, 1, '底部胶片条必须唯一标记当前照片');
  assert.equal(state.currentPhotoName, expectedPhotoName, '详情主图必须对应点击的照片');
  assert.ok(state.filmstrip.top >= state.stage.bottom - 1, '胶片条必须位于主舞台下方');
  assert.ok(state.filmstrip.bottom <= state.main.bottom + 1, '胶片条不得越出详情主内容');
}

async function readDetailSwitchState(page) {
  return page.evaluate(() => {
    const filmstrip = document.querySelector('.photos-detail-filmstrip');
    const list = filmstrip?.querySelector('.photos-detail-neighbor-list');
    const current = list?.querySelector('.photos-detail-neighbor[aria-current="true"]');
    const listRect = list?.getBoundingClientRect();
    const currentRect = current?.getBoundingClientRect();
    const subtitle = document.querySelector('[data-window-subtitle]')?.textContent?.trim() || '';
    const [position, total] = subtitle.split('/').map((part) => Number.parseInt(part.trim(), 10));
    return {
      path: `${window.location.pathname}${window.location.search}`,
      subtitle,
      position: Number.isFinite(position) ? position : 0,
      total: Number.isFinite(total) ? total : 0,
      filmstripCount: list?.querySelectorAll('.photos-detail-neighbor').length || 0,
      currentHref: current?.getAttribute('href') || '',
      currentVisible: Boolean(listRect && currentRect
        && currentRect.left >= listRect.left - 1
        && currentRect.right <= listRect.right + 1),
      previousHref: document.querySelector('.photos-detail-adjacent-btn[aria-label="上一张"]')?.getAttribute('href') || '',
      nextHref: document.querySelector('.photos-detail-adjacent-btn[aria-label="下一张"]')?.getAttribute('href') || '',
      nextDisabled: document.querySelector('.photos-detail-adjacent-btn[aria-label="下一张"]')?.getAttribute('aria-disabled') || '',
      nextTabIndex: document.querySelector('.photos-detail-adjacent-btn[aria-label="下一张"]')?.getAttribute('tabindex') || '',
      zoom: document.querySelector('[data-photos-detail-zoom]')?.value || '',
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1245, height: 923 } });
await context.addInitScript(() => {
  window.localStorage.removeItem('theme-photos-explorer-prefs');
  window.localStorage.setItem('theme-window-metrics-photos', JSON.stringify({
    x: 66,
    y: 68,
    width: 1114,
    height: 620,
    isMaximized: false,
    preMaxX: 0,
    preMaxY: 0,
    preMaxWidth: 0,
    preMaxHeight: 0,
  }));
});

const page = await context.newPage();
const runtimeErrors = collectRuntimeErrors(page);

try {
  const response = await page.goto(absoluteUrl('/photos'), {
    waitUntil: 'networkidle',
    timeout: navigationTimeoutMs,
  });
  assert.equal(response?.status(), 200, '图库路由必须返回 200');
  await waitForPhotosView(page, '/photos', 'library');
  await installViewTransitionProbe(page);

  const sidebarHrefs = await page.locator('.photos-sidebar a.photos-sidebar-item[href]').evaluateAll(
    (links) => links.map((link) => `${new URL(link.href).pathname}${new URL(link.href).search}`)
  );
  const groupHref = sidebarHrefs.find((href) => href.startsWith('/photos?group='));
  assert.ok(groupHref, '图库必须提供至少一个相簿分组用于真页回归');

  await clickSameVariant(
    page,
    page.locator(`a.photos-sidebar-item[href="${groupHref}"]`).first(),
    groupHref,
    'group'
  );
  let state = await probeState(page);
  assert.equal(state.callCount, 0, '图库列表 → 分组不得调用 startViewTransition');
  await assertTransitionStateIsClean(page, '列表 → 分组');

  const albumsHref = '/photos?view=albums';
  await clickSameVariant(
    page,
    page.locator(`a.photos-sidebar-item[href="${albumsHref}"]`).first(),
    albumsHref,
    'albums'
  );
  state = await probeState(page);
  assert.equal(state.callCount, 0, '分组 → 精选集不得调用 startViewTransition');
  await assertTransitionStateIsClean(page, '分组 → 精选集');

  await clickSameVariant(
    page,
    page.locator(`a.photos-sidebar-item[href="${groupHref}"]`).first(),
    groupHref,
    'group'
  );
  state = await probeState(page);
  assert.equal(state.callCount, 0, '精选集 → 分组不得调用 startViewTransition');

  const offscreenCard = await findPhotoCard(page, { visible: false });
  const offscreenBefore = await probeState(page);
  await page.locator('a.photo-card[data-photo-name]').nth(offscreenCard.index).evaluate((card) => card.click());
  await waitForSameVariantCompletion(page, offscreenBefore.sameVariantCompleteCount);
  await waitForPhotosView(page, offscreenCard.href, 'detail');
  state = await probeState(page);
  assert.equal(state.callCount, 0, '不可见照片的程序化点击不得启动共享元素过渡');
  await assertDetailLayout(page, sidebarHrefs, offscreenCard.photoName);
  await assertTransitionStateIsClean(page, '不可见照片 → 详情');

  const detailBackHref = await page.locator('.photos-detail-titlebar-back').first().getAttribute('href');
  assert.ok(detailBackHref, '详情页必须提供可返回的图库列表链接');
  await clickSameVariant(
    page,
    page.locator('.photos-detail-titlebar-back').first(),
    detailBackHref,
    'group'
  );
  state = await probeState(page);
  assert.equal(state.callCount, 0, '详情 → 分组不得反向启动列表共享元素过渡');

  const visibleCard = await findPhotoCard(page, { visible: true });
  const visibleBefore = await probeState(page);
  await page.locator('a.photo-card[data-photo-name]').nth(visibleCard.index).click();

  await page.waitForFunction(
    () => window.__PHOTOS_VIEW_TRANSITION_PROBE__?.callCount === 1,
    null,
    { timeout: navigationTimeoutMs }
  );
  await waitForSameVariantCompletion(page, visibleBefore.sameVariantCompleteCount);
  await waitForPhotosView(page, visibleCard.href, 'detail');

  await page.waitForFunction(
    (name) => document.getAnimations({ subtree: true }).some((animation) => (
      animation.effect?.pseudoElement === `::view-transition-group(${name})`
    )),
    transitionName,
    { timeout: navigationTimeoutMs }
  );

  state = await probeState(page);
  assert.equal(state.callCount, 1, '可见照片列表 → 详情必须且只能调用一次 startViewTransition');
  assert.equal(state.callbackCount, 1, '共享元素过渡必须且只能执行一次内容交换');
  assert.equal(state.records.length, 1, '本轮只允许一条 Photos View Transition 记录');

  const record = state.records[0];
  assert.equal(record.before.rootClassPresent, true, '过渡开始前必须标记 Photos 过渡根 class');
  assert.ok(record.before.rootOwner, '过渡开始前必须生成 owner');
  assert.equal(record.before.participants.length, 1, '过渡开始前只能标记被点击的一张照片');
  assert.equal(record.before.participants[0].photoName, visibleCard.photoName, '来源过渡元素必须是被点击的照片');
  assert.equal(record.before.participants[0].transitionName, transitionName, '来源照片必须使用固定共享名称');
  assert.equal(record.before.participants[0].fullyVisible, true, '共享元素来源必须完整位于图库滚动窗口内');
  assert.equal(record.before.inlineNamedCount, 1, '过渡开始前只能有一个内联 view-transition-name');

  assert.equal(record.afterSwap.rootOwner, record.before.rootOwner, '内容交换后必须沿用同一个 owner');
  assert.equal(record.afterSwap.photosView, 'detail', '内容交换后的目标必须是照片详情');
  assert.equal(record.afterSwap.participants.length, 1, '内容交换后只能标记详情主图');
  assert.equal(record.afterSwap.participants[0].tagName, 'FIGURE', '目标共享元素必须是详情 figure');
  assert.equal(record.afterSwap.participants[0].photoName, visibleCard.photoName, '详情共享元素必须与点击照片一致');
  assert.equal(record.afterSwap.participants[0].transitionName, transitionName, '详情必须沿用固定共享名称');
  assert.equal(record.afterSwap.inlineNamedCount, 1, '内容交换后只能有一个内联 view-transition-name');

  const pseudoElements = await page.evaluate(() => document.getAnimations({ subtree: true })
    .map((animation) => animation.effect?.pseudoElement || '')
    .filter(Boolean));
  assert.ok(
    pseudoElements.includes(`::view-transition-group(${transitionName})`),
    '真实过渡期间必须存在固定共享照片 group'
  );
  assert.equal(
    pseudoElements.some((pseudo) => /\(photo-photo-/.test(pseudo)),
    false,
    '真实过渡不得再为图库中的每张照片生成根级伪元素'
  );

  await assertDetailLayout(page, sidebarHrefs, visibleCard.photoName);
  await assertTransitionStateIsClean(page, '可见照片 → 详情完成');

  const filmstripCount = await page.locator('.photos-detail-neighbor').count();
  assert.ok(filmstripCount >= 3, '详情底部必须输出当前分页的可切换照片列表');
  const lastFilmstripLink = page.locator('.photos-detail-neighbor').last();
  const lastFilmstripHref = await lastFilmstripLink.getAttribute('href');
  assert.ok(lastFilmstripHref, '胶片条末项必须提供详情路由');
  await clickSameVariant(page, lastFilmstripLink, lastFilmstripHref, 'detail');

  let switchState = await readDetailSwitchState(page);
  assert.equal(switchState.filmstripCount, filmstripCount, '胶片条切换后必须保留完整分页列表');
  assert.equal(normalizePath(switchState.currentHref), normalizePath(lastFilmstripHref), '胶片条点击后必须同步当前项');
  assert.equal(switchState.currentVisible, true, '切换后当前胶片缩略图必须自动滚入可见区');
  if (switchState.position === switchState.total) {
    assert.equal(switchState.nextDisabled, 'true', '末张照片必须禁用“下一张”');
    assert.equal(switchState.nextTabIndex, '-1', '末张的禁用按钮不得进入键盘 Tab 顺序');
  } else {
    assert.ok(switchState.nextHref && switchState.nextHref !== '#', '分页末项不是整个相簿末张时必须保留“下一张”');
  }
  assert.ok(switchState.previousHref && switchState.previousHref !== '#', '末张必须保留有效的“上一张”路由');

  for (let index = 0; index < 5; index += 1) {
    await page.locator('[data-photos-control="zoom-in"]').click();
  }
  switchState = await readDetailSwitchState(page);
  assert.equal(switchState.zoom, '1.5', '切换验证前必须进入可拖拽的 1.5 倍缩放状态');

  const beforeZoomedPrevious = await probeState(page);
  await page.locator('.photos-detail-adjacent-btn[aria-label="上一张"]').click();
  await waitForSameVariantCompletion(page, beforeZoomedPrevious.sameVariantCompleteCount);
  await waitForPhotosView(page, switchState.previousHref, 'detail');
  const previousState = await readDetailSwitchState(page);
  assert.equal(previousState.subtitle, `${switchState.position - 1} / ${switchState.total}`, '放大后点击“上一张”必须正确切换计数');
  assert.equal(previousState.currentVisible, true, '左右按钮切换后当前缩略图必须可见');

  const beforeKeyboardPrevious = await probeState(page);
  await page.keyboard.press('ArrowLeft');
  await waitForSameVariantCompletion(page, beforeKeyboardPrevious.sameVariantCompleteCount);
  const keyboardState = await readDetailSwitchState(page);
  assert.equal(keyboardState.subtitle, `${switchState.position - 2} / ${switchState.total}`, '左方向键必须与“上一张”使用同一切换语义');
  assert.equal(keyboardState.currentVisible, true, '键盘切换后当前缩略图必须可见');
  state = await probeState(page);
  assert.equal(state.callCount, 1, '详情内胶片条/按钮/键盘切换不得新启共享元素过渡');
  await assertTransitionStateIsClean(page, '胶片条与上一张切换');
  assert.deepEqual(runtimeErrors, [], `图库专项回归出现运行时错误：\n${runtimeErrors.join('\n')}`);

  console.log('Photos View Transition 真页回归通过：列表无过渡、可见单图共享、稳定侧栏、完整胶片条及按钮/键盘切换正常');
} finally {
  await context.close();
  await browser.close();
}
