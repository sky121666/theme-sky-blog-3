const COLOR_PATHS = new Set(['header.dropdown.light_bg', 'header.dropdown.dark_bg']);

function hexByte(value) {
  return Number.parseInt(value, 16);
}

function toHex(channels) {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function parseSettingsColor(value) {
  const source = String(value || '').trim();
  const hex = source.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    const expanded = hex[1].length <= 4 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    const channels = [0, 2, 4].map((index) => hexByte(expanded.slice(index, index + 2)));
    const alpha = expanded.length === 8 ? hexByte(expanded.slice(6, 8)) / 255 : 1;
    return { hex: toHex(channels), opacity: Math.round(alpha * 100), alpha, channels };
  }
  const rgb = source.match(/^(rgba?)\(([^)]+)\)$/i);
  if (!rgb) return null;
  const values = rgb[2].split(',').map((entry) => entry.trim());
  const alphaExpected = rgb[1].toLowerCase() === 'rgba';
  if (values.length !== (alphaExpected ? 4 : 3)) return null;
  const channels = values.slice(0, 3).map((entry) => {
    if (/^\d{1,3}%$/.test(entry) && Number(entry.slice(0, -1)) <= 100) return Number(entry.slice(0, -1)) * 255 / 100;
    if (/^\d{1,3}$/.test(entry) && Number(entry) <= 255) return Number(entry);
    return NaN;
  });
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const alphaValue = values[3];
  const alpha = !alphaExpected ? 1 : /^\d{1,3}%$/.test(alphaValue) && Number(alphaValue.slice(0, -1)) <= 100
    ? Number(alphaValue.slice(0, -1)) / 100
    : /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(alphaValue) ? Number(alphaValue) : NaN;
  if (!Number.isFinite(alpha)) return null;
  return { hex: toHex(channels), opacity: Math.round(alpha * 100), alpha, channels: channels.map(Math.round) };
}

function colorString(channels, alpha) {
  const alphaText = Number(alpha.toFixed(4)).toString();
  return `rgba(${channels.join(', ')}, ${alphaText})`;
}

export function chooseMenuForeground(value, backdrop = '#17212F') {
  const color = parseSettingsColor(value);
  if (!color) return '#FFFFFF';
  const behind = parseSettingsColor(backdrop) || parseSettingsColor('#17212F');
  const linear = color.channels.map((channel, index) => {
    channel = channel * color.alpha + behind.channels[index] * (1 - color.alpha);
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.36 ? '#17212F' : '#FFFFFF';
}

export function applyMenubarForegroundFromBody(body = document.body) {
  if (!body) return;
  const style = body.style;
  const computed = typeof getComputedStyle === 'function' ? getComputedStyle(body) : null;
  const image = style.backgroundImage || computed?.backgroundImage;
  const solid = (!image || image === 'none') && (style.backgroundColor || computed?.backgroundColor);
  const backdrop = parseSettingsColor(solid)?.alpha === 1 ? solid : '#17212F';
  for (const mode of ['light', 'dark']) {
    const background = style.getPropertyValue(`--mac-header-dropdown-${mode}-bg`)
      || computed?.getPropertyValue(`--mac-header-dropdown-${mode}-bg`) || '';
    const foreground = chooseMenuForeground(background, backdrop);
    const outline = foreground === '#FFFFFF' ? '0,0,0' : '255,255,255';
    const opacity = Number(((1 - (parseSettingsColor(background)?.alpha ?? 1)) * 0.9).toFixed(2));
    style.setProperty(`--mac-header-dropdown-${mode}-fg`, foreground);
    // Images and gradients vary beneath the menu; a contrast halo keeps
    // transparent labels legible without changing the selected background.
    style.setProperty(`--mac-header-dropdown-${mode}-outline`, `rgba(${outline},${opacity})`);
  }
}

export function createSettingsColorMethods() {
  return {
    colorParts(path) {
      if (!COLOR_PATHS.has(path)) return null;
      return parseSettingsColor(this.value(path));
    },
    updateColorHex(path, hex) {
      if (!COLOR_PATHS.has(path) || this.validationErrors?.[path]) return false;
      const current = this.colorParts(path);
      const next = parseSettingsColor(hex);
      if (!current || !next || !/^#[\da-f]{6}$/i.test(String(hex))) return false;
      return this.updateCssColor(path, colorString(next.channels, current.alpha));
    },
    updateColorOpacity(path, percentage) {
      if (!COLOR_PATHS.has(path) || this.validationErrors?.[path]) return false;
      const current = this.colorParts(path);
      if (percentage === '' || percentage === null || percentage === undefined) return false;
      const numeric = Number(percentage);
      if (!current || !Number.isFinite(numeric) || numeric < 0 || numeric > 100) return false;
      return this.updateCssColor(path, colorString(current.channels, Math.round(numeric) / 100));
    }
  };
}
