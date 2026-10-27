// CommentWidget 3.4.0 exposes its editor before the 50 ms readiness poll has
// captured the sanitized baseline. An input in that interval becomes baseline
// and cannot be saved. Keep only the edit surface hidden until the original
// method finishes; the official loading, cancel, sanitization and save paths
// remain in charge. No draft or private content field is rewritten here.
//
// This is deliberately pinned to the audited method, not every component with
// these field names. A changed/upstream-fixed implementation is left untouched.
const AFFECTED_FOCUS_EDITOR = 'async focusEditor(){await this.updateComplete;let e=this.editorRef.value;if(e){for(let t=0;t<100&&!e.editor&&this.isConnected;t++)await new Promise(e=>setTimeout(e,50));this.isConnected&&e.editor&&(this.baseline=pX(e.editor.getHTML()),this.content===this.initialRaw&&(this.content=this.baseline),e.setFocus())}}';
const installed = new WeakSet();

export async function installCommentEditReadiness(host = window) {
  const registry = host?.customElements;
  if (typeof registry?.whenDefined !== 'function') return false;
  await registry.whenDefined('comment-edit-form');
  const prototype = registry.get('comment-edit-form')?.prototype;
  if (!prototype) return false;
  if (installed.has(prototype)) return true;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'focusEditor');
  const original = descriptor?.value;
  const editor = registry.get('comment-editor')?.prototype;
  if (typeof original !== 'function' || !descriptor.writable
    || Function.prototype.toString.call(original).replace(/\s+/g, '') !== AFFECTED_FOCUS_EDITOR.replace(/\s+/g, '')
    || !['loadLatest', 'onEditorUpdate', 'handleSave', 'handleCancel'].every(name => typeof prototype[name] === 'function')
    || typeof Object.getOwnPropertyDescriptor(prototype, 'dirty')?.get !== 'function'
    || typeof Object.getOwnPropertyDescriptor(prototype, 'canSave')?.get !== 'function'
    || typeof editor?.createEditor !== 'function' || typeof editor?.setFocus !== 'function') return false;

  const pending = new WeakMap();
  Object.defineProperty(prototype, 'focusEditor', {
    ...descriptor,
    async value(...args) {
      // The official loadLatest() calls this before rendering the edit surface.
      // Unsupported instances retain the original method without DOM changes.
      if (!this.isConnected || !this.renderRoot?.insertBefore
        || typeof this.baseline !== 'string' || typeof this.initialRaw !== 'string'
        || !this.editorRef || typeof this.ownerDocument?.createElement !== 'function') {
        return original.apply(this, args);
      }
      let state = pending.get(this);
      if (!state) {
        const style = this.ownerDocument.createElement('style');
        style.setAttribute('data-theme-comment-edit-readiness', '');
        // visibility also prevents keyboard focus/input, including across the
        // editor's ShadowRoot. Cancel and the rest of the form stay usable.
        style.textContent = 'comment-editor { visibility: hidden !important; pointer-events: none !important; }';
        state = { style, calls: 0, busy: this.getAttribute('aria-busy') };
        pending.set(this, state);
        // Stay before Lit's root render marker. Appending after its template
        // would let the next loading -> editor render remove this guard.
        this.renderRoot.insertBefore(style, this.renderRoot.firstChild);
        this.setAttribute('aria-busy', 'true');
      }
      state.calls += 1;
      try {
        return await original.apply(this, args);
      } finally {
        state.calls -= 1;
        if (!state.calls) {
          state.style.remove();
          pending.delete(this);
          if (this.getAttribute('aria-busy') === 'true') {
            if (state.busy === null) this.removeAttribute('aria-busy');
            else this.setAttribute('aria-busy', state.busy);
          }
        }
        // The original setFocus() already schedules focus after this promise.
        // Do not add a second focus/timer that could outlive a closed form.
      }
    }
  });
  installed.add(prototype);
  return true;
}
