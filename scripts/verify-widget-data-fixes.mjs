import assert from 'node:assert/strict';
import { renderWidget } from '../src/widgets/halo/latest-posts/render.js';
import { renderWeatherWidget } from '../src/widgets/shared/weather.js';
import { buildWidgetCatalog } from '../src/widgets/catalog.js';
import { editModeMethods } from '../src/shell/desktop-shell/runtime/desktop/surface/edit-mode.js';
import { registerDesktopSurface } from '../src/shell/desktop-shell/runtime/desktop/surface/index.js';
import { registerWindowManager } from '../src/shell/desktop-shell/runtime/desktop/window-manager.js';
import { renderWidgetBodyWithHost } from '../src/shell/desktop-shell/runtime/widgets/render-runtime.js';
import {
  disposeLatestPostsSources,
  fetchLatestPostsByCategory
} from '../src/shell/desktop-shell/runtime/widgets/latest-posts-runtime.js';

const globals = new Map(['fetch', 'window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const post = (name, category) => ({
  metadata: { name }, spec: { title: name, categories: [category] }, status: { permalink: `/archives/${name}` }
});
const response = (items, status = 200) => ({ ok: status === 200, status, json: async () => ({ items }) });
const latestWidget = (categoryName = '', key = 'latest') => ({
  widget: 'halo.latest_posts', key, size: 'medium', meta: { categoryName }
});
const latestHost = (surface = 'desktop') => ({
  surface,
  sources: { hydrated: true, loaded: { 'halo.latest_posts': true }, categories: [], latestPosts: Array.from({ length: 8 }, (_, i) => post(`global-${i}`, 'other')) },
  widgetRenderers: { 'halo.latest_posts': renderWidget },
  widgetRendererPromises: {}, widgetRenderVersions: {}, widgetRendererErrors: {},
  _widgetHtmlCache: new Map(), readyCount: 0,
  onWidgetRendererReady() { this.readyCount += 1; }
});

