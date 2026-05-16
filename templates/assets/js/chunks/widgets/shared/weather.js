function d(t){return String(t||"").trim()}function r(t){return d(t).toLowerCase()}function w(t,e){return{cityName:d((e?.meta&&typeof e.meta=="object"?e.meta:{}).cityName)||d(t.weather.cityName)}}function o(t,e,i){const a=w(t,i);if(!a.cityName)return{cityName:"",loading:!1,error:"请先在后台设置天气组件城市。",data:null};const s=e?.entries?.[r(a.cityName)];return s?{cityName:a.cityName,loading:s.loading===!0,error:s.error||"",data:s.data||null}:{cityName:a.cityName,loading:e?.loading===!0,error:e?.error||"",data:e?.data||null}}function h(t,e){const i=e?.data;return i||{city:t||"天气",temperature:"--",high:"--",low:"--",apparent:"--",humidity:"--",windSpeed:"--",condition:"等待数据",icon:"☁︎",tone:"cloudy",updatedAt:null}}function g(t,e){return`
    <div class="desktop-widget-weather desktop-widget-weather--small is-${e(t.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-top">
        <span class="desktop-widget-weather-city">${e(t.city)}</span>
        <span class="desktop-widget-weather-icon">${e(t.icon)}</span>
      </div>
      <div class="desktop-widget-weather-hero">
        <span class="desktop-widget-weather-temp">${e(`${t.temperature}°`)}</span>
      </div>
      <div class="desktop-widget-weather-foot">
        <span class="desktop-widget-weather-cond">${e(t.condition)}</span>
        <span class="desktop-widget-weather-hilo">H:${e(`${t.high}°`)} L:${e(`${t.low}°`)}</span>
      </div>
    </div>
  `}function c(t,e){return`
    <div class="desktop-widget-weather desktop-widget-weather--medium is-${e(t.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-m-main">
        <div class="desktop-widget-weather-m-top">
          <h4 class="desktop-widget-weather-m-city">${e(t.city)}</h4>
          <span class="desktop-widget-weather-m-cond">${e(t.condition)}</span>
        </div>
        <div class="desktop-widget-weather-m-bottom">
          <span class="desktop-widget-weather-m-temp">${e(`${t.temperature}°`)}</span>
          <div class="desktop-widget-weather-m-icon is-float">${e(t.icon)}</div>
        </div>
      </div>
      <div class="desktop-widget-weather-m-details">
        <div class="desktop-widget-weather-m-details-title">
          <span>当前统计</span>
        </div>
        <div class="desktop-widget-weather-m-stats">
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">体感</span>
            <span class="desktop-widget-weather-m-stat-val">${e(`${t.apparent}°`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">湿度</span>
            <span class="desktop-widget-weather-m-stat-val">${e(`${t.humidity}%`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">风速</span>
            <span class="desktop-widget-weather-m-stat-val">${e(`${t.windSpeed}`)} km/h</span>
          </div>
        </div>
        <div class="desktop-widget-weather-m-hilo">
          <div class="flex-between">
            <span>最高</span>
            <span>${e(`${t.high}°`)}</span>
          </div>
          <div class="flex-between">
            <span>最低</span>
            <span>${e(`${t.low}°`)}</span>
          </div>
        </div>
      </div>
    </div>
  `}function v(){return`
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
  `}function k(){return`
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
  `}function m({modules:t,weatherState:e,escapeHtml:i},a){const s=o(t,e,a),l=s.cityName,p=a?.size==="small";if(!l)return'<div class="desktop-widget-empty">请先在后台设置天气组件城市。</div>';if(s.loading&&!s.data)return p?v():k();const n=h(l,s);return p?g(n,i):c(n,i)}export{m as t};
