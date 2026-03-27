import Pjax from 'pjax';
import NProgress from 'nprogress';
import QRCode from 'qrcode';

let archiveSidebarCleanup = null;
let postOutlineCleanup = null;

function extractTextPreview(value) {
  if (!value) return '';

  if (typeof window !== 'undefined' && value.includes('<')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(value, 'text/html');
    return doc.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength) {
  const normalized = extractTextPreview(value);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function toPositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveThemeMode() {
  const root = document.documentElement;
  const defaultTheme = root?.dataset?.defaultTheme || 'system';
  const savedTheme = localStorage.getItem('theme');
  return savedTheme || defaultTheme;
}

function applyRootThemeState(mode, mediaQuery) {
  const root = document.documentElement;
  const themeMode = mode || 'system';
  const isDark = themeMode === 'dark' || (themeMode === 'system' && !!mediaQuery?.matches);

  root.classList.remove('dark', 'light', 'system', 'color-scheme-auto', 'color-scheme-dark', 'color-scheme-light');
  root.classList.add(themeMode === 'system' ? 'color-scheme-auto' : `color-scheme-${themeMode}`);
  root.classList.add(themeMode);
  root.setAttribute('data-color-scheme', themeMode);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  return isDark;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMomentTime(value, variant = 'full') {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return variant === 'list' ? '--.-- --:--' : '未知时间';
  }

  const pad = (segment) => String(segment).padStart(2, '0');

  if (variant === 'list') {
    return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeMomentRecord(moment) {
  const key = moment?.metadata?.name || '';
  const content = moment?.spec?.content || {};
  const media = Array.isArray(content.medium) ? content.medium : [];
  const rawText = extractTextPreview(content.raw || '') || extractTextPreview(content.html || '');
  const mediaCount = media.length;
  const title = rawText ? truncateText(rawText, 36) : (mediaCount > 0 ? '图片瞬间' : '瞬间记录');
  const summary = rawText
    ? truncateText(rawText, 88)
    : (mediaCount > 0 ? '打开预览查看媒体内容' : '打开预览查看完整内容');

  return {
    key,
    title: title || '瞬间记录',
    summary: summary || '打开预览查看完整内容',
    listTime: formatMomentTime(moment?.spec?.releaseTime, 'list'),
    fullTime: formatMomentTime(moment?.spec?.releaseTime, 'full'),
    media,
    mediaCount,
    rowBadge: mediaCount > 0 ? `${mediaCount} 项媒体` : '文本',
    mediaLabel: mediaCount > 0 ? `${mediaCount} 项媒体` : '纯文本',
    interactions: `${moment?.stats?.upvote ?? 0} 赞 · ${moment?.stats?.totalComment ?? 0} 评论`,
    tags: Array.isArray(moment?.spec?.tags) ? moment.spec.tags : [],
    html: content.html || (rawText ? `<p>${escapeHtml(rawText)}</p>` : ''),
    permalink: key ? `/moments/${encodeURIComponent(key)}` : '/moments'
  };
}

function renderMomentMediaTile(medium) {
  const mediumType = medium?.type || '';
  const mediumUrl = escapeHtml(medium?.url || '');

  if (mediumType === 'PHOTO') {
    return `<div class="author-moment-preview-tile is-photo"><img src="${mediumUrl}" alt=""></div>`;
  }

  if (mediumType === 'VIDEO') {
    return `<div class="author-moment-preview-tile is-video"><video src="${mediumUrl}" preload="metadata" controls playsinline></video></div>`;
  }

  if (mediumType === 'AUDIO') {
    return '<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>音频</span></div></div>';
  }

  return '<div class="author-moment-preview-tile is-placeholder"><div class="author-moment-preview-placeholder"><span>文章卡片</span></div></div>';
}

function renderMomentRow(moment) {
  return `
    <button type="button"
            class="author-moment-row"
            data-author-moment-option
            data-moment-key="${escapeHtml(moment.key)}"
            data-moment-title="${escapeHtml(moment.title)}">
      <div class="author-moment-row-main">
        <span class="author-moment-row-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M5 5.5H15C16.1046 5.5 17 6.39543 17 7.5V12.5C17 13.6046 16.1046 14.5 15 14.5H5C3.89543 14.5 3 13.6046 3 12.5V7.5C3 6.39543 3.89543 5.5 5 5.5Z" stroke="currentColor" stroke-width="1.15"></path>
            <path d="M6.25 11.75L8.25 9.75L10 11.5L12.75 8.75" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="6.75" cy="7.9" r="0.9" fill="currentColor"></circle>
          </svg>
        </span>
        <span class="author-moment-row-copy">
          <span class="author-moment-row-title">${escapeHtml(moment.title)}</span>
          <span class="author-moment-row-summary">${escapeHtml(moment.summary)}</span>
        </span>
      </div>
      <span class="author-moment-row-meta">
        <span class="author-moment-row-date">${escapeHtml(moment.listTime)}</span>
        <span class="author-moment-row-badge">${escapeHtml(moment.rowBadge)}</span>
      </span>
    </button>
  `;
}

function renderMomentPreview(moment, authorDisplayName) {
  const mediaHtml = moment.mediaCount > 0
    ? `<div class="author-moment-preview-media">${moment.media.map((medium) => renderMomentMediaTile(medium)).join('')}</div>`
    : '';
  const tagsHtml = moment.tags.length > 0
    ? `
      <div>
        <dt>标签</dt>
        <dd>
          <span class="author-inline-chip-list">
            ${moment.tags.map((tag) => `<span class="author-inline-chip">${escapeHtml(tag)}</span>`).join('')}
          </span>
        </dd>
      </div>
    `
    : '';

  return `
    <article class="author-preview-panel tag-preview-panel author-preview-panel--moment"
             data-author-moment-panel
             data-moment-key="${escapeHtml(moment.key)}">
      <header class="author-preview-header tag-preview-header">
        <div class="author-preview-icon tag-preview-icon author-preview-icon--moment">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7.25 5.75H16.75C18.1307 5.75 19.25 6.86929 19.25 8.25V15.75C19.25 17.1307 18.1307 18.25 16.75 18.25H7.25C5.86929 18.25 4.75 17.1307 4.75 15.75V8.25C4.75 6.86929 5.86929 5.75 7.25 5.75Z" stroke="currentColor" stroke-width="1.25"></path>
            <path d="M8 14.25L10.5 11.75L12.75 14L15.75 11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="9" cy="9.25" r="1" fill="currentColor"></circle>
          </svg>
        </div>
        <div class="author-preview-heading tag-preview-heading">
          <h2 class="author-preview-title tag-preview-title">${escapeHtml(moment.title)}</h2>
          <p class="author-preview-path tag-preview-path">${escapeHtml(`${authorDisplayName || '作者'} / ${moment.fullTime}`)}</p>
        </div>
      </header>

      ${mediaHtml}

      <dl class="author-preview-meta tag-preview-meta">
        <div>
          <dt>发布时间</dt>
          <dd>${escapeHtml(moment.fullTime)}</dd>
        </div>
        <div>
          <dt>互动</dt>
          <dd>${escapeHtml(moment.interactions)}</dd>
        </div>
        <div>
          <dt>内容类型</dt>
          <dd>${escapeHtml(moment.mediaLabel)}</dd>
        </div>
        ${tagsHtml}
      </dl>

      ${moment.html ? `<div class="author-moment-preview-body">${moment.html}</div>` : ''}

      <a class="author-preview-action tag-preview-action pjax-link" href="${escapeHtml(moment.permalink)}">打开瞬间</a>
    </article>
  `;
}

function replayPjaxScripts(root) {
  if (!root) return;

  root.querySelectorAll('script[data-pjax]').forEach((oldScript) => {
    const script = document.createElement('script');

    Array.from(oldScript.attributes).forEach((attr) => {
      script.setAttribute(attr.name, attr.value);
    });

    script.textContent = oldScript.textContent;
    oldScript.replaceWith(script);
  });
}

function slugifyHeading(text, index) {
  const normalized = String(text || '').trim().toLowerCase();
  const ascii = normalized
    .replace(/&/g, ' and ')
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return ascii || `section-${index + 1}`;
}

function initPostOutline(root = document) {
  if (typeof postOutlineCleanup === 'function') {
    postOutlineCleanup();
    postOutlineCleanup = null;
  }

  const frame = root.querySelector('.post-reader-frame');
  const article = root.querySelector('#article-content');
  const outline = root.querySelector('[data-post-outline]');
  const list = root.querySelector('[data-post-outline-list]');

  if (!frame || !article || !outline || !list) return;

  const headings = Array.from(article.querySelectorAll('h2, h3, h4'))
    .filter((heading) => extractTextPreview(heading.textContent || ''));

  list.innerHTML = '';

  if (!headings.length) {
    outline.hidden = true;
    return;
  }

  const usedIds = new Set();
  headings.forEach((heading, index) => {
    let headingId = heading.id || slugifyHeading(heading.textContent, index);

    while (usedIds.has(headingId) || document.querySelectorAll(`#${CSS.escape(headingId)}`).length > 1) {
      headingId = `${headingId}-${index + 1}`;
    }

    usedIds.add(headingId);
    heading.id = headingId;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `post-outline-link post-outline-link--${heading.tagName.toLowerCase()}`;
    button.dataset.targetId = headingId;
    button.textContent = extractTextPreview(heading.textContent || '');
    list.appendChild(button);
  });

  outline.hidden = false;

  const buttons = Array.from(list.querySelectorAll('.post-outline-link'));

  const setActive = (id) => {
    buttons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.targetId === id);
    });
  };

  const handleClick = (event) => {
    const button = event.target.closest('.post-outline-link');
    if (!button) return;

    const target = article.querySelector(`#${CSS.escape(button.dataset.targetId || '')}`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(button.dataset.targetId || '');
    history.replaceState(history.state, '', `#${button.dataset.targetId}`);
  };

  list.addEventListener('click', handleClick);

  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

      if (visible.length > 0) {
        setActive(visible[0].target.id);
      }
    }, {
      rootMargin: '-20% 0px -65% 0px',
      threshold: [0, 1]
    });

    headings.forEach((heading) => observer.observe(heading));
  }

  const hash = decodeURIComponent(window.location.hash || '').replace(/^#/, '');
  if (hash && usedIds.has(hash)) {
    setActive(hash);
  } else {
    setActive(headings[0].id);
  }

  postOutlineCleanup = () => {
    list.removeEventListener('click', handleClick);
    if (observer) observer.disconnect();
  };
}