try {
  // W1: the selected category has older posts outside the global latest eight,
  // and there is no category tree in an anonymous desktop response.
  const requests = new Map();
  const calls = [];
  setGlobal('fetch', (url, options) => {
    calls.push({ url: String(url), options });
    const name = decodeURIComponent(String(url).match(/categories\/([^/]+)\/posts/)[1]);
    const task = deferred();
    requests.set(name, task);
    return task.promise;
  });
  const desktop = latestHost();
  const notification = latestHost('notification-center');
  const category = '分类 B/特选';
  const widget = latestWidget(category);
  assert.match(renderWidgetBodyWithHost(desktop, widget), /正在读取分类文章/);
  assert.match(renderWidgetBodyWithHost(notification, widget), /正在读取分类文章/);
  await tick();
  assert.equal(calls.length, 1, '多个宿主同分类并发必须共用请求');
  const url = new URL(calls[0].url, 'https://example.test');
  assert.equal(url.searchParams.get('size'), '8');
  assert.equal(url.searchParams.get('sort'), 'spec.publishTime,desc');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.ok(url.pathname.includes(encodeURIComponent(category)), '分类名必须作为编码后的单个路径参数');
  requests.get(category).resolve(response([post('older-category-post', category)]));
  await tick();
  for (const host of [desktop, notification]) {
    const html = renderWidgetBodyWithHost(host, widget);
    assert.match(html, /older-category-post/);
    assert.doesNotMatch(html, /global-0|还没有可展示/);
    assert.equal(host.readyCount, 1);
  }
  assert.match(renderWidgetBodyWithHost(desktop, latestWidget()), /global-0/, '未筛选继续使用 SSR 快照');
  assert.equal(calls.length, 1, '未筛选不能新增 API 请求');
  assert.match(renderWidget({ sources: desktop.sources, escapeHtml: String }, widget), /正在读取分类文章/,
    '没有匹配的分类结果时不得退回全站样本');

  const raceHost = latestHost();
  renderWidgetBodyWithHost(raceHost, latestWidget('race-A'));
  renderWidgetBodyWithHost(raceHost, latestWidget('race-B'));
  renderWidgetBodyWithHost(raceHost, latestWidget('race-A'));
  await tick();
  requests.get('race-B').resolve(response([post('result-B', 'race-B')]));
  await tick();
  assert.doesNotMatch(renderWidgetBodyWithHost(raceHost, latestWidget('race-A')), /result-B/);
  requests.get('race-A').resolve(response([post('result-A', 'race-A')]));
  await tick();
  assert.match(renderWidgetBodyWithHost(raceHost, latestWidget('race-A')), /result-A/);
  assert.match(renderWidgetBodyWithHost(raceHost, latestWidget('race-B')), /result-B/);

  for (const [name, result, expected] of [
    ['empty', response([]), /该分类还没有/],
    ['failed', response([], 503), /暂时无法加载/],
    ['invalid', { ok: true, json: async () => ({}) }, /暂时无法加载/]
  ]) {
    renderWidgetBodyWithHost(desktop, latestWidget(name));
    await tick();
    requests.get(name).resolve(result);
    await tick();
    const html = renderWidgetBodyWithHost(desktop, latestWidget(name));
    assert.match(html, expected);
    assert.doesNotMatch(html, /global-0/);
  }

  const disposed = latestHost();
  const survivor = latestHost('notification-center');
  renderWidgetBodyWithHost(disposed, latestWidget('shared-dispose'));
  renderWidgetBodyWithHost(survivor, latestWidget('shared-dispose'));
  await tick();
  disposeLatestPostsSources(disposed);
  requests.get('shared-dispose').resolve(response([post('surviving-result', 'shared-dispose')]));
  await tick();
  assert.equal(disposed.readyCount, 0, '销毁后不得再写宿主或调度 DOM 增强');
  assert.deepEqual(disposed.widgetRenderVersions, {});
  assert.match(renderWidgetBodyWithHost(survivor, latestWidget('shared-dispose')), /surviving-result/,
    '销毁一个宿主不能取消其他宿主共享的分类请求');

  setGlobal('fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await assert.rejects(fetchLatestPostsByCategory('timeout', { timeoutMs: 10 }), /aborted/);
  setGlobal('fetch', async () => response([post('retry', 'timeout')]));
  assert.equal((await fetchLatestPostsByCategory('timeout'))[0].metadata.name, 'retry', '失败请求必须退出并发去重表');

  // W2: exercise the actual config-submit method and the shared weather renderer.
  const weatherWidget = { key: 'weather', widget: 'system.weather', size: 'medium', meta: { cityName: '上海' } };
  const refreshes = [];
  const editor = {
    widgetConfigForm: { mode: 'update', targetKey: 'weather', meta: { cityName: '北京' } },
    widgets: [weatherWidget], isWidgetConfigFormValid: () => true,
    closeWidgetConfigForm() {}, invalidateWidgetCache() {}, syncResponsiveVisibility() {}, syncWidgetRuntimes() {},
    dispatchNotificationWidgetsChange() {}, markDesktopLayoutDirty() {},
    async loadWeather(force) { refreshes.push({ force, city: this.widgets[0].meta.cityName }); }
  };
  await editModeMethods.submitWidgetConfigForm.call(editor);
  assert.deepEqual(refreshes, [{ force: true, city: '北京' }], '更新天气实例必须立即按新配置刷新');
  const weatherContext = {
    modules: { weather: { cityName: '上海' } }, escapeHtml: String,
    weatherState: { loading: false, data: { city: '上海', temperature: 30 }, entries: {} }
  };
  assert.doesNotMatch(renderWeatherWidget(weatherContext, weatherWidget), /上海|30°/, '新城无缓存不得显示全局旧城');
  assert.match(renderWeatherWidget(weatherContext, weatherWidget), /北京/);
  weatherContext.weatherState.entries['北京'] = { data: { city: '北京市', temperature: 5 } };
  assert.match(renderWeatherWidget(weatherContext, weatherWidget), /北京市/, '城市缓存键不依赖地理编码显示名完全相同');

  setGlobal('window', { removeEventListener() {}, clearTimeout() {}, __THEME_WIDGETS__: { modules: { weather: {} } } });
  const bodyProperties = new Map();
  setGlobal('document', { removeEventListener() {}, body: {
    classList: { remove() {} },
    style: {
      getPropertyValue: (name) => bodyProperties.get(name) || '',
      setProperty: (name, value) => bodyProperties.set(name, String(value))
    }
  } });
  let desktopFactory;
  let menuBarFactory;
  registerDesktopSurface({ data(_name, factory) { desktopFactory = factory; } });
  registerWindowManager({ store() {}, data(name, factory) { if (name === 'menuBar') menuBarFactory = factory; } });

  // Run the same A→B→A and destroy-during-load contract on both weather hosts.
  for (const notificationHost of [false, true]) {
    const host = notificationHost ? menuBarFactory() : desktopFactory();
    const prefix = notificationHost ? 'notificationWeather' : 'weather';
    const load = notificationHost ? 'loadNotificationWeather' : 'loadWeather';
    const ensure = notificationHost ? 'ensureNotificationWeatherRuntime' : 'ensureWeatherRuntime';
    const widgetsKey = notificationHost ? 'notificationWidgets' : 'widgets';
    const cityRequests = new Map([['A', deferred()], ['B', deferred()], ['dispose', deferred()]]);
    const runtime = {
      loadCachedDesktopWidgetWeather: () => null, saveDesktopWidgetWeather() {},
      fetchDesktopWidgetWeather: (city) => cityRequests.get(city).promise
    };
    host[ensure] = async () => runtime;
    host.invalidateWidgetCache = () => {};
    host.scheduleWeatherRefresh = () => {};
    host.scheduleNotificationWeatherRefresh = () => {};
    host.clearWeatherRefreshTimer = () => {};
    host.notificationCenterVisible = false;
    host.$nextTick = () => {};
    const switchCity = (city) => {
      host[widgetsKey] = [{ key: 'weather', widget: 'system.weather', meta: { cityName: city } }];
      return host[load](true);
    };
    const first = switchCity('A'); await tick();
    const second = switchCity('B'); await tick();
    const third = switchCity('A'); await tick();
    cityRequests.get('B').resolve({ city: 'B' });
    await second;
    assert.notEqual(host[`${prefix}State`].data?.city, 'B', '迟到的 B 不得覆盖再次选择的 A');
    cityRequests.get('A').resolve({ city: 'A' });
    await Promise.all([first, third]);
    assert.equal(host[`${prefix}State`].data.city, 'A');
    const pending = switchCity('dispose'); await tick();
    const stateBeforeDestroy = host[`${prefix}State`];
    host.destroy();
    cityRequests.get('dispose').resolve({ city: 'dispose' });
    await pending;
    assert.equal(host[`${prefix}State`], stateBeforeDestroy, '销毁后迟到天气不能写宿主状态');

    const pendingRuntimeHost = notificationHost ? menuBarFactory() : desktopFactory();
    const runtimeReady = deferred();
    let apiCalls = 0;
    pendingRuntimeHost[widgetsKey] = [{ key: 'weather', widget: 'system.weather', meta: { cityName: 'A' } }];
    pendingRuntimeHost[ensure] = () => runtimeReady.promise;
    pendingRuntimeHost.clearWeatherRefreshTimer = () => {};
    const pendingRuntime = pendingRuntimeHost[load](true);
    pendingRuntimeHost.destroy();
    runtimeReady.resolve({ ...runtime, fetchDesktopWidgetWeather() { apiCalls += 1; return Promise.resolve({ city: 'A' }); } });
    await pendingRuntime;
    assert.equal(apiCalls, 0, '运行时加载期间已销毁，不得继续启动天气请求');
  }

  const menuBar = menuBarFactory();
  menuBar.notificationWeatherState.loading = true;
  menuBar.notificationWidgets = [{ key: 'weather', widget: 'system.weather', surface: 'notification-center', meta: { cityName: 'A' } }];
  menuBar.ensureNotificationWidgetRenderer = async () => {};
  const notificationRefreshes = [];
  menuBar.loadNotificationWeather = (force) => notificationRefreshes.push(force);
  menuBar.syncNotificationWidgets([{ key: 'weather', widget: 'system.weather', surface: 'notification-center', meta: { cityName: 'B' } }]);
  assert.deepEqual(notificationRefreshes, [true], '通知实例换城必须越过旧城 loading 去重');

  // A cache hit must keep the visible notification center on its refresh cycle.
  const weatherTimers = new Map();
  let weatherTimerId = 0;
  window.setTimeout = (callback, delay) => {
    const id = ++weatherTimerId;
    weatherTimers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => weatherTimers.delete(id);
  const cachedMenuBar = menuBarFactory();
  cachedMenuBar.notificationWidgets = [{ key: 'weather', widget: 'system.weather', meta: { cityName: 'B', refreshMinutes: 20 } }];
  cachedMenuBar.notificationCenterVisible = true;
  cachedMenuBar.ensureNotificationWeatherRuntime = async () => ({
    loadCachedDesktopWidgetWeather: () => ({ city: 'B' }), saveDesktopWidgetWeather() {},
    fetchDesktopWidgetWeather() { assert.fail('有效缓存不应触发网络请求'); }
  });
  cachedMenuBar.scheduleNotificationWeatherRefresh();
  const previousTimer = cachedMenuBar.notificationWeatherRefreshTimer;
  await cachedMenuBar.loadNotificationWeather();
  assert.equal(cachedMenuBar.notificationWeatherState.data.city, 'B');
  assert.equal(weatherTimers.has(previousTimer), false, '应替换旧定时器');
  assert.equal(weatherTimers.size, 1, '缓存命中后仍必须保留且仅保留一个刷新定时器');
  const nextTimer = weatherTimers.get(cachedMenuBar.notificationWeatherRefreshTimer);
  assert.equal(nextTimer.delay, 20 * 60 * 1000);
  const timedRefreshes = [];
  cachedMenuBar.loadNotificationWeather = (force) => timedRefreshes.push(force);
  nextTimer.callback();
  assert.deepEqual(timedRefreshes, [true], '下一次周期必须强制请求新天气');
  weatherTimers.clear();

  // Exercise the actual settings event handler: it installs new defaults before
  // syncNotificationWidgets reads the widgets, whose city overrides are empty.
  window.addEventListener = () => {};
  window.setInterval = () => 0;
  document.addEventListener = () => {};
  const defaultsMenuBar = menuBarFactory();
  defaultsMenuBar.$nextTick = () => {};
  defaultsMenuBar.tick = () => {};
  const syncDefaultsWidgets = defaultsMenuBar.syncNotificationWidgets;
  defaultsMenuBar.syncNotificationWidgets = () => {};
  defaultsMenuBar.init();
  defaultsMenuBar.syncNotificationWidgets = syncDefaultsWidgets;
  defaultsMenuBar.captureNotificationWidgetRects = () => null;
  defaultsMenuBar.ensureNotificationWidgetRenderer = async () => {};
  defaultsMenuBar.notificationWeatherDefaults = { cityName: 'A', refreshMinutes: 30 };
  const defaultCityWidget = { key: 'weather', widget: 'system.weather', size: 'medium', surface: 'notification-center', meta: {} };
  defaultsMenuBar.notificationWidgets = [defaultCityWidget];
  const defaultCityRequests = new Map([['A', deferred()], ['B', deferred()]]);
  const requestedDefaults = [];
  defaultsMenuBar.ensureNotificationWeatherRuntime = async () => ({
    loadCachedDesktopWidgetWeather: () => null, saveDesktopWidgetWeather() {},
    fetchDesktopWidgetWeather(city) {
      requestedDefaults.push(city);
      return defaultCityRequests.get(city).promise;
    }
  });
  const defaultLoads = [];
  const loadDefaultWeather = defaultsMenuBar.loadNotificationWeather;
  defaultsMenuBar.loadNotificationWeather = function (...args) {
    const pending = loadDefaultWeather.apply(this, args);
    defaultLoads.push(pending);
    return pending;
  };
  void defaultsMenuBar.loadNotificationWeather(true);
  await tick();
  const changeDefaultCity = (cityName) => defaultsMenuBar.handleNotificationWidgetsChange({
    detail: { modules: { weather: { cityName, refreshMinutes: 30 } }, widgets: [defaultCityWidget] }
  });
  changeDefaultCity('B');
  await tick();
  assert.deepEqual(requestedDefaults, ['A', 'B'], 'A 请求期间改默认城市必须立即启动 B 请求');
  changeDefaultCity('B');
  await tick();
  assert.deepEqual(requestedDefaults, ['A', 'B'], '同一活动请求目标仍应去重');
  changeDefaultCity('A');
  await tick();
  assert.deepEqual(requestedDefaults, ['A', 'B', 'A']);
  defaultCityRequests.get('B').resolve({ city: 'B' });
  await tick();
  assert.notEqual(defaultsMenuBar.notificationWeatherState.data?.city, 'B', '默认城市 A→B→A 时迟到 B 不能回写');
  defaultCityRequests.get('A').resolve({ city: 'A' });
  await Promise.all(defaultLoads);
  assert.equal(defaultsMenuBar.notificationWeatherState.data.city, 'A');
  defaultsMenuBar.destroy();

  // W3: an unavailable Photos plugin has no addable size variants.
  assert.equal(buildWidgetCatalog({ photosAvailable: false }).filter((entry) => entry.widget === 'plugin-photos.gallery').length, 0);
  assert.equal(buildWidgetCatalog({ photosAvailable: true }).filter((entry) => entry.widget === 'plugin-photos.gallery').length, 3);
  console.log('widget data fixes passed (W1-W3, category races/sharing/timeout and weather host lifecycle)');
} finally {
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
