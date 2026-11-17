import { withRequestDeadline } from '../../../shared/request-deadline.js';

export function registerPostComponents(Alpine) {
  Alpine.data('postUpvote', (name, initialCount) => ({
    storageKey: 'halo.upvoted.post.names',
    name: name || '',
    count: 0,
    pending: false,
    liked: false,
    uncertain: false,
    error: '',
    _destroyed: false,
    _controller: null,
    _errorTimer: null,

    init() {
      this._destroyed = false;
      const parsedCount = Number.parseInt(initialCount, 10);
      this.count = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 0;

      try {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        this.liked = Array.isArray(saved) && saved.includes(this.name);
      } catch (_error) {
        this.liked = false;
      }
    },

    destroy() {
      this._destroyed = true;
      this._controller?.abort();
      this._controller = null;
      globalThis.clearTimeout(this._errorTimer);
      this._errorTimer = null;
      this.pending = false;
    },

    persistLike() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        const next = Array.isArray(saved) ? saved.slice() : [];
        if (!next.includes(this.name)) {
          next.push(this.name);
        }
        localStorage.setItem(this.storageKey, JSON.stringify(next));
      } catch (_error) {
        // Ignore storage failures. The server-side upvote already succeeded.
      }
    },

    setError(message, persistent = false) {
      globalThis.clearTimeout(this._errorTimer);
      this._errorTimer = null;
      this.error = message || '';
      if (!this.error || persistent) return;
      this._errorTimer = globalThis.setTimeout(() => {
        this._errorTimer = null;
        if (!this._destroyed && this.error === message) {
          this.error = '';
        }
      }, 2200);
    },

    async upvote() {
      if (this._destroyed || !this.name || this.pending || this.liked || this.uncertain) return;

      this.pending = true;
      this.setError('');
      const controller = new AbortController();
      this._controller = controller;
      const isCurrent = () => !this._destroyed && this._controller === controller;

      try {
        const response = await withRequestDeadline(signal => fetch('/apis/api.halo.run/v1alpha1/trackers/upvote', {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            group: 'content.halo.run',
            plural: 'posts',
            name: this.name
          })
        }), { signal: controller.signal });
        if (!isCurrent()) return;

        if (!response.ok) {
          const error = new Error(`Upvote failed with status ${response.status}`);
          error.status = response.status;
          throw error;
        }
        // Halo's tracker acknowledges the write without an HTML document. A
        // gateway can follow a login redirect and end on a misleading HTTP 200.
        if (response.redirected || /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')) {
          throw new Error('Unexpected document returned by the upvote endpoint');
        }

        this.count += 1;
        this.liked = true;
        this.persistLike();
        document.dispatchEvent(new Event('theme:content-mutated'));
      } catch (error) {
        if (!isCurrent()) return;
        // Transport failures and 5xx cannot prove that this increment was rejected.
        // Keep the outcome visible and never replay an unacknowledged write.
        const rejected = error?.status >= 400 && error.status < 500 && error.status !== 408;
        this.uncertain = !rejected;
        this.setError(rejected ? '点赞失败，请稍后再试' : '点赞结果未确认，请刷新文章核对，避免重复点赞。', this.uncertain);
      } finally {
        if (this._controller === controller) {
          this._controller = null;
          this.pending = false;
        }
      }
    }
  }));
}
