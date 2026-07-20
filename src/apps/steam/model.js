function normalizeText(value) {
  return String(value ?? '').trim();
}

export function isSteamGameUnavailable(game) {
  const value = game?.delisted;
  return value === true || value === 1 || normalizeText(value).toLowerCase() === 'true' || normalizeText(value) === '1';
}

export function resolveSteamGameImage(game) {
  if (!game || isSteamGameUnavailable(game)) return '';
  return normalizeText(game.headerImageUrl) || normalizeText(game.realHeaderImage);
}

export function formatSteamPlaytime(formatted, minutes, fallback = '') {
  const preferred = normalizeText(formatted);
  if (preferred) return preferred;

  if (minutes === null || minutes === undefined || minutes === '') {
    return fallback;
  }

  const numeric = Number(minutes);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;

  const roundedMinutes = Math.floor(numeric);
  const hours = Math.floor(roundedMinutes / 60);
  const remainder = roundedMinutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}
