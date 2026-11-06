import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPhotosExplorer } from '../src/apps/photos/runtime/explorer.js';

function fixture() {
  let factory;
  registerPhotosExplorer({ data(_name, value) { factory = value; } });
  const component = factory();
  const focused = [];
  const frames = [];
  const nodes = new Map();
  for (const name of ['[data-photos-detail-info-btn]', '[data-photos-detail-comments-btn]', '.photos-detail-popover', '.photos-detail-comment-head button']) {
    nodes.set(name, { isConnected: true, focus() { focused.push(name); } });
  }
  component.$el = { isConnected: true, querySelector: (selector) => nodes.get(selector) };
  component._getWindowSurface = () => component.$el;
  component.$nextTick = (fn) => frames.push(fn);
  component.syncDetailChromeControls = () => {};
  return { component, focused, flush() { frames.splice(0).forEach((fn) => fn()); } };
}

test('图片信息和评论打开后焦点进入面板，显式关闭返回对应触发器', () => {
  const f = fixture();
  f.component.toggleInfo(); f.flush();
  assert.equal(f.focused.at(-1), '.photos-detail-popover');
  f.component.setInfoOpen(false, { restoreFocus: true });
  assert.equal(f.focused.at(-1), '[data-photos-detail-info-btn]');
  f.component.toggleComments(); f.flush();
  assert.equal(f.focused.at(-1), '.photos-detail-comment-head button');
  f.component.setCommentsOpen(false, { restoreFocus: true });
  assert.equal(f.focused.at(-1), '[data-photos-detail-comments-btn]');
});

test('外部点击关闭不抢焦点，快速开关不把焦点放进隐藏面板', () => {
  const f = fixture();
  f.component.toggleInfo();
  f.component.setInfoOpen(false);
  f.flush();
  assert.deepEqual(f.focused, []);
  f.component.toggleComments();
  f.component.setCommentsOpen(false);
  f.flush();
  assert.deepEqual(f.focused, []);
});
