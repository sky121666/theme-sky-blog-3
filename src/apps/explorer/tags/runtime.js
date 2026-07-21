function createPostPreviewState(optionSelector, currentNavigationSelector = '') {
  return {
    activePostKey: '',
    activePostTitle: '',
    activePostDate: '',
    activePostComments: '',
    activePostExcerpt: '',
    activePostParentName: '',
    activePostAuthor: '',
    activePostHref: '',

    init() {
      const firstPost = this.$root?.querySelector?.(optionSelector);
      if (firstPost) this.selectPost(firstPost);

      const currentNavigation = currentNavigationSelector
        ? this.$root?.querySelector?.(currentNavigationSelector)
        : null;
      currentNavigation?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    },

    selectPost(el) {
      if (!el?.dataset) return;

      this.activePostKey = el.dataset.postKey || '';
      this.activePostTitle = el.dataset.postTitle || '';
      this.activePostDate = el.dataset.postDate || '';
      this.activePostComments = el.dataset.postComments || '0';
      this.activePostExcerpt = el.dataset.postExcerpt || '';
      this.activePostParentName = el.dataset.postParentName || '';
      this.activePostAuthor = el.dataset.postAuthor || '';
      this.activePostHref = el.href || el.dataset.postHref || '';
    }
  };
}

export function registerTagsExplorer(Alpine) {
  Alpine.data('tagsExplorer', () => createPostPreviewState('[data-tag-post-option]'));
}

export function registerTagPostsExplorer(Alpine) {
  Alpine.data('tagPostsExplorer', () => createPostPreviewState(
    '[data-tag-post-option]',
    '[data-tag-link][aria-current="page"]'
  ));
}
