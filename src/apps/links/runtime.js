const LINK_DETAIL_API = '/apis/api.plugin.halo.run/v1alpha1/plugins/PluginLinks/link-detail';
const LINK_SUBMIT_API = '/apis/anonymous.link.submit.kunkunyu.com/v1alpha1/linksubmits/-/submit';
const LINK_SUBMIT_GROUPS_API = '/apis/anonymous.link.submit.kunkunyu.com/v1alpha1/linkgroups';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUrl(value) {
  try {
    return new URL(String(value || '').trim()).toString();
  } catch {
    return '';
  }
}

function readableHost(value) {
  try {
    const host = new URL(String(value || '').trim()).hostname || '';
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return String(value || '').trim();
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }
  return copied;
}

export function registerLinksExplorer(Alpine) {
  Alpine.data('linksExplorer', () => ({
    activeView: 'links',
    selectedGroup: '',
    searchQuery: '',
    sortMode: 'default',
    totalLinks: 0,
    groups: [],
    links: [],
    _showBoardHandler: null,

    init() {
      this.selectedGroup = this.$root.dataset.linksInitialGroup || '';
      this.readDataset();
      this._showBoardHandler = () => this.showBoard(true);
      window.addEventListener('links:show-board', this._showBoardHandler);
    },

    destroy() {
      if (this._showBoardHandler) {
        window.removeEventListener('links:show-board', this._showBoardHandler);
      }
    },

    readDataset() {
      const groupNodes = Array.from(this.$root.querySelectorAll('[data-links-group]'));
      const linkNodes = Array.from(this.$root.querySelectorAll('[data-link-card]'));

      this.groups = groupNodes.map((node) => ({
        key: node.dataset.groupKey || '',
        label: node.dataset.groupLabel || '',
        synthetic: node.dataset.groupSynthetic === 'true'
      }));

      this.links = linkNodes.map((node) => ({
        key: node.dataset.linkKey || '',
        groupKey: node.dataset.groupKey || '',
        name: node.dataset.linkName || '',
        description: node.dataset.linkDescription || '',
        url: node.dataset.linkUrl || '',
        priority: Number(node.dataset.linkPriority || 0),
        createdAt: node.dataset.linkCreated || ''
      }));

      this.totalLinks = this.links.length;
    },

    setGroup(key) {
      this.activeView = 'links';
      this.selectedGroup = key || '';
      this.syncUrl();
      this.scrollMainToTop();
    },

    showBoard(scrollToTop = true) {
      this.activeView = 'board';
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('group');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
      if (scrollToTop) this.scrollMainToTop();
    },

    openSubmitAssistant() {
      document.getElementById('link-submit-modal')?.showModal();
    },

    scrollMainToTop() {
      const scroller = this.$root.querySelector('.links-main-scroll')
        || this.$root.closest('[data-window-scroll]')
        || this.$root;
      scroller?.scrollTo?.({ top: 0, behavior: 'smooth' });
    },

    syncUrl() {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (this.selectedGroup) {
        url.searchParams.set('group', this.selectedGroup);
      } else {
        url.searchParams.delete('group');
      }
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    },

    isGroupActive(key) {
      return (this.selectedGroup || '') === (key || '');
    },

    matchesLink(link) {
      if (!link) return false;
      if (this.activeView !== 'links') return false;
      if (this.selectedGroup && link.groupKey !== this.selectedGroup) return false;

      const query = normalizeText(this.searchQuery);
      if (!query) return true;

      const haystack = [
        link.name,
        link.description,
        link.url
      ].map(normalizeText).join(' ');

      return haystack.includes(query);
    },

    shouldShowLink(el) {
      const key = el?.dataset?.linkKey || '';
      const link = this.links.find((item) => item.key === key);
      return this.matchesLink(link);
    },

    hasVisibleGroup(groupKey) {
      return this.links.some((link) => link.groupKey === groupKey && this.matchesLink(link));
    },

    groupVisibleCount(groupKey) {
      return this.links.filter((link) => link.groupKey === groupKey && this.matchesLink(link)).length;
    },

    visibleCount() {
      return this.links.filter((link) => this.matchesLink(link)).length;
    },

    linkHost(el) {
      return readableHost(el?.dataset?.linkUrl || '');
    },

    sortedVisibleLinks() {
      const links = this.links.filter((link) => this.matchesLink(link));

      return links.slice().sort((left, right) => {
        if (this.sortMode === 'name') {
          return normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-CN');
        }

        if (this.sortMode === 'recent') {
          const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
          const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
          if (leftTime !== rightTime) {
            return rightTime - leftTime;
          }
          return normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-CN');
        }

        if (left.priority !== right.priority) {
          return Number(right.priority || 0) - Number(left.priority || 0);
        }
        return normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-CN');
      });
    },

    activeGroupLabel() {
      if (!this.selectedGroup) return '全部友链';
      const current = this.groups.find((group) => group.key === this.selectedGroup);
      return current?.label || '当前分组';
    },

    activeHeaderTitle() {
      return this.activeView === 'board' ? '留言板' : this.activeGroupLabel();
    },

    activeHeaderSubtitle() {
      if (this.activeView === 'board') {
        return '把友链申请和站点交流集中在这里。';
      }
      return '按分组整理的博客与常访问站点。';
    },

    cardOrder(el) {
      const key = el?.dataset?.linkKey || '';
      if (!key) return 0;
      const index = this.sortedVisibleLinks().findIndex((link) => link.key === key);
      return index >= 0 ? index : 0;
    }
  }));
}