const SEO_HEAD_SELECTORS = [
  "meta[name='description']",
  "meta[name='keywords']",
  "meta[name='robots']",
  "link[rel='canonical']",
  "link[rel='icon']",
  "link[rel='shortcut icon']",
  "link[rel='apple-touch-icon']",
  "meta[property='og:type']",
  "meta[property='og:url']",
  "meta[property='og:site_name']",
  "meta[property='og:title']",
  "meta[property='og:description']",
  "meta[property='og:image']",
  "meta[property='article:published_time']",
  "meta[property='article:modified_time']",
  "meta[property='article:author']",
  "meta[property='article:tag']",
  "meta[name='twitter:card']",
  "meta[name='twitter:creator']",
  "meta[name='twitter:title']",
  "meta[name='twitter:description']",
  "meta[name='twitter:image']"
];

function readHeadAttribute(selectors, attribute = 'content') {
  for (const selector of selectors) {
    const node = document.head.querySelector(selector);
    const value = node?.getAttribute(attribute)?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function getSharePayload() {
  const url =
    readHeadAttribute(["link[rel='canonical']"], 'href') ||
    window.location.href;

  return {
    url
  };
}

function getShareMetadata() {
  const url = getSharePayload().url;
  const title =
    readHeadAttribute(["meta[property='og:title']", "meta[name='twitter:title']"]) ||
    document.title;
  const description =
    readHeadAttribute([
      "meta[property='og:description']",
      "meta[name='twitter:description']",
      "meta[name='description']"
    ]) || '';
  const image =
    readHeadAttribute(["meta[property='og:image']", "meta[name='twitter:image']"]) || '';

  let host = '';
  try {
    host = new URL(url, window.location.origin).host;
  } catch (_error) {
    host = window.location.host;
  }

  return {
    url,
    title,
    description,
    image,
    host
  };
}

async function copyTextFallback(text) {
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

function syncSeoHeadFromResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return;

  const parser = new DOMParser();
  const nextDoc = parser.parseFromString(responseText, 'text/html');
  const currentHead = document.head;
  const nextHead = nextDoc.head;

  if (!currentHead || !nextHead) return;

  SEO_HEAD_SELECTORS.forEach((selector) => {
    currentHead.querySelectorAll(selector).forEach((node) => node.remove());
    nextHead.querySelectorAll(selector).forEach((node) => {
      currentHead.appendChild(node.cloneNode(true));
    });
  });
}

function stripClonedIdsAndAlpine(node) {
  if (!node || !node.querySelectorAll) return;
  
  // Recursively strip IDs and Alpine bindings to prevent framework conflicts
  const elements = [node, ...node.querySelectorAll('*')];
  elements.forEach(el => {
    el.removeAttribute('id');
    // Strip Alpine directives and shorthand bindings from the animation ghost.
    Array.from(el.attributes).forEach(attr => {
      if (
        attr.name.startsWith('x-')
        || attr.name.startsWith('@')
        || attr.name.startsWith(':')
      ) {
        el.removeAttribute(attr.name);
      }
    });
  });
}

function createGenieGhost(sourceWindowEl) {
  const ghostWrapper = document.createElement('div');
  const ghostInner = sourceWindowEl.cloneNode(true);

  stripClonedIdsAndAlpine(ghostInner);

  ghostWrapper.className = 'genie-ghost-wrapper';
  ghostInner.classList.add('genie-ghost-window');

  Object.assign(ghostWrapper.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    zIndex: '10001',
    pointerEvents: 'none',
    overflow: 'visible'
  });

  Object.assign(ghostInner.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    resize: 'none',
    pointerEvents: 'none',
    visibility: 'visible',
    overflow: 'hidden'
  });

  ghostWrapper.appendChild(ghostInner);
  document.body.appendChild(ghostWrapper);

  return { ghostWrapper, ghostInner };
}

function runGenieAnimation({ windowEl, dockEl, action, duration = 420, onBeforeFinish }) {
  if (!windowEl || !dockEl) return Promise.resolve(false);

  const windowRect = windowEl.getBoundingClientRect();
  const targetGraphic = dockEl.querySelector('svg') || dockEl;
  const dockRect = targetGraphic.getBoundingClientRect();
  const { ghostWrapper, ghostInner } = createGenieGhost(windowEl);

  const sourceWidth = Math.max(windowRect.width, 1);
  const sourceHeight = Math.max(windowRect.height, 1);
  const targetWidth = Math.max(dockRect.width, 1);
  const targetHeight = Math.max(dockRect.height, 1);

  ghostWrapper.style.left = `${windowRect.left}px`;
  ghostWrapper.style.top = `${windowRect.top}px`;
  ghostWrapper.style.width = `${sourceWidth}px`;
  ghostWrapper.style.height = `${sourceHeight}px`;

  const windowCenterX = windowRect.left + sourceWidth / 2;
  const windowCenterY = windowRect.top + sourceHeight / 2;
  const dockCenterX = dockRect.left + targetWidth / 2;
  const dockCenterY = dockRect.top + targetHeight / 2;

  const destX = dockCenterX - windowCenterX;
  const destY = dockCenterY - windowCenterY;
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  const easeIn = 'cubic-bezier(0.7, 0, 1, 1)';
  const easeOut = 'cubic-bezier(0, 0, 0.3, 1)';

  const yFrames = action === 'minimize'
    ? [{ transform: 'translateY(0px)' }, { transform: `translateY(${destY}px)` }]
    : [{ transform: `translateY(${destY}px)` }, { transform: 'translateY(0px)' }];

  const xFrames = action === 'minimize'
    ? [
        { transform: 'translateX(0px) scale(1, 1)' },
        { transform: `translateX(${destX}px) scale(${scaleX}, ${scaleY})` }
      ]
    : [
        { transform: `translateX(${destX}px) scale(${scaleX}, ${scaleY})` },
        { transform: 'translateX(0px) scale(1, 1)' }
      ];

  const wrapperAnimation = ghostWrapper.animate(yFrames, {
    duration,
    easing: action === 'minimize' ? easeIn : easeOut,
    fill: 'forwards'
  });

  const innerAnimation = ghostInner.animate(xFrames, {
    duration,
    easing: action === 'minimize' ? easeOut : easeIn,
    fill: 'forwards'
  });

  return new Promise((resolve) => {
    innerAnimation.onfinish = () => {
      if (typeof onBeforeFinish === 'function') {
        onBeforeFinish();
      }
      wrapperAnimation.cancel();
      innerAnimation.cancel();
      ghostWrapper.remove();
      resolve(true);
    };

    innerAnimation.oncancel = () => {
      ghostWrapper.remove();
      resolve(false);
    };
  });
}

