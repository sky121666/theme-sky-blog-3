# Theme Sky Blog 3 Documentation Ownership

## Sources Of Truth

- `README.md`: concise public project entry, capability overview, plugin compatibility summary, install and release overview, current limitations.
- `docs/项目进度.md`: `进行中`, `待开始`, and `已完成` work status.
- `docs/插件适配契约.md`: per-plugin theme contract versions, tested versions, supported surfaces, and evidence.
- `docs/架构总览.md`: architecture boundaries.
- `docs/发布说明.md`: versioned release notes and validation evidence.

## Update README When

- a user-visible capability becomes available or is removed;
- plugin support scope materially changes and theme evidence confirms it;
- installation, upgrade, release, or minimum Halo requirements change;
- a documented current limitation is resolved or newly introduced.

Do not update README for narrow bug fixes, small visual polish, generated assets only, or refactors with no public behavior change.

## Update Project Progress When

- active work changes the answer to what is currently being implemented;
- a required next batch appears or is removed;
- a milestone becomes stable enough to move to `已完成`.

Prefer moving an existing item over duplicating it.

## Update Plugin Contract When

- theme code adopts a changed plugin API, route, Finder, variable, fragment, or DOM contract;
- a newer plugin version is actually tested with the existing theme contract;
- supported or intentionally unsupported plugin surfaces change.

An upstream/shared plugin skill version change alone does not update the theme contract. Use `$halo-theme-plugin-contract` for that comparison.

## Update Release Notes When

- preparing a versioned release;
- a commit is explicitly intended for the next release summary;
- verification evidence materially changes the release confidence.
