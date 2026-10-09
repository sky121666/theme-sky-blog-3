export const SHOP_DISPLAY_PREFS_KEY = 'sky_blog3_shop_display';

const LAYOUTS = new Set(['cards', 'list']);
const SIZES = new Set(['large', 'medium', 'small']);

function normalizeChoice(value, choices, fallback) {
  const choice = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return choices.has(choice) ? choice : fallback;
}

export function normalizeShopDisplay(value) {
  const preferences = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    layout: normalizeChoice(preferences.layout, LAYOUTS, 'cards'),
    size: normalizeChoice(preferences.size, SIZES, 'medium')
  };
}

export function parseShopDisplayPreferences(raw) {
  try {
    return normalizeShopDisplay(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch {
    return normalizeShopDisplay(null);
  }
}
