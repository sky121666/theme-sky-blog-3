import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';
import { renderCalendarWidget } from '../src/widgets/shared/clock-calendar.js';

test('通知中心保持打开跨过本地午夜后更新已缓存的日历', () => {
  const NativeDate = globalThis.Date;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let currentTime = new NativeDate(2026, 8, 27, 23, 59, 59);

  globalThis.Date = class TestDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [currentTime.getTime()]));
    }

    static now() {
      return currentTime.getTime();
    }
  };
  globalThis.window = { __THEME_WIDGETS__: { isHome: true } };
  globalThis.document = { title: '测试' };

  try {
    let menuBarFactory;
    registerWindowManager({
      store() {},
      data(name, factory) {
        if (name === 'menuBar') menuBarFactory = factory;
      }
    });
    const menuBar = menuBarFactory();
    const widget = { key: 'calendar', widget: 'system.calendar', size: 'small' };
    menuBar.timeEnabled = false;
    menuBar.notificationWidgets = [widget];
    menuBar.notificationWidgetRenderers['system.calendar'] = renderCalendarWidget;

    menuBar.tick();
    assert.match(menuBar.renderNotificationWidget(widget), /desktop-widget-calendar-day-number">27<\/div>/);
    menuBar.notificationWidgetHtmlCache.set('system.weather:cached', '天气缓存');
    const originalTick = menuBar.notificationWidgetRenderTick;

    currentTime = new NativeDate(2026, 8, 28, 0, 0, 1);
    menuBar.tick();

    assert.equal(menuBar.notificationWidgetRenderTick, originalTick + 1);
    assert.match(menuBar.renderNotificationWidget(widget), /desktop-widget-calendar-day-number">28<\/div>/);
    assert.equal(menuBar.notificationWidgetHtmlCache.get('system.weather:cached'), '天气缓存');
    menuBar.tick();
    assert.equal(menuBar.notificationWidgetRenderTick, originalTick + 1);
  } finally {
    globalThis.Date = NativeDate;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
