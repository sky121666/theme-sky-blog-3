import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatSubmitFailure,
  registerLinkSubmitForm
} from '../src/apps/links/runtime.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const linksTemplate = readFileSync(new URL('../templates/modules/links-app/list.html', import.meta.url), 'utf8');
assert.match(
  linksTemplate,
  /class="links-submit-fields" x-show="isDirectSubmitMode\(\) \|\| isMessageFallbackMode\(\)"/,
  'manual fields must remain visible in both direct-submit and message-fallback modes'
);

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

function createEmptyFallbackModel() {
  const model = factory();
  model.submitPluginEnabled = false;
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
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalCustomEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
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
  assert.equal(emptyGroupsModel.isMessageFallbackMode(), true, 'group failure should expose the manual fallback fields');
  assert.equal(emptyGroupsModel.canCopyDraft(), true, 'group failure should keep a valid manual draft copyable');
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

  const autofillRequests = [];
  globalThis.fetch = (url, options = {}) => {
    const request = deferred();
    autofillRequests.push({ url: String(url), signal: options.signal, request });
    return request.promise;
  };
  const concurrentAutofillModel = createEmptyFallbackModel();
  concurrentAutofillModel.form.url = 'https://first-autofill.test/';
  const firstAutofillJob = concurrentAutofillModel.autofillFromUrl();
  concurrentAutofillModel.form.url = 'https://second-autofill.test/';
  const secondAutofillJob = concurrentAutofillModel.autofillFromUrl();
  assert.equal(autofillRequests.length, 2, 'two explicit autofill attempts should start two keyed requests');
  assert.equal(autofillRequests[0].signal.aborted, true, 'a newer autofill request should abort the older URL lookup');

  autofillRequests[1].request.resolve(fakeResponse(200, {
    title: '第二个站点',
    description: '第二个请求先完成',
    icon: 'https://second-autofill.test/icon.png'
  }));
  await secondAutofillJob;
  autofillRequests[0].request.resolve(fakeResponse(200, {
    title: '过期的第一个站点',
    description: '这个迟到响应不应覆盖表单'
  }));
  await firstAutofillJob;

  assert.equal(concurrentAutofillModel.form.url, 'https://second-autofill.test/', 'the current URL should remain the second request');
  assert.equal(concurrentAutofillModel.form.displayName, '第二个站点', 'a stale first response must not overwrite the latest autofill result');
  assert.equal(concurrentAutofillModel.form.description, '第二个请求先完成');
  assert.equal(concurrentAutofillModel.fetchingMeta, false, 'the latest autofill completion should release its loading state');
  assert.equal(concurrentAutofillModel.autofillController, null, 'the latest autofill controller should be released');

  const destroyedAutofillModel = createEmptyFallbackModel();
  destroyedAutofillModel.form.url = 'https://destroyed-autofill.test/';
  const destroyedAutofillJob = destroyedAutofillModel.autofillFromUrl();
  const destroyedRequest = autofillRequests.at(-1);
  destroyedAutofillModel.destroy();
  assert.equal(destroyedRequest.signal.aborted, true, 'destroy should abort an unresolved autofill request');
  destroyedRequest.request.resolve(fakeResponse(200, { title: '销毁后返回' }));
  await destroyedAutofillJob;
  assert.equal(destroyedAutofillModel.form.displayName, '', 'a response completed after destroy must not mutate the form');

  const copiedDrafts = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText(value) {
          copiedDrafts.push(value);
        }
      }
    }
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout(callback) {
        callback();
      },
      dispatchEvent() {}
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById() {
        return { close() {} };
      }
    }
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    }
  });

  const disabledPluginModel = createEmptyFallbackModel();
  assert.equal(disabledPluginModel.isMessageFallbackMode(), true, 'disabled plugin should expose the manual fallback mode');
  assert.equal(disabledPluginModel.canCopyDraft(), false, 'an empty manual form must not enable copying');

  disabledPluginModel.markdown = 'stale draft';
  disabledPluginModel.form.url = 'not-a-valid-url';
  assert.equal(disabledPluginModel.canCopyDraft(), false, 'manual copying must reject an invalid URL');
  disabledPluginModel.form.url = 'https://filled-after-load.test/path';
  assert.equal(disabledPluginModel.canCopyDraft(), false, 'manual copying must require a site name');
  disabledPluginModel.form.displayName = '用户后填站点';
  assert.equal(disabledPluginModel.canCopyDraft(), false, 'manual copying must require a site description');
  disabledPluginModel.form.description = '用户在插件禁用后手工填写的描述';
  assert.equal(disabledPluginModel.canCopyDraft(), true, 'valid manually entered fields should enable copying');
  await disabledPluginModel.copyAndGotoBoard();
  assert.match(copiedDrafts.at(-1), /用户后填站点/, 'copy should rebuild Markdown from the latest manual name');
  assert.match(copiedDrafts.at(-1), /https:\/\/filled-after-load\.test\/path/, 'copy should use the latest valid URL');
  assert.match(copiedDrafts.at(-1), /用户在插件禁用后手工填写的描述/, 'copy should use the latest manual description');
  assert.doesNotMatch(copiedDrafts.at(-1), /stale draft/, 'copy must not reuse cached Markdown');
  assert.equal(disabledPluginModel.markdown, copiedDrafts.at(-1), 'the visible draft cache should match the copied Markdown');

  const updateModel = createEmptyFallbackModel();
  updateModel.form.type = 'update';
  updateModel.form.displayName = '待修改站点';
  updateModel.form.url = 'https://update.test/';
  updateModel.form.description = '修改后的站点描述';
  assert.equal(updateModel.canCopyDraft(), false, 'update mode must require an update description');
  updateModel.form.updateDescription = '域名和简介均已变更';
  assert.equal(updateModel.canCopyDraft(), true, 'update mode should enable copying after the update description is filled');
  await updateModel.copyAndGotoBoard();
  assert.match(copiedDrafts.at(-1), /^申请修改友链：/);
  assert.match(copiedDrafts.at(-1), /- 修改说明：域名和简介均已变更/);
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of [
    ['navigator', originalNavigatorDescriptor],
    ['window', originalWindowDescriptor],
    ['document', originalDocumentDescriptor],
    ['CustomEvent', originalCustomEventDescriptor]
  ]) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete globalThis[key];
    }
  }
}

console.log('link-submit 1.0.7 adaptation contract passed');
