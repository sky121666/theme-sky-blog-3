/**
 * 天气组件渲染器
 * 预览和桌面完全一致。背景渐变由 weather.tone 控制。
 */

function buildWeatherData(modules, weatherState) {
  const weather = weatherState?.data;
  if (weather) return weather;

  return {
    city: modules.weather.cityName || '天气',
    temperature: '--',
    high: '--',
    low: '--',
    apparent: '--',
    humidity: '--',
    windSpeed: '--',
    condition: '等待数据',
    icon: '☁︎',
    tone: 'cloudy',
    updatedAt: null
  };
}

function renderSmall(data, escapeHtml) {
  return `
    <div class="desktop-widget-weather desktop-widget-weather--small is-${escapeHtml(data.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-top">
        <span class="desktop-widget-weather-city">${escapeHtml(data.city)}</span>
        <span class="desktop-widget-weather-icon">${escapeHtml(data.icon)}</span>
      </div>
      <div class="desktop-widget-weather-hero">
        <span class="desktop-widget-weather-temp">${escapeHtml(`${data.temperature}°`)}</span>
      </div>
      <div class="desktop-widget-weather-foot">
        <span class="desktop-widget-weather-cond">${escapeHtml(data.condition)}</span>
        <span class="desktop-widget-weather-hilo">H:${escapeHtml(`${data.high}°`)} L:${escapeHtml(`${data.low}°`)}</span>
      </div>
    </div>
  `;
}

function renderMedium(data, escapeHtml) {
  return `
    <div class="desktop-widget-weather desktop-widget-weather--medium is-${escapeHtml(data.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      
      <!-- 左侧：主信息 -->
      <div class="desktop-widget-weather-m-main">
        <div class="desktop-widget-weather-m-top">
          <h4 class="desktop-widget-weather-m-city">${escapeHtml(data.city)}</h4>
          <span class="desktop-widget-weather-m-cond">${escapeHtml(data.condition)}</span>
        </div>
        <div class="desktop-widget-weather-m-bottom">
          <span class="desktop-widget-weather-m-temp">${escapeHtml(`${data.temperature}°`)}</span>
          <div class="desktop-widget-weather-m-icon is-float">${escapeHtml(data.icon)}</div>
        </div>
      </div>
      
      <!-- 右侧：当前状况 stats -->
      <div class="desktop-widget-weather-m-details">
        <div class="desktop-widget-weather-m-details-title">
          <span>当前统计</span>
        </div>
        <div class="desktop-widget-weather-m-stats">
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">体感</span>
            <span class="desktop-widget-weather-m-stat-val">${escapeHtml(`${data.apparent}°`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">湿度</span>
            <span class="desktop-widget-weather-m-stat-val">${escapeHtml(`${data.humidity}%`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">风速</span>
            <span class="desktop-widget-weather-m-stat-val">${escapeHtml(`${data.windSpeed}`)} km/h</span>
          </div>
        </div>
        <div class="desktop-widget-weather-m-hilo">
          <div class="flex-between">
            <span>最高</span>
            <span>${escapeHtml(`${data.high}°`)}</span>
          </div>
          <div class="flex-between">
            <span>最低</span>
            <span>${escapeHtml(`${data.low}°`)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderWeatherWidget({ modules, weatherState, escapeHtml }, widget, options = {}) {
  const cityName = modules.weather.cityName;
  const isSmall = widget?.size === 'small';

  if (!cityName) {
    return '<div class="desktop-widget-empty">请先在后台设置天气组件城市。</div>';
  }

  if (weatherState.loading && !weatherState.data) {
    return '<div class="desktop-widget-empty">天气数据加载中…</div>';
  }

  const data = buildWeatherData(modules, weatherState);
  return isSmall ? renderSmall(data, escapeHtml) : renderMedium(data, escapeHtml);
}
