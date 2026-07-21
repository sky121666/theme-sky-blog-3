import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(
  process.env.SMOKE_BASE_URL || process.env.HALO_BASE_URL || 'http://localhost:8090'
).replace(/\/$/, '');
const navigationTimeoutMs = 30_000;
const transitionName = 'photos-active-photo';
const transitionClass = 'photos-shared-view-transition';
const transitionOwnerAttribute = 'data-photos-view-transition-owner';
const transitionKindAttribute = 'data-photos-view-transition-kind';
const transitionDirectionAttribute = 'data-photos-view-transition-direction';
const filmstripTransitionSettleMs = 320;
const filmstripIdleWaitTimeoutMs = 6_000;

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
  await page.evaluate(({ ownerAttribute, kindAttribute, directionAttribute, sharedName, rootClass }) => {
    if (typeof document.startViewTransition !== 'function') {
      throw new Error('当前 Chromium 不支持 document.startViewTransition');
    }

    const nativeStartViewTransition = document.startViewTransition.bind(document);
    const capture = () => {
      const root = document.documentElement;
      const photosShell = document.querySelector('.photos-detail-shell');
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
            imageReady: !element.querySelector('img') || Boolean(
              element.querySelector('img')?.complete
              && element.querySelector('img')?.naturalWidth > 0
            ),
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
        kind: root.getAttribute(kindAttribute) || '',
        direction: root.getAttribute(directionAttribute) || '',
        participants,
        inlineNamedCount: document.querySelectorAll('[style*="view-transition-name"]').length,
        photosView: document.querySelector('[data-app-root="photos"]')?.dataset?.photosView || '',
        path: `${window.location.pathname}${window.location.search}`,
        title: document.querySelector('[data-window-title]')?.textContent?.trim() || '',
        subtitle: document.querySelector('[data-window-subtitle]')?.textContent?.trim() || '',
        shellTitle: photosShell?.dataset.photosChromeTitle || '',
        shellSubtitle: photosShell?.dataset.photosChromeSubtitle || '',
      };
    };

    window.__PHOTOS_VIEW_TRANSITION_PROBE__ = {
      callCount: 0,
      callbackCount: 0,
      sameVariantCompleteCount: 0,
      records: [],
      decodeCalls: [],
      trackedElements: [],
      sourceElement: null,
      targetElement: null,
    };

    const nativeImageDecode = HTMLImageElement.prototype.decode;
    if (typeof nativeImageDecode === 'function') {
      HTMLImageElement.prototype.decode = function (...args) {
        window.__PHOTOS_VIEW_TRANSITION_PROBE__?.decodeCalls.push({
          connected: this.isConnected,
          photoName: this.closest?.('[data-photo-name]')?.dataset.photoName || '',
          src: this.currentSrc || this.src || '',
        });
        return nativeImageDecode.apply(this, args);
      };
    }

    document.addEventListener('pjax:same-variant-complete', () => {
      window.__PHOTOS_VIEW_TRANSITION_PROBE__.sameVariantCompleteCount += 1;
    });

    document.startViewTransition = (callback) => {
      const state = window.__PHOTOS_VIEW_TRANSITION_PROBE__;
      const record = {
        before: capture(),
        afterSwap: null,
        animationStyles: null,
        animationError: '',
        titlebarPresent: false,
        toolbarPresent: false,
        titlebarStable: false,
        toolbarStable: false,
      };
      const tracked = {
        source: null,
        target: null,
      };
      const titlebar = document.querySelector('[data-window-titlebar]');
      const toolbar = document.querySelector('[data-photos-detail-toolbar]');
      record.titlebarPresent = Boolean(titlebar);
      record.toolbarPresent = Boolean(toolbar);
      state.callCount += 1;
      state.records.push(record);
      state.sourceElement = document.querySelector(
        `[${ownerAttribute}][style*="${sharedName}"]`
      );
      tracked.source = state.sourceElement;
      state.trackedElements.push(tracked);

      const transition = nativeStartViewTransition(async () => {
        state.callbackCount += 1;
        const result = await callback();
        record.afterSwap = capture();
        state.targetElement = document.querySelector(
          `[${ownerAttribute}][style*="${sharedName}"]`
        );
        tracked.target = state.targetElement;
        record.titlebarStable = titlebar === document.querySelector('[data-window-titlebar]');
        record.toolbarStable = toolbar === document.querySelector('[data-photos-detail-toolbar]');
        return result;
      });
      Promise.resolve(transition.ready)
        .then(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          const root = document.documentElement;
          const readStyle = (pseudo) => {
            const style = getComputedStyle(root, pseudo);
            return {
              animationName: style.animationName,
              animationDuration: style.animationDuration,
              animationDelay: style.animationDelay,
              animationFillMode: style.animationFillMode,
            };
          };
          record.animationStyles = {
            animations: document.getAnimations({ subtree: true }).map((animation) => {
              const timing = animation.effect?.getTiming?.() || {};
              return {
                pseudo: animation.effect?.pseudoElement || '',
                name: animation.animationName || '',
                duration: timing.duration,
                delay: timing.delay,
                fill: timing.fill,
              };
            }),
            group: readStyle(`::view-transition-group(${sharedName})`),
            oldPhoto: readStyle(`::view-transition-old(${sharedName})`),
            newPhoto: readStyle(`::view-transition-new(${sharedName})`),
            oldRoot: readStyle('::view-transition-old(root)'),
            newRoot: readStyle('::view-transition-new(root)'),
          };
        })
        .catch((error) => {
          record.animationError = error?.message || String(error || 'transition.ready failed');
        });
      return transition;
    };
  }, {
    ownerAttribute: transitionOwnerAttribute,
    kindAttribute: transitionKindAttribute,
    directionAttribute: transitionDirectionAttribute,
    sharedName: transitionName,
    rootClass: transitionClass,
  });
}

