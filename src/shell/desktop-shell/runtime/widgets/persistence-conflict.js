function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function layoutConflict() {
  return Object.assign(new Error('服务端桌面布局或图标设置已更新，当前编辑内容已保留。请刷新页面后重新编辑再保存。'), { code: 'layout-conflict' });
}

/** Check the server value read under the config mutation lock, before any PUT. */
export function assertDesktopLayoutBaseline(config, expectedLayoutJson, { settingsChanged = false } = {}) {
  if (settingsChanged) throw layoutConflict();
  const container = isRecord(config?.spec?.value) ? config.spec.value
    : isRecord(config?.data) ? config.data : config;
  let group = container?.default_layout;
  if (typeof group === 'string' && group) {
    try { group = JSON.parse(group); } catch (_error) { throw layoutConflict(); }
  }
  if (group != null && group !== '' && !isRecord(group)) throw layoutConflict();
  const current = group?.layout_json ?? '';
  const expected = expectedLayoutJson ?? '';
  if (typeof current !== 'string' || typeof expected !== 'string' || current !== expected) throw layoutConflict();
}
