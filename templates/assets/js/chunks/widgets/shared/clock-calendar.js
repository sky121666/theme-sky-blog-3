function h(s){const e=s instanceof Date?s:new Date,n=e.getFullYear(),d=e.getMonth(),c=e.getDate(),k=new Date(n,d,1).getDay(),o=new Date(n,d+1,0).getDate(),l=["日","一","二","三","四","五","六"],a=[];l.forEach(t=>{a.push(`<span class="desktop-widget-calendar-weekday">${t}</span>`)});for(let t=0;t<k;t+=1)a.push('<span class="desktop-widget-calendar-day is-empty"></span>');for(let t=1;t<=o;t+=1){const g=t===c?" is-today":"";a.push(`<span class="desktop-widget-calendar-day${g}">${t}</span>`)}return a.join("")}function w({now:s}){const e=s.getHours(),n=s.getMinutes(),d=s.getSeconds()+s.getMilliseconds()/1e3,c=n*60+d,k=e%12*3600+c,o=e%12*30+c/120,l=n*6+d*.1,a=d*6,t=Array.from({length:12},(g,i)=>{const r=i+1,p=(r*30-90)*(Math.PI/180),y=40;return`<text x="${50+y*Math.cos(p)}" y="${50+y*Math.sin(p)}" text-anchor="middle" dominant-baseline="central" class="desktop-widget-clock-number">${r}</text>`}).join("");return`
    <div class="desktop-widget-clock">
      <svg viewBox="0 0 100 100" class="desktop-widget-clock-face">
        <circle cx="50" cy="50" r="49" class="desktop-widget-clock-dial"/>
        ${Array.from({length:60},(g,i)=>{const r=(i*6-90)*(Math.PI/180),p=i%5===0,y=p?44.5:46,u=48;return`<line x1="${50+y*Math.cos(r)}" y1="${50+y*Math.sin(r)}" x2="${50+u*Math.cos(r)}" y2="${50+u*Math.sin(r)}" class="desktop-widget-clock-tick${p?" is-hour":""}"/>`}).join("")}
        ${t}
        <line x1="50" y1="50" x2="50" y2="22" transform="rotate(${o} 50 50)" style="--desktop-clock-duration:43200s;--desktop-clock-delay:-${k.toFixed(3)}s" class="desktop-widget-clock-hand is-hour"/>
        <line x1="50" y1="50" x2="50" y2="14" transform="rotate(${l} 50 50)" style="--desktop-clock-duration:3600s;--desktop-clock-delay:-${c.toFixed(3)}s" class="desktop-widget-clock-hand is-minute"/>
        <line x1="50" y1="56" x2="50" y2="12" transform="rotate(${a} 50 50)" style="--desktop-clock-duration:60s;--desktop-clock-delay:-${d.toFixed(3)}s" class="desktop-widget-clock-hand is-second"/>
        <circle cx="50" cy="50" r="2.2" class="desktop-widget-clock-center"/>
      </svg>
    </div>
  `}function v({now:s,escapeHtml:e},n,d={}){const c=n?.size==="small",k=n?.size==="medium",o=d.mode==="preview"||d.preview===!0?" is-preview":"",l=`${s.getMonth()+1}月`,a=`${s.getFullYear()}年`,t=s.toLocaleDateString("zh-CN",{weekday:"long"}),g=s.toLocaleDateString("zh-CN",{day:"numeric"}),i=String(g).replace(/[^\d]/g,"")||g;return c?`
      <div class="desktop-widget-calendar desktop-widget-calendar--mini${o}">
        <div class="desktop-widget-calendar-weekday-label">${e(t)}</div>
        <div class="desktop-widget-calendar-day-number">${e(i)}</div>
      </div>
    `:k?`
      <div class="desktop-widget-calendar desktop-widget-calendar--compact${o}">
        <div class="desktop-widget-calendar-left">
          <div class="desktop-widget-calendar-weekday-label">${e(t)}</div>
          <div class="desktop-widget-calendar-day-number">${e(i)}</div>
        </div>
        <div class="desktop-widget-calendar-right">
          <div class="desktop-widget-calendar-header">
            <span class="desktop-widget-calendar-header-month">${e(l)}</span>
            <span class="desktop-widget-calendar-header-year">${e(a)}</span>
          </div>
          <div class="desktop-widget-calendar-grid">${h(s)}</div>
        </div>
      </div>
    `:`
    <div class="desktop-widget-calendar desktop-widget-calendar--large${o}">
      <div class="desktop-widget-calendar-header">
        <span class="desktop-widget-calendar-header-month">${e(l)}</span>
        <span class="desktop-widget-calendar-header-year">${e(a)}</span>
      </div>
      <div class="desktop-widget-calendar-grid is-large">${h(s)}</div>
    </div>
  `}export{w as n,v as t};
