import assert from 'node:assert/strict';
import test from 'node:test';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';
import { renderCalendarWidget } from '../src/widgets/shared/clock-calendar.js';

test('桌面保持打开跨过本地午夜后更新已缓存的日历', () => {
  const NativeDate = globalThis.Date;
  const originalWindow = globalThis.window;
  let currentTime = new NativeDate(2026, 8, 27, 23, 59, 59);
  const timers = new Map();
  let nextTimerId = 0;

  globalThis.Date = class TestDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [currentTime.getTime()]));
    }

    static now() {
      return currentTime.getTime();
    }
  };
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };

  try {
    let factory;
    registerDesktopSurface({ data(_name, create) { factory = create; } });
    const surface = factory();
    surface.widgetRenderers['system.calendar'] = renderCalendarWidget;
    surface.scheduleDesktopWidgetEnhancement = () => {};
    const widget = { key: 'calendar', widget: 'system.calendar', size: 'small' };

    assert.match(surface.renderWidgetBody(widget), /desktop-widget-calendar-day-number">27<\/div>/);
    surface.startCalendarRollover?.();
    const scheduled = [...timers.values()][0];
    assert.ok(scheduled, '桌面日历应安排跨日检查');
    assert.ok(scheduled.delay >= 1000 && scheduled.delay <= 2000);

    currentTime = new NativeDate(2026, 8, 28, 0, 0, 1);
    scheduled.callback();
    assert.match(surface.renderWidgetBody(widget), /desktop-widget-calendar-day-number">28<\/div>/);
  } finally {
    globalThis.Date = NativeDate;
    globalThis.window = originalWindow;
  }
});