async function probeState(page) {
  return page.evaluate(({ ownerAttribute, kindAttribute, directionAttribute, rootClass }) => {
    const state = window.__PHOTOS_VIEW_TRANSITION_PROBE__;
    const source = state?.sourceElement || null;
    const target = state?.targetElement || null;
    return {
      callCount: state?.callCount || 0,
      callbackCount: state?.callbackCount || 0,
      sameVariantCompleteCount: state?.sameVariantCompleteCount || 0,
      records: state?.records || [],
      decodeCalls: state?.decodeCalls || [],
      rootClassPresent: document.documentElement.classList.contains(rootClass),
      rootOwner: document.documentElement.getAttribute(ownerAttribute) || '',
      rootKind: document.documentElement.getAttribute(kindAttribute) || '',
      rootDirection: document.documentElement.getAttribute(directionAttribute) || '',
      liveOwnerCount: document.querySelectorAll(`[${ownerAttribute}]`).length,
      inlineNamedCount: document.querySelectorAll('[style*="view-transition-name"]').length,
      trackedCleanup: Array.from(state?.trackedElements || []).map(({ source: trackedSource, target: trackedTarget }) => ({
        source: trackedSource ? {
          connected: trackedSource.isConnected,
          owner: trackedSource.getAttribute(ownerAttribute) || '',
          transitionName: trackedSource.style.viewTransitionName || '',
        } : null,
        target: trackedTarget ? {
          connected: trackedTarget.isConnected,
          owner: trackedTarget.getAttribute(ownerAttribute) || '',
          transitionName: trackedTarget.style.viewTransitionName || '',
        } : null,
      })),
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
    kindAttribute: transitionKindAttribute,
    directionAttribute: transitionDirectionAttribute,
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
    ({ ownerAttribute, kindAttribute, directionAttribute, rootClass }) => {
      const state = window.__PHOTOS_VIEW_TRANSITION_PROBE__;
      const source = state?.sourceElement || null;
      const target = state?.targetElement || null;
      return !document.documentElement.classList.contains(rootClass)
        && !document.documentElement.hasAttribute(ownerAttribute)
        && !document.documentElement.hasAttribute(kindAttribute)
        && !document.documentElement.hasAttribute(directionAttribute)
        && document.querySelectorAll(`[${ownerAttribute}]`).length === 0
        && document.querySelectorAll('[style*="view-transition-name"]').length === 0
        && (!source || (!source.hasAttribute(ownerAttribute) && !source.style.viewTransitionName))
        && (!target || (!target.hasAttribute(ownerAttribute) && !target.style.viewTransitionName));
    },
    {
      ownerAttribute: transitionOwnerAttribute,
      kindAttribute: transitionKindAttribute,
      directionAttribute: transitionDirectionAttribute,
      rootClass: transitionClass,
    },
    { timeout: navigationTimeoutMs }
  );

  const state = await probeState(page);
  assert.equal(state.rootClassPresent, false, `${label}: html 过渡 class 必须清理`);
  assert.equal(state.rootOwner, '', `${label}: html owner 必须清理`);
  assert.equal(state.rootKind, '', `${label}: html kind 必须清理`);
  assert.equal(state.rootDirection, '', `${label}: html direction 必须清理`);
  assert.equal(state.liveOwnerCount, 0, `${label}: DOM 中不得残留过渡 owner`);
  assert.equal(state.inlineNamedCount, 0, `${label}: DOM 中不得残留 view-transition-name`);
  assert.equal(state.sourceCleanup?.owner || '', '', `${label}: 已断开的来源照片 owner 必须清理`);
  assert.equal(state.sourceCleanup?.transitionName || '', '', `${label}: 已断开的来源照片样式必须清理`);
  assert.equal(state.targetCleanup?.owner || '', '', `${label}: 目标照片 owner 必须清理`);
  assert.equal(state.targetCleanup?.transitionName || '', '', `${label}: 目标照片样式必须清理`);
  state.trackedCleanup.forEach((tracked, index) => {
    assert.equal(tracked.source?.owner || '', '', `${label}: 第 ${index + 1} 轮来源 owner 必须清理`);
    assert.equal(tracked.source?.transitionName || '', '', `${label}: 第 ${index + 1} 轮来源样式必须清理`);
    assert.equal(tracked.target?.owner || '', '', `${label}: 第 ${index + 1} 轮目标 owner 必须清理`);
    assert.equal(tracked.target?.transitionName || '', '', `${label}: 第 ${index + 1} 轮目标样式必须清理`);
  });
}

async function assertDetailStepTransition(page, beforeState, {
  sourcePhotoName,
  targetPhotoName,
  direction,
  label,
}) {
  await page.waitForFunction(
    (recordIndex) => {
      const record = window.__PHOTOS_VIEW_TRANSITION_PROBE__?.records?.[recordIndex];
      return Boolean(record?.animationStyles || record?.animationError);
    },
    beforeState.records.length,
    { timeout: navigationTimeoutMs }
  );
  const state = await probeState(page);
  assert.equal(state.callCount, beforeState.callCount + 1, `${label}: 必须新增且仅新增一次 View Transition`);
  assert.equal(state.callbackCount, beforeState.callbackCount + 1, `${label}: 内容交换回调必须执行一次`);
  assert.equal(
    state.sameVariantCompleteCount,
    beforeState.sameVariantCompleteCount + 1,
    `${label}: 必须新增且仅新增一次 PJAX 完成事件`
  );
  assert.equal(state.records.length, beforeState.records.length + 1, `${label}: 必须新增一条过渡记录`);

  const record = state.records.at(-1);
  assert.equal(record.animationError, '', `${label}: transition.ready 不得失败`);
  assert.equal(record.before.rootClassPresent, true, `${label}: 过渡开始前必须标记根 class`);
  assert.ok(record.before.rootOwner, `${label}: 过渡开始前必须生成 owner`);
  assert.equal(record.before.kind, 'detail-step', `${label}: 必须使用详情步进过渡`);
  assert.equal(record.before.direction, direction, `${label}: 方向必须正确`);
  assert.equal(record.before.photosView, 'detail', `${label}: 来源必须是照片详情`);
  assert.equal(record.before.participants.length, 1, `${label}: 来源只能命名主照片 figure`);
  assert.equal(record.before.participants[0].tagName, 'FIGURE', `${label}: 来源参与者必须是 figure`);
  assert.equal(record.before.participants[0].photoName, sourcePhotoName, `${label}: 来源照片必须正确`);
  assert.equal(record.before.participants[0].transitionName, transitionName, `${label}: 来源必须复用固定过渡名`);
  assert.equal(record.before.inlineNamedCount, 1, `${label}: 来源不得命名侧栏、标题栏或胶片项`);
  assert.equal(record.before.title, record.before.shellTitle, `${label}: 来源标题必须符合详情数据契约`);
  assert.equal(record.before.subtitle, record.before.shellSubtitle, `${label}: 来源副标题必须符合详情数据契约`);

  assert.equal(record.afterSwap.rootClassPresent, true, `${label}: 交换后必须保留根 class`);
  assert.equal(record.afterSwap.rootOwner, record.before.rootOwner, `${label}: 交换后必须沿用同一 owner`);
  assert.equal(record.afterSwap.kind, 'detail-step', `${label}: 交换后必须保留详情步进标记`);
  assert.equal(record.afterSwap.direction, direction, `${label}: 交换后必须保留方向`);
  assert.equal(record.afterSwap.photosView, 'detail', `${label}: 目标必须仍是照片详情`);
  assert.equal(record.afterSwap.participants.length, 1, `${label}: 目标只能命名主照片 figure`);
  assert.equal(record.afterSwap.participants[0].tagName, 'FIGURE', `${label}: 目标参与者必须是 figure`);
  assert.equal(record.afterSwap.participants[0].photoName, targetPhotoName, `${label}: 目标照片必须正确`);
  assert.equal(record.afterSwap.participants[0].transitionName, transitionName, `${label}: 目标必须复用固定过渡名`);
  assert.equal(record.afterSwap.participants[0].imageReady, true, `${label}: 目标原图必须在新快照前完成解码`);
  assert.equal(record.afterSwap.inlineNamedCount, 1, `${label}: 目标不得命名侧栏、标题栏或胶片项`);
  assert.equal(record.afterSwap.title, record.afterSwap.shellTitle, `${label}: 目标快照标题必须符合详情数据契约`);
  assert.equal(record.afterSwap.subtitle, record.afterSwap.shellSubtitle, `${label}: 目标快照副标题必须符合详情数据契约`);
  assert.equal(record.titlebarPresent, true, `${label}: 详情标题栏必须存在`);
  assert.equal(record.toolbarPresent, true, `${label}: 详情工具栏必须存在`);
  assert.equal(record.titlebarStable, true, `${label}: 标题栏节点必须保持稳定`);
  assert.equal(record.toolbarStable, true, `${label}: 工具栏节点必须保持稳定`);

  const currentChrome = await page.evaluate(() => ({
    title: document.querySelector('[data-window-title]')?.textContent?.trim() || '',
    subtitle: document.querySelector('[data-window-subtitle]')?.textContent?.trim() || '',
  }));
  assert.equal(record.afterSwap.title, currentChrome.title, `${label}: 新快照标题必须精确等于目标标题`);
  assert.equal(record.afterSwap.subtitle, currentChrome.subtitle, `${label}: 新快照副标题必须精确等于目标计数`);
  assert.notEqual(record.afterSwap.subtitle, '图库', `${label}: 新快照不得闪回通用“图库”副标题`);

  const expectedPrefix = direction === 'previous'
    ? 'photos-detail-step-previous'
    : direction === 'next'
      ? 'photos-detail-step-next'
      : 'photos-detail-step-neutral';
  const oldAnimation = record.animationStyles.animations.find((animation) => (
    animation.pseudo === `::view-transition-old(${transitionName})`
      && animation.name === `${expectedPrefix}-out`
  ));
  const newAnimation = record.animationStyles.animations.find((animation) => (
    animation.pseudo === `::view-transition-new(${transitionName})`
      && animation.name === `${expectedPrefix}-in`
  ));
  assert.ok(
    oldAnimation,
    `${label}: 旧图动画名称必须匹配方向；实际 ${JSON.stringify(record.animationStyles.animations)}`
  );
  assert.equal(oldAnimation.duration, 140, `${label}: 旧图必须在 140ms 内平滑淡出`);
  assert.equal(oldAnimation.delay, 0, `${label}: 旧图不得延迟退出`);
  assert.equal(oldAnimation.fill, 'both', `${label}: 旧图必须保持首尾帧`);
  assert.ok(newAnimation, `${label}: 新图动画名称必须匹配方向`);
  assert.equal(newAnimation.duration, 200, `${label}: 新图必须在 200ms 内柔和进入`);
  assert.equal(newAnimation.delay, 40, `${label}: 新图必须短暂延迟以避免高亮双影`);
  assert.equal(newAnimation.fill, 'both', `${label}: 新图延迟阶段必须保持透明首帧`);
  assert.equal(
    record.animationStyles.animations.some((animation) => (
      animation.pseudo === '::view-transition-old(root)'
        || animation.pseudo === '::view-transition-new(root)'
    )),
    false,
    `${label}: 页面根快照不得参与动画`
  );
  assert.ok(
    state.decodeCalls.slice(beforeState.decodeCalls.length).some((call) => (
      call.connected && call.photoName === targetPhotoName
    )),
    `${label}: 新快照前必须对已接入 DOM 的目标主图调用 decode()`
  );

  await assertTransitionStateIsClean(page, label);
  return state;
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
      filmstripPosition: filmstrip ? getComputedStyle(filmstrip).position : '',
      filmstripBorderRadius: filmstrip
        ? Number.parseFloat(getComputedStyle(filmstrip.querySelector('.photos-detail-neighbor-list')).borderRadius)
        : 0,
    };
  });

  assert.ok(state.shell && state.sidebar && state.main, '详情必须保留标准图库侧栏和主内容区');
  assert.deepEqual(state.sidebarHrefs, expectedSidebarHrefs, '详情侧栏链接必须与列表侧栏一致');
  assert.equal(state.legacySidebarCount, 0, '详情不得恢复旧的“附近照片”侧栏');
  assert.ok(state.sidebar.right <= state.main.left + 1, '桌面详情侧栏必须位于主内容左侧');
  assert.ok(Math.abs(state.sidebar.top - state.shell.top) <= 1, '详情侧栏顶部必须与应用内容对齐');
  assert.ok(Math.abs(state.sidebar.bottom - state.shell.bottom) <= 1, '详情侧栏底部必须与应用内容对齐');
  assert.ok(state.filmstrip && state.stage, '详情必须包含主舞台和底部胶片条');
  assert.notEqual(state.filmstripDisplay, 'none', '底部胶片条必须保留完整 DOM');
  assert.ok(state.filmstripCount > 1, '底部胶片条必须提供附近照片');
  assert.equal(state.currentCount, 1, '底部胶片条必须唯一标记当前照片');
  assert.equal(state.currentPhotoName, expectedPhotoName, '详情主图必须对应点击的照片');
  assert.equal(state.filmstripPosition, 'absolute', '胶片条必须作为浮层，避免显隐时重排主图');
  assert.ok(state.filmstrip.top >= state.stage.top - 1, '浮动胶片条不得越出主舞台顶部');
  assert.ok(state.filmstrip.top < state.stage.bottom, '浮动胶片条必须覆盖在主舞台底部');
  assert.ok(state.filmstrip.bottom <= state.main.bottom + 12, '胶片条退场位移不得明显越出详情主内容');
  assert.ok(state.filmstripBorderRadius >= 12, '浮动胶片条必须保留原生相册式圆角材质');
}

