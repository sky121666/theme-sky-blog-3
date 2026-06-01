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
    const finish = () => {
      if (settled) return;
      settled = true;
      if (typeof onFinish === 'function') onFinish();
      resolve();
    };
    const timing = animation.effect?.getTiming?.() || {};
    const duration = Number(timing.duration) || 0;
    const delay = Number(timing.delay) || 0;
    const fallbackTimer = window.setTimeout(finish, Math.max(80, duration + delay + 80));
    animation.onfinish = () => {
      window.clearTimeout(fallbackTimer);
      finish();
    };
    animation.oncancel = () => {
      window.clearTimeout(fallbackTimer);
      finish();
    };
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

      clearAnimations(activePanelAnimations);
      clearAnimations(activeContentAnimations);

      const backdrop = queryBackdrop(panel);
      const items = queryContentItems(panel);
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

      // Initial state for animation: the panel is anchored to the right edge,
      // so it should enter from the right and settle leftward into place.
      panel.style.opacity = '0';
      panel.style.transform = 'translateX(28px) translateY(-2px) scale(0.99)';
      panel.style.filter = 'none';
      panel.style.clipPath = 'none';
      if (backdrop) {
        backdrop.style.opacity = '0';
        backdrop.style.transform = 'none';
      }

      items.forEach((item) => {
        item.style.opacity = '1';
        item.style.transform = 'none';
      });

      // 1. Panel Drawer Slide & Jelly Rebound Curve (macOS back.out(0.72) equivalent)
      const panelKeyframes = [
        {
          opacity: 0,
          transform: 'translateX(28px) translateY(-2px) scale(0.99)'
        },
        {
          opacity: 1,
          transform: 'translateX(0px) translateY(0px) scale(1)'
        }
      ];

      const panelTiming = {
        duration: 360,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards'
      };

      const panelAnim = panel.animate(panelKeyframes, panelTiming);
      activePanelAnimations.push(panelAnim);
      let backdropAnim = null;
      if (backdrop) {
        backdropAnim = backdrop.animate([
          { opacity: 0 },
          { opacity: 1 }
        ], {
          duration: 280,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        activePanelAnimations.push(backdropAnim);
      }

      // Apply the final styles upon panel animation end to keep it static
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

      return Promise.all([panelPromise, backdropPromise]).then(() => {
        [panelAnim, backdropAnim].filter(Boolean).forEach((anim) => {
          try {
            anim.cancel();
          } catch (_e) {}
        });
      });
    },

    close(panel) {
      if (!panel) return Promise.resolve();

      clearAnimations(activePanelAnimations);
      clearAnimations(activeContentAnimations);

      const backdrop = queryBackdrop(panel);
      const reduced = prefersReducedMotion();

      if (reduced) {
        panel.style.opacity = '0';
        panel.style.transform = 'translateX(24px) scale(0.97)';
        if (backdrop) {
          backdrop.style.opacity = '0';
          backdrop.style.transform = 'none';
        }
        return Promise.resolve();
      }

      // Slide-out with smooth acceleration (power2.in equivalent)
      const panelKeyframes = [
        {
          opacity: 1,
          transform: 'translateX(0px) translateY(0px) scale(1)'
        },
        {
          opacity: 0,
          transform: 'translateX(24px) translateY(-2px) scale(0.99)'
        }
      ];

      const panelTiming = {
        duration: 240,
        easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
        fill: 'forwards'
      };

      const panelAnim = panel.animate(panelKeyframes, panelTiming);
      activePanelAnimations.push(panelAnim);
      let backdropAnim = null;
      if (backdrop) {
        backdropAnim = backdrop.animate([
          { opacity: 1 },
          { opacity: 0 }
        ], {
          duration: 180,
          easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
          fill: 'forwards'
        });
        activePanelAnimations.push(backdropAnim);
      }

      const panelPromise = animationPromise(panelAnim, () => {
          panel.style.opacity = '0';
          panel.style.transform = 'translateX(24px) translateY(-2px) scale(0.99)';
          panel.style.filter = 'none';
          panel.style.clipPath = 'none';
      });
      const backdropPromise = backdropAnim
        ? animationPromise(backdropAnim, () => {
          backdrop.style.opacity = '0';
          backdrop.style.transform = 'none';
        })
        : Promise.resolve();

      return Promise.all([panelPromise, backdropPromise]);
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
      return Promise.resolve();
    },

    revealExpandedGroup(groupElement) {
      if (!groupElement || prefersReducedMotion()) return;

      clearAnimations(activeContentAnimations);
      const header = groupElement.querySelector('.notification-center-group-header-wrapper');
      const cards = Array.from(groupElement.querySelectorAll('.notification-center-list .notification-center-card'));
      const animations = [];

      if (header) {
        animations.push(header.animate([
          { opacity: 0.92, transform: 'translateY(-3px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], {
          duration: 120,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        }));
      }

      cards.forEach((card, index) => {
        const animation = card.animate([
          { opacity: 0.88, transform: 'translateY(-4px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], {
          duration: 140,
          delay: Math.min(index * 10, 30),
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        animations.push(animation);
      });

      activeContentAnimations.push(...animations);
      animations.forEach((animation) => {
        animation.onfinish = () => {
          const target = animation.effect?.target;
          if (target) {
            target.style.opacity = '1';
            target.style.transform = 'none';
            target.style.filter = 'none';
          }
        };
      });
    },

    collapseExpandedGroup(groupElement) {
      return Promise.resolve();
    },

    revealCollapsedGroup(groupElement) {
      if (!groupElement || prefersReducedMotion()) return;

      clearAnimations(activeContentAnimations);
      const stack = groupElement.querySelector('.notification-center-stack-card-wrapper');
      const card = groupElement.querySelector('.notification-center-stack-card-wrapper > .notification-center-card');
      const layerOne = groupElement.querySelector('.notification-center-stack-layer--1');
      const layerTwo = groupElement.querySelector('.notification-center-stack-layer--2');
      const targets = [
        [stack, [
          { opacity: 0.9, transform: 'translateY(-4px) scale(0.99)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], 0],
        [card, [
          { opacity: 0.9, transform: 'translateY(-4px) scale(0.99)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], 0],
        [layerOne, [
          { opacity: 0.18, transform: 'translateY(0) scale(0.97)' },
          { opacity: 0.40, transform: 'translateY(5px) scale(0.982)' }
        ], 16],
        [layerTwo, [
          { opacity: 0, transform: 'translateY(4px) scale(0.94)' },
          { opacity: 0.20, transform: 'translateY(10px) scale(0.964)' }
        ], 28]
      ];

      targets.forEach(([target, keyframes, delay]) => {
        if (!target) return;
        const animation = target.animate(keyframes, {
          duration: 140,
          delay,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards'
        });
        activeContentAnimations.push(animation);
        animation.onfinish = () => {
          target.style.opacity = '';
          target.style.transform = '';
          target.style.filter = '';
        };
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
