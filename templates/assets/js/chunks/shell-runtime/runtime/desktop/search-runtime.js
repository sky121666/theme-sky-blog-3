import{n as g}from"../../../rolldown-runtime.js?v=0.9.51&r=9c7c63bdc80a";var _=g({observeSearchWidget:()=>b,openSearchWidget:()=>S}),w=2e3,m=50,o=null,i=null,n=null,p=new WeakSet;function u(t){const r=[];for(const e of t.children)e.inert||e.hidden||(e.matches("button, input, select, textarea, a[href], [tabindex]")&&!e.matches(":disabled")&&e.tabIndex>=0&&e.getClientRects().length&&getComputedStyle(e).visibility==="visible"&&r.push(e),r.push(...u(e.shadowRoot||e)));return r}function v(t){p.has(t)||(p.add(t),t.addEventListener("keydown",r=>{if(r.key!=="Tab"||r.defaultPrevented)return;const e=u(t);if(!e.length)return;const a=e[0],s=e.at(-1),l=r.composedPath().find(x=>e.includes(x));l&&l!==(r.shiftKey?a:s)||(r.preventDefault(),(r.shiftKey?s:a).focus({preventScroll:!0}))}))}function d(t,r,e){if(t.getElementById(r))return;const a=document.createElement("style");a.id=r,a.textContent=e,t.appendChild(a)}function h(t){return`
    ${t} > div:first-of-type,
    ${t} > div:last-of-type {
      background: var(--mac-search-chrome) !important;
      border-color: var(--halo-search-widget-divider-color) !important;
      padding: 12px 14px !important;
    }
    ${t} form {
      height: 50px !important;
      border-radius: 12px !important;
      background: var(--mac-search-input) !important;
      border: 1px solid var(--halo-search-widget-divider-color) !important;
      box-shadow: none !important;
      transition: border-color 120ms ease-out, box-shadow 120ms ease-out !important;
    }
    ${t} form:focus-within {
      border-color: color-mix(in srgb, var(--halo-search-widget-primary-color) 70%, transparent) !important;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--halo-search-widget-primary-color) 16%, transparent) !important;
    }
    ${t} input {
      font-size: 16px !important;
      letter-spacing: -0.01em !important;
      caret-color: var(--halo-search-widget-primary-color);
    }
    ${t} input::placeholder { color: var(--halo-search-widget-muted-color) !important; }
    ${t} li[data-index] {
      border: 1px solid transparent !important;
      border-radius: 9px !important;
      background: transparent !important;
      box-shadow: none !important;
      transition: background-color 100ms ease-out, border-color 100ms ease-out !important;
    }
    @media (hover: hover) and (pointer: fine) {
      ${t} li[data-index]:hover {
        background: var(--halo-search-widget-hit-bg-color) !important;
      }
    }
    ${t} li[data-index][class*='!bg-primary'] {
      background: var(--halo-search-widget-primary-color) !important;
      color: var(--theme-accent-contrast, #fff) !important;
    }
    ${t} li[data-index][class*='!bg-primary'] :is(h2, p, span, mark) {
      color: var(--theme-accent-contrast, #fff) !important;
    }
    ${t} li[data-index]:focus-visible {
      outline: 2px solid var(--halo-search-widget-primary-color);
      outline-offset: -2px;
    }
    ${t} kbd {
      min-width: 23px !important;
      min-height: 22px !important;
      padding: 2px 5px !important;
      border-radius: 5px !important;
      background: var(--mac-search-input) !important;
      border-color: var(--halo-search-widget-kbd-border-color) !important;
      box-shadow: 0 1px 0 var(--halo-search-widget-divider-color) !important;
      font-size: 11px !important;
    }
    @media (max-width: 600px) {
      ${t} > div:last-of-type { gap: 10px; justify-content: center; }
      ${t} > div:last-of-type > div { margin-inline: 0 !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      ${t} form, ${t} li[data-index] { transition: none !important; }
    }
  `}function y(t){const r=t?.shadowRoot;if(!r)return!1;v(r),d(r,"mac-search-style",`
    :host {
      --mac-search-chrome: rgba(248, 248, 250, 0.82);
      --mac-search-input: rgba(255, 255, 255, 0.68);
      color-scheme: light;
    }
    :host-context(.dark), :host-context([data-color-scheme='dark']) {
      --mac-search-chrome: rgba(34, 34, 36, 0.84);
      --mac-search-input: rgba(255, 255, 255, 0.055);
      color-scheme: dark;
    }
    .modal__wrapper {
      align-items: flex-start !important;
      justify-content: center !important;
      padding: clamp(54px, 12vh, 120px) 16px max(16px, env(safe-area-inset-bottom)) !important;
      box-sizing: border-box;
    }
    .modal__layer { background: transparent !important; backdrop-filter: none !important; }
    .modal__content {
      width: min(640px, calc(100vw - 32px)) !important;
      max-width: 640px !important;
      max-height: min(78dvh, 760px) !important;
      border-radius: 18px !important;
      border: 1px solid rgba(255, 255, 255, 0.48) !important;
      background: rgba(248, 248, 250, 0.88) !important;
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22), 0 4px 14px rgba(15, 23, 42, 0.1) !important;
      backdrop-filter: blur(28px) saturate(160%) !important;
      -webkit-backdrop-filter: blur(28px) saturate(160%) !important;
      transform-origin: center top;
      animation: mac-search-enter 160ms cubic-bezier(0.16, 1, 0.3, 1) both !important;
    }
    :host-context(.dark) .modal__content,
    :host-context([data-color-scheme='dark']) .modal__content {
      border-color: rgba(255, 255, 255, 0.13) !important;
      background: rgba(30, 30, 32, 0.9) !important;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.18) !important;
    }
    @keyframes mac-search-enter {
      from { opacity: 0; transform: translateY(-4px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .modal__content { animation: none !important; }
    }
  `);const e=r.querySelector("search-form");return e?e.shadowRoot?(d(e.shadowRoot,"mac-search-form-style",h(":host")),!0):!1:r.querySelector("form")?(d(r,"mac-search-form-style",h(".modal__content")),!0):!1}function f(){o?.disconnect(),o=null,n!==null&&(window.clearTimeout(n),n=null),i!==null&&(window.clearTimeout(i),i=null)}function c(){const t=Array.from(document.querySelectorAll("search-modal"));if(!t.length)return!1;let r=!0;return t.forEach(e=>{y(e)||(r=!1)}),r&&f(),r}function S(){return typeof window.SearchWidget?.open=="function"?(b(),window.SearchWidget.open(),window.requestAnimationFrame(()=>{window.setTimeout(()=>{c()},0)}),!0):!1}function b(){if(c()||o)return;o=new MutationObserver(()=>{c()}),o.observe(document.documentElement,{childList:!0,subtree:!0}),i=window.setTimeout(()=>{f()},w);const t=()=>{n=null,!(!o||c())&&(n=window.setTimeout(t,m))};n=window.setTimeout(t,m)}export{_ as t};
