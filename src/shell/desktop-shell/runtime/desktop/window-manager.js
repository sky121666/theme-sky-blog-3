/**
 * 全局窗口状态管理 Store + 菜单栏 + 主题 + Dock + macOS 26 通知中心控制器
 */

import { resolveThemeMode, applyRootThemeState, runThemeTransition } from '../shared/theme.js';
import { openSearchWidget } from './search.js';
import { runGenieAnimation } from './window.js';
import { createLogger } from '../shared/debug.js';
import { parseDesktopLayoutPayload, mergeDesktopWidgetLayout } from '../widgets/persistence-read.js';
import { getWidgetCatalogEntry, normalizeWidgetAppearance, normalizeWidgetInstance } from '../widgets/catalog-core.js';
import {
  ensureWidgetRendererRuntime,
  renderWidgetBodyWithHost,
  renderWidgetLoadingMarkup
} from '../widgets/render-runtime.js';
import { syncHomeDesktopWidgetProtocolFromResponse } from '../widgets/protocol.js';
import { createNotificationCenterMotion } from './notification-center-motion.js';
import { enhanceDoubanShowcaseWidgets } from '../../../../widgets/plugin/douban-showcase/runtime.js';

const { log: wmLog } = createLogger('window');
const HEADER_MOBILE_BREAKPOINT = 640;
const MENUBAR_RUNTIME_SYNC_EVENT = 'theme:menubar-settings-change';
const LOCAL_NOTIFICATION_WIDGETS = new Set(['system.clock', 'system.calendar', 'system.weather']);
const HEADER_TIME_PRESETS = new Set([
  'time-only',
  'time-seconds',
  'date-time',
  'weekday-date-time',
  'month-day-weekday-time'
]);

function parseBooleanData(value, fallback = false) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeHourCycle(value) {
  return String(value) === '24' ? '24' : '12';
}

function normalizeTimePreset(value, fallback = 'time-only') {
  return HEADER_TIME_PRESETS.has(value) ? value : fallback;
}

function formatDayPeriod(hours) {
  return hours < 12 ? '上午' : '下午';
}

function formatHeaderTime(date, preset, hourCycle) {
  const now = date instanceof Date ? date : new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const is24Hour = hourCycle === '24';
  const rawHours = now.getHours();
  const hourNumber = is24Hour ? rawHours : (rawHours % 12 || 12);
  const hourText = is24Hour ? String(hourNumber).padStart(2, '0') : String(hourNumber);
  const dayPeriod = is24Hour ? '' : `${formatDayPeriod(rawHours)} `;
  const timeText = `${dayPeriod}${hourText}:${minutes}`;
  const timeWithSecondsText = `${timeText}:${seconds}`;
  const dateText = `${month}月${day}日`;

  switch (preset) {
    case 'time-seconds':
      return timeWithSecondsText;
    case 'date-time':
      return `${dateText} ${timeText}`;
    case 'weekday-date-time':
      return `${weekday} ${dateText} ${timeText}`;
    case 'month-day-weekday-time':
      return `${dateText} ${weekday} ${timeText}`;
    case 'time-only':
    default:
      return timeText;
  }
}

function getDesktopWidgetProtocol() {
  return window.__THEME_DESKTOP_PROTOCOL__?.widgets || window.__THEME_WIDGETS__ || {};
}

function normalizeWeatherCityName(value) {
  return String(value || '').trim();
}

function notificationWeatherEntryKey(cityName) {
  return normalizeWeatherCityName(cityName).toLowerCase();
}

const NOTIFICATION_PAGE_SIZE = 50;
const NOTIFICATION_GROUP_PAGE_SIZE = 10;
const HALO_ANONYMOUS_USERNAME = 'anonymousUser';
const USER_ENDPOINT = '/apis/api.console.halo.run/v1alpha1/users/-';
const NOTIFICATION_ENDPOINT = '/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications';
const NOTIFICATION_MARK_READ_ENDPOINT = '/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications/{name}/mark-as-read';
const NOTIFICATION_DELETE_ENDPOINT = '/apis/api.notification.halo.run/v1alpha1/userspaces/{username}/notifications/{name}';

function stripHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function firstLinkFromHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  return template.content.querySelector('a[href]')?.getAttribute('href') || '';
}

