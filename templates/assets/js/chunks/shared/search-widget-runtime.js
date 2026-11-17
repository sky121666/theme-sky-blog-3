import{n as $}from"../rolldown-runtime.js?v=0.9.60&r=a88f798626e6";var W=$({observeSearchWidget:()=>_,openSearchWidget:()=>L}),E=2e3,g=50,s=null,p=null,c=null,w=new WeakSet,x=new WeakSet,O=/^handleOpenLink\(([$\w]+)\)\{let([$\w]+)=[$\w]+\(\[\1,\.\.\.this\.historyHits\],[`'"]id[`'"]\)\.slice\(0,50\);localStorage\.setItem\([$\w]+,JSON\.stringify\(\2\)\),this\.historyHits=\2,window\.location\.href=\1\.permalink\}$/;function y(t,e){if(!e||x.has(e)||typeof t.close!="function"||typeof e.handleOpenLink!="function"||!Array.isArray(e.historyHits)||!O.test(Function.prototype.toString.call(e.handleOpenLink).replace(/\s+/g,"")))return;x.add(e);const r=e.handleOpenLink;let n=!1;e.addEventListener("keydown",o=>{o.key==="Enter"&&o.composedPath()[0]?.matches?.("input")&&o.preventDefault()},{capture:!0}),e.handleOpenLink=function(o){if(n)return;let a;try{a=new URL(o.permalink,window.location.href)}catch{return r.call(this,o)}if(typeof window.pjax?.loadUrl!="function"||!["http:","https:"].includes(a.protocol)||a.origin!==window.location.origin||a.username||a.password||a.pathname===window.location.pathname&&a.search===window.location.search&&a.hash)return r.call(this,o);let d=!1;const u=({detail:i})=>{i?.url===a.href&&(d=!0)};document.addEventListener("theme:navigation-accepted",u);let f;try{f=window.pjax.loadUrl(a.href,{triggerElement:e})}finally{document.removeEventListener("theme:navigation-accepted",u)}if(d){const i=new Set,b=[o,...this.historyHits].filter(l=>i.has(l.id)?!1:(i.add(l.id),!0)).slice(0,50);this.historyHits=b;try{window.localStorage.setItem("halo:search-widgets:history:hits",JSON.stringify(b))}catch(l){console.warn("[theme] Search history could not be saved",l)}t.close()}return n=d,Promise.resolve(f).catch(i=>(console.warn("[theme] Search navigation failed",i),!1)).finally(()=>{n=!1})}}function S(t){const e=[];for(const r of t.children)r.inert||r.hidden||(r.matches("button, input, select, textarea, a[href], [tabindex]")&&!r.matches(":disabled")&&r.tabIndex>=0&&r.getClientRects().length&&getComputedStyle(r).visibility==="visible"&&e.push(r),e.push(...S(r.shadowRoot||r)));return e}function R(t){w.has(t)||(w.add(t),t.addEventListener("keydown",e=>{if(e.key!=="Tab"||e.defaultPrevented)return;const r=S(t);if(!r.length)return;const n=r[0],o=r.at(-1),a=e.composedPath().find(d=>r.includes(d));a&&a!==(e.shiftKey?n:o)||(e.preventDefault(),(e.shiftKey?o:n).focus({preventScroll:!0}))}))}function h(t,e,r){if(t.getElementById(e))return;const n=document.createElement("style");n.id=e,n.textContent=r,t.appendChild(n)}function v(t){return`
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
  `}function T(t){const e=t?.shadowRoot;if(!e)return!1;R(e),h(e,"mac-search-style",`
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
  `);const r=e.querySelector("search-form");return r?r.shadowRoot?(y(t,r),h(r.shadowRoot,"mac-search-form-style",v(":host")),!0):!1:e.querySelector("form")?(y(t,t),h(e,"mac-search-form-style",v(".modal__content")),!0):!1}function k(){s?.disconnect(),s=null,c!==null&&(window.clearTimeout(c),c=null),p!==null&&(window.clearTimeout(p),p=null)}function m(){const t=Array.from(document.querySelectorAll("search-modal"));if(!t.length)return!1;let e=!0;return t.forEach(r=>{T(r)||(e=!1)}),e&&k(),e}function L(t){return typeof window.SearchWidget?.open=="function"?(_(),window.SearchWidget.open(t),window.requestAnimationFrame(()=>{window.setTimeout(()=>{m()},0)}),!0):!1}function _(){if(m()||s)return;s=new MutationObserver(()=>{m()}),s.observe(document.documentElement,{childList:!0,subtree:!0}),p=window.setTimeout(()=>{k()},E);const t=()=>{c=null,!(!s||m())&&(c=window.setTimeout(t,g))};c=window.setTimeout(t,g)}export{W as t};
