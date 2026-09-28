// Bounded to computed RGB colors and one two-stop gradient over a solid fixture.
// This is not a wallpaper/backdrop sampling or general accessibility evaluator.
export function parseComputedColor(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported computed color: ${value}`);
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (![3, 4].includes(parts.length) || parts.some((part) => !Number.isFinite(part))
    || parts.slice(0, 3).some((part) => part < 0 || part > 255)
    || (parts.length === 4 && (parts[3] < 0 || parts[3] > 1))) {
    throw new Error(`Invalid computed color: ${value}`);
  }
  return [...parts.slice(0, 3), parts[3] ?? 1];
}

function composite(foreground, background) {
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
}

function luminance(color) {
  return color.map((value) => value / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function gradientEndpoints(image) {
  // A background shorthand with a final color layer serializes as "gradient, none".
  // Empty trailing image layers add no paint; real additional layers stay rejected.
  const paintedImage = image.trim().replace(/(?:,\s*none)+$/, '');
  if (paintedImage === 'none') return [[0, 0, 0, 0]];
  const color = '(rgba?\\([^)]*\\))';
  const stop = `${color}(?:\\s+(?:0|100)%)?`;
  const match = new RegExp(`^linear-gradient\\((?:(?:180deg|to bottom),\\s*)?${stop},\\s*${stop}\\)$`).exec(paintedImage);
  if (!match) throw new Error(`Unsupported fixture background image: ${image}`);
  const endpoints = [parseComputedColor(match[1]), parseComputedColor(match[2])];
  // Same RGB with varying alpha has monotonic luminance over the solid backdrop.
  // Do not silently approximate arbitrary gradients with their endpoints.
  if (endpoints[0].slice(0, 3).some((value, index) => value !== endpoints[1][index])) {
    throw new Error('Fixture gradient must keep the same RGB at both stops');
  }
  return endpoints;
}

export function computedTextContrast({ layers, color }) {
  if (!layers.length || parseComputedColor(layers[0].backgroundColor)[3] !== 1) {
    throw new Error('Contrast fixture requires an opaque first background');
  }
  let backgrounds = [[255, 255, 255]];
  for (const layer of layers) {
    if (Number(layer.opacity) !== 1) throw new Error('Unsupported fixture element opacity');
    const background = parseComputedColor(layer.backgroundColor);
    const endpoints = gradientEndpoints(layer.backgroundImage);
    backgrounds = backgrounds.flatMap((under) => endpoints.map((overlay) => composite(overlay, composite(background, under))));
  }
  const foreground = parseComputedColor(color);
  const textIsDarker = backgrounds.every((background) => foreground.slice(0, 3).every((value, index) => value <= background[index]));
  const textIsLighter = backgrounds.every((background) => foreground.slice(0, 3).every((value, index) => value >= background[index]));
  if (!textIsDarker && !textIsLighter) {
    throw new Error('Text must stay on one side of the fixture gradient color range');
  }
  const samples = backgrounds.map((background) => {
    const text = composite(foreground, background);
    const a = luminance(text);
    const b = luminance(background);
    return { background, text, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  return { minimumRatio: Math.min(...samples.map(({ ratio }) => ratio)), samples };
}
