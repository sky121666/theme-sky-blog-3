import { warnApiCall } from '../../shell/desktop-shell/runtime/shared/debug.js';

const LINK_SUBMIT_API = '/apis/anonymous.link.submit.kunkunyu.com/v1alpha1/linksubmits/-/submit';
const LINK_SUBMIT_GROUPS_API = '/apis/anonymous.link.submit.kunkunyu.com/v1alpha1/linkgroups';
const SITE_METADATA_TIMEOUT_MS = 8000;
const SITE_METADATA_MAX_BYTES = 1_500_000;

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

function decodeTextEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  return String(value || '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const radix = String(code).toLowerCase().startsWith('x') ? 16 : 10;
      const valueText = radix === 16 ? String(code).slice(1) : String(code);
      const codePoint = Number.parseInt(valueText, radix);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (match, name) => namedEntities[name.toLowerCase()] || match);
}

export function sanitizePlainText(value) {
  return decodeTextEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

export function resolveMetadataUrl(value, baseUrl) {
  try {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';
    const url = new URL(rawValue, baseUrl);
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

function metadataContent(documentNode, selectors) {
  for (const selector of selectors) {
    const node = documentNode.querySelector(selector);
    const value = node?.getAttribute?.('content') || node?.getAttribute?.('href') || node?.textContent || '';
    const text = sanitizePlainText(value);
    if (text) return text;
  }
  return '';
}

function detectSitePlatform(generator) {
  const value = sanitizePlainText(generator).slice(0, 80);
  const normalized = value.toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('halo')) return 'Halo';
  if (normalized.includes('wordpress')) return 'WordPress';
  if (normalized.includes('typecho')) return 'Typecho';
  if (normalized.includes('hexo')) return 'Hexo';
  if (normalized.includes('hugo')) return 'Hugo';
  if (normalized.includes('ghost')) return 'Ghost';
  return value;
}

export function parseSiteMetadata(html, baseUrl) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('当前浏览器不支持 HTML 元数据解析');
  }

  const documentNode = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const title = metadataContent(documentNode, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'title'
  ]).slice(0, 120);
  const description = metadataContent(documentNode, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ]).slice(0, 500);
  const logo = resolveMetadataUrl(metadataContent(documentNode, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'link[rel~="apple-touch-icon"]',
    'link[rel~="icon"]'
  ]), baseUrl);
  const rssUrl = resolveMetadataUrl(metadataContent(documentNode, [
    'link[rel="alternate"][type="application/rss+xml"]',
    'link[rel="alternate"][type="application/atom+xml"]'
  ]), baseUrl);
  const platform = detectSitePlatform(metadataContent(documentNode, ['meta[name="generator"]']));

  return { title, description, logo, rssUrl, platform };
}

async function fetchSiteMetadata(url, signal) {
  const targetUrl = new URL(url);
  if (typeof window !== 'undefined'
    && window.location?.protocol === 'https:'
    && targetUrl.protocol === 'http:') {
    const error = new Error('mixed-content');
    error.code = 'mixed-content';
    throw error;
  }

  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    },
    signal
  });

  if (!response.ok || response.type === 'opaque' || response.status === 0) {
    const error = new Error(`HTTP ${response.status || 'blocked'}`);
    error.code = 'request-failed';
    throw error;
  }

  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    const error = new Error(`unsupported-content-type:${contentType}`);
    error.code = 'not-html';
    throw error;
  }

  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > SITE_METADATA_MAX_BYTES) {
    const error = new Error('site-html-too-large');
    error.code = 'too-large';
    throw error;
  }

  const html = await response.text();
  if (!html.trim()) {
    const error = new Error('empty-site-html');
    error.code = 'empty';
    throw error;
  }
  if (new Blob([html]).size > SITE_METADATA_MAX_BYTES) {
    const error = new Error('site-html-too-large');
    error.code = 'too-large';
    throw error;
  }

  const resolvedUrl = normalizeUrl(response.url) || url;
  const metadata = parseSiteMetadata(html, resolvedUrl);
  if (!metadata.title && !metadata.description && !metadata.logo && !metadata.rssUrl && !metadata.platform) {
    const error = new Error('site-metadata-empty');
    error.code = 'empty';
    throw error;
  }
  return metadata;
}

