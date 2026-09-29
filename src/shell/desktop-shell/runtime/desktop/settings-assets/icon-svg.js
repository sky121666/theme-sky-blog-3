const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SVG_LENGTH = 100_000;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const NUMBER_LIST = /^[\d\s.,+eE%-]+$/;
const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use',
]);
const NUMERIC_ATTRIBUTES = new Set([
  'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'stroke-width', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset', 'pathLength',
]);
const ENUM_ATTRIBUTES = {
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel'],
  'gradientUnits': ['userSpaceOnUse', 'objectBoundingBox'],
  'clipPathUnits': ['userSpaceOnUse', 'objectBoundingBox'],
  'maskUnits': ['userSpaceOnUse', 'objectBoundingBox'],
  'maskContentUnits': ['userSpaceOnUse', 'objectBoundingBox'],
  'spreadMethod': ['pad', 'reflect', 'repeat'],
  'vector-effect': ['none', 'non-scaling-stroke'],
};

function colorValue(value) {
  return /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]+\))$/i.test(value);
}

function attributeValue(name, value, ids) {
  if (name === 'id') return ids.has(value) ? value : '';
  if (['href', 'fill', 'stroke', 'clip-path', 'mask'].includes(name)) {
    const match = name === 'href' ? /^#(.+)$/.exec(value) : /^url\(#([^\s)]+)\)$/.exec(value);
    if (match) return ids.has(match[1]) ? value : '';
    if (name === 'href' || name === 'clip-path' || name === 'mask') return '';
    return colorValue(value) ? value : '';
  }
  if (name === 'color' || name === 'stop-color') return colorValue(value) ? value : '';
  if (NUMERIC_ATTRIBUTES.has(name)) return NUMBER_LIST.test(value) ? value : '';
  if (name === 'width' || name === 'height') return /^(?:\d+(?:\.\d+)?)(?:px|em|%)?$/.test(value) ? value : '';
  if (name === 'viewBox') {
    const parts = value.trim().split(/[\s,]+/).map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? parts.join(' ') : '';
  }
  if (name === 'd') return /^[MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]+$/.test(value) ? value : '';
  if (name === 'points') return NUMBER_LIST.test(value) ? value : '';
  if (name === 'transform' || name === 'gradientTransform') {
    return /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([\d\s.,+eE-]+\)[\s,]*)+$/.test(value) ? value : '';
  }
  if (name === 'preserveAspectRatio') return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value) ? value : '';
  return ENUM_ATTRIBUTES[name]?.includes(value) ? value : '';
}

// Canonical IDs keep repeated normalization stable and avoid referencing page-owned IDs.
function scopeReferences(root, serializer) {
  const ids = new Map();
  for (const node of root.querySelectorAll('[id]')) {
    const previous = node.getAttribute('id');
    if (!ids.has(previous)) ids.set(previous, `theme-icon-id${ids.size}`);
    node.setAttribute('id', ids.get(previous));
  }
  const references = [];
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      const match = /^(?:url\(#([^\s)]+)\)|#(.+))$/.exec(attr.value);
      const old = match?.[1] || match?.[2];
      if (!old || !ids.has(old) || !['href', 'fill', 'stroke', 'clip-path', 'mask'].includes(attr.name)) continue;
      const local = ids.get(old);
      node.setAttribute(attr.name, attr.name === 'href' ? `#${local}` : `url(#${local})`);
      references.push([node, attr.name, local]);
    }
  }
  let hash = 2166136261;
  for (const char of serializer.serializeToString(root)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const prefix = `theme-icon-${hash.toString(16)}-`;
  for (const node of root.querySelectorAll('[id]')) node.setAttribute('id', node.getAttribute('id').replace('theme-icon-', prefix));
  for (const [node, name, local] of references) {
    const scoped = local.replace('theme-icon-', prefix);
    node.setAttribute(name, name === 'href' ? `#${scoped}` : `url(#${scoped})`);
  }
}

/** Rebuild a static SVG from an allowlist before it reaches x-html or Halo storage. */
export function sanitizeIconSvg(svg) {
  if (typeof svg !== 'string' || !svg.trim() || svg.length > MAX_SVG_LENGTH || /<!DOCTYPE|<!ENTITY/i.test(svg)) return '';
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return '';
  try {
    const source = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = source.documentElement;
    if (!root || root.localName !== 'svg' || root.prefix || (root.namespaceURI && root.namespaceURI !== SVG_NS) || source.querySelector('parsererror')) return '';
    const elements = [root, ...root.querySelectorAll('*')];
    if (elements.length > 512) return '';
    const ids = new Set(elements.filter((node) => ELEMENTS.has(node.localName) && !node.prefix && (!node.namespaceURI || node.namespaceURI === SVG_NS))
      .map((node) => node.getAttribute('id')).filter((id) => id && ID.test(id)));
    const document = source.implementation.createDocument(SVG_NS, 'svg', null);
    const copy = (node, depth = 0) => {
      if (depth > 32 || !ELEMENTS.has(node.localName) || node.prefix || (node.namespaceURI && node.namespaceURI !== SVG_NS)) return null;
      const result = document.createElementNS(SVG_NS, node.localName);
      for (const attr of [...node.attributes]) {
        const name = attr.name === 'xlink:href' ? 'href' : attr.name;
        if (attr.namespaceURI && attr.namespaceURI !== 'http://www.w3.org/1999/xlink') continue;
        const value = attributeValue(name, attr.value.trim(), ids);
        if (value) result.setAttribute(name, value);
      }
      for (const child of node.children) {
        const cleanChild = copy(child, depth + 1);
        if (cleanChild) result.appendChild(cleanChild);
      }
      return result;
    };
    const cleaned = copy(root);
    if (!cleaned || !cleaned.querySelector('path, rect, circle, ellipse, line, polyline, polygon')) return '';
    cleaned.removeAttribute('id');
    // Removed subtrees can contain IDs that were present during the first pass.
    const surviving = new Set([...cleaned.querySelectorAll('[id]')].map((node) => node.getAttribute('id')));
    for (const node of [cleaned, ...cleaned.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (!['href', 'fill', 'stroke', 'clip-path', 'mask'].includes(attr.name)) continue;
        const match = attr.name === 'href' ? /^#(.+)$/.exec(attr.value) : /^url\(#(.+)\)$/.exec(attr.value);
        if (match && !surviving.has(match[1])) node.removeAttribute(attr.name);
      }
    }
    const serializer = new XMLSerializer();
    scopeReferences(cleaned, serializer);
    return serializer.serializeToString(cleaned);
  } catch (_error) {
    return '';
  }
}

/** Halo 2.26 IconifyValue stores sizing as a string; empty means theme default. */
export function makeThemeIcon(icon, { color = '', width = 24 } = {}) {
  const value = sanitizeIconSvg(icon?.svg);
  if (!value) return '';
  const input = Number(width);
  const size = String(Number.isFinite(input) ? Math.max(16, Math.min(64, Math.round(input))) : 24);
  const tint = typeof color === 'string' && /^(?:#[\da-f]{3}|#[\da-f]{6})$/i.test(color.trim()) ? color.trim().toUpperCase() : '';
  const document = new DOMParser().parseFromString(value, 'image/svg+xml');
  document.documentElement.setAttribute('width', size);
  document.documentElement.setAttribute('height', size);
  if (tint) document.documentElement.setAttribute('color', tint);
  else document.documentElement.removeAttribute('color');
  return {
    value: new XMLSerializer().serializeToString(document.documentElement),
    name: typeof icon.name === 'string' && ICON_NAME.test(icon.name) ? icon.name : '',
    width: size,
    color: tint,
  };
}
