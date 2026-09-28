const PAYLOAD_ATTRIBUTE = /(?:^|\s)data-bangumi-widget-payload(?:\s|=|$)/i;
const JSON_TYPE = /(?:^|\s)type\s*=\s*(["'])application\/json\1(?:\s|$)/i;

export function parseBangumiIntegerField(value, field, allowed = null) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) throw new Error(`Invalid Bangumi payload ${field}`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || (allowed && !allowed.includes(number))) {
    throw new Error(`Invalid Bangumi payload ${field}`);
  }
  return number;
}

export function parseBangumiPagePayload(html, expected = {}) {
  const responseText = String(html || '');
  if (!/<\/html\s*>\s*$/i.test(responseText)) {
    throw new Error('Bangumi widget response is incomplete');
  }
  const scripts = responseText.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    if (!PAYLOAD_ATTRIBUTE.test(script[1]) || !JSON_TYPE.test(script[1])) continue;

    let raw;
    try {
      raw = JSON.parse(script[2]);
    } catch (_error) {
      throw new Error('Invalid Bangumi widget payload JSON');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Invalid Bangumi widget payload');
    }

    const typeNum = parseBangumiIntegerField(raw.typeNum, 'typeNum', [1, 2]);
    const status = parseBangumiIntegerField(raw.status, 'status', [0, 1, 2, 3]);
    const size = parseBangumiIntegerField(raw.size, 'size');
    const total = parseBangumiIntegerField(raw.total, 'total');
    if (size < 1 || !Array.isArray(raw.items)) {
      throw new Error('Invalid Bangumi widget payload items or size');
    }
    if (
      typeNum !== parseBangumiIntegerField(expected.typeNum, 'expected typeNum', [1, 2])
      || status !== parseBangumiIntegerField(expected.status, 'expected status', [0, 1, 2, 3])
      || size !== parseBangumiIntegerField(expected.size, 'expected size')
    ) {
      throw new Error('Bangumi widget payload identity does not match request');
    }
    return { typeNum, status, size, total, items: raw.items };
  }
  throw new Error('Bangumi widget payload missing');
}