export function normalizeNotificationHref(value = '', baseOrigin = '', siteOrigin = '') {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  try {
    const origin = new URL(baseOrigin || window.location.origin).origin;
    const url = new URL(raw, `${origin}/`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    let siteHost = '';
    try {
      siteHost = siteOrigin ? new URL(siteOrigin, `${origin}/`).host : '';
    } catch (_error) {
      siteHost = '';
    }
    const belongsToCurrentSite = url.origin === origin || (siteHost && url.host === siteHost);
    return belongsToCurrentSite ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch (_error) {
    return '';
  }
}

export function isNotificationPjaxHref(value = '', baseOrigin = '') {
  try {
    const origin = new URL(baseOrigin || window.location.origin).origin;
    const url = new URL(value, `${origin}/`);
    if (url.origin !== origin) return false;
    const hardNavigationPrefixes = [
      '/apis',
      '/console',
      '/login',
      '/logout',
      '/oauth2',
      '/system',
      '/uc'
    ];
    return !hardNavigationPrefixes.some((prefix) => (
      url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    ));
  } catch (_error) {
    return false;
  }
}

export function formatNotificationTime(value, nowValue = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date(nowValue);
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}小时前`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}天前`;

  if (date.getFullYear() !== now.getFullYear()) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatNotificationTimeTitle(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hours}:${minutes}`;
}

function isJsonResponse(response) {
  return (response.headers.get('content-type') || '').includes('application/json');
}

async function resolveCurrentUsername(signal) {
  const response = await fetch(new URL(USER_ENDPOINT, window.location.origin), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  });

  if (response.status === 401 || response.status === 403 || response.redirected) {
    return { status: 'unauthenticated' };
  }
  if (!response.ok || !isJsonResponse(response)) {
    return { status: response.status === 404 ? 'unsupported' : 'error' };
  }

  const data = await response.json();
  const username = data?.user?.metadata?.name || data?.metadata?.name || '';
  if (!username || username === HALO_ANONYMOUS_USERNAME || data?.user?.spec?.disabled === true) {
    return { status: 'unauthenticated' };
  }
  return { status: 'authenticated', username };
}

export function buildUserNotificationUrl(username, {
  unreadOnly = false,
  page = 1,
  pageSize = NOTIFICATION_PAGE_SIZE
} = {}) {
  const path = NOTIFICATION_ENDPOINT.replace('{username}', encodeURIComponent(username));
  const url = new URL(path, window.location.origin);
  url.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
  url.searchParams.set('size', String(pageSize));
  if (unreadOnly) {
    url.searchParams.set('fieldSelector', 'spec.unread=true');
  }
  url.searchParams.append('sort', 'metadata.creationTimestamp,desc');
  return url;
}

function buildMarkNotificationReadUrl(username, notificationName) {
  const path = NOTIFICATION_MARK_READ_ENDPOINT
    .replace('{username}', encodeURIComponent(username))
    .replace('{name}', encodeURIComponent(notificationName));
  return new URL(path, window.location.origin);
}

function buildDeleteNotificationUrl(username, notificationName) {
  const path = NOTIFICATION_DELETE_ENDPOINT
    .replace('{username}', encodeURIComponent(username))
    .replace('{name}', encodeURIComponent(notificationName));
  return new URL(path, window.location.origin);
}

function normalizeNotificationType(item = {}) {
  const spec = item.spec || {};
  const rawType = spec.reasonType
    || spec.reason?.type
    || item.reasonType
    || item.reason?.type
    || '';
  const source = `${rawType} ${spec.title || ''} ${stripHtml(spec.rawContent || '')} ${stripHtml(spec.htmlContent || '')}`.toLowerCase();

  if (/moment|瞬间/.test(source)) return { key: 'moments', label: '瞬间互动', icon: 'icon-[lucide--message-circle]' };
  if (/comment|reply|review|评论|回复|留言|审核/.test(source)) return { key: 'comments', label: '评论回复', icon: 'icon-[lucide--messages-square]' };
  if (/post|article|content|文章|内容|发布|投稿/.test(source)) return { key: 'content', label: '内容动态', icon: 'icon-[lucide--newspaper]' };
  if (/user|auth|login|account|用户|登录|账户|账号/.test(source)) return { key: 'account', label: '账号通知', icon: 'icon-[lucide--user-round]' };
  if (/system|console|系统|后台/.test(source)) return { key: 'system', label: '系统通知', icon: 'icon-[lucide--bell]' };
  if (/plugin|extension|插件|扩展/.test(source)) return { key: 'plugin', label: '插件通知', icon: 'icon-[lucide--blocks]' };
  return { key: 'other', label: '其他通知', icon: 'icon-[lucide--inbox]' };
}

function compactAccountNotificationBody(text, title) {
  const titleStem = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*上登录[。.]?$/u, '');
  let detail = String(text || '').replace(/\s+/g, ' ').trim();

  if (titleStem && detail.startsWith(titleStem)) {
    detail = detail.slice(titleStem.length).replace(/^\s*的\s*/u, '').trim();
  }

  const client = detail.match(/^(.+?)\s*上登录(?:[：:。.]|\s|$)/u)?.[1]?.trim() || '';
  const timeText = detail.match(/时间\s*[：:]\s*(.+?)(?=\s+IP\s*地址\s*[：:]|$)/iu)?.[1]?.trim() || '';
  const compactTimeMatch = timeText.match(/\d{4}-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/u);
  const compactTime = compactTimeMatch
    ? `${compactTimeMatch[1]}/${compactTimeMatch[2]} ${compactTimeMatch[3]}`
    : timeText;
  const ipAddress = detail.match(/IP\s*地址\s*[：:]\s*([^\s，,。]+)/iu)?.[1]?.trim() || '';
  const summary = [client, compactTime, ipAddress].filter(Boolean);

  return summary.length > 0 ? summary.join(' · ') : detail;
}

function compactNotificationBody(text, title = '', typeKey = '') {
  let normalized = String(text || '').replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/^@?\S+\s*你好[：:]\s*/u, '').trim();
  const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim();

  if (typeKey === 'account') {
    normalized = compactAccountNotificationBody(normalized, normalizedTitle);
  }

  if (normalizedTitle && normalized.startsWith(normalizedTitle)) {
    normalized = normalized.slice(normalizedTitle.length).replace(/^[，,。.\s：:]+/, '').trim();
  }
  return normalized === normalizedTitle ? '' : normalized;
}

function normalizeNotification(item = {}) {
  const spec = item.spec || {};
  const html = spec.htmlContent || '';
  const raw = spec.rawContent || '';
  const type = normalizeNotificationType(item);
  const text = stripHtml(html) || stripHtml(raw) || spec.title || '通知';
  const title = spec.title || type.label;
  const createdAt = item.metadata?.creationTimestamp || '';
  const createdAtMs = Date.parse(createdAt) || 0;
  return {
    id: item.metadata?.name || '',
    key: item.metadata?.name || `notification-${Math.random().toString(36).slice(2)}`,
    typeKey: type.key,
    typeLabel: type.label,
    icon: type.icon,
    title,
    body: compactNotificationBody(text, title, type.key),
    href: normalizeNotificationHref(
      firstLinkFromHtml(html),
      window.location.origin,
      getDesktopWidgetProtocol().siteUrl
    ),
    unread: spec.unread === true,
    dismissed: false,
    createdAt,
    createdAtMs,
    time: formatNotificationTime(createdAt),
    timeTitle: formatNotificationTimeTitle(createdAt)
  };
}

function groupNotifications(items) {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.typeKey)) {
      groups.set(item.typeKey, {
        key: item.typeKey,
        label: item.typeLabel,
        icon: item.icon,
        unreadCount: 0,
        latestAtMs: 0,
        items: []
      });
    }
    const group = groups.get(item.typeKey);
    group.items.push(item);
    group.latestAtMs = Math.max(group.latestAtMs, item.createdAtMs || 0);
    if (item.unread) group.unreadCount += 1;
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((left, right) => (
        Number(right.unread) - Number(left.unread)
        || (right.createdAtMs || 0) - (left.createdAtMs || 0)
      ))
    }))
    .sort((left, right) => (
      right.unreadCount - left.unreadCount
      || (right.latestAtMs || 0) - (left.latestAtMs || 0)
      || left.label.localeCompare(right.label, 'zh-CN')
    ));
}

function normalizeNotificationCenterWidgets(widgets = []) {
  return widgets
    .filter((widget) => !widget.hidden && widget.surface === 'notification-center')
    .sort((left, right) => (left.order || 0) - (right.order || 0))
    .map((widget, index) => normalizeWidgetInstance(widget, index));
}

function resolveNotificationWidgets(sourceWidgets = null) {
  if (Array.isArray(sourceWidgets)) {
    return normalizeNotificationCenterWidgets(sourceWidgets);
  }

  const protocol = getDesktopWidgetProtocol();
  const layout = parseDesktopLayoutPayload(protocol.serverLayoutJson, protocol.layoutVersion || 'v1', 'server');
  const widgets = layout ? mergeDesktopWidgetLayout([], layout) : [];
  return normalizeNotificationCenterWidgets(widgets);
}

export function registerWindowManager(Alpine) {
  // =========== 主题管理 ===========
  Alpine.store('theme', {
    mode: 'system',
    isDark: false,

    init() {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.mode === 'system') {
          this.applyTheme();
        }
      });

      this.refresh();

      window.addEventListener('pageshow', () => {
        this.refresh();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refresh();
        }
      });

      document.addEventListener('pjax:complete', () => {
        this.refresh();
      });
    },

    setMode(newMode) {
      this.mode = newMode;
      localStorage.setItem('theme', newMode);
      runThemeTransition(() => {
        this.applyTheme();
      });
    },

    refresh() {
      this.mode = resolveThemeMode();
      this.applyTheme();
    },

    applyTheme() {
      this.isDark = applyRootThemeState(this.mode, this.mediaQuery);
    }
  });

  // =========== 菜单栏 ===========
  Alpine.data('menuBar', () => ({
    timeStr: '',
    appName: '',
    themeSettingEnabled: true,
    searchAvailable: false,
    searchEnabled: true,
    authEnabled: true,
    loginLabel: '登录',
    mobileMenuAvailable: false,
    mobileMenuEnabled: true,
    mobileMenuOpen: false,
    timeEnabled: true,
    timeDesktopPreset: 'month-day-weekday-time',
    timeMobilePreset: 'time-only',
    timeHourCycle: '12',
    notificationCenterTitle: '通知中心',
    notificationCenterGuestTitle: '小组件',
    notificationCenterDefaultOpen: false,
    notificationCenterDefaultOpenConsumed: false,
    notificationCenterAuthenticated: false,
    notificationCenterAuthResolved: false,
    notificationCenterOpen: false,
    notificationCenterVisible: false,
    notificationCenterAnimating: false,
    notificationCenterMotionPhase: 'idle',
    notificationMotionToken: 0,
    notificationMotion: null,
    notificationStatus: 'idle',
    notificationStatusText: '',
    notificationLoading: false,
    notificationLoadingStatusTimer: null,
    notificationLoaded: false,
    notificationController: null,
    notificationMoreController: null,
    notificationUsername: '',
    notificationItems: [],
    notificationGroups: [],
    notificationExpandedGroupKey: '',
    notificationGroupDisplayLimits: {},
    notificationGroupMenuKey: '',
    notificationGroupConfirmKey: '',
    notificationGroupActionBusyKey: '',
    notificationLoadedCount: 0,
    notificationHasMore: false,
    notificationNextPage: 2,
    notificationLoadingMore: false,
    notificationLoadMoreError: '',
    notificationUnreadCount: 0,
    notificationTotalCount: 0,
    notificationShowRead: false,
    notificationFilterSwitching: false,
    notificationFilterMotionToken: 0,
    notificationGroupMotionToken: 0,
    notificationMarkingAllRead: false,
    notificationOpenGeneration: 0,
    notificationOpenScrollPending: false,
    notificationCenterRestoreFocusEl: null,
    notificationNavigationClosePromise: null,
    notificationWidgets: [],
    draggingWidgetKey: null,
    notificationWidgetDraftWidgets: null,
    notificationWidgetRenderers: {},
    notificationWidgetRendererPromises: {},
    notificationWidgetRenderVersions: {},
    notificationWidgetHtmlCache: new Map(),
    notificationWidgetRenderTick: 0,
    notificationWidgetDataStatus: 'idle',
    notificationWidgetDataPromise: null,
    notificationWidgetDataController: null,
    notificationWidgetEnhanceScheduled: false,
    notificationWidgetEnhanceRafId: 0,
    notificationWidgetDropPreview: {
      active: false,
      top: 0,
      left: 0,
      width: 0,
      height: 0
    },
    notificationWeatherRuntimePromise: null,
    notificationWeatherRequestId: 0,
    notificationWeatherState: {
      loading: false,
      error: '',
      data: null,
      entries: {}
    },
    init() {
      const dataset = this.$el?.dataset || {};
      this.appName = dataset.siteTitle || '';
      this.themeSettingEnabled = parseBooleanData(dataset.themeSettingEnabled, true);
      this.searchAvailable = parseBooleanData(dataset.searchAvailable, false);
      this.searchEnabled = parseBooleanData(dataset.searchEnabled, true);
      this.authEnabled = parseBooleanData(dataset.authEnabled, true);
      this.loginLabel = String(dataset.loginLabel || '').trim() || '登录';
      this.mobileMenuAvailable = parseBooleanData(dataset.hasMenu, false);
      this.mobileMenuEnabled = parseBooleanData(dataset.mobileMenuEnabled, true);
      this.timeEnabled = parseBooleanData(dataset.timeEnabled, true);
      this.timeDesktopPreset = normalizeTimePreset(dataset.timeDesktopPreset, 'month-day-weekday-time');
      this.timeMobilePreset = normalizeTimePreset(dataset.timeMobilePreset, 'time-only');
      this.timeHourCycle = normalizeHourCycle(dataset.timeHourCycle);
      this.notificationCenterTitle = String(dataset.notificationCenterTitle || '').trim() || '通知中心';
      this.notificationCenterGuestTitle = String(dataset.notificationCenterGuestTitle || '').trim() || '小组件';
      this.notificationCenterDefaultOpen = parseBooleanData(dataset.notificationCenterDefaultOpen, false);
      this.notificationCenterAuthenticated = parseBooleanData(dataset.notificationCenterAuthenticated, false);
      this.notificationCenterAuthResolved = true;
      this.notificationMotion = createNotificationCenterMotion();
      this.notificationWidgetDataStatus = getDesktopWidgetProtocol().isHome === true ? 'ready' : 'idle';

      this.tick();
      this.tickTimer = window.setInterval(() => this.tick(), 1000);
      this.syncNotificationWidgets();
      this.handleResize = () => {
        this.tick();
        if (window.innerWidth >= HEADER_MOBILE_BREAKPOINT) {
          this.closeMobileMenu();
        }
      };
      this.handlePjaxComplete = () => {
        this.closeMobileMenu();
        if (getDesktopWidgetProtocol().isHome === true) {
          this.notificationWidgetDataStatus = 'ready';
        }
        this.syncNotificationWidgets();
        this.tick();
      };
      this.handleMenubarClose = () => {
        this.closeMobileMenu();
        this.closeNotificationCenter();
      };
      this.handleNotificationWidgetsChange = (event) => {
        const beforeRects = this.captureNotificationWidgetRects();
        // Widget HTML also depends on the persistent desktop protocol sources.
        // A home-response hydration can keep the same widget instances while
        // replacing all Finder/plugin data, so the old markup is not reusable.
        this.notificationWidgetHtmlCache.clear();
        this.notificationWidgetRenderTick += 1;
        if (getDesktopWidgetProtocol().isHome === true) {
          this.notificationWidgetDataStatus = 'ready';
        }
        this.syncNotificationWidgets(event.detail?.widgets, { beforeRects });
      };
      this.handleNotificationCenterOpen = () => {
        this.openNotificationCenter();
      };
      this.handleMenubarSettingsChange = (event) => {
        const detail = event.detail || {};
        this.appName = String(detail.appName || '').trim();
        this.themeSettingEnabled = detail.themeSettingEnabled !== false;
        this.searchEnabled = detail.searchEnabled !== false;
        this.authEnabled = detail.authEnabled !== false;
        this.loginLabel = String(detail.loginLabel || '').trim() || '登录';
        this.mobileMenuEnabled = detail.mobileMenuEnabled !== false;
        this.timeEnabled = detail.timeEnabled !== false;
        this.timeDesktopPreset = normalizeTimePreset(
          detail.timeDesktopPreset,
          this.timeDesktopPreset
        );
        this.timeMobilePreset = normalizeTimePreset(
          detail.timeMobilePreset,
          this.timeMobilePreset
        );
        this.timeHourCycle = normalizeHourCycle(detail.timeHourCycle);
        this.notificationCenterTitle = String(detail.notificationCenterTitle || '').trim() || '通知中心';
        this.notificationCenterGuestTitle = String(detail.notificationCenterGuestTitle || '').trim() || '小组件';
        this.notificationCenterDefaultOpen = detail.notificationCenterDefaultOpen === true;
        if (!this.mobileMenuEnabled) {
          this.closeMobileMenu();
        }
        this.tick();
      };
      this.handleNotificationDropState = (event) => {
        const active = event.detail?.active === true;
        this.notificationWidgetDropPreview = {
          active,
          top: Number.isFinite(Number(event.detail?.top)) ? Number(event.detail.top) : 0,
          left: Number.isFinite(Number(event.detail?.left)) ? Number(event.detail.left) : 0,
          width: Number.isFinite(Number(event.detail?.width)) ? Number(event.detail.width) : 0,
          height: Number.isFinite(Number(event.detail?.height)) ? Number(event.detail.height) : 0
        };
        this.notificationMotion?.setDropActive(
          this.$refs.notificationCenterPanel,
          active
        );
      };
      this.handleWidgetDragState = (event) => {
        const active = event.detail?.active === true;
        this.draggingWidgetKey = active ? event.detail?.key || null : null;
      };
      this.handleEscape = (event) => {
        if (event.key === 'Escape') {
          this.closeMobileMenu();
          if (this.notificationGroupMenuKey) {
            this.closeNotificationGroupMenu();
            return;
          }
          this.closeNotificationCenter();
        }
      };
      this.handleNotificationWidgetDragStart = (event) => {
        this.draggingWidgetKey = event.detail?.widget?.key;
      };
      this.handleNotificationWidgetDragEnd = () => {
        this.draggingWidgetKey = null;
      };
      window.addEventListener('resize', this.handleResize);
      document.addEventListener('pjax:complete', this.handlePjaxComplete);
      window.addEventListener('theme-menubar-close', this.handleMenubarClose);
      window.addEventListener('theme-notification-widgets-change', this.handleNotificationWidgetsChange);
      window.addEventListener('theme-notification-center-open', this.handleNotificationCenterOpen);
      window.addEventListener(MENUBAR_RUNTIME_SYNC_EVENT, this.handleMenubarSettingsChange);
      window.addEventListener('theme-notification-widget-drop-state', this.handleNotificationDropState);
      window.addEventListener('theme-notification-widget-drag-start', this.handleNotificationWidgetDragStart);
      window.addEventListener('theme-notification-widget-drag-end', this.handleNotificationWidgetDragEnd);
      window.addEventListener('theme-widget-drag-state', this.handleWidgetDragState);
      window.addEventListener('keydown', this.handleEscape);

      this.$nextTick(() => {
        if (!this.notificationCenterDefaultOpen || this.notificationCenterDefaultOpenConsumed) return;
        this.notificationCenterDefaultOpenConsumed = true;
        void this.openNotificationCenter({ defaultOpen: true });
      });
    },
    destroy() {
      this.notificationOpenGeneration += 1;
      window.removeEventListener('resize', this.handleResize);
      document.removeEventListener('pjax:complete', this.handlePjaxComplete);
      window.removeEventListener('theme-menubar-close', this.handleMenubarClose);
      window.removeEventListener('theme-notification-widgets-change', this.handleNotificationWidgetsChange);
      window.removeEventListener('theme-notification-center-open', this.handleNotificationCenterOpen);
      window.removeEventListener(MENUBAR_RUNTIME_SYNC_EVENT, this.handleMenubarSettingsChange);
      window.removeEventListener('theme-notification-widget-drop-state', this.handleNotificationDropState);
      window.removeEventListener('theme-notification-widget-drag-start', this.handleNotificationWidgetDragStart);
      window.removeEventListener('theme-notification-widget-drag-end', this.handleNotificationWidgetDragEnd);
      window.removeEventListener('theme-widget-drag-state', this.handleWidgetDragState);
      window.removeEventListener('keydown', this.handleEscape);
      if (this.tickTimer) {
        window.clearInterval(this.tickTimer);
      }
      if (this.notificationWidgetEnhanceRafId) {
        window.cancelAnimationFrame(this.notificationWidgetEnhanceRafId);
      }
      this.notificationController?.abort();
      this.notificationMoreController?.abort();
      this.notificationWidgetDataController?.abort();
      this.notificationMotion?.destroy();
      document.body.classList.remove('notification-center-open');
    },
    openSearch() {
      if (!this.searchEnabled) return;
      this.closeMobileMenu();
      openSearchWidget();
    },
    toggleMobileMenu() {
      if (!this.mobileMenuEnabled) return;
      this.mobileMenuOpen = !this.mobileMenuOpen;
    },
    closeMobileMenu() {
      this.mobileMenuOpen = false;
    },
    toggleNotificationCenter() {
      if (this.notificationCenterOpen) {
        void this.closeNotificationCenter();
        return;
      }
      void this.openNotificationCenter();
    },
    resetNotificationCollection() {
      this.notificationMoreController?.abort();
      this.notificationItems = [];
      this.notificationGroups = [];
      this.notificationExpandedGroupKey = '';
      this.notificationGroupDisplayLimits = {};
      this.notificationGroupMenuKey = '';
      this.notificationGroupConfirmKey = '';
      this.notificationLoadedCount = 0;
      this.notificationHasMore = false;
      this.notificationNextPage = 2;
      this.notificationLoadingMore = false;
      this.notificationLoadMoreError = '';
      this.notificationUnreadCount = 0;
      this.notificationTotalCount = 0;
    },
    async openNotificationCenter(_options = {}) {
      this.closeMobileMenu();
      this.syncNotificationWidgets();
      void this.ensureNotificationWidgetData();
      if (this.notificationCenterOpen && this.notificationCenterVisible) {
        if (this.notificationCenterAuthenticated) {
          void this.loadNotifications();
        }
        return;
      }
      const activeElement = document.activeElement;
      this.notificationCenterRestoreFocusEl = activeElement && activeElement !== document.body
        ? activeElement
        : this.$refs.notificationCenterTrigger || null;
      const token = ++this.notificationMotionToken;
      this.notificationExpandedGroupKey = '';
      this.notificationGroupDisplayLimits = {};
      this.notificationGroupMenuKey = '';
      this.notificationGroupConfirmKey = '';
      this.notificationOpenScrollPending = true;
      this.notificationCenterOpen = true;
      this.notificationCenterVisible = true;
      this.notificationCenterAnimating = true;
      this.notificationCenterMotionPhase = 'opening';
      document.body.classList.add('notification-center-open');
      await this.$nextTick();
      if (this.$refs.notificationCenterScroll) {
        this.$refs.notificationCenterScroll.scrollTop = 0;
      } else if (this.$refs.notificationCenterPanel) {
        this.$refs.notificationCenterPanel.scrollTop = 0;
      }
      this.$refs.notificationCenterClose?.focus?.({ preventScroll: true });
      if (this.notificationCenterAuthenticated || !this.notificationCenterAuthResolved) {
        void this.loadNotifications();
      } else {
        this.resetNotificationCollection();
        this.notificationLoaded = true;
        this.notificationUsername = '';
        this.setNotificationState('guest', '');
      }
      await this.notificationMotion?.open(this.$refs.notificationCenterPanel);
      if (token !== this.notificationMotionToken) return;
      this.notificationCenterAnimating = false;
      this.notificationCenterMotionPhase = 'idle';
    },
    async closeNotificationCenter() {
      if (!this.notificationCenterVisible && !this.notificationCenterOpen) return;
      const token = ++this.notificationMotionToken;
      this.notificationGroupMotionToken += 1;
      this.notificationOpenScrollPending = false;
      this.notificationGroupMenuKey = '';
      this.notificationGroupConfirmKey = '';
      this.notificationCenterOpen = false;
      this.notificationCenterAnimating = true;
      this.notificationCenterMotionPhase = 'closing';
      await this.$nextTick();
      await this.notificationMotion?.close(this.$refs.notificationCenterPanel);
      if (token !== this.notificationMotionToken) return;
      this.notificationCenterVisible = false;
      this.notificationCenterAnimating = false;
      this.notificationCenterMotionPhase = 'idle';
      if (this.notificationLoadingStatusTimer) {
        window.clearTimeout(this.notificationLoadingStatusTimer);
        this.notificationLoadingStatusTimer = null;
      }
      document.body.classList.remove('notification-center-open');
      const restoreTarget = this.notificationCenterRestoreFocusEl;
      this.notificationCenterRestoreFocusEl = null;
      if (restoreTarget?.isConnected && typeof restoreTarget.focus === 'function') {
        restoreTarget.focus({ preventScroll: true });
      }
    },
    handleNotificationScroll() {
      const scrollEl = this.$refs.notificationCenterScroll;
      if (this.notificationOpenScrollPending && scrollEl?.scrollTop > 1) {
        this.notificationOpenScrollPending = false;
      }
    },
    notificationFocusableElements() {
      const panel = this.$refs.notificationCenterPanel;
      if (!panel) return [];
      return Array.from(panel.querySelectorAll([
        'button:not([disabled])',
        'a[href]',
        '[role="link"][tabindex="0"]',
        '[role="button"][tabindex="0"]',
        '[tabindex]:not([tabindex="-1"])'
      ].join(','))).filter((element) => (
        element.getAttribute('aria-hidden') !== 'true'
        && element.getClientRects().length > 0
      ));
    },
    handleNotificationFocusTrap(event) {
      if (event.key !== 'Tab' || !this.notificationCenterVisible) return;
      const focusable = this.notificationFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        this.$refs.notificationCenterPanel?.focus?.({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !this.$refs.notificationCenterPanel?.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !this.$refs.notificationCenterPanel?.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    },
    setNotificationState(status, text = '') {
      this.notificationStatus = status;
      this.notificationStatusText = text;
    },
    notificationCenterDisplayTitle() {
      if (!this.notificationCenterAuthResolved || this.notificationCenterAuthenticated) {
        return this.notificationCenterTitle;
      }
      return this.notificationCenterGuestTitle;
    },
    notificationVisibleGroups() {
      if (this.notificationExpandedGroupKey) {
        return this.notificationGroups
          .filter((group) => group.key === this.notificationExpandedGroupKey)
          .filter((group) => this.notificationGroupItems(group).length > 0);
      }
      return this.notificationGroups
        .filter((group) => this.notificationGroupItems(group).length > 0);
    },
    notificationGroupItems(group) {
      return group.items.filter((item) => !item.dismissed && (this.notificationShowRead || item.unread));
    },
    notificationExpandedItems(group) {
      const limit = this.notificationGroupDisplayLimits[group?.key] || NOTIFICATION_GROUP_PAGE_SIZE;
      return this.notificationGroupItems(group).slice(0, limit);
    },
    notificationGroupRemainingCount(group) {
      return Math.max(0, this.notificationGroupItems(group).length - this.notificationExpandedItems(group).length);
    },
    showMoreNotificationGroupItems(group) {
      if (!group?.key) return;
      const current = this.notificationGroupDisplayLimits[group.key] || NOTIFICATION_GROUP_PAGE_SIZE;
      this.notificationGroupDisplayLimits = {
        ...this.notificationGroupDisplayLimits,
        [group.key]: current + NOTIFICATION_GROUP_PAGE_SIZE
      };
    },
    notificationGroupUnreadCount(group) {
      return group?.items?.filter((item) => !item.dismissed && item.unread).length || 0;
    },
    notificationGroupReadCount(group) {
      return group?.items?.filter((item) => !item.dismissed && !item.unread).length || 0;
    },
    notificationItemActionLabel(item) {
      return item?.unread ? '标为已读' : '删除此通知';
    },
    isNotificationGroupMenuOpen(group) {
      return !!group?.key && this.notificationGroupMenuKey === group.key;
    },
    toggleNotificationGroupMenu(group) {
      if (!group?.key) return;
      const nextKey = this.notificationGroupMenuKey === group.key ? '' : group.key;
      this.notificationGroupMenuKey = nextKey;
      this.notificationGroupConfirmKey = '';
    },
    closeNotificationGroupMenu() {
      this.notificationGroupMenuKey = '';
      this.notificationGroupConfirmKey = '';
    },
    requestNotificationGroupClear(group) {
      if (!group?.key || this.notificationGroupReadCount(group) <= 0) return;
      this.notificationGroupConfirmKey = group.key;
    },
    cancelNotificationGroupClear() {
      this.notificationGroupConfirmKey = '';
    },
    notificationSummaryText() {
      if (this.notificationTotalCount <= 0 && this.notificationUnreadCount <= 0) return '';
      if (this.notificationUnreadCount > 0) {
        return `${this.notificationUnreadCount} 条未读 · ${this.notificationTotalCount} 条通知`;
      }
      return this.notificationShowRead ? `${this.notificationTotalCount} 条通知` : '暂无未读通知';
    },
    notificationEmptyText() {
      if (this.notificationLoading || this.notificationStatus === 'loading') return '';
      if (!this.notificationLoaded) return '';
      if (['unauthenticated', 'unsupported', 'error'].includes(this.notificationStatus)) return '';
      if (this.notificationVisibleGroups().length > 0) return '';
      return this.notificationShowRead ? '暂无通知' : '暂无未读通知';
    },
    async setNotificationReadFilter(showRead = false) {
      const nextValue = showRead === true;
      if (this.notificationShowRead === nextValue) return;
      const token = ++this.notificationFilterMotionToken;
      this.notificationGroupMotionToken += 1;
      this.notificationMotion?.prepareFilterSwitch(this.$refs.notificationCenterPanel);
      this.notificationFilterSwitching = true;
      this.notificationShowRead = nextValue;
      this.notificationExpandedGroupKey = '';
      this.notificationGroupDisplayLimits = {};
      this.closeNotificationGroupMenu();
      await this.$nextTick();
      if (token !== this.notificationFilterMotionToken) return;
      this.notificationMotion?.finishFilterSwitch(this.$refs.notificationCenterPanel, nextValue ? 'all' : 'unread');
      window.setTimeout(() => {
        if (token === this.notificationFilterMotionToken) {
          this.notificationFilterSwitching = false;
        }
      }, 240);
    },
    toggleNotificationReadFilter() {
      this.setNotificationReadFilter(!this.notificationShowRead);
    },
    isNotificationGroupExpanded(group) {
      return !!group?.key && this.notificationExpandedGroupKey === group.key;
    },
    async openNotificationGroup(group) {
      if (!group?.key) return;
      if (this.notificationExpandedGroupKey === group.key) return;
      const token = ++this.notificationGroupMotionToken;
      this.notificationGroupDisplayLimits = {
        ...this.notificationGroupDisplayLimits,
        [group.key]: NOTIFICATION_GROUP_PAGE_SIZE
      };
      this.closeNotificationGroupMenu();
      const escapedKey = window.CSS?.escape ? CSS.escape(group.key) : group.key;
      const collapsedEl = this.$refs.notificationCenterPanel?.querySelector(
        `[data-notification-group-key="${escapedKey}"]`
      );
      await this.notificationMotion?.expandStack(collapsedEl);
      if (token !== this.notificationGroupMotionToken) return;
      this.notificationExpandedGroupKey = group.key;
      await this.$nextTick();
      if (token !== this.notificationGroupMotionToken) return;
      const expandedEl = this.$refs.notificationCenterPanel?.querySelector(
        `[data-notification-group-key="${escapedKey}"]`
      );
      await this.notificationMotion?.revealExpandedGroup(expandedEl);
    },
    async collapseNotificationGroup() {
      const activeKey = this.notificationExpandedGroupKey;
      if (!activeKey) return;
      const token = ++this.notificationGroupMotionToken;
      this.closeNotificationGroupMenu();
      const escapedKey = window.CSS?.escape ? CSS.escape(activeKey) : activeKey;
      const expandedEl = this.$refs.notificationCenterPanel?.querySelector(
        `[data-notification-group-key="${escapedKey}"]`
      );
      await this.notificationMotion?.collapseExpandedGroup(expandedEl);
      if (token !== this.notificationGroupMotionToken) return;
      this.notificationExpandedGroupKey = '';
      const nextLimits = { ...this.notificationGroupDisplayLimits };
      delete nextLimits[activeKey];
      this.notificationGroupDisplayLimits = nextLimits;
      await this.$nextTick();
      if (token !== this.notificationGroupMotionToken) return;
      const collapsedEl = this.$refs.notificationCenterPanel?.querySelector(
        `[data-notification-group-key="${escapedKey}"]`
      );
      await this.notificationMotion?.revealCollapsedGroup(collapsedEl);
    },
    toggleNotificationGroup(group) {
      if (this.isNotificationGroupExpanded(group)) {
        void this.collapseNotificationGroup();
        return;
      }
      void this.openNotificationGroup(group);
    },
    syncNotificationGroups() {
      this.notificationGroups = groupNotifications(
        this.notificationItems.filter((item) => !item.dismissed)
      );
      if (!this.notificationExpandedGroupKey) return;
      const activeGroup = this.notificationGroups.find(
        (group) => group.key === this.notificationExpandedGroupKey
      );
      if (!activeGroup || this.notificationGroupItems(activeGroup).length === 0) {
        this.notificationExpandedGroupKey = '';
        this.closeNotificationGroupMenu();
      }
    },
    async loadNotifications({ force = false, animate = false } = {}) {
      if (!this.notificationCenterAuthenticated && this.notificationCenterAuthResolved) {
        this.notificationController?.abort();
        this.notificationLoading = false;
        this.resetNotificationCollection();
        this.notificationLoaded = true;
        this.notificationUsername = '';
        this.setNotificationState('guest', '');
        return;
      }

      if (this.notificationLoading) return;
      if (this.notificationLoaded && !force) {
        this.notificationOpenScrollPending = false;
        return;
      }

      this.notificationLoading = true;
      this.notificationMoreController?.abort();
      this.notificationLoadingMore = false;
      this.notificationLoadMoreError = '';
      this.notificationController?.abort();
      this.notificationController = new AbortController();
      if (this.notificationLoadingStatusTimer) {
        window.clearTimeout(this.notificationLoadingStatusTimer);
        this.notificationLoadingStatusTimer = null;
      }
      this.setNotificationState('loading', '');
      this.notificationLoadingStatusTimer = window.setTimeout(() => {
        this.notificationLoadingStatusTimer = null;
        if (this.notificationLoading && this.notificationCenterVisible && this.notificationStatus === 'loading') {
          this.notificationStatusText = '正在加载通知...';
        }
      }, 450);

      try {
        const user = await resolveCurrentUsername(this.notificationController.signal);
        if (user.status === 'unauthenticated') {
          this.notificationCenterAuthenticated = false;
          this.notificationCenterAuthResolved = true;
          if (this.$el?.dataset) {
            this.$el.dataset.notificationCenterAuthenticated = 'false';
          }
          this.resetNotificationCollection();
          this.notificationLoaded = true;
          this.notificationUsername = '';
          this.setNotificationState('unauthenticated', '登录后查看通知');
          return;
        }
        if (user.status === 'unsupported') {
          this.notificationCenterAuthenticated = false;
          this.notificationCenterAuthResolved = true;
          if (this.$el?.dataset) {
            this.$el.dataset.notificationCenterAuthenticated = 'false';
          }
          this.resetNotificationCollection();
          this.notificationLoaded = true;
          this.notificationUsername = '';
          this.setNotificationState('unsupported', '当前 Halo 未开放用户通知接口');
          return;
        }
        if (user.status !== 'authenticated') {
          throw new Error('Unable to resolve current user');
        }

        this.notificationCenterAuthenticated = true;
        this.notificationCenterAuthResolved = true;
        if (this.$el?.dataset) {
          this.$el.dataset.notificationCenterAuthenticated = 'true';
        }
        this.notificationUsername = user.username;
        const requestOptions = {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: this.notificationController.signal
        };
        const [response, unreadResponse] = await Promise.all([
          fetch(buildUserNotificationUrl(user.username, {
            unreadOnly: false,
            page: 1,
            pageSize: NOTIFICATION_PAGE_SIZE
          }), requestOptions),
          fetch(buildUserNotificationUrl(user.username, {
            unreadOnly: true,
            page: 1,
            pageSize: 1
          }), requestOptions).catch(() => null)
        ]);

        if (response.status === 401 || response.status === 403 || response.redirected) {
          this.notificationCenterAuthenticated = false;
          this.notificationCenterAuthResolved = true;
          if (this.$el?.dataset) {
            this.$el.dataset.notificationCenterAuthenticated = 'false';
          }
          this.resetNotificationCollection();
          this.notificationLoaded = true;
          this.notificationUsername = '';
          this.setNotificationState('unauthenticated', '登录后查看通知');
          return;
        }
        if (response.status === 404) {
          this.notificationCenterAuthenticated = false;
          this.notificationCenterAuthResolved = true;
          if (this.$el?.dataset) {
            this.$el.dataset.notificationCenterAuthenticated = 'false';
          }
          this.resetNotificationCollection();
          this.notificationLoaded = true;
          this.notificationUsername = '';
          this.setNotificationState('unsupported', '当前 Halo 未开放用户通知接口');
          return;
        }
        if (!response.ok || !isJsonResponse(response)) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items.map(normalizeNotification) : [];
        const parsedTotalCount = Number(data.total);
        const totalCount = Number.isFinite(parsedTotalCount)
          ? Math.max(items.length, parsedTotalCount)
          : items.length;
        let unreadCount = items.filter((item) => item.unread).length;
        if (unreadResponse?.ok && isJsonResponse(unreadResponse)) {
          const unreadData = await unreadResponse.json();
          const parsedUnreadCount = Number(unreadData.total);
          if (Number.isFinite(parsedUnreadCount)) {
            unreadCount = Math.max(0, parsedUnreadCount);
          }
        }

        this.notificationItems = items;
        this.notificationLoadedCount = items.length;
        this.notificationHasMore = items.length < totalCount;
        this.notificationNextPage = 2;
        this.notificationLoadMoreError = '';
        this.syncNotificationGroups();
        this.notificationUnreadCount = unreadCount;
        this.notificationTotalCount = totalCount;
        this.notificationLoaded = true;
        this.setNotificationState(items.length ? 'ready' : 'empty', '');
      } catch (error) {
        if (error?.name !== 'AbortError') {
          this.setNotificationState('error', '通知加载失败，稍后重试');
          wmLog('notification center load failed', error?.message || String(error || ''));
        }
      } finally {
        if (this.notificationLoadingStatusTimer) {
          window.clearTimeout(this.notificationLoadingStatusTimer);
          this.notificationLoadingStatusTimer = null;
        }
        this.notificationLoading = false;
        if (this.notificationCenterVisible) {
          await this.$nextTick();
          const scrollEl = this.$refs.notificationCenterScroll;
          if (this.notificationOpenScrollPending && (!scrollEl || scrollEl.scrollTop <= 1)) {
            if (scrollEl) scrollEl.scrollTop = 0;
            this.notificationOpenScrollPending = false;
          }
          if (animate) {
            this.notificationMotion?.refreshContent(this.$refs.notificationCenterPanel);
          }
        }
      }
    },
    async loadMoreNotifications() {
      if (
        this.notificationLoading
        || this.notificationLoadingMore
        || !this.notificationHasMore
        || !this.notificationUsername
      ) return;

      const page = this.notificationNextPage;
      this.notificationLoadingMore = true;
      this.notificationLoadMoreError = '';
      this.notificationMoreController?.abort();
      this.notificationMoreController = new AbortController();

      try {
        const response = await fetch(buildUserNotificationUrl(this.notificationUsername, {
          unreadOnly: false,
          page,
          pageSize: NOTIFICATION_PAGE_SIZE
        }), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: this.notificationMoreController.signal
        });
        if (!response.ok || !isJsonResponse(response)) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const nextItems = Array.isArray(data.items) ? data.items.map(normalizeNotification) : [];
        const mergedItems = new Map(this.notificationItems.map((item) => [item.key, item]));
        nextItems.forEach((item) => mergedItems.set(item.key, item));
        this.notificationItems = Array.from(mergedItems.values());
        this.notificationLoadedCount = this.notificationItems.length;
        const parsedTotalCount = Number(data.total);
        if (Number.isFinite(parsedTotalCount)) {
          this.notificationTotalCount = Math.max(this.notificationLoadedCount, parsedTotalCount);
        }
        this.notificationNextPage = page + 1;
        this.notificationHasMore = (
          nextItems.length > 0
          && this.notificationLoadedCount < this.notificationTotalCount
        );
        this.syncNotificationGroups();
        await this.$nextTick();
        this.notificationMotion?.refreshContent(this.$refs.notificationCenterPanel);
      } catch (error) {
        if (error?.name !== 'AbortError') {
          this.notificationLoadMoreError = '更多通知加载失败，请重试';
          wmLog('notification center load-more failed', error?.message || String(error || ''));
        }
      } finally {
        this.notificationLoadingMore = false;
      }
    },
    async markNotificationAsRead(item) {
      if (!item?.id || !item.unread) return true;
      item.unread = false;
      this.notificationUnreadCount = Math.max(0, this.notificationUnreadCount - 1);
      this.syncNotificationGroups();
      if (!this.notificationUsername) {
        if (!this.notificationShowRead && this.notificationVisibleGroups().length === 0) {
          this.setNotificationState('empty', '暂无未读通知');
        }
        return true;
      }

      try {
        const response = await fetch(buildMarkNotificationReadUrl(this.notificationUsername, item.id), {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (!this.notificationShowRead && this.notificationVisibleGroups().length === 0) {
          this.setNotificationState('empty', '暂无未读通知');
        }
        return true;
      } catch (error) {
        item.unread = true;
        this.notificationUnreadCount += 1;
        this.syncNotificationGroups();
        this.setNotificationState('ready', '');
        wmLog('notification mark-as-read failed', error?.message || String(error || ''));
        return false;
      }
    },
    async deleteNotification(item) {
      if (!item) return false;
      item.dismissed = true;
      this.syncNotificationGroups();
      if (!this.notificationUsername || !item.id) {
        this.notificationItems = this.notificationItems.filter((entry) => entry !== item);
        this.notificationLoadedCount = Math.max(0, this.notificationLoadedCount - 1);
        this.notificationTotalCount = Math.max(0, this.notificationTotalCount - 1);
        this.notificationHasMore = this.notificationLoadedCount < this.notificationTotalCount;
        return true;
      }

      try {
        const response = await fetch(buildDeleteNotificationUrl(this.notificationUsername, item.id), {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`HTTP ${response.status}`);
        }
        this.notificationItems = this.notificationItems.filter((entry) => entry !== item);
        this.notificationLoadedCount = Math.max(0, this.notificationLoadedCount - 1);
        this.notificationTotalCount = Math.max(0, this.notificationTotalCount - 1);
        this.notificationHasMore = this.notificationLoadedCount < this.notificationTotalCount;
        this.syncNotificationGroups();
        return true;
      } catch (error) {
        wmLog('notification delete failed', error?.message || String(error || ''));
        item.dismissed = false;
        this.syncNotificationGroups();
        return false;
      }
    },
    async dismissNotification(item, event) {
      if (!item) return;
      const card = event?.currentTarget?.closest('.notification-center-card');

      if (item.unread) {
        if (!this.notificationShowRead && card) {
          await this.notificationMotion?.dismissCard(card);
        }
        const marked = await this.markNotificationAsRead(item);
        if (!marked) {
          await this.$nextTick();
          this.notificationMotion?.refreshContent(this.$refs.notificationCenterPanel);
        }
        return;
      }

      if (card) {
        await this.notificationMotion?.dismissCard(card);
      }

      const deleted = await this.deleteNotification(item);
      if (deleted && this.notificationHasMore) {
        await this.loadNotifications({ force: true });
      }
    },
    async markNotificationGroupAsRead(group, event) {
      if (!group?.key || this.notificationGroupActionBusyKey) return;
      const unreadItems = group.items.filter((item) => !item.dismissed && item.unread);
      if (unreadItems.length === 0) {
        this.closeNotificationGroupMenu();
        return;
      }
      this.notificationGroupActionBusyKey = group.key;
      const groupEl = event?.currentTarget?.closest('.notification-center-group');
      const unreadKeys = new Set(unreadItems.map((item) => item.key));
      const cards = !this.notificationShowRead && groupEl
        ? Array.from(groupEl.querySelectorAll('.notification-center-card'))
          .filter((card) => unreadKeys.has(card.dataset.notificationItemKey))
        : [];

      try {
        this.closeNotificationGroupMenu();
        if (cards.length > 0) {
          await this.notificationMotion?.dismissCards(cards);
        }
        await Promise.allSettled(unreadItems.map((item) => this.markNotificationAsRead(item)));
        this.syncNotificationGroups();
        if (!this.notificationShowRead && this.notificationVisibleGroups().length === 0) {
          this.setNotificationState('empty', '暂无未读通知');
        }
      } finally {
        this.notificationGroupActionBusyKey = '';
      }
    },
    async clearReadNotificationGroup(group, event) {
      if (
        !group?.key
        || this.notificationGroupConfirmKey !== group.key
        || this.notificationGroupActionBusyKey
      ) return;

      const readItems = group.items.filter((item) => !item.dismissed && !item.unread);
      if (readItems.length === 0) {
        this.closeNotificationGroupMenu();
        return;
      }
      this.notificationGroupActionBusyKey = group.key;
      const groupEl = event?.currentTarget?.closest('.notification-center-group');
      const readKeys = new Set(readItems.map((item) => item.key));
      const cards = this.notificationShowRead && groupEl
        ? Array.from(groupEl.querySelectorAll('.notification-center-card'))
          .filter((card) => readKeys.has(card.dataset.notificationItemKey))
        : [];

      try {
        this.closeNotificationGroupMenu();
        if (cards.length > 0) {
          await this.notificationMotion?.dismissCards(cards);
        }
        const results = await Promise.all(readItems.map((item) => this.deleteNotification(item)));
        if (results.some(Boolean) && this.notificationHasMore) {
          await this.loadNotifications({ force: true });
        }
        this.syncNotificationGroups();
      } finally {
        this.notificationGroupActionBusyKey = '';
      }
    },
    async markAllNotificationsAsRead() {
      if (this.notificationMarkingAllRead || this.notificationUnreadCount <= 0) return;
      this.notificationMarkingAllRead = true;

      const panel = this.$refs.notificationCenterPanel;
      if (panel && !this.notificationShowRead) {
        const cards = Array.from(panel.querySelectorAll('.notification-center-card.is-unread'));
        if (cards.length > 0) {
          await this.notificationMotion?.dismissCards(cards);
        }
      }

      const unreadItems = this.notificationGroups.flatMap((group) => group.items).filter((item) => item.unread);

      try {
        await Promise.allSettled(unreadItems.map((item) => this.markNotificationAsRead(item)));
        this.syncNotificationGroups();
        if (!this.notificationShowRead && this.notificationVisibleGroups().length === 0) {
          this.setNotificationState('empty', '暂无未读通知');
        }
      } finally {
        this.notificationMarkingAllRead = false;
      }
    },
    async openNotificationItem(item, _event) {
      const href = normalizeNotificationHref(
        item?.href,
        window.location.origin,
        getDesktopWidgetProtocol().siteUrl
      );
      if (!href) return;
      const generation = ++this.notificationOpenGeneration;
      const markReadPromise = this.markNotificationAsRead(item);
      if (!this.notificationNavigationClosePromise) {
        const closePromise = Promise.resolve(this.closeNotificationCenter());
        const navigationClosePromise = closePromise.finally(() => {
          if (this.notificationNavigationClosePromise === navigationClosePromise) {
            this.notificationNavigationClosePromise = null;
          }
        });
        this.notificationNavigationClosePromise = navigationClosePromise;
      }
      const closePromise = this.notificationNavigationClosePromise;
      await Promise.allSettled([markReadPromise, closePromise]);
      if (generation !== this.notificationOpenGeneration) return;
      const url = new URL(href, window.location.origin);
      if (isNotificationPjaxHref(url.href, window.location.origin) && window.pjax?.loadUrl) {
        window.pjax.loadUrl(`${url.pathname}${url.search}${url.hash}`);
        return;
      }
      window.location.assign(url.href);
    },
    captureNotificationWidgetRects() {
      const panel = this.$refs?.notificationCenterPanel || document.getElementById('notification-center-panel');
      if (!panel) return new Map();
      return new Map(Array.from(panel.querySelectorAll('[data-notification-widget-card]'))
        .map((card) => {
          const key = card.dataset.notificationWidgetKey;
          return key ? [key, card.getBoundingClientRect()] : null;
        })
        .filter(Boolean));
    },
    animateNotificationWidgetRects(beforeRects) {
      if (!beforeRects?.size || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
      const panel = this.$refs?.notificationCenterPanel || document.getElementById('notification-center-panel');
      if (!panel) return;
      panel.querySelectorAll('[data-notification-widget-card]').forEach((card) => {
        const key = card.dataset.notificationWidgetKey;
        const before = beforeRects.get(key);
        if (!before) return;
        const after = card.getBoundingClientRect();
        const deltaX = before.left - after.left;
        const deltaY = before.top - after.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
        card.animate([
          { transform: `translate(${deltaX}px, ${deltaY}px)`, opacity: 0.92 },
          { transform: 'translate(0, 0)', opacity: 1 }
        ], {
          duration: 220,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
        });
      });
    },
    notificationWidgetNeedsHomeData(widget) {
      const widgetType = String(widget?.widget || '').trim();
      return !!widgetType && !LOCAL_NOTIFICATION_WIDGETS.has(widgetType);
    },
    notificationWidgetHomePath() {
      const siteUrl = String(getDesktopWidgetProtocol().siteUrl || '').trim();
      if (!siteUrl) return '/';
      try {
        const url = new URL(siteUrl, window.location.origin);
        return `${url.pathname || '/'}${url.search || ''}`;
      } catch (_error) {
        return '/';
      }
    },
    async ensureNotificationWidgetData() {
      if (getDesktopWidgetProtocol().isHome === true) {
        this.notificationWidgetDataStatus = 'ready';
        return getDesktopWidgetProtocol();
      }
      if (!this.notificationWidgets.some((widget) => this.notificationWidgetNeedsHomeData(widget))) {
        return null;
      }
      if (this.notificationWidgetDataPromise) return this.notificationWidgetDataPromise;

      this.notificationWidgetDataController?.abort();
      this.notificationWidgetDataController = new AbortController();
      const controller = this.notificationWidgetDataController;
      this.notificationWidgetDataStatus = 'loading';
      this.notificationWidgetRenderTick += 1;

      this.notificationWidgetDataPromise = fetch(this.notificationWidgetHomePath(), {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`首页小组件数据请求失败（HTTP ${response.status}）`);
          }
          const protocol = syncHomeDesktopWidgetProtocolFromResponse(await response.text());
          if (!protocol?.isHome) {
            throw new Error('首页响应缺少桌面小组件数据协议');
          }
          this.notificationWidgetDataStatus = 'ready';
          return protocol;
        })
        .catch((error) => {
          if (error?.name === 'AbortError' || controller.signal.aborted) return null;
          this.notificationWidgetDataStatus = 'error';
          wmLog('notification widget home data failed', { message: error?.message || String(error || '') });
          return null;
        })
        .finally(() => {
          if (this.notificationWidgetDataController === controller) {
            this.notificationWidgetDataController = null;
          }
          this.notificationWidgetDataPromise = null;
          this.notificationWidgetHtmlCache.clear();
          this.notificationWidgetRenderTick += 1;
        });

      return this.notificationWidgetDataPromise;
    },
    syncNotificationWidgets(widgets = null, options = {}) {
      if (Array.isArray(widgets)) {
        this.notificationWidgetDraftWidgets = widgets.map((widget) => ({ ...widget }));
      }
      const sourceWidgets = Array.isArray(widgets) ? widgets : this.notificationWidgetDraftWidgets;
      this.notificationWidgets = resolveNotificationWidgets(sourceWidgets);
      this.notificationWidgets.forEach((widget) => {
        void this.ensureNotificationWidgetRenderer(widget.widget);
      });
      if (this.hasNotificationWeatherWidget()) {
        void this.loadNotificationWeather();
      } else {
        this.notificationWeatherRequestId += 1;
        this.notificationWeatherState = {
          loading: false,
          error: '',
          data: null,
          entries: {}
        };
      }
      if (this.notificationCenterVisible) {
        this.$nextTick(() => {
          this.animateNotificationWidgetRects(options.beforeRects);
          this.scheduleNotificationWidgetEnhancement();
        });
      }
    },
    notificationWidgetDropPreviewStyle() {
      const preview = this.notificationWidgetDropPreview || {};
      const top = Math.max(0, Number(preview.top) || 0);
      const left = Math.max(0, Number(preview.left) || 0);
      const width = Math.max(0, Number(preview.width) || 0);
      const height = Math.max(0, Number(preview.height) || 0);
      return [
        `transform: translate(${left}px, ${top}px)`,
        width ? `width:${width}px` : '',
        height ? `height:${height}px` : ''
      ].filter(Boolean).join(';');
    },
    enhanceNotificationWidgets(_tick = 0) {
      this.scheduleNotificationWidgetEnhancement();
    },
    hasNotificationWeatherWidget() {
      return this.notificationWidgets.some((widget) => widget.widget === 'system.weather');
    },
    ensureNotificationWeatherRuntime() {
      if (!this.notificationWeatherRuntimePromise) {
        this.notificationWeatherRuntimePromise = import('../widgets/weather-runtime.js')
          .catch((error) => {
            this.notificationWeatherRuntimePromise = null;
            throw error;
          });
      }
      return this.notificationWeatherRuntimePromise;
    },
    resolveNotificationWeatherWidgetConfig(widget) {
      const protocol = getDesktopWidgetProtocol();
      const weatherModule = protocol.modules?.weather || {};
      const meta = widget?.meta && typeof widget.meta === 'object' ? widget.meta : {};
      const cityName = normalizeWeatherCityName(meta.cityName) || normalizeWeatherCityName(weatherModule.cityName);
      const refreshMinutes = Number.parseInt(meta.refreshMinutes ?? weatherModule.refreshMinutes ?? 30, 10);
      return {
        cityName,
        refreshMinutes: Math.min(Math.max(Number.isFinite(refreshMinutes) ? refreshMinutes : 30, 10), 240),
        key: notificationWeatherEntryKey(cityName)
      };
    },
    resolveNotificationWeatherLoadTargets() {
      const targets = new Map();
      this.notificationWidgets
        .filter((widget) => widget.widget === 'system.weather')
        .forEach((widget) => {
          const config = this.resolveNotificationWeatherWidgetConfig(widget);
          if (config.cityName && config.key) {
            targets.set(config.key, config);
          }
        });
      return Array.from(targets.values());
    },
    async loadNotificationWeather(forceRefresh = false) {
      if (!this.hasNotificationWeatherWidget()) return;
      if (this.notificationWeatherState.loading && !forceRefresh) return;

      const targets = this.resolveNotificationWeatherLoadTargets();
      if (!targets.length) {
        this.notificationWeatherState = {
          loading: false,
          error: '请先在后台为天气组件配置城市。',
          data: null,
          entries: {}
        };
        this.notificationWidgetHtmlCache.clear();
        this.notificationWidgetRenderTick += 1;
        return;
      }

      const {
        loadCachedDesktopWidgetWeather,
        saveDesktopWidgetWeather,
        fetchDesktopWidgetWeather
      } = await this.ensureNotificationWeatherRuntime();

      const nextEntries = { ...(this.notificationWeatherState.entries || {}) };
      const pendingTargets = [];

      targets.forEach((target) => {
        if (!forceRefresh) {
          const cached = loadCachedDesktopWidgetWeather(target.cityName, target.refreshMinutes);
          if (cached) {
            nextEntries[target.key] = { loading: false, error: '', data: cached };
            return;
          }
        }
        pendingTargets.push(target);
        nextEntries[target.key] = {
          loading: true,
          error: '',
          data: nextEntries[target.key]?.data || null
        };
      });

      const primaryKey = targets[0]?.key || '';
      const primaryEntry = nextEntries[primaryKey] || null;
      if (!pendingTargets.length && primaryEntry?.data) {
        this.notificationWeatherState = {
          loading: false,
          error: '',
          data: primaryEntry.data,
          entries: nextEntries
        };
        this.notificationWidgetHtmlCache.clear();
        this.notificationWidgetRenderTick += 1;
        return;
      }

      this.notificationWeatherRequestId += 1;
      const requestId = this.notificationWeatherRequestId;
      this.notificationWeatherState = {
        ...this.notificationWeatherState,
        entries: nextEntries,
        loading: true,
        error: ''
      };
      this.notificationWidgetHtmlCache.clear();
      this.notificationWidgetRenderTick += 1;

      try {
        const results = await Promise.allSettled(
          pendingTargets.map(async (target) => {
            const data = await fetchDesktopWidgetWeather(target.cityName);
            saveDesktopWidgetWeather(target.cityName, data);
            return { target, data };
          })
        );
        if (requestId !== this.notificationWeatherRequestId) return;

        const resolvedEntries = { ...(this.notificationWeatherState.entries || {}) };
        results.forEach((result, index) => {
          const target = pendingTargets[index];
          if (result.status === 'fulfilled') {
            resolvedEntries[target.key] = { loading: false, error: '', data: result.value.data };
            return;
          }
          resolvedEntries[target.key] = {
            loading: false,
            error: '天气数据暂时不可用。',
            data: resolvedEntries[target.key]?.data || null
          };
        });

        const resolvedPrimary = resolvedEntries[primaryKey] || Object.values(resolvedEntries).find((entry) => entry?.data);
        this.notificationWeatherState = {
          loading: false,
          error: resolvedPrimary?.error || '',
          data: resolvedPrimary?.data || null,
          entries: resolvedEntries
        };
      } catch (_error) {
        if (requestId !== this.notificationWeatherRequestId) return;

        this.notificationWeatherState = {
          loading: false,
          error: '天气数据暂时不可用。',
          data: null,
          entries: Object.fromEntries(targets.map((target) => [target.key, {
            loading: false,
            error: '天气数据暂时不可用。',
            data: this.notificationWeatherState.entries?.[target.key]?.data || null
          }]))
        };
      } finally {
        if (requestId === this.notificationWeatherRequestId) {
          this.notificationWidgetHtmlCache.clear();
          this.notificationWidgetRenderTick += 1;
          this.$nextTick(() => this.scheduleNotificationWidgetEnhancement());
        }
      }
    },
    scheduleNotificationWidgetEnhancement() {
      if (this.notificationWidgetEnhanceScheduled) return;
      this.notificationWidgetEnhanceScheduled = true;
      if (this.notificationWidgetEnhanceRafId) {
        window.cancelAnimationFrame(this.notificationWidgetEnhanceRafId);
        this.notificationWidgetEnhanceRafId = 0;
      }
      this.$nextTick(() => {
        this.notificationWidgetEnhanceRafId = window.requestAnimationFrame(() => {
          this.notificationWidgetEnhanceRafId = window.requestAnimationFrame(() => {
            this.notificationWidgetEnhanceRafId = 0;
            this.notificationWidgetEnhanceScheduled = false;
            const root = this.$refs.notificationCenterPanel;
            if (!root) return;
            enhanceDoubanShowcaseWidgets(root);
            if (root.querySelector('[data-tag-focus]')) {
              void import('../../../../widgets/halo/random-tags/render.js')
                .then((runtime) => runtime.ensureTagFocusRotation?.(root))
                .catch(() => {});
            }
          });
        });
      });
    },
    ensureNotificationWidgetRenderer(widgetType) {
      return ensureWidgetRendererRuntime({
        widgetRenderers: this.notificationWidgetRenderers,
        widgetRendererPromises: this.notificationWidgetRendererPromises,
        widgetRenderVersions: this.notificationWidgetRenderVersions,
        onWidgetRendererReady: () => {
          this.notificationWidgetHtmlCache.clear();
          this.notificationWidgetRenderTick += 1;
        }
      }, widgetType);
    },
    notificationWidgetCardClass(widget) {
      const typeToken = String(widget?.widget || 'widget')
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-|-$/g, '');
      return [
        `is-${widget?.size || 'medium'}`,
        `widget--${typeToken}`,
        this.draggingWidgetKey === widget?.key ? 'is-drag-source' : ''
      ].filter(Boolean).join(' ');
    },
    notificationWidgetKicker(widget) {
      return getWidgetCatalogEntry(widget?.widget)?.kicker || '桌面组件';
    },
    notificationWidgetAppearanceValue(widget) {
      return normalizeWidgetAppearance(widget?.appearance);
    },
    renderNotificationWidget(widget, _renderTick = 0) {
      const protocol = getDesktopWidgetProtocol();
      if (protocol.isHome !== true && this.notificationWidgetNeedsHomeData(widget)) {
        if (this.notificationWidgetDataStatus === 'error') {
          return '<div class="desktop-widget-empty" role="status">小组件数据暂时无法加载，请关闭后重试。</div>';
        }
        return renderWidgetLoadingMarkup();
      }
      return renderWidgetBodyWithHost({
        surface: 'notification-center',
        now: new Date(),
        modules: protocol.modules || { weather: { cityName: '北京', refreshMinutes: 30 } },
        sources: protocol.sources || {},
        weatherState: this.notificationWeatherState,
        widgetRenderers: this.notificationWidgetRenderers,
        widgetRendererPromises: this.notificationWidgetRendererPromises,
        widgetRenderVersions: this.notificationWidgetRenderVersions,
        _widgetHtmlCache: this.notificationWidgetHtmlCache,
        onWidgetRendererReady: () => {
          this.notificationWidgetHtmlCache.clear();
          this.notificationWidgetRenderTick += 1;
        }
      }, widget, { surface: 'notification-center', compact: false });
    },
    dispatchNotificationWidgetCommand(widget, action, event = null) {
      if (!widget?.key || !action) return;
      this.notificationMotion?.commitWidgetCommand(event?.currentTarget || null);
      window.dispatchEvent(new CustomEvent('theme-notification-widget-command', {
        detail: {
          key: widget.key,
          action
        }
      }));
    },
    openNotificationWidgetContextMenu(widget, event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!widget?.key) return;
      window.dispatchEvent(new CustomEvent('theme-widget-context-menu', {
        detail: {
          key: widget.key,
          source: 'notification-center',
          x: event?.clientX || window.innerWidth - 220,
          y: event?.clientY || 160
        }
      }));
    },
    openNotificationWidgetEditor() {
      window.dispatchEvent(new CustomEvent('theme-open-widget-center', {
        detail: {
          source: 'notification-center',
          targetSurface: 'desktop'
        }
      }));
    },
    isNotificationWidgetEditingActive() {
      return document.body.classList.contains('desktop-widget-center-open')
        || document.body.classList.contains('desktop-editing');
    },
    beginNotificationWidgetDrag(widget, event) {
      if (!this.isNotificationWidgetEditingActive()) return;
      if (event.button !== undefined && event.button !== 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const markup = event.currentTarget.innerHTML;

      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // The desktop drag engine also listens on window as a fallback.
      }

      window.dispatchEvent(new CustomEvent('theme-notification-widget-drag-start', {
        detail: {
          source: 'notification-center',
          widget: { ...widget },
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId ?? null,
          rect,
          markup
        }
      }));
      event.preventDefault();
    },
    currentTimePreset() {
      return window.innerWidth < HEADER_MOBILE_BREAKPOINT
        ? this.timeMobilePreset
        : this.timeDesktopPreset;
    },
    tick() {
      if (!this.timeEnabled) {
        this.timeStr = '';
        return;
      }

      this.timeStr = formatHeaderTime(
        new Date(),
        this.currentTimePreset(),
        this.timeHourCycle
      );
    }
  }));

  // =========== 全局窗口控制 Store ===========
  Alpine.store('windowManager', {
    show: false,
    minimized: false,
    title: document.title,
    isAnimating: false,
    animationToken: 0,
    pendingOpenTitle: '',
    pendingOpenRequested: false,

    init() {
      try {
        const stored = localStorage.getItem('theme-macOS-window-state');
        if (stored) {
          const state = JSON.parse(stored);
          this.show = state.show;
          this.minimized = state.minimized;
        }
      } catch(e) {}

      if (window.location.pathname === '/') {
        this.showDesktop();
      }
      wmLog('init', { show: this.show, minimized: this.minimized, path: window.location.pathname });
    },

    sync() {
       localStorage.setItem('theme-macOS-window-state', JSON.stringify({
          show: this.show,
          minimized: this.minimized
       }));
    },

    queueOpen(title) {
      this.pendingOpenRequested = true;
      this.pendingOpenTitle = title || document.title || this.title;
    },

    flushPendingOpen() {
      if (!this.pendingOpenRequested) return;
      const nextTitle = this.pendingOpenTitle;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.open(nextTitle);
    },

    restoreWindowSurface() {
      const winEl = document.querySelector('[data-window-surface]');
      if (!winEl) return null;

      winEl.style.visibility = 'visible';
      winEl.style.opacity = '1';
      winEl.style.pointerEvents = 'auto';

      if (window.innerWidth >= 768) {
        winEl.style.transform = 'none';
      } else {
        winEl.style.transform = '';
        winEl.style.left = '';
        winEl.style.top = '';
      }

      const titlebar = winEl.querySelector('[data-window-titlebar]');
      if (titlebar) {
        titlebar.style.opacity = '';
        titlebar.style.backdropFilter = '';
        titlebar.style.webkitBackdropFilter = '';
      }

      return winEl;
    },

    prepareWindowSurfaceForRestore(winEl = document.querySelector('[data-window-surface]')) {
      if (!winEl) return null;

      const titlebar = winEl.querySelector('[data-window-titlebar]');
      if (titlebar) {
        titlebar.style.opacity = '';
        titlebar.style.backdropFilter = '';
        titlebar.style.webkitBackdropFilter = '';
      }

      return winEl;
    },

    invalidateAnimation() {
      this.animationToken += 1;
      this.isAnimating = false;
    },

    revealAfterNavigation(title) {
      if (title) this.title = title;
      this.invalidateAnimation();
      this.show = true;
      this.minimized = false;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.restoreWindowSurface();
      this.sync();
    },

    showDesktop() {
      wmLog('showDesktop');
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.animationToken += 1;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.sync();
    },

    open(title) {
      wmLog('open', { title, show: this.show, minimized: this.minimized, isAnimating: this.isAnimating });
      if (title) this.title = title;
      if (this.isAnimating) {
        this.queueOpen(title);
        return;
      }
      if (this.minimized) {
        this.show = true;
        void this.restore(title);
        return;
      }
      this.show = true;
      this.minimized = false;
      this.sync();

      setTimeout(() => {
        const winEl = this.restoreWindowSurface();
        if (winEl) {
          winEl.style.transition = 'none';
        }
      }, 0);
    },

    hide() {
      wmLog('hide');
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.sync();
    },

    async minimize() {
      wmLog('minimize');
      if (this.isAnimating || this.minimized) return;
      const winEl = document.querySelector('[data-window-surface]');
      if (!winEl) return;
      const animationToken = ++this.animationToken;

      this.minimized = true;
      this.sync();
      this.isAnimating = true;

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const dockIcon = document.getElementById('minimized-dock-icon');
      if (!dockIcon) {
        winEl.style.visibility = 'hidden';
        winEl.style.opacity = '1';
        winEl.style.transform = 'none';
        winEl.style.pointerEvents = 'none';
        this.isAnimating = false;
        this.flushPendingOpen();
        return;
      }

      const animPromise = runGenieAnimation({
        windowEl: winEl,
        dockEl: dockIcon,
        action: 'minimize'
      });
      winEl.style.visibility = 'hidden';
      const titlebar = winEl.querySelector('[data-window-titlebar]');
      if (titlebar) {
        titlebar.style.opacity = '0';
        titlebar.style.backdropFilter = 'none';
        titlebar.style.webkitBackdropFilter = 'none';
      }

      const animated = await animPromise;

      if (animationToken !== this.animationToken) {
        return;
      }

      if (animated) {
        winEl.style.visibility = 'hidden';
        winEl.style.opacity = '1';
        winEl.style.transform = 'none';
        winEl.style.pointerEvents = 'none';
      }

      this.isAnimating = false;
      this.flushPendingOpen();
    },

    async restore(nextTitle) {
       wmLog('restore', { nextTitle });
       if (nextTitle) this.title = nextTitle;
       if (this.isAnimating || !this.minimized) return;
       const animationToken = ++this.animationToken;
       this.isAnimating = true;
       this.show = true;

       const winEl = document.querySelector('[data-window-surface]');
       const dockIcon = document.getElementById('minimized-dock-icon');

       if (winEl && dockIcon) {
         dockIcon.style.opacity = '0';

         this.prepareWindowSurfaceForRestore(winEl);

         winEl.style.visibility = 'hidden';
         winEl.style.opacity = '1';
         winEl.style.transform = 'none';

         await runGenieAnimation({
           windowEl: winEl,
           dockEl: dockIcon,
           action: 'restore',
           onBeforeFinish: () => {
             if (animationToken === this.animationToken) {
               this.restoreWindowSurface();
             }
           }
         });

         if (animationToken !== this.animationToken) {
           return;
         }

         this.minimized = false;
         this.isAnimating = false;
         this.sync();
       } else {
         if (animationToken !== this.animationToken) {
           return;
         }
         this.restoreWindowSurface();
         this.minimized = false;
         this.isAnimating = false;
         this.sync();
       }

       this.flushPendingOpen();
    }
  });

  // =========== Dock 物理级高斯放大引擎 ===========
  Alpine.data('dock', () => ({
    init() {
      const dockBar = this.$refs.dockBar;
      if (!dockBar) return;
      const el = this.$el;
      const runtimeSyncEvent = 'theme:dock-settings-change';

      const readSettings = () => {
        const ds = el.dataset;
        const enableMagnification = ds.magnification !== 'false';
        const baseSize = Math.max(36, Math.min(64, parseInt(ds.dockIconSize, 10) || 48));
        const iconGap = Math.max(2, Math.min(12, parseInt(ds.dockIconGap, 10) || 4));
        const dockPadding = Math.max(4, Math.min(16, parseInt(ds.dockPadding, 10) || 6));
        const magScale = Math.max(1, Math.min(2, parseFloat(ds.dockMagScale) || 1.4));
        const glassBlur = Math.max(20, Math.min(100, parseInt(ds.dockGlassBlur, 10) || 60));
        const glassOpacity = Math.max(10, Math.min(80, parseInt(ds.dockGlassOpacity, 10) || 28));
        const maxSize = Math.round(baseSize * magScale);
        const maxLift = enableMagnification ? Math.round(baseSize * 0.10) : 0;
        const glassHeight = baseSize + dockPadding * 2;

        return {
          enableMagnification,
          showLabels: ds.showLabels === 'true',
          baseSize,
          iconGap,
          dockPadding,
          magScale,
          glassBlur,
          glassOpacity,
          range: Math.round(baseSize * 2.9),
          maxLift,
          maxScale: maxSize / baseSize,
          glassHeight,
          barHeight: glassHeight + (enableMagnification ? Math.max(14, maxLift + 8) : 0)
        };
      };

      const applySettings = () => {
        const nextSettings = readSettings();
        el.style.setProperty('--dock-icon-size', `${nextSettings.baseSize}px`);
        el.style.setProperty('--dock-gap', `${nextSettings.iconGap}px`);
        el.style.setProperty('--dock-padding', `${nextSettings.dockPadding}px`);
        el.style.setProperty('--dock-glass-height', `${nextSettings.glassHeight}px`);
        el.style.setProperty('--dock-bar-height', `${nextSettings.barHeight}px`);
        el.style.setProperty('--dock-blur', `${nextSettings.glassBlur}px`);
        el.style.setProperty('--dock-opacity', `${nextSettings.glassOpacity / 100}`);
        el.style.setProperty('--dock-icon-radius', `${Math.round(nextSettings.baseSize * 0.25)}px`);
        el.querySelectorAll('.dock-tooltip').forEach((tooltip) => {
          tooltip.hidden = !nextSettings.showLabels;
          tooltip.classList.remove('dock-tooltip-visible');
          if (nextSettings.showLabels) {
            tooltip.style.removeProperty('display');
          }
        });
        return nextSettings;
      };

      let settings = applySettings();

      let rafId = null;
      let lastMouseX = null;

      const ac = new AbortController();
      const { signal } = ac;

      const getIcons = () => Array.from(dockBar.querySelectorAll('.dock-icon'));

      const resetIcons = () => {
        lastMouseX = null;
        getIcons().forEach((icon) => {
          icon.classList.add('dock-animating');
          icon.classList.remove('dock-tooltip-visible');
          icon.style.width = `${settings.baseSize}px`;
          icon.style.height = `${settings.baseSize}px`;
          icon.style.transform = 'translateY(0px)';
          icon.style.zIndex = '';
        });
      };

      const updateDock = (mouseX) => {
        const {
          baseSize,
          range,
          maxScale,
          maxLift,
          showLabels
        } = settings;
        const icons = getIcons();
        let tooltipTarget = null;
        let nearestDistance = Infinity;

        icons.forEach((icon) => {
          icon.classList.remove('dock-animating', 'dock-tooltip-visible');

          const rect = icon.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const distance = Math.abs(mouseX - centerX);

          let scale = 1;
          if (distance < range) {
            const ratio = distance / range;
            /* cos³ 衰减 — 集中中心隆起，边缘平滑 */
            const influence = Math.cos(ratio * Math.PI / 2);
            const softenedInfluence = influence * influence * influence;
            scale = 1 + (maxScale - 1) * softenedInfluence;
          }

          const lift = maxScale > 1 ? ((scale - 1) / (maxScale - 1)) * maxLift : 0;
          icon.style.width = `${baseSize * scale}px`;
          icon.style.height = `${baseSize * scale}px`;
          icon.style.transform = `translateY(-${lift}px)`;
          icon.style.zIndex = String(10 + Math.round(scale * 10));

          if (distance < nearestDistance) {
            nearestDistance = distance;
            tooltipTarget = icon;
          }
        });

        if (showLabels && tooltipTarget && nearestDistance < range * 0.65) {
          tooltipTarget.classList.add('dock-tooltip-visible');
        }
      };

      /* 初始化图标基础尺寸 */
      requestAnimationFrame(() => {
        resetIcons();
      });

      el.addEventListener('mousemove', (e) => {
        if (!settings.enableMagnification) return;
        lastMouseX = e.clientX;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (lastMouseX !== null) updateDock(lastMouseX);
        });
      }, { signal });

      el.addEventListener('mouseleave', () => {
        cancelAnimationFrame(rafId);
        requestAnimationFrame(resetIcons);
      }, { signal });

      el.addEventListener(runtimeSyncEvent, () => {
        cancelAnimationFrame(rafId);
        settings = applySettings();
        rafId = requestAnimationFrame(resetIcons);
      }, { signal });

      /* destroy 清理 */
      this._dockCleanup = () => {
        cancelAnimationFrame(rafId);
        ac.abort();
        resetIcons();
      };
    },

    destroy() {
      if (this._dockCleanup) this._dockCleanup();
    }
  }));
}