function openSearchWidget() {
  if (typeof window.SearchWidget?.open === 'function') {
    window.SearchWidget.open();
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('search-modal').forEach(injectSearchModalStyles);
      }, 0);
    });
    return true;
  }
  return false;
}

function injectSearchModalStyles(modalEl) {
  const root = modalEl?.shadowRoot;
  if (!root || root.getElementById('mac-search-style')) return;

  const style = document.createElement('style');
  style.id = 'mac-search-style';
  style.textContent = `
    :host {
      --mac-search-panel-border-light: rgba(255, 255, 255, 0.55);
      --mac-search-panel-border-dark: rgba(255, 255, 255, 0.08);
      --mac-search-panel-shadow-light: 0 36px 88px rgba(15, 23, 42, 0.20);
      --mac-search-panel-shadow-dark: 0 36px 96px rgba(0, 0, 0, 0.55);
      --mac-search-form-light: rgba(255, 255, 255, 0.72);
      --mac-search-form-dark: rgba(44, 44, 46, 0.82);
      --mac-search-list-hover-light: rgba(15, 23, 42, 0.045);
      --mac-search-list-hover-dark: rgba(255, 255, 255, 0.06);
      --mac-search-kbd-light: rgba(255, 255, 255, 0.78);
      --mac-search-kbd-dark: rgba(58, 58, 60, 0.92);
      color-scheme: light;
    }

    :host-context(.dark),
    :host-context([data-color-scheme='dark']) {
      color-scheme: dark;
    }

    .modal__wrapper {
      align-items: flex-start !important;
      justify-content: center !important;
      padding: clamp(68px, 12vh, 120px) 16px 24px !important;
    }

    .modal__layer {
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    .modal__content {
      width: min(720px, calc(100vw - 32px)) !important;
      max-height: min(78vh, 760px) !important;
      overflow: hidden !important;
      border-radius: 24px !important;
      border: 1px solid var(--mac-search-panel-border-light) !important;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.76), rgba(248, 248, 250, 0.82)) !important;
      box-shadow: var(--mac-search-panel-shadow-light), inset 0 1px 0 rgba(255, 255, 255, 0.42) !important;
      backdrop-filter: blur(34px) saturate(180%) !important;
      -webkit-backdrop-filter: blur(34px) saturate(180%) !important;
    }

    :host-context(.dark) .modal__content,
    :host-context([data-color-scheme='dark']) .modal__content {
      border-color: var(--mac-search-panel-border-dark) !important;
      background: linear-gradient(to bottom, rgba(34, 34, 36, 0.82), rgba(28, 28, 30, 0.88)) !important;
      box-shadow: var(--mac-search-panel-shadow-dark), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
    }

    .modal__content > div:first-child,
    .modal__content > div:last-child {
      background: transparent !important;
    }

    .modal__content > div:first-child {
      border-bottom-width: 1px !important;
      border-bottom-color: var(--halo-search-widget-divider-color) !important;
      padding: 16px !important;
    }

    .modal__content > div:last-child {
      border-top-width: 1px !important;
      border-top-color: var(--halo-search-widget-divider-color) !important;
      padding: 12px 16px !important;
    }

    .modal__content form {
      height: 54px !important;
      border-radius: 16px !important;
      background: var(--mac-search-form-light) !important;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45) !important;
      backdrop-filter: blur(20px) saturate(150%) !important;
      -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
    }

    :host-context(.dark) .modal__content form,
    :host-context([data-color-scheme='dark']) .modal__content form {
      background: var(--mac-search-form-dark) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
    }

    .modal__content input {
      font-size: 15px !important;
      letter-spacing: -0.01em !important;
    }

    .modal__content input::placeholder {
      color: var(--halo-search-widget-muted-color) !important;
    }

    .modal__content li[data-index] {
      border: 1px solid transparent !important;
      border-radius: 14px !important;
      transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease !important;
      background: var(--halo-search-widget-hit-bg-color) !important;
      box-shadow: none !important;
    }

    .modal__content li[data-index]:hover {
      transform: translateY(-1px) !important;
      background: var(--mac-search-list-hover-light) !important;
      border-color: rgba(15, 23, 42, 0.06) !important;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06) !important;
    }

    :host-context(.dark) .modal__content li[data-index]:hover,
    :host-context([data-color-scheme='dark']) .modal__content li[data-index]:hover {
      background: var(--mac-search-list-hover-dark) !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22) !important;
    }

    .modal__content li[data-index][class*='!bg-primary'] {
      border-color: transparent !important;
      box-shadow: 0 10px 22px color-mix(in srgb, var(--halo-search-widget-primary-color) 20%, transparent) !important;
    }

    .modal__content kbd {
      min-width: 28px !important;
      min-height: 28px !important;
      border-radius: 10px !important;
      background: var(--mac-search-kbd-light) !important;
      border-color: var(--halo-search-widget-kbd-border-color) !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.36), var(--halo-search-widget-kbd-shadow) !important;
    }

    :host-context(.dark) .modal__content kbd,
    :host-context([data-color-scheme='dark']) .modal__content kbd {
      background: var(--mac-search-kbd-dark) !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05), var(--halo-search-widget-kbd-shadow) !important;
    }

    .modal__content mark {
      color: var(--halo-search-widget-primary-color) !important;
      background: transparent !important;
    }
  `;

  root.appendChild(style);
}

