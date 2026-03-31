function renderCalendarMarkup(date) {
  const now = date instanceof Date ? date : new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const firstDay = new Date(year, month, 1);
  const offset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdays = ['\u65e5', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d'];
  const cells = [];

  weekdays.forEach((day) => {
    cells.push(`<span class="desktop-widget-calendar-weekday">${day}</span>`);
  });

  for (let index = 0; index < offset; index += 1) {
    cells.push('<span class="desktop-widget-calendar-day is-empty"></span>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const activeClass = day === today ? ' is-today' : '';
    cells.push(`<span class="desktop-widget-calendar-day${activeClass}">${day}</span>`);
  }

  return cells.join('');
}

export function renderClockWidget({ now }) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hourAngle = (hours % 12) * 30 + minutes * 0.5;
  const minuteAngle = minutes * 6 + seconds * 0.1;
  const secondAngle = seconds * 6;

  const hourNumbers = Array.from({ length: 12 }, (_, i) => {
    const num = i + 1;
    const angle = (num * 30 - 90) * (Math.PI / 180);
    const r = 40;
    const x = 50 + r * Math.cos(angle);
    const y = 50 + r * Math.sin(angle);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" class="desktop-widget-clock-number">${num}</text>`;
  }).join('');

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const angle = (i * 6 - 90) * (Math.PI / 180);
    const isHour = i % 5 === 0;
    const r1 = isHour ? 44.5 : 46;
    const r2 = 48;
    const x1 = 50 + r1 * Math.cos(angle);
    const y1 = 50 + r1 * Math.sin(angle);
    const x2 = 50 + r2 * Math.cos(angle);
    const y2 = 50 + r2 * Math.sin(angle);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="desktop-widget-clock-tick${isHour ? ' is-hour' : ''}"/>`;
  }).join('');

  return `
    <div class="desktop-widget-clock">
      <svg viewBox="0 0 100 100" class="desktop-widget-clock-face">
        <circle cx="50" cy="50" r="49" class="desktop-widget-clock-dial"/>
        ${ticks}
        ${hourNumbers}
        <line x1="50" y1="50" x2="50" y2="22" transform="rotate(${hourAngle} 50 50)" class="desktop-widget-clock-hand is-hour"/>
        <line x1="50" y1="50" x2="50" y2="14" transform="rotate(${minuteAngle} 50 50)" class="desktop-widget-clock-hand is-minute"/>
        <line x1="50" y1="56" x2="50" y2="12" transform="rotate(${secondAngle} 50 50)" class="desktop-widget-clock-hand is-second"/>
        <circle cx="50" cy="50" r="2.2" class="desktop-widget-clock-center"/>
      </svg>
    </div>
  `;
}

export function renderCalendarWidget({ now, escapeHtml }, widget, options = {}) {
  const mini = widget?.size === 'small';
  const compact = widget?.size === 'medium';
  const previewClass = options.preview === true ? ' is-preview' : '';
  const monthShort = `${now.getMonth() + 1}月`;
  const yearStr = `${now.getFullYear()}年`;
  const weekday = now.toLocaleDateString('zh-CN', {
    weekday: 'long'
  });
  const day = now.toLocaleDateString('zh-CN', {
    day: 'numeric'
  });
  const dayNumber = String(day).replace(/[^\d]/g, '') || day;

  if (mini) {
    return `
      <div class="desktop-widget-calendar desktop-widget-calendar--mini${previewClass}">
        <div class="desktop-widget-calendar-weekday-label">${escapeHtml(weekday)}</div>
        <div class="desktop-widget-calendar-day-number">${escapeHtml(dayNumber)}</div>
      </div>
    `;
  }

  if (compact) {
    return `
      <div class="desktop-widget-calendar desktop-widget-calendar--compact${previewClass}">
        <div class="desktop-widget-calendar-left">
          <div class="desktop-widget-calendar-weekday-label">${escapeHtml(weekday)}</div>
          <div class="desktop-widget-calendar-day-number">${escapeHtml(dayNumber)}</div>
        </div>
        <div class="desktop-widget-calendar-right">
          <div class="desktop-widget-calendar-header">
            <span class="desktop-widget-calendar-header-month">${escapeHtml(monthShort)}</span>
            <span class="desktop-widget-calendar-header-year">${escapeHtml(yearStr)}</span>
          </div>
          <div class="desktop-widget-calendar-grid">${renderCalendarMarkup(now)}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="desktop-widget-calendar desktop-widget-calendar--large${previewClass}">
      <div class="desktop-widget-calendar-header">
        <span class="desktop-widget-calendar-header-month">${escapeHtml(monthShort)}</span>
        <span class="desktop-widget-calendar-header-year">${escapeHtml(yearStr)}</span>
      </div>
      <div class="desktop-widget-calendar-grid is-large">${renderCalendarMarkup(now)}</div>
    </div>
  `;
}
