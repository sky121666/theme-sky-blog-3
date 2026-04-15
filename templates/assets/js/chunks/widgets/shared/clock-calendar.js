function h(s){const t=s instanceof Date?s:new Date,n=t.getFullYear(),c=t.getMonth(),l=t.getDate(),g=new Date(n,c,1).getDay(),i=new Date(n,c+1,0).getDate(),r=["日","一","二","三","四","五","六"],d=[];r.forEach(e=>{d.push(`<span class="desktop-widget-calendar-weekday">${e}</span>`)});for(let e=0;e<g;e+=1)d.push('<span class="desktop-widget-calendar-day is-empty"></span>');for(let e=1;e<=i;e+=1){const a=e===l?" is-today":"";d.push(`<span class="desktop-widget-calendar-day${a}">${e}</span>`)}return d.join("")}function w({now:s}){const t=s.getHours(),n=s.getMinutes(),c=s.getSeconds(),l=t%12*30+n*.5,g=n*6+c*.1,i=c*6,r=Array.from({length:12},(d,e)=>{const a=e+1,o=(a*30-90)*(Math.PI/180),p=40;return`<text x="${50+p*Math.cos(o)}" y="${50+p*Math.sin(o)}" text-anchor="middle" dominant-baseline="central" class="desktop-widget-clock-number">${a}</text>`}).join("");return`
    <div class="desktop-widget-clock">
      <svg viewBox="0 0 100 100" class="desktop-widget-clock-face">
        <circle cx="50" cy="50" r="49" class="desktop-widget-clock-dial"/>
        ${Array.from({length:60},(d,e)=>{const a=(e*6-90)*(Math.PI/180),o=e%5===0,p=o?44.5:46,k=48;return`<line x1="${50+p*Math.cos(a)}" y1="${50+p*Math.sin(a)}" x2="${50+k*Math.cos(a)}" y2="${50+k*Math.sin(a)}" class="desktop-widget-clock-tick${o?" is-hour":""}"/>`}).join("")}
        ${r}
        <line x1="50" y1="50" x2="50" y2="22" transform="rotate(${l} 50 50)" class="desktop-widget-clock-hand is-hour"/>
        <line x1="50" y1="50" x2="50" y2="14" transform="rotate(${g} 50 50)" class="desktop-widget-clock-hand is-minute"/>
        <line x1="50" y1="56" x2="50" y2="12" transform="rotate(${i} 50 50)" class="desktop-widget-clock-hand is-second"/>
        <circle cx="50" cy="50" r="2.2" class="desktop-widget-clock-center"/>
      </svg>
    </div>
  `}function u({now:s,escapeHtml:t},n,c={}){const l=n?.size==="small",g=n?.size==="medium",i=c.mode==="preview"||c.preview===!0?" is-preview":"",r=`${s.getMonth()+1}月`,d=`${s.getFullYear()}年`,e=s.toLocaleDateString("zh-CN",{weekday:"long"}),a=s.toLocaleDateString("zh-CN",{day:"numeric"}),o=String(a).replace(/[^\d]/g,"")||a;return l?`
      <div class="desktop-widget-calendar desktop-widget-calendar--mini${i}">
        <div class="desktop-widget-calendar-weekday-label">${t(e)}</div>
        <div class="desktop-widget-calendar-day-number">${t(o)}</div>
      </div>
    `:g?`
      <div class="desktop-widget-calendar desktop-widget-calendar--compact${i}">
        <div class="desktop-widget-calendar-left">
          <div class="desktop-widget-calendar-weekday-label">${t(e)}</div>
          <div class="desktop-widget-calendar-day-number">${t(o)}</div>
        </div>
        <div class="desktop-widget-calendar-right">
          <div class="desktop-widget-calendar-header">
            <span class="desktop-widget-calendar-header-month">${t(r)}</span>
            <span class="desktop-widget-calendar-header-year">${t(d)}</span>
          </div>
          <div class="desktop-widget-calendar-grid">${h(s)}</div>
        </div>
      </div>
    `:`
    <div class="desktop-widget-calendar desktop-widget-calendar--large${i}">
      <div class="desktop-widget-calendar-header">
        <span class="desktop-widget-calendar-header-month">${t(r)}</span>
        <span class="desktop-widget-calendar-header-year">${t(d)}</span>
      </div>
      <div class="desktop-widget-calendar-grid is-large">${h(s)}</div>
    </div>
  `}export{w as n,u as t};
