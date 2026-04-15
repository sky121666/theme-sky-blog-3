function l(s,e){const t=e?.data;return t||{city:s.weather.cityName||"天气",temperature:"--",high:"--",low:"--",apparent:"--",humidity:"--",windSpeed:"--",condition:"等待数据",icon:"☁︎",tone:"cloudy",updatedAt:null}}function w(s,e){return`
    <div class="desktop-widget-weather desktop-widget-weather--small is-${e(s.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-top">
        <span class="desktop-widget-weather-city">${e(s.city)}</span>
        <span class="desktop-widget-weather-icon">${e(s.icon)}</span>
      </div>
      <div class="desktop-widget-weather-hero">
        <span class="desktop-widget-weather-temp">${e(`${s.temperature}°`)}</span>
      </div>
      <div class="desktop-widget-weather-foot">
        <span class="desktop-widget-weather-cond">${e(s.condition)}</span>
        <span class="desktop-widget-weather-hilo">H:${e(`${s.high}°`)} L:${e(`${s.low}°`)}</span>
      </div>
    </div>
  `}function n(s,e){return`
    <div class="desktop-widget-weather desktop-widget-weather--medium is-${e(s.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-m-main">
        <div class="desktop-widget-weather-m-top">
          <h4 class="desktop-widget-weather-m-city">${e(s.city)}</h4>
          <span class="desktop-widget-weather-m-cond">${e(s.condition)}</span>
        </div>
        <div class="desktop-widget-weather-m-bottom">
          <span class="desktop-widget-weather-m-temp">${e(`${s.temperature}°`)}</span>
          <div class="desktop-widget-weather-m-icon is-float">${e(s.icon)}</div>
        </div>
      </div>
      <div class="desktop-widget-weather-m-details">
        <div class="desktop-widget-weather-m-details-title">
          <span>当前统计</span>
        </div>
        <div class="desktop-widget-weather-m-stats">
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">体感</span>
            <span class="desktop-widget-weather-m-stat-val">${e(`${s.apparent}°`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">湿度</span>
            <span class="desktop-widget-weather-m-stat-val">${e(`${s.humidity}%`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">风速</span>
            <span class="desktop-widget-weather-m-stat-val">${e(`${s.windSpeed}`)} km/h</span>
          </div>
        </div>
        <div class="desktop-widget-weather-m-hilo">
          <div class="flex-between">
            <span>最高</span>
            <span>${e(`${s.high}°`)}</span>
          </div>
          <div class="flex-between">
            <span>最低</span>
            <span>${e(`${s.low}°`)}</span>
          </div>
        </div>
      </div>
    </div>
  `}function h(){return`
    <div class="desktop-widget-weather desktop-widget-weather--small wg-weather-skeleton">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-top">
        <span class="wg-skel-pill" style="width:42px;height:10px"></span>
        <span class="wg-skel-pill" style="width:18px;height:18px;border-radius:50%"></span>
      </div>
      <div class="desktop-widget-weather-hero">
        <span class="wg-skel-pill" style="width:56px;height:32px"></span>
      </div>
      <div class="desktop-widget-weather-foot">
        <span class="wg-skel-pill" style="width:36px;height:9px"></span>
        <span class="wg-skel-pill" style="width:60px;height:9px"></span>
      </div>
    </div>
  `}function o(){return`
    <div class="desktop-widget-weather desktop-widget-weather--medium wg-weather-skeleton">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-m-main">
        <div class="desktop-widget-weather-m-top">
          <span class="wg-skel-pill" style="width:52px;height:12px"></span>
          <span class="wg-skel-pill" style="width:38px;height:9px;margin-top:4px"></span>
        </div>
        <div class="desktop-widget-weather-m-bottom">
          <span class="wg-skel-pill" style="width:68px;height:36px"></span>
          <span class="wg-skel-pill" style="width:32px;height:32px;border-radius:50%"></span>
        </div>
      </div>
      <div class="desktop-widget-weather-m-details">
        <div class="desktop-widget-weather-m-details-title">
          <span class="wg-skel-pill" style="width:50px;height:9px"></span>
        </div>
        <div class="desktop-widget-weather-m-stats">
          <div class="desktop-widget-weather-m-stat">
            <span class="wg-skel-pill" style="width:20px;height:8px"></span>
            <span class="wg-skel-pill" style="width:28px;height:10px;margin-top:3px"></span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="wg-skel-pill" style="width:20px;height:8px"></span>
            <span class="wg-skel-pill" style="width:28px;height:10px;margin-top:3px"></span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="wg-skel-pill" style="width:20px;height:8px"></span>
            <span class="wg-skel-pill" style="width:28px;height:10px;margin-top:3px"></span>
          </div>
        </div>
        <div class="desktop-widget-weather-m-hilo">
          <div class="flex-between">
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
          </div>
          <div class="flex-between">
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
          </div>
        </div>
      </div>
    </div>
  `}function r({modules:s,weatherState:e,escapeHtml:t},a){const p=s.weather.cityName,i=a?.size==="small";if(!p)return'<div class="desktop-widget-empty">请先在后台设置天气组件城市。</div>';if(e.loading&&!e.data)return i?h():o();const d=l(s,e);return i?w(d,t):n(d,t)}export{r as t};
