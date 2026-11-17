export { prepareCommentPageHistoryView } from './comment-history.js';
import { installCommentPageHistory } from './comment-history.js';
import { installCommentEditReadiness } from '../../../../../shared/comment-edit-readiness.js';
import { isCoveredNativeBeforeUnload } from './navigation-admission.js';

const GUARD_ID = 'official-comment-drafts';
const installations = new WeakMap();

function captureMomentDrafts(root) {
  return Array.from(root.querySelectorAll('[data-moment-card] form[data-moment-comment-form] textarea[data-moment-comment-input]'), node => {
    const form = node.form;
    return { node, tag: 'moment-comment', content: node.value, target: form.dataset.momentDraftComment,
      quote: form.dataset.momentDraftReply, dirty: Boolean(node.value.trim()), busy: form.getAttribute('aria-busy') === 'true' };
  });
}

// The official component owns draft storage, permissions and saving. Read its
// current state only; cancellation and failed navigation never reset a form.
function captureForms(host, root) {
  const states = captureMomentDrafts(root);
  if (!host.customElements?.get('base-form') && !host.customElements?.get('comment-edit-form')) return states;
  const visit = (scope) => {
    for (const node of scope.querySelectorAll('*')) {
      const tag = node.localName;
      const type = tag === 'base-form' || tag === 'comment-edit-form'
        ? host.customElements?.get(tag) : null;
      if (type && node instanceof type && node.isConnected) {
        if (tag === 'base-form' && typeof node.getDraftSnapshot === 'function') {
          const draft = node.getDraftSnapshot();
          const owner = node.getRootNode()?.host;
          const widget = owner?.localName === 'comment-form' ? owner.getRootNode()?.host : null;
          const pending = Boolean(node.editorRef?.value?.hasPendingUpload);
          states.push({ node, tag, key: draft.key, storedDraft: draft.storedDraft,
            revision: draft.revision, content: draft.content, hidden: draft.hidden,
            paginationPersistent: widget?.localName === 'comment-widget',
            mount: widget?.localName === 'comment-widget' ? widget.parentElement : null,
            pending, dirty: Boolean(draft.content) || pending,
            busy: Boolean(node.uploading || node.submitting || owner?.submitting) });
        } else if (tag === 'comment-edit-form' && typeof node.dirty === 'boolean') {
          const pending = Boolean(node.editorRef?.value?.hasPendingUpload);
          states.push({ node, tag, content: node.content, baseline: node.baseline,
            version: node.version, resource: node.resource, target: node.target?.metadata?.name,
            pending, dirty: node.dirty || pending, busy: Boolean(node.saving) });
        }
      }
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  };
  visit(root);
  return states;
}

function unchanged(before, after) {
  // An empty editor can mount lazily while a document is loading. Only a
  // changed draft or an upload/submission needs to revoke the leave permit.
  const relevant = state => state.dirty || state.busy;
  const previous = before.filter(relevant);
  const current = new Map(after.filter(relevant).map(state => [state.node, state]));
  return current.size === previous.length && previous.every(state => {
    if (state.dormant) {
      const next = [...current.values()].find(s => s.mount === state.mount && s.key === state.key);
      return next && !next.busy && !next.pending && next.paginationPersistent && next.tag === 'base-form'
        && next.storedDraft === state.storedDraft && next.revision === state.revision
        && next.content === state.content && next.hidden === state.hidden;
    }
    const next = current.get(state.node);
    return next && Object.keys(state).every(key => state[key] === next[key]);
  });
}

export function installCommentDraftGuard(host = window, root = document) {
  if (installations.has(host)) return installations.get(host);
  void installCommentEditReadiness(host);
  void installCommentPageHistory(host);
  // A previously visited article renders the same official SSR mount before
  // IntersectionObserver recreates its editor. Remember key/version only,
  // never draft text or detached DOM; read the exact current store on demand.
  const visitedDrafts = new Map();
  const capture = () => {
    const states = captureForms(host, root);
    for (const [id, ref] of visitedDrafts) {
      const mount = root.getElementById(id);
      if (!mount || states.some(s => s.mount === mount && (s.dirty || s.busy || (s.key && s.key !== ref.key)))) continue;
      try {
        const storedDraft = host.localStorage.getItem(ref.key);
        const draft = JSON.parse(storedDraft);
        if (draft?.revision !== ref.revision || typeof draft.content !== 'string' || !draft.content) continue;
        states.push({ node:mount, mount, tag:'base-form', dormant:true, paginationPersistent:true,
          key:ref.key, revision:ref.revision, storedDraft, content:draft.content, hidden:draft.hidden ?? false,
          pending:false, busy:false, dirty:true });
      } catch { /* No verified persisted draft. A subsequently changed form still revokes the permit. */ }
    }
    return states;
  };
  const guard = {
    id: GUARD_ID,
    capture,
    allow(snapshot, context) {
      if (snapshot.some((state) => state.busy)) return false;
      // Pagination retains the top-level new-comment form, but can replace
      // reply/edit forms inside rows. Hash detail changes can replace both.
      return !snapshot.some((state) => state.dirty
        && !(context.commentPageHistory && state.paginationPersistent))
        || host.confirm('评论中有未完成的内容。确定继续离开当前页面吗？');
    },
    isUnchanged: (snapshot) => unchanged(snapshot, capture()),
    commit(snapshot) {
      for (const state of snapshot) {
        const id = state.mount?.id;
        if (!state.paginationPersistent || !id?.startsWith('comment-') || state.dormant
          || !state.dirty || state.busy || state.pending || !state.key || !state.revision || !state.storedDraft) continue;
        visitedDrafts.delete(id);
        visitedDrafts.set(id, { key:state.key, revision:state.revision });
        if (visitedDrafts.size > 32) visitedDrafts.delete(visitedDrafts.keys().next().value);
      }
    }
  };
  host.addEventListener('beforeunload', (event) => {
    if (!isCoveredNativeBeforeUnload(event, GUARD_ID)) {
      if (captureMomentDrafts(root).some(state => state.dirty || state.busy)) {
        event.preventDefault();
        event.returnValue = true;
      }
      return;
    }
    // Only suppress official handlers already covered by the same accepted
    // leave permit. Unrelated plugins keep their own native protection.
    const forms = capture().filter(({ dirty, node }) => dirty && typeof node.onBeforeUnload === 'function');
    for (const { node } of forms) host.removeEventListener('beforeunload', node.onBeforeUnload);
    host.queueMicrotask(() => {
      const current = capture();
      for (const { node } of forms) {
        if (current.some((state) => state.node === node && state.dirty)) {
          host.addEventListener('beforeunload', node.onBeforeUnload);
        }
      }
    });
  }, true);
  installations.set(host, guard);
  return guard;
}
