import { getSwupClient, readPreparedPage } from '../../../../../shared/swup-client.js';
import { isCompleteHtmlDocument, isHtmlDocumentResponse } from '../../../../../shared/html-document.js';
import { Location } from 'swup';
import { prepareSwupPostImages } from './reader-images.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function cancelled() {
  return new DOMException('Navigation superseded', 'AbortError');
}

function legacyEvent(type, options, request) {
  return Object.assign(new Event(type, { bubbles: true }), options, { request });
}

export class SwupNavigation {
  constructor(options) {
    this.options = options;
    this.request = null;
    this.lastUid = window.history.state?.uid;
    this.swup = getSwupClient();

    this.swup.hooks.before('visit:start', async visit => {
      const session = visit.meta.session;
      session.visit = visit;
      visit.history.popstate = session.options.history === false;
      visit.scroll.reset = false;
      visit.scroll.target = false;
      session.execution = Promise.resolve().then(() => session.execute(session)).then(result => {
        session.result = result;
        session.prepared.resolve(null);
        return result;
      }, error => {
        session.error = error;
        session.prepared.reject(error);
        return false;
      });
      try {
        const page = await session.prepared.promise;
        session.controller.signal.throwIfAborted();
        if (!page || page.commit?.() === false) throw cancelled();
        const target = new URL(page.url, window.location.href);
        visit.to.url = target.pathname + target.search;
        visit.to.hash = target.hash;
        // Swup decides whether the real entry is replaced (canonical redirect
        // back to the source, explicit replace) or actually pushed.
        session.pushesHistory = !visit.history.popstate && visit.history.action !== 'replace'
          && visit.to.url !== this.swup.location.url;
        session.page = { url: target.pathname + target.search, html: page.html };
      } catch (error) {
        session.cancelled = true;
        session.controller.abort(error);
        session.render.resolve();
        const source = new URL(window.location.href);
        visit.history.popstate = true;
        visit.to.url = source.pathname + source.search;
        visit.to.hash = source.hash;
        session.page = { url: visit.to.url, html: '' };
      }
    });
    this.swup.hooks.replace('page:load', visit => visit.meta.session.page);
    this.swup.hooks.replace('visit:transition', async (visit, args, transition) => {
      const session = visit.meta.session;
      if (session.cancelled) {
        visit.abort();
        this.swup.classes.clear();
        this.finish(session);
        return;
      }
      return transition(visit, args);
    });
    this.swup.hooks.replace('content:replace', async visit => {
      const session = visit.meta.session;
      session.controller.signal.throwIfAborted();
      session.historyCommitted = true;
      session.render.resolve();
      await session.execution;
      if (session.error) throw session.error;
      if (session.controller.signal.aborted) {
        visit.abort();
        this.swup.classes.clear();
        this.finish(session);
      }
    });
    this.swup.hooks.replace('content:scroll', visit => {
      if (!visit.to.hash || visit.meta.session.options.history === false) return;
      visit.scroll.target = visit.to.hash;
      return this.swup.scrollToContent(visit);
    });
    this.swup.hooks.replace('visit:end', visit => {
      this.swup.classes.clear();
      this.finish(visit.meta.session);
    });
    this.swup.hooks.replace('visit:fail', (visit, { error }) => {
      const session = visit.meta.session;
      this.swup.classes.clear();
      if (error?.name !== 'AbortError' && !session.controller.signal.aborted) {
        this.dispatchFailure(session);
      }
      this.finish(session);
    });
    this.swup.hooks.replace('fetch:request', async (visit, { url, options: requestOptions }, fetchRequest) => {
      if (requestOptions.docsFlight || requestOptions.navigationFlight) {
        return fetchRequest(visit, { url, options: requestOptions });
      }
      const signal = requestOptions.themeSignal
        ? AbortSignal.any([requestOptions.signal, requestOptions.themeSignal])
        : requestOptions.signal;
      const response = await fetch(url, {
        method: requestOptions.method,
        body: requestOptions.body,
        headers: requestOptions.headers,
        credentials: 'same-origin',
        signal
      });
      if (requestOptions.themeResponse) requestOptions.themeResponse.value = response;
      return response;
    });
    window.addEventListener('popstate', event => {
      void this.loadUrl(window.location.href, { history: false, scrollPos: event.state?.scrollPos });
    });
  }

  finish(session) {
    window.setTimeout(() => session.completion.resolve(session.result ?? false), 0);
  }

  dispatchFailure(session) {
    if (session.failureDispatched) return;
    session.failureDispatched = true;
    document.dispatchEvent(legacyEvent('pjax:error', session.options, session.response));
    document.dispatchEvent(legacyEvent('pjax:complete', {
      ...session.options, __themeFailedResponse: true
    }, session.response));
  }