async function readFilmstripLifecycleState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.photos-detail-shell');
    const main = shell?.querySelector('.photos-detail-main');
    const stage = shell?.querySelector('.photos-detail-stage');
    const image = shell?.querySelector('.photos-detail-image');
    const filmstrip = shell?.querySelector('.photos-detail-filmstrip');
    const list = filmstrip?.querySelector('.photos-detail-neighbor-list');
    const current = list?.querySelector('.photos-detail-neighbor[aria-current="true"]');
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
    const filmstripStyle = filmstrip ? getComputedStyle(filmstrip) : null;
    const listStyle = list ? getComputedStyle(list) : null;

    return {
      state: shell?.dataset.photosFilmstripState || '',
      idleDelay: Number.parseInt(shell?.dataset.photosFilmstripIdleDelay || '0', 10),
      main: rect(main),
      stage: rect(stage),
      image: rect(image),
      filmstrip: rect(filmstrip),
      filmstripCount: list?.querySelectorAll('.photos-detail-neighbor').length || 0,
      currentCount: list?.querySelectorAll('.photos-detail-neighbor.is-current[aria-current="true"]').length || 0,
      currentHref: current?.getAttribute('href') || '',
      ariaHidden: filmstrip?.getAttribute('aria-hidden') || '',
      inert: filmstrip?.hasAttribute('inert') || false,
      opacity: filmstripStyle?.opacity || '',
      visibility: filmstripStyle?.visibility || '',
      pointerEvents: filmstripStyle?.pointerEvents || '',
      position: filmstripStyle?.position || '',
      transform: filmstripStyle?.transform || '',
      transitionDuration: filmstripStyle?.transitionDuration || '',
      listBorderRadius: listStyle?.borderRadius || '',
      nextHref: shell?.querySelector('.photos-detail-adjacent-btn[aria-label="下一张"]:not(.is-disabled)')?.getAttribute('href') || '',
    };
  });
}