export function registerLinkSubmitForm(Alpine) {
  Alpine.data('linkSubmitForm', () => ({
    form: {
      type: 'add',
      displayName: '',
      url: '',
      logo: '',
      email: '',
      description: '',
      updateDescription: '',
      groupName: '',
      rssUrl: ''
    },
    detail: {
      displayName: '',
      description: '',
      logo: ''
    },
    submitPluginEnabled: false,
    messageFallback: false,
    submitGroups: [],
    loadingGroups: false,
    submitting: false,
    markdown: '',
    previewVisible: false,
    fetchingMeta: false,
    copied: false,
    result: {
      show: false,
      success: false,
      message: ''
    },

    init() {
      const root = document.querySelector('[data-app-root="links"]');
      this.submitPluginEnabled = root?.dataset?.linkSubmitEnabled === 'true';
      if (this.submitPluginEnabled) {
        this.loadSubmitGroups();
      }
    },

    async loadSubmitGroups() {
      this.loadingGroups = true;

      try {
        const response = await fetch(LINK_SUBMIT_GROUPS_API, {
          headers: {
            Accept: 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`${response.status}`);
        }

        const payload = await response.json();
        const groups = Array.isArray(payload) ? payload : (payload?.items || payload?.data || []);
        this.submitGroups = groups
          .map((group) => ({
            displayName: String(group?.displayName || group?.groupName || '').trim(),
            groupName: String(group?.groupName || '').trim(),
            priority: Number(group?.priority || 0)
          }))
          .filter((group) => group.groupName)
          .sort((left, right) => {
            if (left.priority !== right.priority) return Number(left.priority) - Number(right.priority);
            return left.displayName.localeCompare(right.displayName, 'zh-CN');
          });

        if (!this.form.groupName && this.submitGroups.length > 0) {
          this.form.groupName = this.submitGroups[0].groupName;
        }
      } catch (_error) {
        this.enableMessageFallback();
        this.result = {
          show: true,
          success: false,
          message: '友链提交插件分组加载失败，已切换为留言申请方式'
        };
      } finally {
        this.loadingGroups = false;
      }
    },

    async fillFromUrl() {
      const normalized = normalizeUrl(this.form.url);
      this.copied = false;

      if (!normalized) {
        this.result = {
          show: true,
          success: false,
          message: '请先输入有效的网站地址'
        };
        return;
      }

      this.fetchingMeta = true;
      this.previewVisible = true;
      this.result.show = false;

      try {
        const response = await fetch(`${LINK_DETAIL_API}?url=${encodeURIComponent(normalized)}`, {
          headers: {
            Accept: 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`${response.status}`);
        }

        const detail = await response.json();
        this.detail = {
          displayName: detail?.title || readableHost(normalized) || '待确认站点',
          description: detail?.description || '这个站点暂时没有提取到简介。',
          logo: detail?.icon || detail?.image || ''
        };
        this.syncFormFromDetail(normalized);
        this.markdown = this.buildMarkdown(normalized);

        this.result = {
          show: true,
          success: true,
          message: this.isDirectSubmitMode() ? '已提取站点信息，请确认表单后提交' : '已提取站点信息，可以复制到留言板'
        };
      } catch (_error) {
        this.detail = {
          displayName: readableHost(normalized) || '待确认站点',
          description: '未能自动提取简介，请手动补充。',
          logo: ''
        };
        this.syncFormFromDetail(normalized);
        this.markdown = this.buildMarkdown(normalized);
        this.result = {
          show: true,
          success: false,
          message: this.isDirectSubmitMode() ? '自动提取失败，请手动补充表单后提交' : '自动提取失败，已生成可手动补充的申请格式'
        };
      } finally {
        this.fetchingMeta = false;
      }
    },

    syncFormFromDetail(url) {
      this.form.url = url;
      this.form.displayName = this.detail.displayName || this.form.displayName;
      this.form.description = this.detail.description || this.form.description;
      this.form.logo = this.detail.logo || this.form.logo;
    },

    enableMessageFallback() {
      this.messageFallback = true;
      const hasSiteDraft = normalizeUrl(this.form.url)
        || String(this.form.displayName || this.detail.displayName || '').trim()
        || String(this.form.description || this.detail.description || '').trim();
      this.markdown = hasSiteDraft ? this.buildMarkdown(this.form.url) : '';
    },

    isDirectSubmitMode() {
      return this.submitPluginEnabled && !this.messageFallback;
    },

    isMessageFallbackMode() {
      return !this.submitPluginEnabled || this.messageFallback;
    },

    canSubmitDirect() {
      if (this.submitting || this.fetchingMeta || this.loadingGroups) return false;
      if (!this.isDirectSubmitMode()) return false;
      if (!normalizeUrl(this.form.url)) return false;
      if (!String(this.form.displayName || '').trim()) return false;
      if (!String(this.form.description || '').trim()) return false;
      if (!this.form.groupName) return false;
      if (this.form.type === 'update' && !String(this.form.updateDescription || '').trim()) return false;
      return true;
    },

    primaryActionLabel() {
      if (this.isDirectSubmitMode()) {
        if (this.submitting) return '提交中...';
        return this.form.type === 'update' ? '提交修改申请' : '提交友链申请';
      }
      return this.copied ? '已复制，前往留言板' : '复制并前往留言板';
    },

    primaryActionNote() {
      if (this.isDirectSubmitMode()) {
        return '提交后会进入后台审核，发送前可以修改表单。';
      }
      return this.messageFallback ? '自助提交暂不可用，复制后会自动切换到留言板。' : '复制后会自动切换到留言板。';
    },

    async submitLink() {
      if (!this.canSubmitDirect()) return;

      this.submitting = true;
      this.result.show = false;

      const payload = {
        type: this.form.type || 'add',
        displayName: String(this.form.displayName || '').trim(),
        url: normalizeUrl(this.form.url),
        logo: String(this.form.logo || '').trim(),
        email: String(this.form.email || '').trim(),
        description: String(this.form.description || '').trim(),
        updateDescription: String(this.form.updateDescription || '').trim(),
        groupName: String(this.form.groupName || '').trim(),
        rssUrl: String(this.form.rssUrl || '').trim()
      };

      try {
        const response = await fetch(LINK_SUBMIT_API, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`${response.status}`);
        }

        this.result = {
          show: true,
          success: true,
          message: '友链申请已提交，等待站点后台审核'
        };
      } catch (_error) {
        this.enableMessageFallback();
        this.result = {
          show: true,
          success: false,
          message: '提交失败，已切换为留言申请方式'
        };
      } finally {
        this.submitting = false;
      }
    },

    buildMarkdown(url = this.form.url) {
      const normalized = normalizeUrl(url) || String(url || '').trim();
      const lines = [
        '申请交换友链：',
        `- 网站名称：${this.form.displayName || this.detail.displayName || '请补充网站名称'}`,
        `- 网站地址：${normalized || '请补充网站地址'}`,
        `- 头像链接：${this.form.logo || this.detail.logo || '请补充头像或 Logo 地址'}`,
        `- 网站描述：${this.form.description || this.detail.description || '请补充一句话简介'}`
      ];

      if (this.form.email) {
        lines.push(`- 邮箱：${this.form.email}`);
      }

      if (this.form.groupName) {
        const group = this.submitGroups.find((item) => item.groupName === this.form.groupName);
        lines.push(`- 申请分组：${group?.displayName || this.form.groupName}`);
      }

      if (this.form.rssUrl) {
        lines.push(`- RSS 链接：${this.form.rssUrl}`);
      }

      if (this.form.type === 'update' && this.form.updateDescription) {
        lines.push(`- 修改说明：${this.form.updateDescription}`);
      }

      return lines.join('\n');
    },

    async copyAndGotoBoard() {
      if (!this.markdown) return;

      try {
        const copied = await copyText(this.markdown);
        this.copied = copied;
        this.result = {
          show: true,
          success: copied,
          message: copied ? '信息已复制，请在留言板粘贴提交' : '复制失败，请手动复制文本'
        };

        if (copied) {
          window.setTimeout(() => {
            document.getElementById('link-submit-modal')?.close();
            window.dispatchEvent(new CustomEvent('links:show-board'));
          }, 240);
        }
      } catch (_error) {
        this.result = {
          show: true,
          success: false,
          message: '复制失败，请手动复制文本'
        };
      }
    }
  }));
}
