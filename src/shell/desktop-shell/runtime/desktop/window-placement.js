export function desktopBounds(win, doc, maximized = false) {
  const dock = doc.querySelector?.('.dock-container');
  const style = dock && win.getComputedStyle(dock);
  const rect = dock && style?.display !== 'none' && style?.visibility !== 'hidden' && dock.getBoundingClientRect();
  const inset = rect?.height > 0 ? Math.max(16, win.innerHeight - rect.top + 12) : 16;
  const left = maximized ? 0 : 16;
  return { left, top: 24, width: Math.max(240, win.innerWidth - 2 * left), height: Math.max(240, win.innerHeight - 24 - inset) };
}

export function initialDesktopRect(win, bounds, widthAttr, heightAttr) {
  const w = parseInt(widthAttr, 10), h = parseInt(heightAttr, 10);
  const width = w > 0 ? Math.min(w, bounds.width) : Math.min(1200, bounds.width, win.innerWidth * 0.85);
  const height = h > 0 ? Math.min(h, bounds.height) : Math.min(900, bounds.height, Math.max(320, bounds.height * 0.9));
  return { x: bounds.left + (bounds.width - width) / 2, y: bounds.top + (bounds.height - height) / 2, width, height };
}

export function constrainDesktopRect(rect, bounds, minWidth, minHeight) {
  const width = Math.min(bounds.width, Math.max(minWidth, Number(rect.width) || minWidth));
  const height = Math.min(bounds.height, Math.max(minHeight, Number(rect.height) || minHeight));
  const x = Math.min(bounds.left + bounds.width - width, Math.max(bounds.left, Number.isFinite(rect.x) ? rect.x : bounds.left));
  const y = Math.min(bounds.top + bounds.height - height, Math.max(bounds.top, Number.isFinite(rect.y) ? rect.y : bounds.top));
  return { x, y, width, height };
}