  abortRequest(request, exceptIntent) {
    if (!request || (exceptIntent && request.options.__themeNavigationIntent === exceptIntent)) return;
    request.controller.abort(cancelled());
    request.prepared.resolve(null);
    request.render.resolve();
  }

  async fetchResponse(url, { signal, requestOptions = {} } = {}) {
    const method = String(requestOptions.requestMethod || 'GET').toUpperCase();
    const headers = {};
    let body = requestOptions.formData || null;
    if (Array.isArray(requestOptions.requestParams) && requestOptions.requestParams.length) {
      const parameters = requestOptions.requestParams.map(param => `${param.name}=${param.value}`).join('&');
      if (method === 'GET') {
        const target = new URL(url, location.href);
        target.search = parameters;
        url = target.href;
      } else {
        body = parameters;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
    const response = {};
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(new DOMException('Page request timed out', 'TimeoutError')), this.options.timeout);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      if (method === 'GET' && !body) {
        const prepared = readPreparedPage(url, { signal: combinedSignal });
        if (prepared) return await prepared;
      }
      const page = await this.swup.fetchPage(url, {
        method, body, headers, themeSignal: combinedSignal, themeResponse: response
      }).catch(error => {
        // Swup rejects empty bodies and HTTP 500. Keep the actual status for
        // the coordinator, without retrying or re-reading the response body.
        if (response.value && response.value.status !== 200) return null;
        throw error;
      });
      combinedSignal.throwIfAborted();
      const fetched = response.value;
      return {
        ok: fetched.ok, status: fetched.status, headers: fetched.headers,
        url: fetched.url, text: async () => page?.html ?? ''
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  navigateContent(url, options, execute) {
    const previous = this.request;
    this.abortRequest(previous);
    const session = {
      options, execute, controller: new AbortController(),
      prepared: deferred(), render: deferred(), completion: deferred(),
      result: false, historyCommitted: false
    };
    session.beforeRender = async page => {
      session.controller.signal.throwIfAborted();
      session.prepared.resolve(page);
      await session.render.promise;
      session.controller.signal.throwIfAborted();
    };
    this.request = session;
    const launch = async () => {
      if (previous) await previous.completion.promise;
      if (session.controller.signal.aborted) {
        this.finish(session);
        return;
      }
      this.swup.location = Location.fromUrl(options.__themeSourceUrl || window.location.href);
      // At launch the trigger may have changed since the click. Swup would
      // otherwise call location.assign itself, bypassing both the leave permit
      // and the hooks that resolve completion if beforeunload is cancelled.
      if (this.swup.shouldIgnoreVisit(url, { el: options.triggerElement })) {
        try { this.options.onNativeNavigation?.(url, options); }
        finally { this.finish(session); }
        return;
      }
      this.swup.navigate(url, {
        animate: false,
        cache: { read: false, write: false },
        meta: { session }
      }, { el: options.triggerElement });
    };
    void launch().catch(error => {
      session.error = error;
      this.dispatchFailure(session);
      this.finish(session);
    });
    return session.completion.promise;
  }

  loadUrl(url, options = {}) {
    return this.navigateContent(url, options, async session => {
      const request = { status: 0, responseText: null, responseURL: url };
      session.response = request;
      document.dispatchEvent(legacyEvent('pjax:send', options, request));
      try {
        const response = await this.fetchResponse(url, {
          signal: session.controller.signal, requestOptions: options.requestOptions
        });
        request.status = response.status;
        const effectiveUrl = new URL(response.url || url, window.location.href);
        effectiveUrl.hash ||= new URL(url, window.location.href).hash;
        request.responseURL = effectiveUrl.href;
        if (response.status === 200) {
          if (!isHtmlDocumentResponse(response)) throw new Error('Expected HTML navigation response');
          request.responseText = await response.text();
          request.completeHtml = isCompleteHtmlDocument(request.responseText);
          request.navigationDocument = new DOMParser().parseFromString(request.responseText, 'text/html');
        }
        return await this.handleResponse(request.responseText, request, url, { ...options, session });
      } catch (error) {
        if (!session.controller.signal.aborted) {
          this.dispatchFailure(session);
        }
        return false;
      }
    });
  }

  async handleResponse(html, request, url, options) {
    if (typeof html !== 'string') return false;
    const session = options.session;
    await session.beforeRender({ html, url: request.responseURL || url });
    const target = request.navigationDocument;
    const oldRoot = document.getElementById('window-frame-root');
    const nextRoot = target.getElementById('window-frame-root');
    prepareSwupPostImages(nextRoot);
    this.options.switches['#window-frame-root'].call({ onSwitch() {} }, oldRoot, nextRoot);
    document.title = target.title;
    const event = legacyEvent('pjax:complete', options, request);
    const completion = this.onComplete?.(event);
    document.dispatchEvent(event);
    await completion;
    return !session.controller.signal.aborted;
  }
}