export function formatMetadataFailure(error) {
  if (error?.code === 'mixed-content') {
    return '当前页面使用 HTTPS，浏览器会阻止读取 HTTP 站点；已保留网址，请手动补充站点信息。';
  }
  if (error?.code === 'not-html') {
    return '目标地址没有返回可识别的网页；已保留网址，请手动补充站点信息。';
  }
  if (error?.code === 'too-large') {
    return '目标网页内容过大，已停止自动识别；网址已保留，请手动补充站点信息。';
  }
  if (error?.code === 'timeout') {
    return '目标站点响应超时；已保留网址，请手动补充站点信息。';
  }
  return '浏览器未能读取目标站点（常见原因是跨域限制或访问拦截）；已保留网址，请手动补充站点信息。';
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
    _popstateHandler: null,

    init() {
      this.readDataset();
      this.applyLocationState(true);
      this._showBoardHandler = () => this.showBoard(true);
      this._popstateHandler = () => this.applyLocationState(false);
      window.addEventListener('links:show-board', this._showBoardHandler);
      window.addEventListener('popstate', this._popstateHandler);
    },

    destroy() {
      if (this._showBoardHandler) {
        window.removeEventListener('links:show-board', this._showBoardHandler);
      }
      if (this._popstateHandler) {
        window.removeEventListener('popstate', this._popstateHandler);
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

      this.links = linkNodes.map((node) => {
        const description = sanitizePlainText(node.dataset.linkDescription || '');
        const descriptionNode = node.querySelector('.link-card-desc');
        if (descriptionNode) {
          descriptionNode.textContent = description || '这个站点还没有填写简介。';
        }
        node.dataset.linkDescription = description;

        return {
          key: node.dataset.linkKey || '',
          groupKey: node.dataset.groupKey || '',
          name: sanitizePlainText(node.dataset.linkName || ''),
          description,
          url: node.dataset.linkUrl || '',
          priority: Number(node.dataset.linkPriority || 0),
          createdAt: node.dataset.linkCreated || ''
        };
      });

      this.totalLinks = this.links.length;
    },

    setGroup(key) {
      this.activeView = 'links';
      this.selectedGroup = this.groups.some((group) => group.key === key) ? key : '';
      this.syncUrl('push');
      this.scrollMainToTop();
    },

    showBoard(scrollToTop = true) {
      this.activeView = 'board';
      this.selectedGroup = '';
      this.syncUrl('push');
      if (scrollToTop) this.scrollMainToTop();
    },

    openSubmitAssistant() {
      document.getElementById('link-submit-modal')?.showModal();
    },

    scrollMainToTop() {
      const scroller = this.$root.querySelector('.links-main-scroll')
        || this.$root.closest('[data-window-scroll]')
        || this.$root;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      scroller?.scrollTo?.({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    },

    applyLocationState(canonicalize = false) {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const requestedView = url.searchParams.get('view') || '';
      const requestedGroup = url.searchParams.get('group') || '';
      const validGroup = requestedGroup && this.groups.some((group) => group.key === requestedGroup);
      let needsCanonicalUrl = Boolean(requestedView && requestedView !== 'board');

      if (requestedView === 'board') {
        this.activeView = 'board';
        this.selectedGroup = '';
        needsCanonicalUrl = needsCanonicalUrl || url.searchParams.has('group');
      } else {
        this.activeView = 'links';
        this.selectedGroup = validGroup ? requestedGroup : '';
        needsCanonicalUrl = needsCanonicalUrl
          || (url.searchParams.has('group') && !validGroup);
      }

      if (canonicalize && needsCanonicalUrl) this.syncUrl('replace');
    },

    syncUrl(mode = 'push') {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (this.activeView === 'board') {
        url.searchParams.set('view', 'board');
        url.searchParams.delete('group');
      } else {
        url.searchParams.delete('view');
        if (this.selectedGroup) {
          url.searchParams.set('group', this.selectedGroup);
        } else {
          url.searchParams.delete('group');
        }
      }

      const target = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (target === current) return;
      const method = mode === 'replace' ? 'replaceState' : 'pushState';
      window.history[method](window.history.state, '', target);
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

    resultSummary() {
      const count = this.visibleCount();
      if (this.searchQuery.trim()) return `${count} 个搜索结果`;
      if (this.selectedGroup) return `${count} 个友链`;
      return `共 ${this.totalLinks} 个友链`;
    },

    emptyTitle() {
      return this.searchQuery.trim() ? '没有匹配的友链' : '该分组暂无友链';
    },

    emptyText() {
      if (this.searchQuery.trim()) return `换一个关键词，或者回到${this.allLinksTitle}继续浏览。`;
      return `这个分组还没有收录站点，可以返回${this.allLinksTitle}继续浏览。`;
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
      logo: '',
      platform: ''
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
    autofillAttempted: false,
    autofillAvailable: false,
    autofillController: null,
    autofillGeneration: 0,
    autofillSnapshot: null,
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

      this.clearStaleAutofill(normalized);
      this.previewVisible = true;
      this.result.show = false;
      this.applyManualDraft(normalized);
      this.result = {
        show: true,
        success: true,
        message: this.isDirectSubmitMode() ? '已保留网址，请补充站点信息后提交' : '已保留网址，请补充信息后复制到留言板'
      };
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

      this.clearStaleAutofill(normalized);
      this.fetchingMeta = true;
      this.previewVisible = true;
      this.result.show = false;
      const controller = new AbortController();
      const generation = ++this.autofillGeneration;
      this.autofillController = controller;
      let timedOut = false;
      const timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SITE_METADATA_TIMEOUT_MS);
      const isLatest = () => !this.destroyed
        && generation === this.autofillGeneration
        && normalizeUrl(this.form.url) === normalized;
      const isCurrent = () => !controller.signal.aborted && isLatest();

      try {
        const detail = await fetchSiteMetadata(normalized, controller.signal);
        if (!isCurrent()) return;
        this.detail = {
          displayName: detail?.title || readableHost(normalized) || '待确认站点',
          description: detail?.description || '',
          logo: detail?.logo || '',
          platform: detail?.platform || ''
        };
        this.autofillAvailable = true;
        this.syncFormFromDetail(normalized, true);
        this.form.rssUrl = detail?.rssUrl || this.form.rssUrl;
        this.autofillSnapshot = {
          url: normalized,
          displayName: this.form.displayName,
          description: this.form.description,
          logo: this.form.logo,
          rssUrl: this.form.rssUrl
        };
        this.markdown = this.buildMarkdown(normalized);
        this.result = {
          show: true,
          success: true,
          message: this.detail.platform
            ? `已在浏览器中识别站点信息（${this.detail.platform}），请确认后提交`
            : '已在浏览器中识别站点信息，请确认后提交'
        };
      } catch (_error) {
        if (!isLatest()) return;
        if (_error?.name === 'AbortError' && !timedOut) return;
        if (timedOut) _error.code = 'timeout';
        warnApiCall('links', '浏览器读取友链站点失败，已切换手动填写', {
          endpoint: normalized,
          url: normalized,
          message: _error?.message || String(_error || ''),
          action: 'generate-manual-draft',
          hint: '目标站点可能限制跨域读取；保留网址并提示访客手动补充。'
        });
        this.autofillAvailable = false;
        this.applyManualDraft(normalized);
        this.result = {
          show: true,
          success: false,
          warning: true,
          message: formatMetadataFailure(_error)
        };
      } finally {
        globalThis.clearTimeout(timeoutId);
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
        logo: '',
        platform: ''
      };
      this.syncFormFromDetail(url, false);
      this.markdown = this.buildMarkdown(url);
    },

    clearStaleAutofill(url) {
      const snapshot = this.autofillSnapshot;
      if (!snapshot || snapshot.url === url) return;
      for (const field of ['displayName', 'description', 'logo', 'rssUrl']) {
        if (this.form[field] === snapshot[field]) this.form[field] = '';
      }
      this.autofillSnapshot = null;
      this.autofillAvailable = false;
      this.detail = {
        displayName: '',
        description: '',
        logo: '',
        platform: ''
      };
    },

    syncFormFromDetail(url, preferDetail = true) {
      this.form.url = url;
      if (preferDetail) {
        this.form.displayName = this.detail.displayName || this.form.displayName;
        this.form.description = this.detail.description || this.form.description;
        this.form.logo = this.detail.logo || this.form.logo;
        return;
      }
      this.form.displayName = this.form.displayName || this.detail.displayName;
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
