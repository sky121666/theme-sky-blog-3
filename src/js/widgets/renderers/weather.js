export function renderWeatherWidget({ modules, weatherState, escapeHtml }, widget, options = {}) {
  const cityName = modules.weather.cityName;
  const weather = weatherState.data;
  const isPreview = options.preview === true;
  const isLarge = widget?.size === 'large';
  const isSmall = widget?.size === 'small';

  if (isPreview && (!modules.weather.enabled || !cityName || (!weather && !weatherState.loading))) {
    const fallbackCity = cityName || '天气';
    return `
      <div class="desktop-widget-preview-skin desktop-widget-preview-skin--weather is-cloudy ${isLarge ? 'is-large' : 'is-compact'}">
        <div class="desktop-widget-preview-weather-head">
          <span class="desktop-widget-preview-weather-city">${escapeHtml(fallbackCity)}</span>
          <span class="desktop-widget-preview-weather-icon">☁︎</span>
        </div>
        <div class="desktop-widget-preview-weather-hero${isLarge ? '' : ' is-compact'}">
          <strong>18°</strong>
          <div class="desktop-widget-preview-weather-hero-copy">
            <span class="desktop-widget-preview-weather-condition">${escapeHtml(modules.weather.enabled ? '等待同步' : '启用天气后显示')}</span>
            <em class="desktop-widget-preview-weather-range">H 24° · L 12°</em>
          </div>
        </div>
        ${isLarge ? `
          <div class="desktop-widget-preview-weather-summary is-large">
            <span>体感 17°</span>
            <span>湿度 52%</span>
            <span>风速 9km/h</span>
          </div>
          <div class="desktop-widget-preview-weather-insights">
            <span><em>状态</em><strong>多云</strong></span>
            <span><em>更新</em><strong>预览</strong></span>
            <span><em>来源</em><strong>主题设置</strong></span>
          </div>
        ` : `
          <div class="desktop-widget-preview-weather-summary">
            <span>等待天气数据接入</span>
            <span>可添加到桌面</span>
          </div>
        `}
      </div>
    `;
  }

  if (!modules.weather.enabled) {
    return '<div class="desktop-widget-empty">天气组件当前未启用。</div>';
  }

  if (!cityName) {
    return '<div class="desktop-widget-empty">请先在后台设置天气组件城市。</div>';
  }

  if (weatherState.loading && !weather) {
    return '<div class="desktop-widget-empty">天气数据加载中…</div>';
  }

  if (!weather) {
    return `<div class="desktop-widget-empty">${escapeHtml(weatherState.error || '天气数据暂时不可用。')}</div>`;
  }

  const updateLabel = weather.updatedAt
    ? new Date(weather.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

  if (isPreview) {
    if (!isLarge) {
      return `
        <div class="desktop-widget-preview-skin desktop-widget-preview-skin--weather is-${escapeHtml(weather.tone)} is-compact">
          <div class="desktop-widget-preview-weather-head">
            <span class="desktop-widget-preview-weather-city">${escapeHtml(weather.city)}</span>
            <span class="desktop-widget-preview-weather-icon">${escapeHtml(weather.icon)}</span>
          </div>
          <div class="desktop-widget-preview-weather-hero is-compact">
            <strong>${escapeHtml(`${weather.temperature}°`)}</strong>
            <div class="desktop-widget-preview-weather-hero-copy">
              <span class="desktop-widget-preview-weather-condition">${escapeHtml(weather.condition)}</span>
              <em class="desktop-widget-preview-weather-range">H ${escapeHtml(`${weather.high}°`)} · L ${escapeHtml(`${weather.low}°`)}</em>
            </div>
          </div>
          <div class="desktop-widget-preview-weather-summary">
            <span>体感 ${escapeHtml(`${weather.apparent}°`)}</span>
            <span>湿度 ${escapeHtml(`${weather.humidity}%`)}</span>
            <span>${escapeHtml(updateLabel || '即时更新')}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="desktop-widget-preview-skin desktop-widget-preview-skin--weather is-${escapeHtml(weather.tone)} is-large">
        <div class="desktop-widget-preview-weather-head">
          <span class="desktop-widget-preview-weather-city">${escapeHtml(weather.city)}</span>
          <span class="desktop-widget-preview-weather-icon">${escapeHtml(weather.icon)}</span>
        </div>
        <div class="desktop-widget-preview-weather-hero">
          <strong>${escapeHtml(`${weather.temperature}°`)}</strong>
          <div class="desktop-widget-preview-weather-hero-copy">
            <span class="desktop-widget-preview-weather-condition">${escapeHtml(weather.condition)}</span>
            <em class="desktop-widget-preview-weather-range">H ${escapeHtml(`${weather.high}°`)} · L ${escapeHtml(`${weather.low}°`)}</em>
          </div>
        </div>
        <div class="desktop-widget-preview-weather-summary is-large">
          <span>体感 ${escapeHtml(`${weather.apparent}°`)}</span>
          <span>湿度 ${escapeHtml(`${weather.humidity}%`)}</span>
          <span>风速 ${escapeHtml(`${weather.windSpeed}km/h`)}</span>
        </div>
        <div class="desktop-widget-preview-weather-insights">
          <span><em>更新</em><strong>${escapeHtml(updateLabel || '实时')}</strong></span>
          <span><em>状态</em><strong>${escapeHtml(weather.condition)}</strong></span>
          <span><em>体感</em><strong>${escapeHtml(`${weather.apparent}°`)}</strong></span>
        </div>
      </div>
    `;
  }

  if (isSmall) {
    return `
      <div class="desktop-widget-weather desktop-widget-weather--small is-${escapeHtml(weather.tone)}">
        <div class="desktop-widget-weather-atmosphere" aria-hidden="true"></div>
        <div class="desktop-widget-weather-s-icon">${escapeHtml(weather.icon)}</div>
        <div class="desktop-widget-weather-s-temp">${escapeHtml(`${weather.temperature}°`)}</div>
        <div class="desktop-widget-weather-s-city">${escapeHtml(weather.city)}</div>
        <div class="desktop-widget-weather-s-hi-lo">H:${escapeHtml(`${weather.high}°`)} L:${escapeHtml(`${weather.low}°`)}</div>
      </div>
    `;
  }

  return `
    <div class="desktop-widget-weather desktop-widget-weather--medium is-${escapeHtml(weather.tone)}">
      <div class="desktop-widget-weather-atmosphere" aria-hidden="true"></div>
      <div class="desktop-widget-weather-l-hero">
        <div class="desktop-widget-weather-l-hero-left">
          <div class="desktop-widget-weather-l-city">${escapeHtml(weather.city)}</div>
          <div class="desktop-widget-weather-l-temp">${escapeHtml(`${weather.temperature}°`)}</div>
          <div class="desktop-widget-weather-l-condition">${escapeHtml(weather.condition)}</div>
          <div class="desktop-widget-weather-l-hi-lo">H:${escapeHtml(`${weather.high}°`)} L:${escapeHtml(`${weather.low}°`)}</div>
        </div>
        <div class="desktop-widget-weather-l-hero-icon">${escapeHtml(weather.icon)}</div>
      </div>
      <div class="desktop-widget-weather-l-stats">
        <div class="desktop-widget-weather-l-stat">
          <span class="desktop-widget-weather-l-stat-label">体感</span>
          <span class="desktop-widget-weather-l-stat-value">${escapeHtml(`${weather.apparent}°`)}</span>
        </div>
        <div class="desktop-widget-weather-l-stat">
          <span class="desktop-widget-weather-l-stat-label">湿度</span>
          <span class="desktop-widget-weather-l-stat-value">${escapeHtml(`${weather.humidity}%`)}</span>
        </div>
        <div class="desktop-widget-weather-l-stat">
          <span class="desktop-widget-weather-l-stat-label">风速</span>
          <span class="desktop-widget-weather-l-stat-value">${escapeHtml(`${weather.windSpeed}`)}<em>km/h</em></span>
        </div>
      </div>
    </div>
  `;
}
