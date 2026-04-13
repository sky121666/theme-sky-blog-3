/**
 * 归档侧边栏 + archiveExplorer Alpine 组件
 */

let archiveSidebarCleanup = null;

export function initArchiveSidebar(root = document) {
  const sidebarLinks = Array.from(root.querySelectorAll('[data-archive-sidebar-link]'));
  const yearGroups = Array.from(root.querySelectorAll('[data-archive-year-group]'));

  if (!sidebarLinks.length || !yearGroups.length) return;

  const setActiveYear = (year) => {
    sidebarLinks.forEach((link) => {
      const active = link.dataset.archiveYear === year;
      link.classList.toggle('is-active', active);
      link.setAttribute('aria-current', active ? 'true' : 'false');
    });
  };

  const pickClosestYear = () => {
    const threshold = 120;
    let currentYear = yearGroups[0]?.dataset.archiveYear;

    yearGroups.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= threshold) {
        currentYear = section.dataset.archiveYear;
      }
    });

    if (currentYear) setActiveYear(currentYear);
  };

  const syncFromHash = () => {
    const hash = decodeURIComponent(window.location.hash || '');
    const matched = hash.match(/^#archive-year-(.+)$/);
    if (matched?.[1]) {
      setActiveYear(matched[1]);
      return true;
    }
    return false;
  };

  sidebarLinks.forEach((link) => {
    if (link.dataset.archiveSidebarBound === 'true') return;

    link.dataset.archiveSidebarBound = 'true';
    link.addEventListener('click', () => {
      const year = link.dataset.archiveYear;
      if (year) setActiveYear(year);
    });
  });

  if (!syncFromHash()) {
    pickClosestYear();
  }

  const onScroll = () => pickClosestYear();
  const onHashChange = () => syncFromHash() || pickClosestYear();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', onHashChange);

  if (typeof archiveSidebarCleanup === 'function') {
    archiveSidebarCleanup();
  }

  archiveSidebarCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('hashchange', onHashChange);
  };
}

export function registerArchiveExplorer(Alpine) {
  Alpine.data('archiveExplorer', () => ({
    activeYear: '',
    activeYearLabel: '',
    activeMonthKey: '',
    activeMonthLabel: '',
    activePostKey: '',
    activePostTitle: '',
    activePostDate: '',
    activePostComments: '',
    activePostExcerpt: '',
    activePostParentName: '',
    activePostAuthor: '',
    activePostHref: '',

    init() {
      const firstYear = this.$root.querySelector('[data-archive-year-option]');
      if (!firstYear) return;
      this.selectYear(firstYear.dataset.year, firstYear.dataset.yearLabel);
    },

    selectYear(year, label) {
      this.activeYear = year || '';
      this.activeYearLabel = label || '';

      const firstMonth = Array.from(this.$root.querySelectorAll('[data-archive-month-option]'))
        .find((el) => el.dataset.parentYear === this.activeYear);

      if (firstMonth) {
        this.selectMonth(firstMonth.dataset.monthKey, firstMonth.dataset.monthLabel);
      } else {
        this.activeMonthKey = '';
        this.activeMonthLabel = '';
        this.clearPost();
      }
    },

    selectMonth(monthKey, label) {
      this.activeMonthKey = monthKey || '';
      this.activeMonthLabel = label || '';

      const firstPost = Array.from(this.$root.querySelectorAll('[data-archive-post-option]'))
        .find((el) => el.dataset.parentMonthKey === this.activeMonthKey);

      if (firstPost) {
        this.selectPost(firstPost);
      } else {
        this.clearPost();
      }
    },

    selectPost(el) {
      if (!el || !el.dataset) return;
      this.activePostKey = el.dataset.postKey || '';
      this.activePostTitle = el.dataset.postTitle || '';
      this.activePostDate = el.dataset.postDate || '';
      this.activePostComments = el.dataset.postComments || '0';
      this.activePostExcerpt = el.dataset.postExcerpt || '';
      this.activePostParentName = el.dataset.postParentName || '';
      this.activePostAuthor = el.dataset.postAuthor || '';
      this.activePostHref = el.href || el.dataset.postHref || '';
    },

    clearPost() {
      this.activePostKey = '';
      this.activePostTitle = '';
      this.activePostDate = '';
      this.activePostComments = '';
      this.activePostExcerpt = '';
      this.activePostParentName = '';
      this.activePostAuthor = '';
      this.activePostHref = '';
    }
  }));
}
