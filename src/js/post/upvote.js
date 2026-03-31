export function registerPostComponents(Alpine) {
  Alpine.data('postUpvote', (name, initialCount) => ({
    storageKey: 'halo.upvoted.post.names',
    name: name || '',
    count: 0,
    pending: false,
    liked: false,
    error: '',

    init() {
      const parsedCount = Number.parseInt(initialCount, 10);
      this.count = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 0;

      try {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        this.liked = Array.isArray(saved) && saved.includes(this.name);
      } catch (_error) {
        this.liked = false;
      }
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

    setError(message) {
      this.error = message || '';
      if (!this.error) return;
      window.setTimeout(() => {
        if (this.error === message) {
          this.error = '';
        }
      }, 2200);
    },

    async upvote() {
      if (!this.name || this.pending || this.liked) return;

      this.pending = true;
      this.error = '';

      try {
        const response = await fetch('/apis/api.halo.run/v1alpha1/trackers/upvote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            group: 'content.halo.run',
            plural: 'posts',
            name: this.name
          })
        });

        if (!response.ok) {
          throw new Error(`Upvote failed with status ${response.status}`);
        }

        this.count += 1;
        this.liked = true;
        this.persistLike();
      } catch (_error) {
        this.setError('网络请求失败，请稍后再试');
      } finally {
        this.pending = false;
      }
    }
  }));
}
