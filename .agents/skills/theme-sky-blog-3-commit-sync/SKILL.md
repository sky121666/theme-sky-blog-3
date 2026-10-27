---
name: theme-sky-blog-3-commit-sync
description: Use in the theme-sky-blog-3 repository when preparing commits or release checkpoints, deciding which public status, project progress, plugin contract, version, and release files must be synchronized with current changes, and keeping generated assets and documentation in the same intentional commit.
---

# Theme Sky Blog 3 Commit Sync

## Scope

Use this project-local skill only in `theme-sky-blog-3` for commit, tag, or release checkpoints. Read the repository-root `AGENTS.md` first and preserve unrelated user changes.

## Choose the authorized work, including direct invocation

Before using any workflow below, derive the requested work from the full current task and applicable project rules. Explicit Skill invocation or a router suggestion selects knowledge only. “Prepare a commit”, “explain the release process” and “check release readiness” remain analysis/preparation unless the task also authorizes changes. Do not advance through these stages automatically:

| Stage | Applicable condition and boundary |
| --- | --- |
| A. Analyze/check | Read state, list affected documents, inspect readiness, or draft commit/release text in the conversation. No file or Git writes. |
| B. Modify files | The task authorizes the specific documentation/version/source edits. Editing does not itself authorize staging. |
| C. Stage | The task authorizes staging, or staging is a necessary part of an authorized local commit. Stage only attributable authorized paths/hunks; preserve unrelated index/worktree content. |
| D. Local commit | Current task authorization or applicable project policy permits this commit and its checks pass. Current explicit “do not commit” restrictions still control. |
| E. Push branch | Authorization covers the intended remote effect; verify repository, remote, branch and the entire outgoing commit range, including prior commits. A local commit is not push permission. |
| F. Create local tag | Authorization covers tag creation; verify the exact tag name and target commit. A version-file edit does not authorize a tag. |
| G. Push tag / publish | Separately verify the exact remote tag or release target and its effects are within authorization. Never push all tags or publish a GitHub Release merely because a local tag exists. |

These are independently conditional stages, not a mandatory pipeline. Reuse existing authorization that already covers the workflow; do not ask again for every command. Missing permission blocks only its dependent stage. Preserve any applicable project allowance for autonomous local commits without importing that allowance from another repository.

## Commit Workflow

1. Confirm the repository and inspect `git status --short` plus relevant source diffs.
2. Separate source changes from generated `templates/assets/**`; rebuild only when source changes require it and the task authorizes those writes. Readiness-only checks report the required build without performing it.
3. Decide which ownership document changed:
   - `README.md`: public capabilities, plugin compatibility summary, installation, or current limitations.
   - `docs/项目进度.md`: active work, next work, or completed milestones.
   - `docs/插件适配契约.md`: theme-local plugin `contractVersion`, `testedVersion`, supported surfaces, or evidence.
   - `docs/发布说明.md`: release-facing change summary and verification evidence.
4. When file updates are authorized under stage B, update only affected documents; otherwise list the proposed synchronization. A shared `halo-plugin-*` baseline update alone is not proof that this theme's contract changed.
5. Run validation required by `AGENTS.md` and the changed surface within the task’s authorized effects; inspect scripts first and report blocked checks separately from checks that are not applicable.
6. Only when stages C/D are authorized, stage the intended source, generated assets and affected documents and commit a coherent change. Otherwise stop at the requested analysis or file edits. Never include unrelated staged content.

Read `references/readme-sync-rules.md` when document ownership is unclear.

## Release Workflow

For a requested release checkpoint, first determine whether the request is a readiness check, file preparation or an actual release operation. Apply only the authorized stages above:

1. Inspect `package.json` and `theme.yaml` for the intended same version; edit them only within stage B authorization.
2. Update `docs/发布说明.md` and regenerate `templates/assets/**` when required and file/build writes are authorized. A readiness-only check reports what would need updating.
3. Inspect the repository's release verification commands and their side effects first. Run the applicable authorized checks; a read-only request does not authorize generated files, reloads or remote changes merely because they are called verification. Report required checks outside scope as unverified.
4. Apply stages C/D and E separately when authorized. `main` is this repository’s declared branch, not a cross-project default; verify the actual checkout, remote and complete outgoing range before any push.
5. Apply F and G separately when authorized: create only the exact requested tag at the verified commit, and push only that tag to the verified remote. Publishing a GitHub Release requires authorization for that additional release action.

The repository CD workflow listens for a published GitHub Release and delegates packaging, release asset upload, and Halo App Store publishing to `halo-sigs/reusable-workflows`.

## Guardrails

- Do not update README for small polish or internal refactors with no public status change.
- Do not write upstream latest plugin versions into the theme compatibility table without theme evidence.
- Do not stage unrelated existing worktree changes.
- Do not create branches or worktrees unless explicitly requested; repository policy uses `main`.
- Do not manually upload release assets when the CD workflow owns that action.
