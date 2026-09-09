# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-08

### Added

- Complete Chinese/English UI, including pet status, floating shell, usage panels, prompt enhancement, settings, skin messages, maintenance feedback, tooltips, accessibility labels, and locale-aware dates. Both settings surfaces synchronize without resetting drafts, custom templates, or in-flight previews.
- A bounded local adaptation of the reviewed MIT `prompt-optimizer` Skill is now the default enhancement rule set. It preserves intent, language, facts, constraints, custom-template guidance, and all existing result actions; it never executes the source task or installs a global Skill.
- Default-off completion sound, a silent audio-unlock toggle, and explicit preview. Only successful live reply boundaries in the current conversation notify; tool completion, cancellation, errors, historical replay, and session changes remain silent. Muting, view changes, and disposal revoke pending notes/preview continuations.
- English usage guide and isolated Chrome component/shell tests using synthetic data and fake audio (no real session access or audible playback).

### Changed

- Responsive context/session, lifetime, ranking, and trend cards; wrapping model names and a single main scroller. Narrow shell headers keep accessible icon controls; settings use grouped, bounded form fields and a localized file-picker button.
- Centralized typed bilingual dictionaries and shared live settings subscriptions. Built-in prompt templates follow UI language without overwriting custom templates or translating user content.

### Fixed

- Let the floating panel size to its actual overview content while retaining a bounded scroller for long model/settings views, removing the large empty lower region on tall windows.
- Keep the prompt textarea stable while it has focus: asynchronous composer draft projections no longer overwrite text or interrupt cursor input mid-sentence.
- Preserve chronological model headers when deduplicating usage events so multi-model sessions retain the correct provider/model attribution.
- Bootstrap Lifetime Ledger from live sessions and newly durable session IDs before the first explicit usage-index build, without reading unrelated historical logs; preserve newer durability fences across retries and prevent retry timers from rearming after host disposal.
- Revoke stale composer actions and clear drafts on session transitions; recheck queued submit admission and discard enhancement completions after their session panel unmounts.
- Correct the README published version, v0.1.1 release date, and outdated public-repository / CI checklist entries.

### Maintenance notes

- These changes are local and not yet published; the current npm/GitHub release remains 0.1.1.
- Previously persisted model misattribution is not automatically migrated. A history rebuild alone cannot safely correct the monotonic Lifetime Ledger; review backup and migration strategy before publishing this fix to existing installations.
- The marketplace catalog's fallback tarball still targets 0.1.0 despite its 0.1.1 version field. Update the catalog only with separate authorization for online changes.

### Planned

- Replace the README interface illustration with privacy-safe captures from the real DSH Desktop UI.
- Add browser-level visual regression coverage for animation hand-offs.
- Record a 24-hour renderer/main-process memory and latency run.

## [0.1.1] - 2026-09-02

### Changed

- Documentation-only release: README now explains that dsh-token-pet is a Web UI plugin and must be installed into a profile that loads `@deepseek-ai/dsh-web-app` (the `web` profile for dsh web, or the `desktop` profile for DSH Desktop).
- Added install commands for the web profile and a troubleshooting section for the "profile lacks WebUI components / UI does not appear" message.

## [0.1.0] - 2026-09-01

### Added

- Fixed Green Sprout QPet identity with 12 authored actions, each using 32 WebP frames at 100ms per frame.
- Runtime state badge, context occupancy chip, pressure ring, tool feedback, and reduced-motion/low-performance behavior.
- Lifetime Ledger with monotonic per-session snapshots, deleted-session retention, corruption recovery, atomic persistence, and irreversible clear watermarks.
- Three-tab usage panel with model totals, local-time hourly trend, explicit index maintenance, request deadlines, and stale snapshot display.
- User-triggered prompt enhancement with preview, editing, replace/append/copy/undo, and DSH composer submission.
- Independent pet/panel dragging, viewport recovery, and proportional resize.
- Public npm package, GitHub Release tarball, CI workflow, screenshots manifest, and marketplace submission metadata.

### Changed

- Panel GET routes now serve persisted snapshots only; startup/session events and low-frequency fallback maintain indexes in the background.
- Runtime animation uses two decoded `<img>` buffers, fixed viewport geometry, per-cell clipping, two-RAF preparation, and atomic hand-off without canvas or crossfade.
- User actions use explicit interrupt semantics; background bursts coalesce in a 40ms window.
- Runtime status and visual motion are separate so reduced motion does not misreport the semantic state.
- Published package excludes Review production sources, sourcemaps, duplicate standalone action strips, and deprecated visual assets.

### Fixed

- Removed artificial per-frame horizontal recentering from click and prompt actions.
- Prevented incomplete one-shot playback, prompt loop seams, adjacent-frame leakage, transition stretching, blank swaps, and status-chip misalignment.
- Added 10-second client deadlines and bounded retries to prevent indefinite panel loading.
- Corrected index inspection, Lifetime refresh, empty-index persistence, concurrent writes, and stale post-sync status.

### Verification

- 126 automated tests pass.
- TypeScript host/client typecheck passes.
- QPet asset audit reports zero problems.
- npm package installs with host entry, web client bundle, and `cordis.patch.yml` present.
- GitHub CI passes on the public `main` branch.

[Unreleased]: https://github.com/Jimmy0123-ux/dsh-token-pet/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.1.1
[0.1.0]: https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.1.0
