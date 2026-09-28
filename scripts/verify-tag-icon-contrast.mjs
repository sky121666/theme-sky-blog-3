import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(process.env.SMOKE_BASE_URL || '').trim();
if (!baseUrl) {
  console.log('跳过标签图标对比度验证：未设置 SMOKE_BASE_URL');
  process.exit(0);
}

function luminance(rgb) {
  const channels = rgb.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
  assert.equal(channels.length, 3, `无法解析图标颜色：${rgb}`);
  const linear = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const response = await page.goto(new URL('/tags', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200, '标签页必须返回 200');
  await page.waitForSelector('[data-app-root="explorer-tags"] .tags-sidebar-nav');

  const sample = await page.evaluate(() => {
    const white = /^#(?:fff|ffff|ffffff|ffffffff)$/i;
    const item = [...document.querySelectorAll('.tags-sidebar-item[data-tag-color]')]
      .find((node) => white.test(node.dataset.tagColor || ''));
    const icon = item?.querySelector('.tags-folder-icon');
    return {
      dark: document.documentElement.classList.contains('dark'),
      tag: item?.textContent?.trim().replace(/\s+/g, ' ') || '',
      iconColor: icon ? getComputedStyle(icon).color : ''
    };
  });
  assert.equal(sample.dark, false, '测试必须运行在浅色主题');
  assert.ok(sample.tag && sample.iconColor, '样本必须包含使用白色标签色的图标');

  const contrast = (1.05) / (luminance(sample.iconColor) + 0.05);
  assert.ok(contrast >= 3, `${sample.tag} 图标与浅底对比度需至少 3:1，当前为 ${contrast.toFixed(2)}:1 (${sample.iconColor})`);
  console.log(`标签白色图标对比度通过：${sample.tag} ${contrast.toFixed(2)}:1`);
} finally {
  await browser.close();
}
