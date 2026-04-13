/**
 * Weather runtime is data-fetch only and can stay out of the critical path.
 */

const DESKTOP_WIDGET_WEATHER_CACHE_PREFIX = 'theme-macOS-desktop-weather';

const DESKTOP_WIDGET_WEATHER_CODE_MAP = {
  clear: { label: '晴朗', tone: 'sunny', icon: '☀' },
  cloudy: { label: '多云', tone: 'cloudy', icon: '☁' },
  foggy: { label: '雾', tone: 'foggy', icon: '〰' },
  rainy: { label: '降雨', tone: 'rainy', icon: '☂' },
  snowy: { label: '降雪', tone: 'snowy', icon: '❄' },
  stormy: { label: '雷暴', tone: 'stormy', icon: '⚡' }
};

function resolveWeatherDescriptor(code) {
  if (code === 0) return DESKTOP_WIDGET_WEATHER_CODE_MAP.clear;
  if (code === 1 || code === 2 || code === 3) return DESKTOP_WIDGET_WEATHER_CODE_MAP.cloudy;
  if (code === 45 || code === 48) return DESKTOP_WIDGET_WEATHER_CODE_MAP.foggy;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return DESKTOP_WIDGET_WEATHER_CODE_MAP.rainy;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return DESKTOP_WIDGET_WEATHER_CODE_MAP.snowy;
  if (code >= 95 && code <= 99) return DESKTOP_WIDGET_WEATHER_CODE_MAP.stormy;
  return DESKTOP_WIDGET_WEATHER_CODE_MAP.cloudy;
}

function getDesktopWidgetWeatherCacheKey(cityName) {
  return `${DESKTOP_WIDGET_WEATHER_CACHE_PREFIX}:${encodeURIComponent(String(cityName || '').trim().toLowerCase())}`;
}

export function loadCachedDesktopWidgetWeather(cityName, refreshMinutes) {
  if (!cityName) return null;

  try {
    const raw = localStorage.getItem(getDesktopWidgetWeatherCacheKey(cityName));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const ttl = Math.max(refreshMinutes || 30, 10) * 60 * 1000;
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > ttl) {
      return null;
    }

    return parsed.data || null;
  } catch (_error) {
    return null;
  }
}

export function saveDesktopWidgetWeather(cityName, data) {
  if (!cityName || !data) return;

  try {
    localStorage.setItem(getDesktopWidgetWeatherCacheKey(cityName), JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (_error) {
    // noop
  }
}

export async function fetchDesktopWidgetWeather(cityName) {
  if (!cityName) return null;

  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=zh&format=json`;
  const geocodingResponse = await fetch(geocodingUrl);
  if (!geocodingResponse.ok) {
    throw new Error(`Weather geocoding failed: ${geocodingResponse.status}`);
  }

  const geocoding = await geocodingResponse.json();
  const location = Array.isArray(geocoding?.results) ? geocoding.results[0] : null;
  if (!location) {
    throw new Error('Weather geocoding returned empty result');
  }

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`;
  const forecastResponse = await fetch(forecastUrl);
  if (!forecastResponse.ok) {
    throw new Error(`Weather forecast failed: ${forecastResponse.status}`);
  }

  const forecast = await forecastResponse.json();
  const current = forecast?.current || {};
  const daily = forecast?.daily || {};
  const descriptor = resolveWeatherDescriptor(Number(current.weather_code));

  const days = ['日', '一', '二', '三', '四', '五', '六'];
  const forecastList = Array.isArray(daily.time) ? daily.time.map((dateStr, i) => {
    const d = new Date(dateStr);
    const desc = resolveWeatherDescriptor(Number(Array.isArray(daily.weather_code) ? daily.weather_code[i] : 0));
    return {
      label: i === 0 ? '今天' : `周${days[d.getDay()]}`,
      icon: desc.icon,
      condition: desc.label,
      high: Math.round(Number(Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[i] || 0 : 0)),
      low: Math.round(Number(Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[i] || 0 : 0))
    };
  }) : [];

  return {
    city: location.name || cityName,
    country: location.country || '',
    condition: descriptor.label,
    tone: descriptor.tone,
    icon: descriptor.icon,
    temperature: Math.round(Number(current.temperature_2m || 0)),
    apparent: Math.round(Number(current.apparent_temperature || current.temperature_2m || 0)),
    humidity: Math.round(Number(current.relative_humidity_2m || 0)),
    windSpeed: Math.round(Number(current.wind_speed_10m || 0)),
    high: Math.round(Number(Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] || 0 : 0)),
    low: Math.round(Number(Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] || 0 : 0)),
    forecast: forecastList,
    updatedAt: Date.now()
  };
}
