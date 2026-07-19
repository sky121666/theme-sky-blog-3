import assert from 'node:assert/strict';
import { fetchDesktopWidgetWeather } from '../src/shell/desktop-shell/runtime/widgets/weather-runtime.js';

const originalFetch = globalThis.fetch;

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

function geocodingPayload(name) {
  return {
    results: [{ name, country: '中国', latitude: 39.9, longitude: 116.4 }]
  };
}

function forecastPayload() {
  return {
    current: {
      temperature_2m: 22,
      relative_humidity_2m: 48,
      apparent_temperature: 21,
      weather_code: 0,
      wind_speed_10m: 8
    },
    daily: {
      time: ['2026-07-19'],
      weather_code: [0],
      temperature_2m_max: [27],
      temperature_2m_min: [18]
    }
  };
}

try {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    await Promise.resolve();
    return String(url).includes('geocoding-api')
      ? jsonResponse(geocodingPayload('北京'))
      : jsonResponse(forecastPayload());
  };

  const [first, second] = await Promise.all([
    fetchDesktopWidgetWeather('北京'),
    fetchDesktopWidgetWeather(' 北京 ')
  ]);

  assert.deepEqual(first, second, '归一化后的同城市并发请求应得到同一份数据');
  assert.equal(calls.filter((url) => url.includes('geocoding-api')).length, 1, '同城市并发只请求一次地理编码');
  assert.equal(calls.filter((url) => url.includes('/v1/forecast')).length, 1, '同城市并发只请求一次天气预报');
  assert.equal(calls[0].includes('name=%E5%8C%97%E4%BA%AC'), true, '请求城市应先 trim');

  let failureCalls = 0;
  globalThis.fetch = async (url) => {
    failureCalls += 1;
    if (failureCalls === 1) return jsonResponse({}, 500);
    return String(url).includes('geocoding-api')
      ? jsonResponse(geocodingPayload('上海'))
      : jsonResponse(forecastPayload());
  };

  await assert.rejects(
    fetchDesktopWidgetWeather('上海'),
    /Weather geocoding failed: 500/,
    '首次失败应向调用方暴露错误'
  );
  const retryResult = await fetchDesktopWidgetWeather('上海');
  assert.equal(retryResult.city, '上海', '失败 settle 后必须允许同城市重试');
  assert.equal(failureCalls, 3, '重试应重新执行地理编码和天气预报');

  const cityCalls = [];
  globalThis.fetch = async (url) => {
    cityCalls.push(String(url));
    if (String(url).includes('geocoding-api')) {
      const city = String(url).includes('%E5%B9%BF%E5%B7%9E') ? '广州' : '深圳';
      return jsonResponse(geocodingPayload(city));
    }
    return jsonResponse(forecastPayload());
  };

  const [guangzhou, shenzhen] = await Promise.all([
    fetchDesktopWidgetWeather('广州'),
    fetchDesktopWidgetWeather('深圳')
  ]);
  assert.equal(guangzhou.city, '广州');
  assert.equal(shenzhen.city, '深圳');
  assert.equal(cityCalls.filter((url) => url.includes('geocoding-api')).length, 2, '不同城市不能被错误合并');
  assert.equal(cityCalls.filter((url) => url.includes('/v1/forecast')).length, 2, '不同城市各自请求天气');

  globalThis.fetch = async () => {
    throw new Error('空城市不应触发 fetch');
  };
  assert.equal(await fetchDesktopWidgetWeather('   '), null, '纯空白城市应直接返回 null');

  console.log('weather runtime contract passed');
} finally {
  globalThis.fetch = originalFetch;
}
