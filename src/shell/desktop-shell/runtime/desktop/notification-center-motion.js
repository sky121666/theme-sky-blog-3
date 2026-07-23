/**
 * macOS 26 Notification Center Motion Engine
 * Pure native Web Animations API (WAAPI) implementation.
 * Zero external dependencies, GPU-accelerated compositor-thread animations.
 */

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const CONTENT_SELECTOR = [
  '.notification-center-header',
  '.notification-center-status',
  '.notification-center-group',
  '[data-notification-widget-card]',
  '.notification-center-widget-dropzone',
  '.notification-center-widget-toolbar'
].join(', ');

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOTION_QUERY).matches;
}

function queryContentItems(panel) {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(CONTENT_SELECTOR));
}

function queryBackdrop(panel) {
  if (!panel?.ownerDocument) return null;
  return panel.ownerDocument.querySelector('.notification-center-backdrop');
}

function animationPromise(animation, onFinish = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed = true) => {
      if (settled) return;
      settled = true;
      if (completed && typeof onFinish === 'function') onFinish();
      resolve();
    };
    const timing = animation.effect?.getTiming?.() || {};
    const duration = Number(timing.duration) || 0;
    const delay = Number(timing.delay) || 0;
    const fallbackTimer = window.setTimeout(finish, Math.max(80, duration + delay + 80));
    animation.onfinish = () => {
      window.clearTimeout(fallbackTimer);
      finish(true);
    };
    animation.oncancel = () => {
      window.clearTimeout(fallbackTimer);
      finish(false);
    };
  });
}

function readVisualState(target, fallback = { opacity: '1', transform: 'none' }) {
  if (!target || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return { ...fallback };
  }
  const computed = window.getComputedStyle(target);
  return {
    opacity: computed.opacity || fallback.opacity,
    transform: computed.transform && computed.transform !== 'none'
      ? computed.transform
      : fallback.transform
  };
}

function applyVisualState(target, state) {
  if (!target || !state) return;
  target.style.opacity = state.opacity;
  target.style.transform = state.transform;
}

function clearMotionStyles(target, properties = ['opacity', 'transform', 'filter', 'clipPath']) {
  if (!target) return;
  properties.forEach((property) => {
    target.style[property] = '';
  });
}

