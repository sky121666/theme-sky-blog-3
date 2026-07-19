import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const previousIntersectionObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
const observers = [];

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    this.observeCalls = 0;
    this.unobserveCalls = 0;
    this.disconnectCalls = 0;
    observers.push(this);
  }

  observe(section) {
    this.observeCalls += 1;
    this.observed.add(section);
  }

  unobserve(section) {
    this.unobserveCalls += 1;
    this.observed.delete(section);
  }

  disconnect() {
    this.disconnectCalls += 1;
    this.observed.clear();
  }

  trigger(entries) {
    this.callback(entries);
  }
}

function setIntersectionObserver(value) {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value,
    configurable: true,
    writable: true
  });
}

function createSection(name) {
  const hidden = {
    present: true,
    style: { display: 'none' },
    removeAttribute(attribute) {
      assert.equal(attribute, 'data-comment-hidden');
      this.present = false;
    }
  };
  return {
    name,
    isConnected: true,
    hidden,
    matches(selector) {
      return selector === '[data-lazy-comment]';
    },
    querySelector(selector) {
      if (selector === 'template[data-comment-template]') return null;
      if (selector === '[data-comment-hidden]') return hidden.present ? hidden : null;
      return null;
    }
  };
}

function createRoot(sections = []) {
  return {
    matches() {
      return false;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-lazy-comment]');
      return sections;
    },
    contains(section) {
      return sections.includes(section);
    }
  };
}

try {
  setIntersectionObserver(FakeIntersectionObserver);
  const lazyCommentUrl = pathToFileURL(
    path.join(root, 'src/shell/desktop-shell/runtime/shared/lazy-comment.js')
  );
  const { disposeLazyComments, initLazyComments } = await import(
    `${lazyCommentUrl.href}?contract=lazy-comment-lifecycle`
  );

  const rootOneSection = createSection('root-one');
  const rootTwoSection = createSection('root-two');
  const rootOne = createRoot([rootOneSection]);
  const rootTwo = createRoot([rootTwoSection]);

  initLazyComments(rootOne);
  initLazyComments(rootOne);
  initLazyComments(rootTwo);

  assert.equal(observers.length, 1, '共享观察器只允许创建一次');
  assert.deepEqual(observers[0].options, { rootMargin: '400px 0px' });
  assert.equal(observers[0].observeCalls, 2, '重复初始化不得重复 observe 同一评论区');
  assert.equal(observers[0].observed.has(rootOneSection), true);
  assert.equal(observers[0].observed.has(rootTwoSection), true);

  disposeLazyComments(rootOne);
  assert.equal(observers[0].observed.has(rootOneSection), false, '页面释放必须解除本页评论观察');
  assert.equal(observers[0].observed.has(rootTwoSection), true, '页面释放不得影响其他 root');
  assert.equal(observers[0].disconnectCalls, 0, '仍有观察目标时不得断开共享观察器');

  observers[0].trigger([{ isIntersecting: true, target: rootTwoSection }]);
  assert.equal(rootTwoSection.hidden.present, false, '进入视口后必须显示评论内容');
  assert.equal(rootTwoSection.hidden.style.display, '');
  assert.equal(observers[0].observed.size, 0);
  assert.equal(observers[0].disconnectCalls, 1, '最后一个目标结束后必须 disconnect');

  initLazyComments(rootTwo);
  assert.equal(observers.length, 1, '已显示评论不得重新创建观察器');

  const disconnectedSection = createSection('disconnected');
  initLazyComments(createRoot([disconnectedSection]));
  assert.equal(observers.length, 2, '观察集合清空后允许创建新观察器');
  disconnectedSection.isConnected = false;
  disposeLazyComments(createRoot([]));
  assert.equal(observers[1].observed.size, 0, 'dispose 必须顺带清理断连评论节点');
  assert.equal(observers[1].disconnectCalls, 1);

  setIntersectionObserver(undefined);
  const fallbackSection = createSection('fallback');
  initLazyComments(createRoot([fallbackSection]));
  assert.equal(fallbackSection.hidden.present, false, '无 IntersectionObserver 时必须立即显示评论');
  assert.equal(fallbackSection.hidden.style.display, '');

  const pageAppSource = fs.readFileSync(
    path.join(root, 'src/shell/desktop-shell/runtime/shared/page-app.js'),
    'utf8'
  );
  assert.match(pageAppSource, /import \{ disposeLazyComments, initLazyComments \} from '\.\/lazy-comment\.js';/);
  assert.match(
    pageAppSource,
    /finally \{[\s\S]*?disposeLazyImages\(activeApp\.root \|\| document\);[\s\S]*?disposeLazyComments\(activeApp\.root \|\| document\);[\s\S]*?registry\.activeApp = null;/,
    '页面销毁 finally 必须同时释放图片与评论观察器'
  );

  console.log('lazy comment lifecycle contract passed');
} finally {
  if (previousIntersectionObserver) {
    Object.defineProperty(globalThis, 'IntersectionObserver', previousIntersectionObserver);
  } else {
    delete globalThis.IntersectionObserver;
  }
}
