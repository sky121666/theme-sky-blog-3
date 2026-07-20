import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

const LINK_SUBMIT_API = '/apis/anonymous.link.submit.kunkunyu.com/v1alpha1/linksubmits/-/submit';
const LINK_SUBMIT_GROUPS_API = '/apis/anonymous.link.submit.kunkunyu.com/v1alpha1/linkgroups';
const LINK_DETAIL_API = '/apis/console.api.link.halo.run/v1alpha1/links/-/detail';
const CURRENT_USER_API = '/apis/api.console.halo.run/v1alpha1/users/-';
const HALO_ANONYMOUS_USERNAME = 'anonymousUser';
const HALO_ADMIN_ROLE_NAMES = new Set(['super-role', 'admin', 'administrator']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
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

async function readErrorMessage(response) {
  try {
    const payload = await response.clone().json();
    return String(payload?.detail || payload?.message || payload?.title || '').trim();
  } catch {
    try {
      return String(await response.text() || '').trim();
    } catch {
      return '';
    }
  }
}

export function formatSubmitFailure(response, message) {
  const status = Number(response?.status || 0);
  const genericHttpTitles = new Set([
    'bad request',
    'internal server error',
    'not found',
    'forbidden',
    'unauthorized',
    'conflict',
    'too many requests',
    'service unavailable'
  ]);
  const normalizedMessage = String(message || '').trim();
  const rawMessage = genericHttpTitles.has(normalizedMessage.toLowerCase()) ? '' : normalizedMessage;

  if (rawMessage.includes('已存在')) {
    return '这个链接已经存在，不能直接新增。请切换为“修改友链”，复制修改申请到留言板。';
  }

  if (status === 400) {
    return rawMessage || '提交内容没有通过校验，请检查网站地址、名称、描述和分组。';
  }

  if (status === 404) {
    return '友链自助提交接口未启用，请复制申请到留言板。';
  }

  if (status === 409) {
    return rawMessage || '这个链接已存在或已有待审核申请，请切换到留言板说明修改内容。';
  }

  if (status === 429) {
    return rawMessage || '提交过于频繁，请稍后再试；也可以复制申请到留言板。';
  }

  if (status >= 500) {
    return '友链自助提交服务暂时异常，请复制申请到留言板。';
  }

  return rawMessage || '友链自助提交没有成功，请复制申请到留言板。';
}

async function fetchLinkDetail(url, signal) {
  const response = await fetch(`${LINK_DETAIL_API}?url=${encodeURIComponent(url)}`, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    },
    signal,
    redirect: 'manual'
  });

  if (!response.ok || response.type === 'opaqueredirect' || response.status === 0) {
    const message = await readErrorMessage(response);
    throw new Error(message || `${response.status || 'redirect'}`);
  }

  return response.json();
}

async function resolveCurrentUser() {
  const response = await fetch(CURRENT_USER_API, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok || response.redirected) return null;

  const payload = await response.json();
  const user = payload?.user || payload;
  const name = user?.metadata?.name || '';
  if (!name || name === HALO_ANONYMOUS_USERNAME || user?.spec?.disabled === true) {
    return null;
  }
  return user;
}