export function createNotificationCenterMotion() {
  let activePanelAnimations = [];
  let activeContentAnimations = [];
  let dropActive = false;
  let activeDropAnimations = [];

  const clearAnimations = (animationList) => {
    animationList.forEach((anim) => {
      try {
        anim.cancel();
      } catch (_e) {}
    });
    animationList.length = 0;
  };

  return {
    open(panel) {
      if (!panel) return Promise.resolve();

      const backdrop = queryBackdrop(panel);
      const items = queryContentItems(panel).slice(0, 10);
      const panelState = readVisualState(panel, {
        opacity: '0',
        transform: 'translateX(38px) translateY(-2px) scale(0.986)'
      });
      const backdropState = readVisualState(backdrop, { opacity: '0', transform: 'none' });
      const itemStates = new Map(items.map((item) => [
        item,
        readVisualState(item, { opacity: '0.42', transform: 'translateX(9px) scale(0.994)' })
      ]));

      clearAnimations(activePanelAnimations);
      clearAnimations(activeContentAnimations);

      const reduced = prefersReducedMotion();

      if (reduced) {
        panel.style.opacity = '1';
        panel.style.transform = 'none';
        panel.style.filter = 'none';
        if (backdrop) {
          backdrop.style.opacity = '1';
          backdrop.style.transform = 'none';
        }
        items.forEach((item) => {
          item.style.opacity = '1';
          item.style.transform = 'none';
        });
        return Promise.resolve();
      }

      applyVisualState(panel, panelState);
      panel.style.filter = 'none';
      panel.style.clipPath = 'none';
      if (backdrop) {
        applyVisualState(backdrop, backdropState);
      }

      const panelKeyframes = [
        panelState,
        {
          opacity: 1,
          transform: 'translateX(0px) translateY(0px) scale(1)'
        }
      ];

      const panelTiming = {
        duration: 410,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards'
      };

      const panelAnim = panel.animate(panelKeyframes, panelTiming);
      activePanelAnimations.push(panelAnim);
      let backdropAnim = null;
      if (backdrop) {
        backdropAnim = backdrop.animate([
          backdropState,
          { opacity: 1 }
        ], {
          duration: 300,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        activePanelAnimations.push(backdropAnim);
      }

      const contentAnimations = items.map((item, index) => {
        const current = itemStates.get(item);
        const isSettled = Number.parseFloat(current.opacity) > 0.98
          && (current.transform === 'none' || current.transform === 'matrix(1, 0, 0, 1, 0, 0)');
        const from = isSettled
          ? { opacity: 0.44, transform: 'translateX(9px) scale(0.994)' }
          : current;
        applyVisualState(item, from);
        const animation = item.animate([
          from,
          { opacity: 1, transform: 'translateX(0px) scale(1)' }
        ], {
          duration: 292,
          delay: 44 + Math.min(index * 12, 84),
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        activeContentAnimations.push(animation);
        return animation;
      });

      const panelPromise = animationPromise(panelAnim, () => {
        panel.style.opacity = '1';
        panel.style.transform = 'none';
        panel.style.filter = 'none';
        panel.style.clipPath = 'none';
      });
      const backdropPromise = backdropAnim
        ? animationPromise(backdropAnim, () => {
          backdrop.style.opacity = '1';
          backdrop.style.transform = 'none';
        })
        : Promise.resolve();
      const contentPromises = contentAnimations.map((animation) => (
        animationPromise(animation, () => {
          const target = animation.effect?.target;
          if (target) {
            target.style.opacity = '1';
            target.style.transform = 'none';
          }
        })
      ));

      return Promise.all([panelPromise, backdropPromise, ...contentPromises]).then(() => {
        const completedPanelAnimations = [panelAnim, backdropAnim].filter(Boolean);
        completedPanelAnimations.concat(contentAnimations).forEach((anim) => {
          try {
            anim.cancel();
          } catch (_e) {}
        });
        activePanelAnimations = activePanelAnimations.filter((animation) => (
          !completedPanelAnimations.includes(animation)
        ));
        activeContentAnimations = activeContentAnimations.filter((animation) => (
          !contentAnimations.includes(animation)
        ));
      });
    },

    close(panel) {
      if (!panel) return Promise.resolve();

      const backdrop = queryBackdrop(panel);
      const items = queryContentItems(panel).slice(0, 10);
      const panelState = readVisualState(panel, { opacity: '1', transform: 'none' });
      const backdropState = readVisualState(backdrop, { opacity: '1', transform: 'none' });
      const itemStates = new Map(items.map((item) => [
        item,
        readVisualState(item, { opacity: '1', transform: 'none' })
      ]));

      clearAnimations(activePanelAnimations);
      clearAnimations(activeContentAnimations);

      const reduced = prefersReducedMotion();

      if (reduced) {
        panel.style.opacity = '0';
        panel.style.transform = 'translateX(34px) scale(0.988)';
        if (backdrop) {
          backdrop.style.opacity = '0';
          backdrop.style.transform = 'none';
        }
        items.forEach((item) => clearMotionStyles(item, ['opacity', 'transform']));
        return Promise.resolve();
      }

      applyVisualState(panel, panelState);
      if (backdrop) applyVisualState(backdrop, backdropState);
      items.forEach((item) => applyVisualState(item, itemStates.get(item)));

      const panelKeyframes = [
        panelState,
        {
          opacity: 0,
          transform: 'translateX(34px) translateY(-1px) scale(0.988)'
        }
      ];

      const panelTiming = {
        duration: 286,
        easing: 'cubic-bezier(0.32, 0, 0.2, 1)',
        fill: 'forwards'
      };

      const panelAnim = panel.animate(panelKeyframes, panelTiming);
      activePanelAnimations.push(panelAnim);
      let backdropAnim = null;
      if (backdrop) {
        backdropAnim = backdrop.animate([
          backdropState,
          { opacity: 0 }
        ], {
          duration: 220,
          easing: 'cubic-bezier(0.32, 0, 0.2, 1)',
          fill: 'forwards'
        });
        activePanelAnimations.push(backdropAnim);
      }

      const contentAnimations = items.map((item, index) => {
        const animation = item.animate([
          itemStates.get(item),
          { opacity: 0.18, transform: 'translateX(7px) scale(0.996)' }
        ], {
          duration: 168,
          delay: Math.min((items.length - index - 1) * 5, 30),
          easing: 'cubic-bezier(0.32, 0, 0.2, 1)',
          fill: 'forwards'
        });
        activeContentAnimations.push(animation);
        return animation;
      });

      const panelPromise = animationPromise(panelAnim, () => {
        panel.style.opacity = '0';
        panel.style.transform = 'translateX(34px) translateY(-1px) scale(0.988)';
        panel.style.filter = 'none';
        panel.style.clipPath = 'none';
      });
      const backdropPromise = backdropAnim
        ? animationPromise(backdropAnim, () => {
          backdrop.style.opacity = '0';
          backdrop.style.transform = 'none';
        })
        : Promise.resolve();
      const contentPromises = contentAnimations.map((animation) => animationPromise(animation));

      return Promise.all([panelPromise, backdropPromise, ...contentPromises]).then(() => {
        contentAnimations.forEach((animation) => {
          const target = animation.effect?.target;
          clearMotionStyles(target, ['opacity', 'transform']);
          try {
            animation.cancel();
          } catch (_e) {}
        });
        const completedPanelAnimations = [panelAnim, backdropAnim].filter(Boolean);
        completedPanelAnimations.forEach((animation) => {
          try {
            animation.cancel();
          } catch (_e) {}
        });
        activePanelAnimations = activePanelAnimations.filter((animation) => (
          !completedPanelAnimations.includes(animation)
        ));
        activeContentAnimations = activeContentAnimations.filter((animation) => (
          !contentAnimations.includes(animation)
        ));
      });
    },

    refreshContent(panel) {
      if (!panel || prefersReducedMotion()) return;

      const items = queryContentItems(panel);
      if (!items.length) return;

      clearAnimations(activeContentAnimations);

      items.forEach((item, index) => {
        const keyframes = [
          { opacity: 0.8, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'translateY(0px)' }
        ];

        const timing = {
          duration: 220,
          delay: index * 16,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
          fill: 'forwards'
        };

        const anim = item.animate(keyframes, timing);
        activeContentAnimations.push(anim);

        anim.onfinish = () => {
          item.style.opacity = '1';
          item.style.transform = 'none';
        };
      });
    },

    expandStack(groupElement) {
      if (!groupElement || prefersReducedMotion()) return Promise.resolve();

      clearAnimations(activeContentAnimations);
      const stack = groupElement.querySelector('.notification-center-stack-card-wrapper');
      const card = groupElement.querySelector('.notification-center-stack-card-wrapper > .notification-center-card');
      const layerOne = groupElement.querySelector('.notification-center-stack-layer--1');
      const layerTwo = groupElement.querySelector('.notification-center-stack-layer--2');
      const animations = [];

      const animate = (target, keyframes, timing) => {
        if (!target) return;
        const animation = target.animate(keyframes, {
          duration: 170,
          easing: 'cubic-bezier(0.32, 0, 0.67, 0)',
          fill: 'forwards',
          ...timing
        });
        animations.push(animation);
      };

      animate(stack, [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0.82, transform: 'translateY(-3px) scale(0.988)' }
      ]);
      animate(card, [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0.94, transform: 'translateY(-2px) scale(0.994)' }
      ], { duration: 150 });
      animate(layerOne, [
        { opacity: 0.44, transform: 'translateY(5px) scale(0.982)' },
        { opacity: 0.08, transform: 'translateY(0) scale(0.994)' }
      ], { duration: 145 });
      animate(layerTwo, [
        { opacity: 0.22, transform: 'translateY(10px) scale(0.964)' },
        { opacity: 0, transform: 'translateY(2px) scale(0.982)' }
      ], { duration: 130 });

      activeContentAnimations.push(...animations);
      return Promise.all(animations.map((animation) => animationPromise(animation))).then(() => {
        animations.forEach((animation) => {
          const target = animation.effect?.target;
          clearMotionStyles(target);
          try {
            animation.cancel();
          } catch (_e) {}
        });
      });
    },

    revealExpandedGroup(groupElement) {
      if (!groupElement || prefersReducedMotion()) return Promise.resolve();

      clearAnimations(activeContentAnimations);
      const header = groupElement.querySelector('.notification-center-group-header-wrapper');
      const list = groupElement.querySelector('.notification-center-list');
      const cards = Array.from(groupElement.querySelectorAll('.notification-center-list .notification-center-card'));
      const animations = [];

      if (header) {
        animations.push(header.animate([
          { opacity: 0, transform: 'translateY(-7px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], {
          duration: 240,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        }));
      }

      if (list) {
        const listHeight = list.getBoundingClientRect().height;
        const visibleStart = Math.min(68, listHeight);
        const clippedBottom = Math.max(0, Math.round(listHeight - visibleStart));
        list.style.overflow = 'clip';
        animations.push(list.animate([
          {
            opacity: 0.82,
            transform: 'translateY(-3px) scale(0.992)',
            clipPath: `inset(0 0 ${clippedBottom}px 0 round 18px)`
          },
          {
            opacity: 1,
            transform: 'translateY(0) scale(1)',
            clipPath: 'inset(0 0 0 0 round 18px)'
          }
        ], {
          duration: 430,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        }));
      }

      cards.slice(0, 12).forEach((card, index) => {
        const isLeadCard = index === 0;
        const offset = isLeadCard ? -6 : -Math.min(14 + (index * 2), 28);
        const animation = card.animate([
          {
            opacity: isLeadCard ? 0.88 : 0,
            transform: `translateY(${offset}px) scale(${isLeadCard ? 0.992 : 0.984})`
          },
          { opacity: 1, transform: 'translateY(0)' }
        ], {
          duration: isLeadCard ? 330 : 390,
          delay: isLeadCard ? 0 : Math.min(index * 18, 108),
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        animations.push(animation);
      });

      activeContentAnimations.push(...animations);
      return Promise.all(animations.map((animation) => animationPromise(animation))).then(() => {
        animations.forEach((animation) => {
          const target = animation.effect?.target;
          clearMotionStyles(target, ['opacity', 'transform', 'filter', 'clipPath']);
          if (target === list) target.style.overflow = '';
          try {
            animation.cancel();
          } catch (_e) {}
        });
      });
    },

    collapseExpandedGroup(groupElement) {
      if (!groupElement || prefersReducedMotion()) return Promise.resolve();

      clearAnimations(activeContentAnimations);
      const header = groupElement.querySelector('.notification-center-group-header-wrapper');
      const list = groupElement.querySelector('.notification-center-list');
      const cards = Array.from(groupElement.querySelectorAll('.notification-center-list .notification-center-card'));
      const animations = [];

      if (header) {
        animations.push(header.animate([
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-5px)' }
        ], {
          duration: 170,
          easing: 'cubic-bezier(0.32, 0, 0.67, 0)',
          fill: 'forwards'
        }));
      }

      if (list) {
        const listHeight = list.getBoundingClientRect().height;
        const visibleEnd = Math.min(68, listHeight);
        const clippedBottom = Math.max(0, Math.round(listHeight - visibleEnd));
        list.style.overflow = 'clip';
        animations.push(list.animate([
          {
            opacity: 1,
            transform: 'translateY(0) scale(1)',
            clipPath: 'inset(0 0 0 0 round 18px)'
          },
          {
            opacity: 0.82,
            transform: 'translateY(-3px) scale(0.992)',
            clipPath: `inset(0 0 ${clippedBottom}px 0 round 18px)`
          }
        ], {
          duration: 250,
          easing: 'cubic-bezier(0.32, 0, 0.67, 0)',
          fill: 'forwards'
        }));
      }

      cards.slice(0, 12).forEach((card, index) => {
        const isLeadCard = index === 0;
        const offset = isLeadCard ? -4 : -Math.min(10 + (index * 2), 24);
        const animation = card.animate([
          { opacity: 1, transform: 'translateY(0) scale(1)' },
          {
            opacity: isLeadCard ? 0.90 : 0,
            transform: `translateY(${offset}px) scale(${isLeadCard ? 0.994 : 0.986})`
          }
        ], {
          duration: isLeadCard ? 210 : 190,
          delay: Math.min((cards.length - index - 1) * 5, 28),
          easing: 'cubic-bezier(0.32, 0, 0.67, 0)',
          fill: 'forwards'
        });
        animations.push(animation);
      });

      activeContentAnimations.push(...animations);
      return Promise.all(animations.map((animation) => animationPromise(animation))).then(() => {
        animations.forEach((animation) => {
          const target = animation.effect?.target;
          clearMotionStyles(target, ['opacity', 'transform', 'filter', 'clipPath']);
          if (target === list) target.style.overflow = '';
          try {
            animation.cancel();
          } catch (_e) {}
        });
      });
    },

    revealCollapsedGroup(groupElement) {
      if (!groupElement || prefersReducedMotion()) return Promise.resolve();

      clearAnimations(activeContentAnimations);
      const stack = groupElement.querySelector('.notification-center-stack-card-wrapper');
      const card = groupElement.querySelector('.notification-center-stack-card-wrapper > .notification-center-card');
      const layerOne = groupElement.querySelector('.notification-center-stack-layer--1');
      const layerTwo = groupElement.querySelector('.notification-center-stack-layer--2');
      const targets = [
        [stack, [
          { opacity: 0.74, transform: 'translateY(-5px) scale(0.982)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], 0],
        [card, [
          { opacity: 0.88, transform: 'translateY(-3px) scale(0.99)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], 0],
        [layerOne, [
          { opacity: 0.04, transform: 'translateY(0) scale(0.994)' },
          { opacity: 0.44, transform: 'translateY(5px) scale(0.982)' }
        ], 22],
        [layerTwo, [
          { opacity: 0, transform: 'translateY(2px) scale(0.982)' },
          { opacity: 0.22, transform: 'translateY(10px) scale(0.964)' }
        ], 42]
      ];

      const animations = [];
      targets.forEach(([target, keyframes, delay]) => {
        if (!target) return;
        const animation = target.animate(keyframes, {
          duration: 280,
          delay,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        activeContentAnimations.push(animation);
        animations.push(animation);
      });

      return Promise.all(animations.map((animation) => animationPromise(animation))).then(() => {
        animations.forEach((animation) => {
          const target = animation.effect?.target;
          clearMotionStyles(target);
          try {
            animation.cancel();
          } catch (_e) {}
        });
      });
    },

    prepareFilterSwitch(panel) {
      clearAnimations(activeContentAnimations);
    },

    finishFilterSwitch(panel, direction = 'unread') {
      if (!panel || prefersReducedMotion()) return;

      const items = Array.from(panel.querySelectorAll([
        '.notification-center-status',
        '.notification-center-group',
        '.notification-center-empty'
      ].join(', ')));
      if (!items.length) return;

      clearAnimations(activeContentAnimations);
      const offsetX = direction === 'all' ? 3 : -3;

      items.forEach((item, index) => {
        const anim = item.animate([
          { opacity: 0.98, transform: `translateX(${offsetX}px)` },
          { opacity: 1, transform: 'translateX(0)' }
        ], {
          duration: 110,
          delay: Math.min(index * 6, 18),
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        activeContentAnimations.push(anim);
        anim.onfinish = () => {
          item.style.opacity = '1';
          item.style.transform = 'none';
        };
      });
    },

    commitWidgetCommand(target) {
      if (prefersReducedMotion()) return;

      const button = target?.closest?.('button');
      const card = target?.closest?.('[data-notification-widget-card]');

      // Click scale down & pop up bounce physical feedback
      if (button) {
        button.animate([
          { transform: 'scale(0.88)' },
          { transform: 'scale(1)' }
        ], {
          duration: 220,
          easing: 'cubic-bezier(0.175, 0.885, 0.32, 2)' // Heavy elastic bounce-out
        });
      }

      if (card) {
        card.animate([
          { transform: 'scale(1)' },
          { transform: 'scale(0.982)' },
          { transform: 'scale(1)' }
        ], {
          duration: 160,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
        });
      }
    },

    setDropActive(panel, active) {
      if (!panel || prefersReducedMotion()) return;
      if (dropActive === active) return;
      dropActive = active;
      clearAnimations(activeDropAnimations);

      const widgets = panel.querySelector('.notification-center-widgets');
      const dropzone = panel.querySelector('.notification-center-widget-dropzone');
      const targets = [widgets, dropzone].filter(Boolean);

      targets.forEach((el) => {
        const anim = el.animate([
          { transform: active ? 'scale(1)' : 'scale(1.012) translateY(-2px)' },
          { transform: active ? 'scale(1.012) translateY(-2px)' : 'scale(1)' }
        ], {
          duration: active ? 240 : 180,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
          fill: 'forwards'
        });
        activeDropAnimations.push(anim);
        anim.onfinish = () => {
          el.style.transform = active ? 'scale(1.012) translateY(-2px)' : 'none';
        };
      });
    },

    dismissCard(cardElement) {
      if (!cardElement) return Promise.resolve();
      if (prefersReducedMotion()) {
        cardElement.style.display = 'none';
        return Promise.resolve();
      }

      const rect = cardElement.getBoundingClientRect();
      const currentHeight = rect.height;

      const keyframes = [
        {
          transform: 'translateX(0)',
          opacity: '1',
          height: `${currentHeight}px`,
          marginBottom: '12px',
          paddingTop: '12px',
          paddingBottom: '12px',
          overflow: 'hidden'
        },
        {
          transform: 'translateX(120%)',
          opacity: '0',
          height: '0px',
          marginBottom: '0px',
          paddingTop: '0px',
          paddingBottom: '0px',
          overflow: 'hidden'
        }
      ];

      const timing = {
        duration: 300,
        easing: 'cubic-bezier(0.3, 0.85, 0.32, 1)',
        fill: 'forwards'
      };

      const anim = cardElement.animate(keyframes, timing);
      return new Promise((resolve) => {
        anim.onfinish = () => {
          resolve();
        };
      });
    },

    dismissCards(cardElements) {
      if (!cardElements || !cardElements.length) return Promise.resolve();
      if (prefersReducedMotion()) {
        cardElements.forEach(el => { el.style.display = 'none'; });
        return Promise.resolve();
      }

      const promises = cardElements.map((cardElement, index) => {
        const rect = cardElement.getBoundingClientRect();
        const currentHeight = rect.height;

        const keyframes = [
          {
            transform: 'translateX(0)',
            opacity: '1',
            height: `${currentHeight}px`,
            marginBottom: '12px',
            paddingTop: '12px',
            paddingBottom: '12px',
            overflow: 'hidden'
          },
          {
            transform: 'translateX(120%)',
            opacity: '0',
            height: '0px',
            marginBottom: '0px',
            paddingTop: '0px',
            paddingBottom: '0px',
            overflow: 'hidden'
          }
        ];

        const timing = {
          duration: 300,
          delay: index * 40, // 40ms stagger cascade
          easing: 'cubic-bezier(0.3, 0.85, 0.32, 1)',
          fill: 'forwards'
        };

        const anim = cardElement.animate(keyframes, timing);
        return new Promise((resolve) => {
          anim.onfinish = () => {
            resolve();
          };
        });
      });

      return Promise.all(promises).then(() => {});
    },

    destroy() {
      clearAnimations(activePanelAnimations);
      clearAnimations(activeContentAnimations);
      clearAnimations(activeDropAnimations);
      dropActive = false;
    }
  };
}
