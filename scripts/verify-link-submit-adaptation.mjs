import assert from 'node:assert/strict';
import {
  formatSubmitFailure,
  registerLinkSubmitForm
} from '../src/apps/links/runtime.js';

assert.equal(
  formatSubmitFailure({ status: 400 }, 'Bad Request'),
  '提交内容没有通过校验，请检查网站地址、名称、描述和分组。'
);
assert.equal(
  formatSubmitFailure({ status: 409 }, 'Conflict'),
  '这个链接已存在或已有待审核申请，请切换到留言板说明修改内容。'
);
assert.equal(
  formatSubmitFailure({ status: 409 }, '这个链接已存在'),
  '这个链接已经存在，不能直接新增。请切换为“修改友链”，复制修改申请到留言板。'
);
assert.equal(
  formatSubmitFailure({ status: 429 }, 'Too Many Requests'),
  '提交过于频繁，请稍后再试；也可以复制申请到留言板。'
);
assert.equal(
  formatSubmitFailure({ status: 503 }, 'Service Unavailable'),
  '友链自助提交服务暂时异常，请复制申请到留言板。'
);
assert.equal(
  formatSubmitFailure({ status: 500 }, '插件维护中'),
  '友链自助提交服务暂时异常，请复制申请到留言板。'
);

let factory = null;
registerLinkSubmitForm({
  data(name, componentFactory) {
    assert.equal(name, 'linkSubmitForm');
    factory = componentFactory;
  }
});
assert.equal(typeof factory, 'function');

function createModel() {
  const model = factory();
  model.submitPluginEnabled = true;
  model.form = {
    ...model.form,
    type: 'add',
    displayName: '示例站点',
    url: 'https://example.test/',
    description: '用于契约验证',
    groupName: 'friends'
  };
  return model;
}

function fakeResponse(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone() {
      return this;
    },
    async json() {
      return payload;
    },
    async text() {
      return '';
    }
  };
}

const originalFetch = globalThis.fetch;
try {
  let successPostCount = 0;
  globalThis.fetch = async () => {
    successPostCount += 1;
    return fakeResponse(200);
  };
  const successModel = createModel();
  await successModel.submitLink();
  assert.equal(successModel.result.success, true, '200 response should preserve the direct-submit success path');
  assert.equal(successModel.messageFallback, false, 'success must not enable the message fallback');
  assert.equal(successModel.submitted, true, 'successful submission should enter a terminal submitted state');
  assert.equal(successModel.canSubmitDirect(), false, 'successful submission should disable the direct-submit action');
  assert.equal(successModel.primaryActionLabel(), '已提交，等待审核');
  await successModel.submitLink();
  assert.equal(successPostCount, 1, 'successful submission must not allow a repeated POST');
  await successModel.fillFromUrl();
  assert.equal(successModel.submitted, false, 'generating a new draft should explicitly reopen the submission flow');

  globalThis.fetch = async () => fakeResponse(200, []);
  const emptyGroupsModel = createModel();
  await emptyGroupsModel.loadSubmitGroups();
  assert.equal(emptyGroupsModel.loadingGroups, false, 'empty group fallback should release the loading state');
  assert.equal(emptyGroupsModel.messageFallback, true, '200 with no usable groups should switch to message fallback');
  assert.equal(emptyGroupsModel.result.success, false, 'empty group fallback should explain that direct submit is unavailable');
  assert.match(emptyGroupsModel.markdown, /示例站点/, 'empty group fallback should preserve a copyable draft');

  for (const [status, title, expectedText] of [
    [400, 'Bad Request', '没有通过校验'],
    [409, 'Conflict', '已存在或已有待审核申请'],
    [429, 'Too Many Requests', '提交过于频繁'],
    [503, 'Service Unavailable', '服务暂时异常']
  ]) {
    globalThis.fetch = async () => fakeResponse(status, { title });
    const model = createModel();
    await model.submitLink();
    assert.equal(model.result.success, false, `${status} response should enter the fallback path`);
    assert.equal(model.messageFallback, true, `${status} response should enable message fallback`);
    assert.match(model.result.message, new RegExp(expectedText));
    assert.match(model.markdown, /示例站点/, `${status} fallback should preserve a copyable draft`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('link-submit 1.0.7 adaptation contract passed');