function parseRoleNames(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch (_error) {
    // Halo stores role names as a JSON array string; fall through for older/plain values.
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function isAdminUser(user) {
  const roleNames = parseRoleNames(user?.metadata?.annotations?.['rbac.authorization.halo.run/role-names']);
  return roleNames.some((roleName) => HALO_ADMIN_ROLE_NAMES.has(roleName));
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
    allLinksTitle: '全部友链',
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
      this.allLinksTitle = this.$root.dataset.linksAllTitle || '全部友链';

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
      if (!this.selectedGroup) return this.allLinksTitle;
      const current = this.groups.find((group) => group.key === this.selectedGroup);
      return current?.label || '当前分组';
    },

    activeHeaderTitle() {
      return this.activeView === 'board' ? '留言板' : this.activeGroupLabel();
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
    submitted: false,
    markdown: '',
    previewVisible: false,
    fetchingMeta: false,
    detailToolChecking: false,
    detailToolAvailable: false,
    autofillAttempted: false,
    autofillAvailable: false,
    autofillController: null,
    autofillGeneration: 0,
    destroyed: false,
    copied: false,
    result: {
      show: false,
      success: false,
      message: ''
    },

    init() {
      this.destroyed = false;
      const root = document.querySelector('[data-app-root="links"]');
      this.submitPluginEnabled = root?.dataset?.linkSubmitEnabled === 'true';
      if (this.submitPluginEnabled) {
        this.loadSubmitGroups();
      }
      this.detectDetailTool();
    },

    destroy() {
      this.destroyed = true;
      this.cancelAutofill();
    },

    cancelAutofill() {
      this.autofillGeneration += 1;
      this.autofillController?.abort();
      this.autofillController = null;
      this.fetchingMeta = false;
    },

    async detectDetailTool() {
      this.detailToolChecking = true;
      try {
        const user = await resolveCurrentUser();
        if (!user) {
          this.detailToolAvailable = false;
          return;
        }
        this.detailToolAvailable = isAdminUser(user);
      } catch (_error) {
        this.detailToolAvailable = false;
        warnApiCall('links', '友链自动补全权限检测失败，使用手动表单', {
          endpoint: CURRENT_USER_API,
          message: _error?.message || String(_error || ''),
          action: 'hide-autofill',
          hint: '检查 Halo 当前用户接口、登录态和管理员角色判断。'
        });
      } finally {
        this.detailToolChecking = false;
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
          const message = await readErrorMessage(response);
          throw new Error(message || `${response.status}`);
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

        if (this.submitGroups.length === 0) {
          throw new Error('没有可用的友链提交分组');
        }

        if (!this.form.groupName) {
          this.form.groupName = this.submitGroups[0].groupName;
        }
      } catch (_error) {
        warnApiCall('links', '友链提交分组加载失败，切换留言兜底', {
          endpoint: LINK_SUBMIT_GROUPS_API,
          message: _error?.message || String(_error || ''),
          action: 'enable-message-fallback',
          hint: '检查 Link Submit 插件是否启用、匿名分组接口是否可访问。'
        });
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
      this.cancelAutofill();
      const normalized = normalizeUrl(this.form.url);
      this.copied = false;
      this.submitted = false;

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
      this.applyManualDraft(normalized);
      this.result = {
        show: true,
        success: true,
        message: this.isDirectSubmitMode() ? '已生成申请草稿，请补充信息后提交' : '已生成申请草稿，可以复制到留言板'
      };
      this.fetchingMeta = false;
    },

    async autofillFromUrl() {
      this.cancelAutofill();
      const normalized = normalizeUrl(this.form.url);
      this.copied = false;
      this.submitted = false;
      this.autofillAttempted = true;

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
      const controller = new AbortController();
      const generation = ++this.autofillGeneration;
      this.autofillController = controller;
      const isCurrent = () => !controller.signal.aborted
        && !this.destroyed
        && generation === this.autofillGeneration
        && normalizeUrl(this.form.url) === normalized;

      try {
        const detail = await fetchLinkDetail(normalized, controller.signal);
        if (!isCurrent()) return;
        this.detail = {
          displayName: detail?.title || readableHost(normalized) || '待确认站点',
          description: detail?.description || '请手动补充一句话简介。',
          logo: detail?.icon || detail?.image || ''
        };
        this.autofillAvailable = true;
        this.syncFormFromDetail(normalized);
        this.markdown = this.buildMarkdown(normalized);
        this.result = {
          show: true,
          success: true,
          message: '已自动补全站点信息，请确认后提交'
        };
      } catch (_error) {
        if (_error?.name === 'AbortError' || !isCurrent()) return;
        warnApiCall('links', '友链自动补全失败，已生成手动草稿', {
          endpoint: LINK_DETAIL_API,
          url: normalized,
          message: _error?.message || String(_error || ''),
          action: 'generate-manual-draft',
          hint: '检查管理员登录态、Console detail API 权限，以及目标站点是否允许抓取基础信息。'
        });
        this.autofillAvailable = false;
        this.applyManualDraft(normalized);
        this.result = {
          show: true,
          success: true,
          message: this.isDirectSubmitMode() ? '当前无后台提取权限，已生成申请草稿' : '已生成申请草稿，可以复制到留言板'
        };
      } finally {
        if (this.autofillController === controller) {
          this.autofillController = null;
          this.fetchingMeta = false;
        }
      }
    },

    applyManualDraft(url) {
      this.detail = {
        displayName: readableHost(url) || '待确认站点',
        description: '请手动补充一句话简介。',
        logo: ''
      };
      this.syncFormFromDetail(url);
      this.markdown = this.buildMarkdown(url);
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

    isUpdateMode() {
      return this.form.type === 'update';
    },

    isDirectSubmitMode() {
      return this.submitPluginEnabled && !this.messageFallback && !this.isUpdateMode();
    },

    isMessageFallbackMode() {
      return !this.submitPluginEnabled || this.messageFallback || this.isUpdateMode();
    },

    canSubmitDirect() {
      if (this.submitting || this.submitted || this.fetchingMeta || this.loadingGroups) return false;
      if (!this.isDirectSubmitMode()) return false;
      if (!normalizeUrl(this.form.url)) return false;
      if (!String(this.form.displayName || '').trim()) return false;
      if (!String(this.form.description || '').trim()) return false;
      if (!this.form.groupName) return false;
      if (this.form.type === 'update' && !String(this.form.updateDescription || '').trim()) return false;
      return true;
    },

    canCopyDraft() {
      if (this.fetchingMeta) return false;
      if (!this.isMessageFallbackMode()) return false;
      if (!normalizeUrl(this.form.url)) return false;
      if (!String(this.form.displayName || '').trim()) return false;
      if (!String(this.form.description || '').trim()) return false;
      if (this.isUpdateMode() && !String(this.form.updateDescription || '').trim()) return false;
      return true;
    },

    primaryActionLabel() {
      if (this.isDirectSubmitMode()) {
        if (this.submitted) return '已提交，等待审核';
        if (this.submitting) return '提交中...';
        return '提交友链申请';
      }
      if (this.isUpdateMode()) return this.copied ? '已复制，前往留言板' : '复制修改申请到留言板';
      return this.copied ? '已复制，前往留言板' : '复制并前往留言板';
    },

    primaryActionNote() {
      if (this.isUpdateMode()) {
        return '修改不会直接覆盖现有友链，请把修改申请发到留言板，由站长手动处理。';
      }
      if (this.isDirectSubmitMode()) {
        if (this.submitted) return '申请已经提交，请等待站点后台审核。';
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
          const message = await readErrorMessage(response);
          throw new Error(formatSubmitFailure(response, message));
        }

        this.result = {
          show: true,
          success: true,
          message: '友链申请已提交，等待站点后台审核'
        };
        this.submitted = true;
      } catch (error) {
        warnApiCall('links', '友链申请提交失败，切换留言兜底', {
          endpoint: LINK_SUBMIT_API,
          message: error?.message || String(error || ''),
          action: 'enable-message-fallback',
          hint: '检查 Link Submit 插件状态、匿名提交接口、分组 groupName 和提交字段契约。'
        });
        this.enableMessageFallback();
        const errorMessage = String(error?.message || '').trim();
        this.result = {
          show: true,
          success: false,
          message: `${errorMessage || '友链自助提交没有成功。'} 已为你切换到留言板申请方式。`
        };
      } finally {
        this.submitting = false;
      }
    },

    buildMarkdown(url = this.form.url) {
      const normalized = normalizeUrl(url) || String(url || '').trim();
      const lines = [
        this.form.type === 'update' ? '申请修改友链：' : '申请交换友链：',
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
      if (!this.canCopyDraft()) return;

      const markdown = this.buildMarkdown(this.form.url);
      this.markdown = markdown;

      try {
        const copied = await copyText(markdown);
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