function observeSearchWidget() {
  const scan = () => {
    document.querySelectorAll('search-modal').forEach(injectSearchModalStyles);
  };

  scan();

  const observer = new MutationObserver(() => {
    scan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function initArchiveSidebar(root = document) {
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

/**
 * macOS 简易单主窗静态渲染框架 + Pjax 获取
 */
export function registerComponents(Alpine) {
  
  // =========== 1. 全局真单页 Pjax 引擎初始化 ===========
  setTimeout(() => {
    const isErrorPage = document.body?.dataset.errorPage === 'true';
    if (isErrorPage) return;
    
    // 初始化 Pjax，接管桌面图标和 Dock 的普通 a 链接跳转
    const pjax = new Pjax({
      selectors: ["title", "#pjax-container"],
      cacheBust: false,
      elements: "a:not([target='_blank'])" 
    });
    
    // 把实例抛给 window 供其它行内脚本或 Alpine.js 指令自由调用
    window.pjax = pjax;

    document.addEventListener("pjax:send", () => {
      NProgress.start();
      const container = document.getElementById('pjax-container');
      if (container) container.classList.add('pjax-loading');
    });
    
    document.addEventListener("pjax:complete", (event) => {
      const requestStatus = event?.request?.status;
      if (requestStatus && requestStatus >= 400) {
        NProgress.done();
        return;
      }

      NProgress.done();
      syncSeoHeadFromResponse(event?.request?.responseText);
      const container = document.getElementById('pjax-container');
      if (container) {
        replayPjaxScripts(container);
        if (window.Alpine?.initTree) {
          window.Alpine.initTree(container);
        }

        // 利用 RequestAnimationFrame 保证 DOM 插入后再生效 CSS
        requestAnimationFrame(() => {
          container.classList.remove('pjax-loading');
        });

        initArchiveSidebar(container);
        initPostOutline(container);
      }
      
      // 如果不是因为点击关闭按钮而触发的 pjax，正常弹出窗口
      const windowManager = Alpine.store('windowManager');
      const isHome = window.location.pathname === '/';

      if (isHome) {
        window.preventAutoOpen = false;
        windowManager.showDesktop();
      } else if (windowManager.minimized) {
        window.preventAutoOpen = false;
        windowManager.revealAfterNavigation(document.title);
      } else if (window.preventAutoOpen) {
        window.preventAutoOpen = false;
      } else {
        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });
    document.addEventListener("pjax:error", (event) => {
      NProgress.done();

      const requestStatus = event?.request?.status;
      if (!requestStatus || requestStatus < 400) {
        return;
      }

      const fallbackUrl =
        event?.request?.responseURL ||
        event?.triggerElement?.href ||
        event?.requestOptions?.requestUrl;

      if (fallbackUrl) {
        window.location.assign(fallbackUrl);
      }
    });

    // 拦截主题内部可导航链接，保证切页前先显示主窗口
    document.body.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && !link.target && !link.hasAttribute('download') && !link.href.startsWith('javascript:')) {
        const targetUrl = new URL(link.href, window.location.origin);
        const windowManager = Alpine.store('windowManager');
        const isHomeLink = targetUrl.origin === window.location.origin && targetUrl.pathname === '/';
        const isLeavingDesktop = window.location.pathname === '/' && targetUrl.origin === window.location.origin && targetUrl.pathname !== '/';
        const isSameDocumentRoute =
          targetUrl.origin === window.location.origin &&
          targetUrl.pathname === window.location.pathname &&
          targetUrl.search === window.location.search;

        if (isHomeLink) {
          window.preventAutoOpen = true;
          windowManager.showDesktop();
          return;
        }

        // 首页进入内容页时，不要先弹空窗口，等 PJAX 注入目标内容后再统一开窗。
        if (isLeavingDesktop) {
          return;
        }

        // 最小化后切到其它内容页时，不要先恢复旧窗口，等待 PJAX 完成后再恢复目标页。
        if (windowManager?.minimized && !isSameDocumentRoute) {
          return;
        }

        window.dispatchEvent(new CustomEvent('open-window'));
      }
    });

  }, 0);

  initArchiveSidebar(document);
  initPostOutline(document);

  // =========== 2. 主题管理 (Apple Style) ===========
  // 负责全局暗黑模式的状态及系统跟随
  Alpine.store('theme', {
    mode: 'system', // 'light', 'dark', 'system'
    isDark: false,
    
    init() {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.mode === 'system') {
          this.applyTheme();
        }
      });

      // 首屏、BFCache 恢复、从其它界面返回时都要重新对齐主题根状态。
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
      this.applyTheme();
    },

    refresh() {
      this.mode = resolveThemeMode();
      this.applyTheme();
    },

    applyTheme() {
      this.isDark = applyRootThemeState(this.mode, this.mediaQuery);
    }
  });

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

  Alpine.data('windowTitlebar', () => ({
    title: document.title,
    shareOpen: false,
    shareView: 'actions',
    shareFeedback: '',
    shareFeedbackTimer: null,
    wechatQrDataUrl: '',
    wechatQrLoading: false,
    wechatQrError: '',
    shareMeta: {
      url: '',
      title: '',
      description: '',
      image: '',
      host: ''
    },

    init() {
      this.sync();
    },

    sync() {
      this.title = document.title;
      const previousUrl = this.shareMeta.url;
      this.shareMeta = getShareMetadata();
      if (previousUrl && previousUrl !== this.shareMeta.url) {
        this.wechatQrDataUrl = '';
        this.wechatQrError = '';
      }
    },

    setShareFeedback(message) {
      this.shareFeedback = message || '';
      if (this.shareFeedbackTimer) {
        window.clearTimeout(this.shareFeedbackTimer);
        this.shareFeedbackTimer = null;
      }

      if (!this.shareFeedback) return;

      this.shareFeedbackTimer = window.setTimeout(() => {
        this.shareFeedback = '';
        this.shareFeedbackTimer = null;
      }, 1800);
    },

    openSharePanel() {
      this.sync();
      this.shareView = 'actions';
      this.shareOpen = true;
    },

    closeSharePanel() {
      this.shareOpen = false;
      this.shareView = 'actions';
    },

    toggleSharePanel() {
      if (this.shareOpen) {
        this.closeSharePanel();
        return;
      }

      this.openSharePanel();
    },

    async copyLink(feedback = '链接已复制') {
      try {
        const copied = await copyTextFallback(this.shareMeta.url);
        this.setShareFeedback(copied ? feedback : '复制失败');
        if (copied) {
          this.closeSharePanel();
        }
        return copied;
      } catch (_error) {
        this.setShareFeedback('复制失败');
        return false;
      }
    },

    backToShareActions() {
      this.shareView = 'actions';
    },

    async openWeChatShare() {
      this.sync();
      this.shareView = 'wechat';
      this.wechatQrError = '';

      if (this.wechatQrDataUrl || this.wechatQrLoading) {
        return;
      }

      this.wechatQrLoading = true;
      try {
        this.wechatQrDataUrl = await QRCode.toDataURL(this.shareMeta.url, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 264,
          color: {
            dark: '#111827',
            light: '#0000'
          }
        });
      } catch (_error) {
        this.wechatQrError = '二维码生成失败';
      } finally {
        this.wechatQrLoading = false;
      }
    },

    async saveWeChatQr() {
      if (!this.wechatQrDataUrl) {
        await this.openWeChatShare();
      }

      if (!this.wechatQrDataUrl) {
        this.setShareFeedback('暂无可保存二维码');
        return;
      }

      const safeTitle = (this.shareMeta.title || 'share')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40) || 'share';

      const link = document.createElement('a');
      link.href = this.wechatQrDataUrl;
      link.download = `${safeTitle}-wechat-qrcode.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      this.setShareFeedback('二维码已保存');
    },

    async shareToQQ() {
      await this.copyLink('已复制链接，请在 QQ 中粘贴发送');
    },

    openExternalShare(url) {
      if (!url) return;

      const width = 720;
      const height = 640;
      const left = Math.max(0, Math.round((window.innerWidth - width) / 2));
      const top = Math.max(0, Math.round((window.innerHeight - height) / 2));
      window.open(
        url,
        'share-panel',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no,scrollbars=yes,resizable=yes`
      );
      this.closeSharePanel();
    },

    shareToTelegram() {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(this.shareMeta.url)}`;
      this.openExternalShare(shareUrl);
    },

    shareToX() {
      const shareUrl =
        `https://twitter.com/intent/tweet?url=${encodeURIComponent(this.shareMeta.url)}` +
        `&text=${encodeURIComponent(this.shareMeta.title)}`;
      this.openExternalShare(shareUrl);
    },

    shareToEmail() {
      const body = this.shareMeta.description
        ? `${this.shareMeta.title}\n\n${this.shareMeta.description}\n\n${this.shareMeta.url}`
        : `${this.shareMeta.title}\n\n${this.shareMeta.url}`;
      window.location.href =
        `mailto:?subject=${encodeURIComponent(this.shareMeta.title)}&body=${encodeURIComponent(body)}`;
      this.closeSharePanel();
    },

    async shareCurrent() {
      const payload = getSharePayload();

      try {
        if (navigator.share) {
          await navigator.share(payload);
          this.setShareFeedback('已调起分享');
          this.closeSharePanel();
          return;
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
      }

      try {
        await this.copyLink();
      } catch (_error) {}
    }
  }));

  // =========== 3. 菜单栏 ===========
  Alpine.data('menuBar', () => ({
    timeStr: '',
    appName: '',
    init() {
      this.appName = this.$el?.dataset?.siteTitle || '';
      this.tick();
      setInterval(() => this.tick(), 1000);
    },
    openSearch() {
      openSearchWidget();
    },
    tick() {
      const d = new Date();
      const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
      const timeStr = d.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: true });
      this.timeStr = dateStr.replace(/ /g, '') + ' ' + timeStr;
    }
  }));

  Alpine.data('archiveExplorer', () => ({
    activeYear: '',
    activeYearLabel: '',
    activeMonthKey: '',
    activeMonthLabel: '',
    activePostKey: '',
    activePostTitle: '',

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
        this.activePostKey = '';
        this.activePostTitle = '';
      }
    },

    selectMonth(monthKey, label) {
      this.activeMonthKey = monthKey || '';
      this.activeMonthLabel = label || '';

      const firstPost = Array.from(this.$root.querySelectorAll('[data-archive-post-option]'))
        .find((el) => el.dataset.parentMonthKey === this.activeMonthKey);

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('tagsExplorer', () => ({
    activeTagKey: '',
    activeTagPage: 1,
    activeTagName: '',
    activeTagHref: '',
    activeTagCount: '',
    activeTagColor: '',
    activeTagCover: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstTag = this.$root.querySelector('[data-tags-folder]');
      if (!firstTag) return;
      this.selectTag(firstTag.dataset.tagKey, firstTag.dataset.tagName, firstTag.dataset.tagHref, firstTag.dataset.tagCount, firstTag.dataset.tagColor, firstTag.dataset.tagCover);
    },

    selectTag(key, name, href, count, color, cover) {
      this.activeTagKey = key || '';
      this.activeTagPage = 1;
      this.activeTagName = name || '';
      this.activeTagHref = href || '';
      this.activeTagCount = count || '';
      this.activeTagColor = color || '';
      this.activeTagCover = cover || '';
      this.syncTagPosts();
    },

    selectTagPage(page) {
      const nextPage = Number(page) || 1;
      if (nextPage < 1) return;
      this.activeTagPage = nextPage;
      this.syncTagPosts();
    },

    syncTagPosts() {
      const firstPost = Array.from(this.$root.querySelectorAll('[data-tags-post-option]'))
        .find((el) => (
          el.dataset.parentTagKey === this.activeTagKey &&
          Number(el.dataset.tagPage || '1') === this.activeTagPage
        ));

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }

      const postsScroll = this.$root.querySelector('.tag-posts-scroll');
      if (postsScroll) {
        postsScroll.scrollTop = 0;
      }

      const previewScroll = this.$root.querySelector('.tags-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('tagPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstPost = this.$root.querySelector('[data-tag-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('authorPostsExplorer', () => ({
    activeSource: 'posts',
    activePostKey: '',
    activePostTitle: '',
    activeMomentKey: '',
    activeMomentTitle: '',
    authorDisplayName: '',
    authorName: '',
    momentsEnabled: false,
    momentPage: 1,
    renderedMomentPage: 1,
    momentPageSize: 10,
    momentTotal: 0,
    momentTotalPages: 0,
    momentListEl: null,
    momentPreviewEl: null,
    momentPaginationEl: null,
    momentEmptyEl: null,
    momentFetchController: null,

    async init() {
      this.authorDisplayName = this.$root.querySelector('.author-profile-name')?.textContent?.trim() || '';
      this.authorName = this.$root.dataset.authorName || '';
      this.momentsEnabled = this.$root.dataset.momentsEnabled === 'true';
      this.momentPageSize = toPositiveInt(this.$root.dataset.momentPageSize, 10);
      this.momentTotal = toPositiveInt(this.$root.dataset.momentTotal, 0);
      this.momentTotalPages = toPositiveInt(this.$root.dataset.momentTotalPages, 0);
      this.momentPage = 1;
      this.renderedMomentPage = 1;
      this.cacheMomentElements();
      this.normalizeMomentText();
      this.bindMomentControls();

      const urlState = this.readUrlState();
      const defaultSource = this.$root.dataset.defaultSource || 'posts';
      this.activeSource = urlState.source === 'moments' && this.momentsEnabled ? 'moments' : defaultSource;
      this.momentPage = urlState.momentPage;

      if (this.activeSource === 'moments' && this.momentsEnabled && this.momentPage > 1) {
        await this.goToMomentPage(this.momentPage, { preserveSelection: false, updateUrl: false });
      } else {
        await this.syncSourceSelection({ preserveCurrent: false, updateUrl: false });
      }

      this.writeUrlState();
    },

    cacheMomentElements() {
      this.momentListEl = this.$root.querySelector('[data-author-moment-list]');
      this.momentPreviewEl = this.$root.querySelector('[data-author-moment-preview-list]');
      this.momentPaginationEl = this.$root.querySelector('[data-author-moment-pagination]');
      this.momentEmptyEl = this.$root.querySelector('[data-author-moment-empty]');
    },

    bindMomentControls() {
      if (this.momentListEl && !this.momentListEl.dataset.bound) {
        const activateMoment = (event) => {
          const optionEl = event.target.closest('[data-author-moment-option]');
          if (!optionEl || !this.momentListEl.contains(optionEl)) return;
          this.selectMoment(optionEl.dataset.momentKey, optionEl.dataset.momentTitle);
        };

        this.momentListEl.addEventListener('click', activateMoment);
        this.momentListEl.addEventListener('focusin', activateMoment);
        this.momentListEl.addEventListener('mouseover', (event) => {
          const optionEl = event.target.closest('[data-author-moment-option]');
          if (!optionEl || !this.momentListEl.contains(optionEl)) return;
          if (event.relatedTarget && optionEl.contains(event.relatedTarget)) return;
          this.selectMoment(optionEl.dataset.momentKey, optionEl.dataset.momentTitle);
        });

        this.momentListEl.dataset.bound = 'true';
      }

      if (this.momentPaginationEl && !this.momentPaginationEl.dataset.bound) {
        this.momentPaginationEl.addEventListener('click', (event) => {
          const buttonEl = event.target.closest('[data-moment-page-target]');
          if (!buttonEl || !this.momentPaginationEl.contains(buttonEl)) return;
          if (buttonEl.disabled || buttonEl.classList.contains('is-disabled')) return;

          const targetPage = buttonEl.dataset.momentPageTarget === 'next'
            ? this.momentPage + 1
            : this.momentPage - 1;

          this.goToMomentPage(targetPage);
        });

        this.momentPaginationEl.dataset.bound = 'true';
      }
    },

    readUrlState() {
      if (typeof window === 'undefined') {
        return {
          source: '',
          momentPage: 1
        };
      }

      const url = new URL(window.location.href);
      return {
        source: url.searchParams.get('source') || '',
        momentPage: toPositiveInt(url.searchParams.get('momentPage'), 1)
      };
    },

    writeUrlState() {
      if (typeof window === 'undefined') return;

      const url = new URL(window.location.href);

      if (this.activeSource === 'moments' && this.momentsEnabled) {
        url.searchParams.set('source', 'moments');
        if (this.momentPage > 1) {
          url.searchParams.set('momentPage', String(this.momentPage));
        } else {
          url.searchParams.delete('momentPage');
        }
      } else {
        url.searchParams.delete('source');
        url.searchParams.delete('momentPage');
      }

      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    },

    async selectSource(source) {
      if (!source) return;
      this.activeSource = source;
      await this.syncSourceSelection();
    },

    selectPost(postKey, title) {
      this.activeSource = 'posts';
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
      this.scrollPreviewToTop();
    },

    selectMoment(momentKey, title) {
      this.activeSource = 'moments';
      this.activeMomentKey = momentKey || '';
      this.activeMomentTitle = title || '';
      this.syncMomentSelectionDom();
      this.scrollPreviewToTop();
    },

    get activeSourcePath() {
      const sourceLabel = this.activeSource === 'moments' ? '瞬间' : '文章';
      return this.authorDisplayName ? `${this.authorDisplayName} / ${sourceLabel}` : sourceLabel;
    },

    get currentPreviewTitle() {
      return this.activeSource === 'moments'
        ? (this.activeMomentTitle || '')
        : (this.activePostTitle || '');
    },

    normalizeMomentText() {
      this.$root.querySelectorAll('[data-author-moment-option]').forEach((optionEl) => {
        optionEl.dataset.momentTitle = extractTextPreview(optionEl.dataset.momentTitle || '') || '瞬间记录';

        optionEl.querySelectorAll('[data-moment-display-text]').forEach((textEl) => {
          const normalized = extractTextPreview(textEl.textContent || '');
          if (normalized) {
            textEl.textContent = normalized;
          }
        });
      });

      this.$root.querySelectorAll('[data-moment-display-title]').forEach((titleEl) => {
        const normalized = extractTextPreview(titleEl.textContent || '');
        if (normalized) {
          titleEl.textContent = normalized;
        }
      });
    },

    async syncSourceSelection({ preserveCurrent = true, updateUrl = true } = {}) {
      if (this.activeSource === 'moments') {
        if (this.momentsEnabled && this.momentPage !== this.renderedMomentPage && this.momentTotal > 0) {
          await this.goToMomentPage(this.momentPage, { preserveSelection: false, updateUrl: false });
        } else {
          const currentMoment = preserveCurrent
            ? Array.from(this.$root.querySelectorAll('[data-author-moment-option]'))
              .find((el) => el.dataset.momentKey === this.activeMomentKey)
            : null;
          const firstMoment = currentMoment || this.$root.querySelector('[data-author-moment-option]');

          if (firstMoment) {
            this.activeMomentKey = firstMoment.dataset.momentKey || '';
            this.activeMomentTitle = firstMoment.dataset.momentTitle || '';
          } else {
            this.activeMomentKey = '';
            this.activeMomentTitle = '';
            this.scrollPreviewToTop();
          }

          this.syncMomentSelectionDom();
          this.scrollListToTop();
        }

        if (updateUrl) this.writeUrlState();
        return;
      }

      const currentPost = preserveCurrent
        ? Array.from(this.$root.querySelectorAll('[data-author-post-option]'))
          .find((el) => el.dataset.postKey === this.activePostKey)
        : null;
      const firstPost = currentPost || this.$root.querySelector('[data-author-post-option]');

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
        this.scrollPreviewToTop();
      }

      this.scrollListToTop();
      this.syncMomentSelectionDom();
      if (updateUrl) this.writeUrlState();
    },

    syncMomentSelectionDom() {
      const isMomentSource = this.activeSource === 'moments';

      this.$root.querySelectorAll('[data-author-moment-option]').forEach((optionEl) => {
        const isActive = isMomentSource && optionEl.dataset.momentKey === this.activeMomentKey;
        optionEl.classList.toggle('is-active', isActive);
      });

      this.$root.querySelectorAll('[data-author-moment-panel]').forEach((panelEl) => {
        const isActive = isMomentSource && panelEl.dataset.momentKey === this.activeMomentKey;
        panelEl.hidden = !isActive;
      });
    },

    async goToMomentPage(page, { preserveSelection = true, updateUrl = true } = {}) {
      if (!this.momentsEnabled || !this.authorName) return;

      const safeUpperBound = this.momentTotalPages > 0 ? this.momentTotalPages : Number.POSITIVE_INFINITY;
      const targetPage = Math.min(Math.max(toPositiveInt(page, 1), 1), safeUpperBound);
      if (targetPage === this.renderedMomentPage && this.$root.querySelector('[data-author-moment-option]')) {
        this.momentPage = targetPage;
        if (updateUrl) this.writeUrlState();
        return;
      }

      if (this.momentFetchController) {
        this.momentFetchController.abort();
      }

      const controller = new AbortController();
      this.momentFetchController = controller;

      try {
        const result = await this.fetchMomentPage(targetPage, controller.signal);
        const momentItems = Array.isArray(result?.items) ? result.items.map((item) => normalizeMomentRecord(item)) : [];

        this.momentPage = toPositiveInt(result?.page, targetPage);
        this.renderedMomentPage = this.momentPage;
        this.momentPageSize = toPositiveInt(result?.size, this.momentPageSize);
        this.momentTotal = Math.max(Number(result?.total || 0), 0);
        this.momentTotalPages = Math.max(toPositiveInt(result?.totalPages, 1), momentItems.length > 0 ? 1 : 0);

        this.renderMomentPage(momentItems);
        this.renderMomentPagination();

        const currentMomentKey = preserveSelection ? this.activeMomentKey : '';
        const nextSelection = currentMomentKey && momentItems.some((item) => item.key === currentMomentKey)
          ? momentItems.find((item) => item.key === currentMomentKey)
          : momentItems[0];

        if (nextSelection) {
          this.activeMomentKey = nextSelection.key;
          this.activeMomentTitle = nextSelection.title;
        } else {
          this.activeMomentKey = '';
          this.activeMomentTitle = '';
        }

        this.syncMomentSelectionDom();
        this.scrollListToTop();
        this.scrollPreviewToTop();
        if (updateUrl) this.writeUrlState();
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to load author moments page:', error);
        }
      } finally {
        if (this.momentFetchController === controller) {
          this.momentFetchController = null;
        }
      }
    },

    async fetchMomentPage(page, signal) {
      const cacheKey = `author-moments:${this.authorName}:${this.momentPageSize}:${page}`;
      const cachedPayload = typeof window !== 'undefined' ? window.sessionStorage.getItem(cacheKey) : null;

      if (cachedPayload) {
        try {
          const parsed = JSON.parse(cachedPayload);
          if (Date.now() - parsed.timestamp < 5 * 60 * 1000 && parsed.data) {
            return parsed.data;
          }
        } catch {}
      }

      const requestUrl = new URL('/apis/api.moment.halo.run/v1alpha1/moments', window.location.origin);
      requestUrl.searchParams.set('page', String(page));
      requestUrl.searchParams.set('size', String(this.momentPageSize));
      requestUrl.searchParams.set('ownerName', this.authorName);
      requestUrl.searchParams.set('sort', 'spec.releaseTime,desc');

      const response = await fetch(requestUrl.toString(), {
        headers: {
          Accept: 'application/json'
        },
        signal
      });

      if (!response.ok) {
        throw new Error(`Moments request failed: ${response.status}`);
      }

      const data = await response.json();

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(cacheKey, JSON.stringify({
          timestamp: Date.now(),
          data
        }));
      }

      return data;
    },

    renderMomentPage(momentItems) {
      if (this.momentListEl) {
        this.momentListEl.innerHTML = momentItems.map((moment) => renderMomentRow(moment)).join('');
      }

      if (this.momentPreviewEl) {
        this.momentPreviewEl.innerHTML = momentItems.map((moment) => renderMomentPreview(moment, this.authorDisplayName)).join('');
      }

      if (this.momentEmptyEl) {
        this.momentEmptyEl.hidden = momentItems.length > 0;
      }
    },

    renderMomentPagination() {
      if (!this.momentPaginationEl) return;

      if (this.momentTotalPages <= 1) {
        this.momentPaginationEl.hidden = true;
        return;
      }

      const prevDisabled = this.momentPage <= 1;
      const nextDisabled = this.momentPage >= this.momentTotalPages;

      this.momentPaginationEl.hidden = false;
      this.momentPaginationEl.innerHTML = `
        <button type="button"
                class="author-page-btn tag-page-btn${prevDisabled ? ' is-disabled' : ''}"
                data-moment-page-target="prev"
                ${prevDisabled ? 'disabled' : ''}>
          上一页
        </button>
        <span class="author-page-indicator tag-page-indicator">${escapeHtml(`${this.momentPage} / ${this.momentTotalPages}`)}</span>
        <button type="button"
                class="author-page-btn tag-page-btn${nextDisabled ? ' is-disabled' : ''}"
                data-moment-page-target="next"
                ${nextDisabled ? 'disabled' : ''}>
          下一页
        </button>
      `;
    },

    scrollListToTop() {
      const listScroll = this.$root.querySelector('.author-posts-scroll');
      if (listScroll) {
        listScroll.scrollTop = 0;
      }
    },

    scrollPreviewToTop() {
      const previewScroll = this.$root.querySelector('.author-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    }
  }));

  Alpine.data('categoriesExplorer', () => ({
    activeCategoryKey: '',
    activeCategoryPage: 1,
    activeCategoryName: '',
    activeCategoryHref: '',
    activeCategoryCount: '',
    activeCategoryDescription: '',
    activeCategoryCover: '',
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstCategory = this.$root.querySelector('[data-categories-folder]');
      if (!firstCategory) return;
      this.selectCategory(
        firstCategory.dataset.categoryKey,
        firstCategory.dataset.categoryName,
        firstCategory.dataset.categoryHref,
        firstCategory.dataset.categoryCount,
        firstCategory.dataset.categoryDescription,
        firstCategory.dataset.categoryCover
      );
    },

    selectCategory(key, name, href, count, description, cover) {
      this.activeCategoryKey = key || '';
      this.activeCategoryPage = 1;
      this.activeCategoryName = name || '';
      this.activeCategoryHref = href || '';
      this.activeCategoryCount = count || '';
      this.activeCategoryDescription = description || '';
      this.activeCategoryCover = cover || '';
      this.syncCategoryPosts();
    },

    selectCategoryPage(page) {
      const nextPage = Number(page) || 1;
      if (nextPage < 1) return;
      this.activeCategoryPage = nextPage;
      this.syncCategoryPosts();
    },

    syncCategoryPosts() {
      const firstPost = Array.from(this.$root.querySelectorAll('[data-categories-post-option]'))
        .find((el) => (
          el.dataset.parentCategoryKey === this.activeCategoryKey &&
          Number(el.dataset.categoryPage || '1') === this.activeCategoryPage
        ));

      if (firstPost) {
        this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
      } else {
        this.activePostKey = '';
        this.activePostTitle = '';
      }

      const postsScroll = this.$root.querySelector('.category-posts-scroll');
      if (postsScroll) {
        postsScroll.scrollTop = 0;
      }

      const previewScroll = this.$root.querySelector('.categories-preview-scroll');
      if (previewScroll) {
        previewScroll.scrollTop = 0;
      }
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  Alpine.data('categoryPostsExplorer', () => ({
    activePostKey: '',
    activePostTitle: '',

    init() {
      const firstPost = this.$root.querySelector('[data-category-post-option]');
      if (!firstPost) return;
      this.selectPost(firstPost.dataset.postKey, firstPost.dataset.postTitle);
    },

    selectPost(postKey, title) {
      this.activePostKey = postKey || '';
      this.activePostTitle = title || '';
    }
  }));

  // =========== 4. 全局窗口控制 Store ===========
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
      const winEl = document.querySelector('.macos-window');
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

      const titlebar = winEl.querySelector('.window-titlebar');
      if (titlebar) {
        titlebar.style.opacity = '';
        titlebar.style.backdropFilter = '';
        titlebar.style.webkitBackdropFilter = '';
      }

      return winEl;
    },

    prepareWindowSurfaceForRestore(winEl = document.querySelector('.macos-window')) {
      if (!winEl) return null;

      const titlebar = winEl.querySelector('.window-titlebar');
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
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.animationToken += 1;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.sync();
    },

    open(title) {
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
      this.show = false;
      this.minimized = false;
      this.isAnimating = false;
      this.pendingOpenRequested = false;
      this.pendingOpenTitle = '';
      this.sync();
    },
    
    async minimize() {
      if (this.isAnimating || this.minimized) return;
      const winEl = document.querySelector('.macos-window');
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

      // 强行同步剔除原身视觉残留，只保留替身演出
      const animPromise = runGenieAnimation({
        windowEl: winEl,
        dockEl: dockIcon,
        action: 'minimize'
      });
      winEl.style.visibility = 'hidden';
      // 修复 titlebar 的独立合成层残留 bug
      const titlebar = winEl.querySelector('.window-titlebar');
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
       if (nextTitle) this.title = nextTitle;
       if (this.isAnimating || !this.minimized) return;
       const animationToken = ++this.animationToken;
       this.isAnimating = true;
       this.show = true;

       const winEl = document.querySelector('.macos-window');
       const dockIcon = document.getElementById('minimized-dock-icon');

       if (winEl && dockIcon) {
         // 先剔除 Dock 图标，制造其“脱壳飞出”的视觉假象
         dockIcon.style.opacity = '0';

         // titlebar 在最小化时被单独降层，恢复时提前预热合成层，避免窗口出现后 header 再晚一拍。
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

  // =========== 4.5 拖拽与缩放窗口引擎 ===========
  Alpine.data('draggableWindow', () => ({
    isDragging: false,
    isResizing: false,
    isMaximized: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    preMaxX: 0,
    preMaxY: 0,
    preMaxWidth: 0,
    preMaxHeight: 0,
    resizeDirection: '',
    resizeStartWidth: 0,
    resizeStartHeight: 0,
    resizeStartWindowX: 0,
    resizeStartWindowY: 0,
    isDesktop: window.innerWidth >= 768,
    windowEl: null,

    applyResizeMode() {
      if (!this.windowEl) return;

      this.windowEl.style.resize = 'none';

      if (!this.isDesktop) {
        this.windowEl.style.borderRadius = '';
        return;
      }

      if (this.isMaximized) {
        this.windowEl.style.borderRadius = '0';
        return;
      }

      this.windowEl.style.borderRadius = '';
    },

    getMinWidth() {
      if (!this.windowEl) return 400;
      const computed = Number.parseFloat(window.getComputedStyle(this.windowEl).minWidth);
      return Number.isFinite(computed) && computed > 0 ? computed : 400;
    },

    getMinHeight() {
      if (!this.windowEl) return 400;
      const computed = Number.parseFloat(window.getComputedStyle(this.windowEl).minHeight);
      return Number.isFinite(computed) && computed > 0 ? computed : 400;
    },

    getResizeCursor(direction) {
      if (direction === 'n' || direction === 's') return 'ns-resize';
      if (direction === 'e' || direction === 'w') return 'ew-resize';
      if (direction === 'ne' || direction === 'sw') return 'nesw-resize';
      return 'nwse-resize';
    },

    setWindowRect({ x = this.x, y = this.y, width = this.width, height = this.height } = {}) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;

      if (!this.windowEl || !this.isDesktop) return;

      this.windowEl.style.left = `${this.x}px`;
      this.windowEl.style.top = `${this.y}px`;
      this.windowEl.style.width = `${this.width}px`;
      this.windowEl.style.height = `${this.height}px`;
      this.windowEl.style.transform = 'none';
    },

    syncState() {
      if (!this.isDesktop) return;
      localStorage.setItem('theme-macOS-window-metrics', JSON.stringify({
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        isMaximized: this.isMaximized,
        preMaxX: this.preMaxX,
        preMaxY: this.preMaxY,
        preMaxWidth: this.preMaxWidth,
        preMaxHeight: this.preMaxHeight
      }));
    },

    init() {
      this.windowEl = this.$el;
      
      try {
        const storedStr = localStorage.getItem('theme-macOS-window-metrics');
        if (storedStr) {
          const stored = JSON.parse(storedStr);
          this.x = stored.x || 0;
          this.y = stored.y || 0;
          this.width = stored.width || 0;
          this.height = stored.height || 0;
          this.isMaximized = stored.isMaximized || false;
          this.preMaxX = stored.preMaxX || 0;
          this.preMaxY = stored.preMaxY || 0;
          this.preMaxWidth = stored.preMaxWidth || 0;
          this.preMaxHeight = stored.preMaxHeight || 0;
        }
      } catch(e) {}

      if (this.width === 0) this.updateMeasurements();
      else if (this.isDesktop) {
         this.windowEl.style.width = `${this.width}px`;
         this.windowEl.style.height = `${this.height}px`;
         this.applyTransform();
      }

      this.applyResizeMode();

      if (this.isDesktop && window.ResizeObserver) {
        let resizeTimeout;
        const ro = new ResizeObserver(() => {
          if (this.isMaximized || this.isResizing) return;
          const newW = this.windowEl.offsetWidth;
          const newH = this.windowEl.offsetHeight;
          if (newW && newH && (this.width !== newW || this.height !== newH)) {
             this.width = newW;
             this.height = newH;
             clearTimeout(resizeTimeout);
             resizeTimeout = setTimeout(() => this.syncState(), 400);
          }
        });
        ro.observe(this.windowEl);
      }
      
      const resizeHandler = () => {
        this.isDesktop = window.innerWidth >= 768;
        if (!this.isDesktop) {
          this.isDragging = false;
          this.isResizing = false;
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          this.windowEl.style.transform = '';
          this.windowEl.style.left = '';
          this.windowEl.style.top = '';
          this.windowEl.style.width = '100%';
          this.windowEl.style.height = '100%';
        } else {
           if (this.width === 0) this.updateMeasurements();
           if (this.isMaximized) {
             this.width = window.innerWidth;
             this.height = window.innerHeight - 28;
             this.windowEl.style.width = `${this.width}px`;
             this.windowEl.style.height = `${this.height}px`;
             this.syncState();
           }
           this.clampPositions(); 
           this.applyTransform();
        }
        this.applyResizeMode();
      };
      // Debounce window resize
      let timeout;
      window.addEventListener('resize', () => {
        clearTimeout(timeout);
        timeout = setTimeout(resizeHandler, 100);
      });

      // 初始化显示逻辑
      const isHome = window.location.pathname === '/';

      // 深链接页面必须优先于本地窗口缓存，否则文章/单页会继承首页的关窗或最小化状态。
      if (!isHome) {
        this.$store.windowManager.minimized = false;
        this.$store.windowManager.open(document.title);
      } else {
        this.$store.windowManager.showDesktop();
        this.windowEl.style.transition = 'none';
        this.windowEl.style.opacity = '0';
        this.windowEl.style.visibility = 'hidden';
        this.windowEl.style.pointerEvents = 'none';
        this.windowEl.style.transform = 'none';
      }
    },

    updateMeasurements() {
       if (this.isDesktop) {
         const width = Math.min(1200, window.innerWidth * 0.85);
         const height = Math.min(900, Math.max(500, window.innerHeight * 0.85));
         const x = (window.innerWidth - width) / 2;
         const y = Math.max(28, (window.innerHeight - height) / 2);

         this.setWindowRect({ x, y, width, height });
         this.applyResizeMode();
         this.syncState();
       }
    },

    clampPositions() {
       if (!this.isDesktop || this.isMaximized) return;
       const maxX = window.innerWidth - 80;
       const maxY = window.innerHeight - 40;
       const minX = -this.width + 80;
       const minY = 28; // MenuBar margin

       if (this.x > maxX) this.x = maxX;
       if (this.x < minX) this.x = minX;
       if (this.y > maxY) this.y = maxY;
       if (this.y < minY) this.y = minY;
    },

    applyTransform() {
       if (!this.isDesktop) return;
       this.setWindowRect();
    },

    toggleMaximize() {
      if (!this.isDesktop) return;
      const winEl = document.querySelector('.macos-window');
      if (!winEl) return;
      
      winEl.style.transition = 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
      if (this.isMaximized) {
        this.width = this.preMaxWidth;
        this.height = this.preMaxHeight;
        this.x = this.preMaxX;
        this.y = this.preMaxY;
        winEl.style.width = `${this.width}px`;
        winEl.style.height = `${this.height}px`;
        this.applyTransform();
        this.isMaximized = false;
      } else {
        this.preMaxWidth = winEl.offsetWidth;
        this.preMaxHeight = winEl.offsetHeight;
        this.preMaxX = this.x;
        this.preMaxY = this.y;
        
        this.width = window.innerWidth;
        this.height = window.innerHeight - 28;
        this.x = 0;
        this.y = 28;
        
        winEl.style.width = `${this.width}px`;
        winEl.style.height = `${this.height}px`;
        this.applyTransform();
        this.isMaximized = true;
      }
      this.applyResizeMode();
      this.syncState();
      
      setTimeout(() => {
        if (!this.isDragging) winEl.style.transition = '';
      }, 300);
    },

    onDragStart(e) {
      if (!this.isDesktop || this.isMaximized) return;
      if (this.isResizing || e.target.closest('button, a, .traffic-lights, svg, .desktop-icon, .window-resize-handle')) return;
      
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.initialX = this.x;
      this.initialY = this.y;
      document.body.style.userSelect = 'none';
      
      if (this.windowEl) this.windowEl.style.transition = 'none';
    },

    startResize(direction, e) {
      if (!this.isDesktop || this.isMaximized || !this.windowEl) return;

      this.isResizing = true;
      this.resizeDirection = direction;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.resizeStartWidth = this.windowEl.offsetWidth;
      this.resizeStartHeight = this.windowEl.offsetHeight;
      this.resizeStartWindowX = this.x;
      this.resizeStartWindowY = this.y;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = this.getResizeCursor(direction);
      this.windowEl.style.transition = 'none';
    },

    onPointerMove(e) {
      if (this.isResizing) {
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        const direction = this.resizeDirection;
        const minWidth = this.getMinWidth();
        const minHeight = this.getMinHeight();

        let nextX = this.resizeStartWindowX;
        let nextY = this.resizeStartWindowY;
        let nextWidth = this.resizeStartWidth;
        let nextHeight = this.resizeStartHeight;

        if (direction.includes('e')) nextWidth = this.resizeStartWidth + dx;
        if (direction.includes('s')) nextHeight = this.resizeStartHeight + dy;
        if (direction.includes('w')) {
          nextWidth = this.resizeStartWidth - dx;
          nextX = this.resizeStartWindowX + dx;
        }
        if (direction.includes('n')) {
          nextHeight = this.resizeStartHeight - dy;
          nextY = this.resizeStartWindowY + dy;
        }

        if (nextWidth < minWidth) {
          if (direction.includes('w')) nextX += nextWidth - minWidth;
          nextWidth = minWidth;
        }

        if (nextHeight < minHeight) {
          if (direction.includes('n')) nextY += nextHeight - minHeight;
          nextHeight = minHeight;
        }

        if (direction.includes('n') && nextY < 28) {
          nextHeight += nextY - 28;
          nextY = 28;
          if (nextHeight < minHeight) nextHeight = minHeight;
        }

        this.setWindowRect({
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight
        });
        return;
      }

      if (!this.isDragging) return;

      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;

      this.x = this.initialX + dx;
      this.y = this.initialY + dy;

      this.clampPositions();
      this.applyTransform();
    },

    onPointerEnd() {
      if (!this.isDragging && !this.isResizing) return;

      this.isDragging = false;
      this.isResizing = false;
      this.resizeDirection = '';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      this.$el.style.transition = '';

      this.width = this.$el.offsetWidth;
      this.height = this.$el.offsetHeight;
      this.syncState();
    },

    closeWindow() {
      const shouldReturnHome = window.location.pathname !== '/';

      this.$store.windowManager.hide();

      if (shouldReturnHome && window.pjax) {
        window.preventAutoOpen = true;
        window.setTimeout(() => window.pjax.loadUrl('/'), 180);
      }
    }
  }));

  // =========== 5. Dock 物理级高斯放大引擎 (1:1 标定) ===========
  Alpine.data('dock', () => ({
    init() {
      const dockBar = this.$refs.dockBar;
      if (!dockBar) return;
      const enableMagnification = this.$el.dataset.magnification !== 'false';
      const showLabels = this.$el.dataset.showLabels === 'true';
      
      const baseSize = 48;
      const maxSize = 60;
      const range = 120;
      const maxLift = 10;
      let rafId = null;

      const getIcons = () => Array.from(dockBar.querySelectorAll('.dock-icon'));
      const maxScale = maxSize / baseSize;

      const resetIcons = () => {
        getIcons().forEach((icon) => {
          icon.classList.add('dock-animating');
          icon.classList.remove('dock-tooltip-visible');
          icon.style.width = `${baseSize}px`;
          icon.style.height = `${baseSize}px`;
          icon.style.transform = 'translateY(0px)';
          icon.style.zIndex = '';
        });
      };

      const updateDock = (mouseX) => {
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
            const influence = Math.cos(ratio * Math.PI / 2);
            const softenedInfluence = influence * influence;
            scale = 1 + (maxScale - 1) * softenedInfluence;
          }

          const lift = ((scale - 1) / (maxScale - 1)) * maxLift;
          icon.style.width = `${baseSize * scale}px`;
          icon.style.height = `${baseSize * scale}px`;
          icon.style.transform = `translateY(-${lift}px)`;
          icon.style.zIndex = String(10 + Math.round(scale * 10));

          if (distance < nearestDistance) {
            nearestDistance = distance;
            tooltipTarget = icon;
          }
        });

        if (showLabels && tooltipTarget && nearestDistance < range * 0.72) {
          tooltipTarget.classList.add('dock-tooltip-visible');
        }
      };

      this.$el.addEventListener('mousemove', (e) => {
        if (!enableMagnification) return;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => updateDock(e.clientX));
      });

      this.$el.addEventListener('mouseleave', () => {
        cancelAnimationFrame(rafId);
        requestAnimationFrame(resetIcons);
      });
    }
  }));

  // =========== 6. 桌面图标管理 ===========
  Alpine.data('desktopIcons', () => ({
    selectedId: null,

    select(id) { this.selectedId = id; },

    handleOutsideClick(e) {
      if (!e.target.closest('.desktop-icon')) {
        this.selectedId = null;
      }
    }
  }));

  observeSearchWidget();
  initArchiveSidebar(document);

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (openSearchWidget()) {
        event.preventDefault();
      }
    }
  });
}
