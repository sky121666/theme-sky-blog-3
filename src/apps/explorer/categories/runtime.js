function createPostPreviewState(optionSelector) {
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

      const current = this.$root?.querySelector?.('[data-category-link][aria-current="page"]');
      const strip = current?.closest('.categories-sidebar-nav');
      if (strip && strip.scrollWidth > strip.clientWidth) {
        const item = current.getBoundingClientRect();
        const bounds = strip.getBoundingClientRect();
        // Move only the horizontal strip; opening a category must not scroll its posts.
        if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
        else if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
      }
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

export function registerCategoriesExplorer(Alpine) {
  Alpine.data('categoriesExplorer', () => createPostPreviewState('[data-category-post-option]'));
}

export function registerCategoryPostsExplorer(Alpine) {
  Alpine.data('categoryPostsExplorer', () => createPostPreviewState('[data-category-post-option]'));
}