function assertStableRect(before, after, label) {
  assert.ok(before && after, `${label}必须存在`);
  for (const key of ['top', 'left', 'width', 'height']) {
    assert.ok(
      Math.abs(before[key] - after[key]) <= 0.75,
      `${label}在胶片条显隐前后不得发生${key}跳动：${before[key]} -> ${after[key]}`
    );
  }
}

async function wakeFilmstrip(page) {
  const current = await readFilmstripLifecycleState(page);
  if (current.state === 'visible') return current;

  await page.locator('.photos-detail-stage').hover({ position: { x: 20, y: 20 } });
  await page.waitForFunction(
    () => document.querySelector('.photos-detail-shell')?.dataset.photosFilmstripState === 'visible',
    null,
    { timeout: navigationTimeoutMs }
  );
  await page.waitForTimeout(filmstripTransitionSettleMs);
  return readFilmstripLifecycleState(page);
}

async function readDetailSwitchState(page) {
  return page.evaluate(() => {
    const filmstrip = document.querySelector('.photos-detail-filmstrip');
    const list = filmstrip?.querySelector('.photos-detail-neighbor-list');
    const current = list?.querySelector('.photos-detail-neighbor[aria-current="true"]');
    const listRect = list?.getBoundingClientRect();
    const currentRect = current?.getBoundingClientRect();
    const subtitle = document.querySelector('[data-window-subtitle]')?.textContent?.trim() || '';
    const title = document.querySelector('[data-window-title]')?.textContent?.trim() || '';
    const photosRoot = document.querySelector('[data-app-root="photos"]');
    const [position, total] = subtitle.split('/').map((part) => Number.parseInt(part.trim(), 10));
    return {
      path: `${window.location.pathname}${window.location.search}`,
      title,
      subtitle,
      chromeTitle: photosRoot?.dataset.photosChromeTitle || '',
      chromeSubtitle: photosRoot?.dataset.photosChromeSubtitle || '',
      photoName: document.querySelector('.photos-detail-figure[data-photo-name]')?.dataset.photoName || '',
      position: Number.isFinite(position) ? position : 0,
      total: Number.isFinite(total) ? total : 0,
      filmstripCount: list?.querySelectorAll('.photos-detail-neighbor').length || 0,
      currentHref: current?.getAttribute('href') || '',
      filmstripScrollLeft: list?.scrollLeft || 0,
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

async function verifyFilmstripIdleLifecycle(browser, detailHref) {
  const idleContext = await browser.newContext({ viewport: { width: 1245, height: 923 } });
  await idleContext.addInitScript(() => {
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

  const idlePage = await idleContext.newPage();
  const idleErrors = collectRuntimeErrors(idlePage);
  const waitForHidden = () => idlePage.waitForFunction(
    () => document.querySelector('.photos-detail-shell')?.dataset.photosFilmstripState === 'hidden',
    null,
    { timeout: filmstripIdleWaitTimeoutMs }
  );

  try {
    const response = await idlePage.goto(absoluteUrl(detailHref), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs,
    });
    assert.equal(response?.status(), 200, '胶片条空闲回归详情路由必须返回 200');
    await waitForPhotosView(idlePage, detailHref, 'detail');
    await idlePage.locator('.photos-detail-stage').hover({ position: { x: 20, y: 20 } });
    await idlePage.waitForFunction(() => {
      const shell = document.querySelector('.photos-detail-shell');
      const image = document.querySelector('.photos-detail-image');
      return shell?.dataset.photosFilmstripState === 'visible'
        && Number.parseInt(shell.dataset.photosFilmstripIdleDelay || '0', 10) > 0
        && image?.complete
        && image.naturalWidth > 0;
    }, null, { timeout: navigationTimeoutMs });
    await idlePage.waitForTimeout(filmstripTransitionSettleMs);

    const visible = await readFilmstripLifecycleState(idlePage);
    assert.equal(visible.state, 'visible', '详情初始必须显示浮动胶片条');
    assert.ok(visible.idleDelay >= 3_000 && visible.idleDelay <= 4_000, '胶片条空闲时间必须保持在约 3 秒');
    assert.equal(visible.position, 'absolute', '胶片条必须浮在主舞台内，不得占用布局行');
    assert.equal(visible.opacity, '1', '胶片条初始必须完全可见');
    assert.equal(visible.visibility, 'visible', '胶片条初始不得被隐藏');
    assert.equal(visible.pointerEvents, 'auto', '显示态胶片条必须可以点击');
    assert.equal(visible.ariaHidden, '', '显示态胶片条不得从辅助技术中隐藏');
    assert.equal(visible.inert, false, '显示态胶片条必须可聚焦');
    assert.equal(visible.currentCount, 1, '胶片条初始必须唯一标记当前照片');
    assert.ok(visible.filmstripCount > 1, '胶片条初始必须保留完整照片列表');

    await waitForHidden();
    await idlePage.waitForTimeout(filmstripTransitionSettleMs);
    const hidden = await readFilmstripLifecycleState(idlePage);
    assert.equal(hidden.state, 'hidden', '超过空闲时间后胶片条必须隐藏');
    assert.equal(hidden.opacity, '0', '隐藏态胶片条必须完全淡出');
    assert.equal(hidden.visibility, 'hidden', '隐藏态胶片条必须退出视觉命中');
    assert.equal(hidden.pointerEvents, 'none', '隐藏态胶片条不得拦截主图操作');
    assert.equal(hidden.ariaHidden, 'true', '隐藏态胶片条必须同步辅助技术状态');
    assert.equal(hidden.inert, true, '隐藏态胶片条不得保留不可见焦点目标');
    assert.equal(hidden.filmstripCount, visible.filmstripCount, '隐藏不得销毁胶片条照片列表');
    assert.equal(hidden.currentCount, 1, '隐藏不得丢失当前照片标记');
    assertStableRect(visible.stage, hidden.stage, '主舞台');
    assertStableRect(visible.image, hidden.image, '主图');

    const woken = await wakeFilmstrip(idlePage);
    assert.equal(woken.state, 'visible', '鼠标回到主舞台时必须立即唤醒胶片条');
    assert.equal(woken.opacity, '1', '唤醒完成后胶片条必须完全显示');
    assert.equal(woken.inert, false, '唤醒后胶片条必须恢复可交互状态');
    assertStableRect(visible.stage, woken.stage, '唤醒后的主舞台');
    assertStableRect(visible.image, woken.image, '唤醒后的主图');

    await idlePage.locator('.photos-detail-filmstrip').hover();
    await idlePage.waitForTimeout(visible.idleDelay + 250);
    const hovered = await readFilmstripLifecycleState(idlePage);
    assert.equal(hovered.state, 'visible', '鼠标悬停胶片条时不得自动收走');

    await idlePage.locator('.photos-detail-stage').hover({ position: { x: 20, y: 20 } });
    await waitForHidden();
    await idlePage.keyboard.press('Tab');
    await idlePage.waitForFunction(
      () => document.querySelector('.photos-detail-shell')?.dataset.photosFilmstripState === 'visible',
      null,
      { timeout: navigationTimeoutMs }
    );
    const currentFilmstripItem = idlePage.locator('.photos-detail-neighbor[aria-current="true"]');
    await currentFilmstripItem.focus();
    await idlePage.waitForTimeout(visible.idleDelay + 250);
    const focused = await readFilmstripLifecycleState(idlePage);
    assert.equal(focused.state, 'visible', '键盘焦点位于胶片条时不得自动收走');
    assert.equal(
      await currentFilmstripItem.evaluate((element) => element === document.activeElement),
      true,
      '胶片条保持显示时不得丢失当前键盘焦点'
    );

    await idlePage.evaluate(() => document.activeElement?.blur?.());
    await idlePage.locator('.photos-detail-stage').hover({ position: { x: 24, y: 24 } });
    await waitForHidden();
    const beforePjax = await readFilmstripLifecycleState(idlePage);
    assert.ok(beforePjax.nextHref && beforePjax.nextHref !== '#', '空闲 PJAX 回归必须提供下一张');
    await idlePage.evaluate(() => {
      window.__PHOTOS_IDLE_OLD_ROOT__ = document.querySelector('.photos-detail-shell');
    });
    await idlePage.keyboard.press('ArrowRight');
    await waitForPhotosView(idlePage, beforePjax.nextHref, 'detail');
    await idlePage.waitForFunction(
      () => document.querySelector('.photos-detail-shell')?.dataset.photosFilmstripState === 'visible',
      null,
      { timeout: navigationTimeoutMs }
    );
    const afterPjax = await readFilmstripLifecycleState(idlePage);
    assert.equal(afterPjax.state, 'visible', '详情 PJAX 切换后新胶片条必须重新短暂显示');
    const oldRootState = await idlePage.evaluate(() => ({
      connected: window.__PHOTOS_IDLE_OLD_ROOT__?.isConnected || false,
      state: window.__PHOTOS_IDLE_OLD_ROOT__?.dataset.photosFilmstripState || '',
      idleDelay: window.__PHOTOS_IDLE_OLD_ROOT__?.dataset.photosFilmstripIdleDelay || '',
    }));
    assert.equal(oldRootState.connected, false, 'PJAX 后旧详情根必须断开');
    assert.equal(oldRootState.state, '', 'PJAX 销毁时必须清理旧胶片条状态');
    assert.equal(oldRootState.idleDelay, '', 'PJAX 销毁时必须清理旧胶片条计时契约');
    assert.deepEqual(idleErrors, [], `胶片条空闲回归出现运行时错误：\n${idleErrors.join('\n')}`);
  } finally {
    await idleContext.close();
  }
}

async function verifyTouchFilmstripPersistence(browser, detailHref) {
  const touchContext = await browser.newContext({
    viewport: { width: 900, height: 700 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  const touchErrors = collectRuntimeErrors(touchPage);
  try {
    const response = await touchPage.goto(absoluteUrl(detailHref), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs,
    });
    assert.equal(response?.status(), 200, '触屏胶片条回归详情路由必须返回 200');
    await waitForPhotosView(touchPage, detailHref, 'detail');
    await touchPage.waitForFunction(
      () => document.querySelector('.photos-detail-shell')?.dataset.photosFilmstripState === 'visible',
      null,
      { timeout: navigationTimeoutMs }
    );
    const touchCapability = await touchPage.evaluate(() => ({
      fineHover: matchMedia('(hover: hover) and (pointer: fine)').matches,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
    assert.equal(touchCapability.fineHover, false, '触屏回归必须禁用细指针悬停能力');
    assert.ok(touchCapability.maxTouchPoints > 0, '触屏回归必须暴露触摸输入');

    const initial = await readFilmstripLifecycleState(touchPage);
    await touchPage.waitForTimeout(initial.idleDelay + 350);
    const settled = await readFilmstripLifecycleState(touchPage);
    assert.equal(settled.state, 'visible', '触屏设备空闲时胶片条必须保持常显');
    assert.equal(settled.pointerEvents, 'auto', '触屏胶片条必须保持单击可用');
    assert.equal(settled.inert, false, '触屏胶片条不得进入 inert 状态');
    assert.deepEqual(touchErrors, [], `触屏胶片条回归出现运行时错误：\n${touchErrors.join('\n')}`);
  } finally {
    await touchContext.close();
  }
}

async function verifyReducedMotionFallback(browser) {
  const reducedContext = await browser.newContext({
    viewport: { width: 1245, height: 923 },
    reducedMotion: 'reduce',
  });
  await reducedContext.addInitScript(() => {
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

  const reducedPage = await reducedContext.newPage();
  const reducedErrors = collectRuntimeErrors(reducedPage);
  try {
    const response = await reducedPage.goto(absoluteUrl('/photos'), {
      waitUntil: 'networkidle',
      timeout: navigationTimeoutMs,
    });
    assert.equal(response?.status(), 200, 'reduced-motion 图库路由必须返回 200');
    await waitForPhotosView(reducedPage, '/photos', 'library');
    await installViewTransitionProbe(reducedPage);

    const visibleCard = await findPhotoCard(reducedPage, { visible: true });
    const beforeDetail = await probeState(reducedPage);
    await reducedPage.locator('a.photo-card[data-photo-name]').nth(visibleCard.index).click();
    await waitForSameVariantCompletion(reducedPage, beforeDetail.sameVariantCompleteCount);
    await waitForPhotosView(reducedPage, visibleCard.href, 'detail');
    let state = await probeState(reducedPage);
    assert.equal(state.callCount, 0, 'reduced-motion 列表进入详情不得调用 startViewTransition');
    await assertTransitionStateIsClean(reducedPage, 'reduced-motion 列表进入详情');

    await reducedPage.waitForFunction(
      () => document.querySelector('.photos-detail-shell')?.dataset.photosFilmstripState === 'hidden',
      null,
      { timeout: filmstripIdleWaitTimeoutMs }
    );
    const reducedFilmstrip = await readFilmstripLifecycleState(reducedPage);
    assert.equal(reducedFilmstrip.state, 'hidden', 'reduced-motion 仍必须保留空闲隐藏功能');
    assert.equal(reducedFilmstrip.opacity, '0', 'reduced-motion 空闲隐藏必须直接完成');
    assert.match(
      reducedFilmstrip.transitionDuration,
      /^0s(?:, 0s)*$/,
      'reduced-motion 胶片条不得播放显隐过渡'
    );

    const current = await readDetailSwitchState(reducedPage);
    assert.ok(current.nextHref && current.nextHref !== '#', 'reduced-motion 详情必须提供下一张');
    const reducedNextPhotoName = await reducedPage
      .locator(`.photos-detail-neighbor[href="${current.nextHref}"]`)
      .getAttribute('data-photo-name');
    assert.ok(reducedNextPhotoName, 'reduced-motion 下一张必须映射到胶片条照片');
    await reducedPage.evaluate(() => {
      window.__PHOTOS_REDUCED_NATIVE_IMAGE__ = window.Image;
      window.__PHOTOS_REDUCED_IMAGE_COUNT__ = 0;
      window.__PHOTOS_REDUCED_TITLEBAR__ = document.querySelector('[data-window-titlebar]');
      window.Image = new Proxy(window.Image, {
        construct(target, args, newTarget) {
          window.__PHOTOS_REDUCED_IMAGE_COUNT__ += 1;
          return Reflect.construct(target, args, newTarget);
        },
      });
    });
    const beforeNext = await probeState(reducedPage);
    try {
      await reducedPage.locator('.photos-detail-adjacent-btn[aria-label="下一张"]').click();
      await waitForSameVariantCompletion(reducedPage, beforeNext.sameVariantCompleteCount);
      await waitForPhotosView(reducedPage, current.nextHref, 'detail');
    } finally {
      await reducedPage.evaluate(() => {
        window.Image = window.__PHOTOS_REDUCED_NATIVE_IMAGE__;
        delete window.__PHOTOS_REDUCED_NATIVE_IMAGE__;
      });
    }
    state = await probeState(reducedPage);
    assert.equal(state.callCount, 0, 'reduced-motion 详情步进不得调用 startViewTransition');
    assert.equal(state.callbackCount, 0, 'reduced-motion 详情步进不得执行 View Transition 回调');
    assert.equal(state.records.length, 0, 'reduced-motion 详情步进不得产生 View Transition 记录');
    assert.equal(state.sameVariantCompleteCount, beforeNext.sameVariantCompleteCount + 1, 'reduced-motion 详情步进仍必须完成一次 PJAX');
    const reducedImageCount = await reducedPage.evaluate(() => window.__PHOTOS_REDUCED_IMAGE_COUNT__ || 0);
    assert.equal(reducedImageCount, 0, 'reduced-motion 详情步进不得创建脱离 DOM 的预载图片');
    const reducedNext = await readDetailSwitchState(reducedPage);
    assert.equal(reducedNext.photoName, reducedNextPhotoName, 'reduced-motion 必须切到正确的目标主图');
    assert.equal(reducedNext.position, current.position + 1, 'reduced-motion 必须将位置递增 1');
    assert.equal(reducedNext.currentVisible, true, 'reduced-motion 当前胶片项必须保持可见');
    assert.equal(reducedNext.title, reducedNext.chromeTitle, 'reduced-motion 标题必须同步目标数据');
    assert.equal(reducedNext.subtitle, reducedNext.chromeSubtitle, 'reduced-motion 副标题必须同步目标计数');
    assert.equal(
      await reducedPage.evaluate(() => (
        window.__PHOTOS_REDUCED_TITLEBAR__ === document.querySelector('[data-window-titlebar]')
      )),
      true,
      'reduced-motion 详情步进仍必须保留标题栏节点'
    );
    await assertTransitionStateIsClean(reducedPage, 'reduced-motion 详情步进');
    assert.deepEqual(reducedErrors, [], `reduced-motion 回归出现运行时错误：\n${reducedErrors.join('\n')}`);
  } finally {
    await reducedContext.close();
  }
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
  assert.equal(record.before.kind, 'list-to-detail', '列表进入详情必须记录正确的过渡类型');
  assert.equal(record.before.direction, 'neutral', '列表进入详情不得伪造前后方向');
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

  let directState = await readDetailSwitchState(page);
  assert.ok(directState.nextHref && directState.nextHref !== '#', '中间照片必须提供下一张用于方向回归');
  const directNextTargetName = await page
    .locator(`.photos-detail-neighbor[href="${directState.nextHref}"]`)
    .getAttribute('data-photo-name');
  assert.ok(directNextTargetName, '下一张路由必须映射到胶片条照片');
  const beforeDirectNext = await probeState(page);
  await clickSameVariant(
    page,
    page.locator('.photos-detail-adjacent-btn[aria-label="下一张"]'),
    directState.nextHref,
    'detail'
  );
  await assertDetailStepTransition(page, beforeDirectNext, {
    sourcePhotoName: directState.photoName,
    targetPhotoName: directNextTargetName,
    direction: 'next',
    label: '下一张按钮',
  });
  let directNextState = await readDetailSwitchState(page);
  assert.equal(directNextState.position, directState.position + 1, '下一张按钮必须将位置递增 1');

  const directPreviousTargetName = await page
    .locator(`.photos-detail-neighbor[href="${directNextState.previousHref}"]`)
    .getAttribute('data-photo-name');
  assert.equal(directPreviousTargetName, directState.photoName, '上一张路由必须返回原照片');
  const beforeDirectPrevious = await probeState(page);
  await clickSameVariant(
    page,
    page.locator('.photos-detail-adjacent-btn[aria-label="上一张"]'),
    directNextState.previousHref,
    'detail'
  );
  await assertDetailStepTransition(page, beforeDirectPrevious, {
    sourcePhotoName: directNextState.photoName,
    targetPhotoName: directPreviousTargetName,
    direction: 'previous',
    label: '上一张按钮',
  });
  directState = await readDetailSwitchState(page);
  assert.equal(directState.photoName, visibleCard.photoName, '上一张按钮必须回到原照片');

  const filmstripCount = await page.locator('.photos-detail-neighbor').count();
  assert.ok(filmstripCount >= 3, '详情底部必须输出当前分页的可切换照片列表');
  const lastFilmstripLink = page.locator('.photos-detail-neighbor').last();
  const lastFilmstripHref = await lastFilmstripLink.getAttribute('href');
  const lastFilmstripPhotoName = await lastFilmstripLink.getAttribute('data-photo-name');
  assert.ok(lastFilmstripHref, '胶片条末项必须提供详情路由');
  assert.ok(lastFilmstripPhotoName, '胶片条末项必须提供照片标识');
  await wakeFilmstrip(page);
  const beforeFilmstripStep = await probeState(page);
  await clickSameVariant(page, lastFilmstripLink, lastFilmstripHref, 'detail');
  await assertDetailStepTransition(page, beforeFilmstripStep, {
    sourcePhotoName: directState.photoName,
    targetPhotoName: lastFilmstripPhotoName,
    direction: 'next',
    label: '胶片条向后跳转',
  });

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

  const zoomedPreviousTargetName = await page
    .locator(`.photos-detail-neighbor[href="${switchState.previousHref}"]`)
    .getAttribute('data-photo-name');
  assert.ok(zoomedPreviousTargetName, '放大状态的上一张必须映射到胶片条照片');
  const beforeZoomedPrevious = await probeState(page);
  await page.locator('.photos-detail-adjacent-btn[aria-label="上一张"]').click();
  await waitForSameVariantCompletion(page, beforeZoomedPrevious.sameVariantCompleteCount);
  await waitForPhotosView(page, switchState.previousHref, 'detail');
  await assertDetailStepTransition(page, beforeZoomedPrevious, {
    sourcePhotoName: switchState.photoName,
    targetPhotoName: zoomedPreviousTargetName,
    direction: 'previous',
    label: '放大后的上一张按钮',
  });
  const previousState = await readDetailSwitchState(page);
  assert.equal(previousState.subtitle, `${switchState.position - 1} / ${switchState.total}`, '放大后点击“上一张”必须正确切换计数');
  assert.equal(previousState.currentVisible, true, '左右按钮切换后当前缩略图必须可见');

  const keyboardPreviousTargetName = await page
    .locator(`.photos-detail-neighbor[href="${previousState.previousHref}"]`)
    .getAttribute('data-photo-name');
  assert.ok(keyboardPreviousTargetName, '左方向键目标必须映射到胶片条照片');
  const beforeKeyboardPrevious = await probeState(page);
  await page.keyboard.press('ArrowLeft');
  await waitForSameVariantCompletion(page, beforeKeyboardPrevious.sameVariantCompleteCount);
  await assertDetailStepTransition(page, beforeKeyboardPrevious, {
    sourcePhotoName: previousState.photoName,
    targetPhotoName: keyboardPreviousTargetName,
    direction: 'previous',
    label: '左方向键',
  });
  const keyboardState = await readDetailSwitchState(page);
  assert.equal(keyboardState.subtitle, `${switchState.position - 2} / ${switchState.total}`, '左方向键必须与“上一张”使用同一切换语义');
  assert.equal(keyboardState.currentVisible, true, '键盘切换后当前缩略图必须可见');

  const keyboardNextTargetName = await page
    .locator(`.photos-detail-neighbor[href="${keyboardState.nextHref}"]`)
    .getAttribute('data-photo-name');
  assert.equal(keyboardNextTargetName, previousState.photoName, '右方向键目标必须返回上一轮照片');
  const beforeKeyboardNext = await probeState(page);
  await page.keyboard.press('ArrowRight');
  await waitForSameVariantCompletion(page, beforeKeyboardNext.sameVariantCompleteCount);
  await assertDetailStepTransition(page, beforeKeyboardNext, {
    sourcePhotoName: keyboardState.photoName,
    targetPhotoName: keyboardNextTargetName,
    direction: 'next',
    label: '右方向键',
  });
  const keyboardNextState = await readDetailSwitchState(page);
  assert.equal(keyboardNextState.photoName, previousState.photoName, '右方向键必须与“下一张”使用同一切换语义');
  assert.equal(keyboardNextState.currentVisible, true, '右方向键切换后当前缩略图必须可见');

  assert.ok(keyboardNextState.previousHref && keyboardNextState.previousHref !== '#', 'decode 超时回归前必须仍有上一张');
  const decodeTimeoutTargetName = await page
    .locator(`.photos-detail-neighbor[href="${keyboardNextState.previousHref}"]`)
    .getAttribute('data-photo-name');
  assert.ok(decodeTimeoutTargetName, 'decode 超时目标必须映射到胶片条照片');
  await page.evaluate(() => {
    window.__PHOTOS_LIVE_DECODE_NATIVE__ = HTMLImageElement.prototype.decode;
    window.__PHOTOS_LIVE_DECODE_COUNT__ = 0;
    HTMLImageElement.prototype.decode = function (...args) {
      if (this.isConnected && this.closest?.('.photos-detail-figure')) {
        window.__PHOTOS_LIVE_DECODE_COUNT__ += 1;
        window.__PHOTOS_VIEW_TRANSITION_PROBE__?.decodeCalls.push({
          connected: true,
          photoName: this.closest('[data-photo-name]')?.dataset.photoName || '',
          src: this.currentSrc || this.src || '',
        });
        return new Promise(() => {});
      }
      return window.__PHOTOS_LIVE_DECODE_NATIVE__.apply(this, args);
    };
  });
  const beforeDecodeTimeout = await probeState(page);
  try {
    await clickSameVariant(
      page,
      page.locator('.photos-detail-adjacent-btn[aria-label="上一张"]'),
      keyboardNextState.previousHref,
      'detail'
    );
    await assertDetailStepTransition(page, beforeDecodeTimeout, {
      sourcePhotoName: keyboardNextState.photoName,
      targetPhotoName: decodeTimeoutTargetName,
      direction: 'previous',
      label: '目标主图 decode 超时降级',
    });
  } finally {
    await page.evaluate(() => {
      HTMLImageElement.prototype.decode = window.__PHOTOS_LIVE_DECODE_NATIVE__;
      delete window.__PHOTOS_LIVE_DECODE_NATIVE__;
    });
  }
  const decodeTimeoutState = await readDetailSwitchState(page);
  assert.equal(decodeTimeoutState.position, keyboardNextState.position - 1, 'decode 超时后仍必须完成目标切换');
  assert.equal(
    await page.evaluate(() => window.__PHOTOS_LIVE_DECODE_COUNT__ || 0),
    1,
    'live decode 超时路径必须且只能尝试一次目标主图解码'
  );

  assert.ok(decodeTimeoutState.nextHref && decodeTimeoutState.nextHref !== '#', '冷图降级前必须仍有下一张');
  await page.evaluate(() => {
    window.__PHOTOS_NATIVE_IMAGE__ = window.Image;
    window.__PHOTOS_COLD_TITLEBAR__ = document.querySelector('[data-window-titlebar]');
    window.Image = class DeferredPhotosImage {
      constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.onload = null;
        this.onerror = null;
      }

      set src(value) {
        this.currentSrc = value;
      }
    };
  });
  try {
    const beforeColdTarget = await probeState(page);
    await page.locator('.photos-detail-adjacent-btn[aria-label="下一张"]').click();
    await waitForSameVariantCompletion(page, beforeColdTarget.sameVariantCompleteCount);
    await waitForPhotosView(page, decodeTimeoutState.nextHref, 'detail');
    state = await probeState(page);
    assert.equal(state.callCount, beforeColdTarget.callCount, '目标原图 200ms 内未就绪时不得启动空白过渡');
    assert.equal(state.sameVariantCompleteCount, beforeColdTarget.sameVariantCompleteCount + 1, '冷图降级仍必须完成一次 PJAX');
    await assertTransitionStateIsClean(page, '目标原图超时降级');
    await page.waitForFunction(() => {
      const list = document.querySelector('.photos-detail-neighbor-list');
      const current = list?.querySelector('.photos-detail-neighbor[aria-current="true"]');
      const listRect = list?.getBoundingClientRect();
      const currentRect = current?.getBoundingClientRect();
      return Boolean(listRect && currentRect
        && currentRect.left >= listRect.left - 1
        && currentRect.right <= listRect.right + 1);
    }, null, { timeout: navigationTimeoutMs });
    const coldTargetState = await readDetailSwitchState(page);
    assert.equal(coldTargetState.position, decodeTimeoutState.position + 1, '冷图降级仍必须切到正确照片');
    assert.equal(coldTargetState.currentVisible, true, '冷图降级后当前胶片项必须可见');
    assert.equal(coldTargetState.title, coldTargetState.chromeTitle, '冷图降级后标题必须属于目标照片');
    assert.equal(coldTargetState.subtitle, coldTargetState.chromeSubtitle, '冷图降级后计数必须属于目标照片');
    assert.equal(
      await page.evaluate(() => (
        window.__PHOTOS_COLD_TITLEBAR__ === document.querySelector('[data-window-titlebar]')
      )),
      true,
      '冷图降级仍必须保留标题栏节点'
    );
  } finally {
    await page.evaluate(() => {
      window.Image = window.__PHOTOS_NATIVE_IMAGE__;
      delete window.__PHOTOS_NATIVE_IMAGE__;
    });
  }
  assert.deepEqual(runtimeErrors, [], `图库专项回归出现运行时错误：\n${runtimeErrors.join('\n')}`);

  await verifyFilmstripIdleLifecycle(browser, visibleCard.href);
  await verifyTouchFilmstripPersistence(browser, visibleCard.href);
  await verifyReducedMotionFallback(browser);

  console.log('Photos View Transition 真页回归通过：列表共享进入、详情定向步进、稳定侧栏/标题栏及空闲胶片坞正常');
} finally {
  await context.close();
  await browser.close();
}
