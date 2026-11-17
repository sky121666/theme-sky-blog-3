import { constrainDesktopRect, desktopBounds, initialDesktopRect } from '../window-placement.js';

// Public app entry points only. Never preview an order, login, action or arbitrary link.
// The live regression compares these launch rectangles with the real window.
const entries = new Map([
  ['/docs', ['文档', 'docsme', 1240, 960, 640]], ['/photos', ['图库', 'photos', 0, 700, 450]],
  ['/links', ['朋友们', 'links-wechat-v1', 500, 500, 560]], ['/moments', ['瞬间', 'moments', 560, 560, 400]],
  ['/douban', ['豆瓣', 'douban', 1180, 920, 660]], ['/steam', ['Steam', 'steam', 1200, 960, 680]],
  ['/bangumis', ['追番', 'bangumis', 1100, 900, 620]], ['/equipments', ['装备', 'equipments', 1220, 960, 680]],
  ['/shop', ['商店', 'shop', 1180, 760, 620]]
]);

export function beginLaunchPreview(doc, win, detail) {
  if (detail.source !== 'click' || doc.body?.dataset.pageMode !== 'browser-home' || win.innerWidth <= 768) return;
  const url = new URL(detail.url, win.location.href);
  if (url.origin !== win.location.origin || url.search || url.hash) return;
  const path = url.pathname.replace(/\/$/, '');
  const entry = path === (win.__SKY_THEME_ROUTES__?.archivesUri || '/archives').replace(/\/$/, '')
    ? ['文章归档', 'browser'] : entries.get(path === '/shop/products' ? '/shop' : path);
  const template = entry && doc.getElementById('desktop-launch-preview');
  if (!template) return;
  let preview, animation, frame;
  // Give a cached navigation one paint to commit without flashing a placeholder.
  frame = win.requestAnimationFrame(() => {
    frame = win.requestAnimationFrame(() => {
      if (win.innerWidth <= 768 || doc.body.dataset.pageMode !== 'browser-home') return;
      const [title, key, width] = entry;
      let saved;
      try { saved = JSON.parse(win.localStorage.getItem('theme-window-metrics-' + key)); } catch { /* storage is optional */ }
      const bounds = desktopBounds(win, doc, saved?.isMaximized === true);
      const rect = initialDesktopRect(win, bounds, width);
      const sameViewport = saved?.viewportWidth === win.innerWidth && saved?.viewportHeight === win.innerHeight;
      const minW = sameViewport && saved.minWidth > 0 ? saved.minWidth : entry[3] || 400;
      const minH = sameViewport && saved.minHeight > 0 ? saved.minHeight
        : key === 'docsme' ? Math.min(640, win.innerHeight - 132) : entry[4] || 400;
      rect.width = Math.min(bounds.width, Math.max(rect.width, minW));
      rect.height = Math.min(bounds.height, Math.max(rect.height, minH));
      if (saved?.isMaximized === true) Object.assign(rect, { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height });
      else if (saved && [saved.width, saved.height, saved.x, saved.y].every(Number.isFinite) && saved.width > 0 && saved.height > 0) {
        const fixed = key === 'moments' ? Math.min(width, win.innerWidth) : saved.width;
        Object.assign(rect, constrainDesktopRect({ ...saved, width: fixed, x: saved.x + (saved.width - fixed) / 2 }, bounds, minW, minH));
      }
      preview = template.content.firstElementChild.cloneNode(true);
      const origin = doc.querySelector('a.theme-navigation-pending[data-dock-label]');
      preview.querySelector('[data-launch-title]').textContent = origin?.href === url.href && origin.dataset.dockLabel || title;
      Object.assign(preview.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      doc.body.append(preview);
      if (!win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animation = preview.animate?.([{ opacity: 0.5, transform: 'translateY(4px) scale(.985)' }, { opacity: 1, transform: 'none' }],
          { duration: 160, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    });
  });
  const size = win.matchMedia('(max-width: 768px)');
  const close = () => {
    size.removeEventListener('change', close);
    win.cancelAnimationFrame(frame); animation?.cancel(); preview?.remove();
  };
  size.addEventListener('change', close);
  return close;
}
