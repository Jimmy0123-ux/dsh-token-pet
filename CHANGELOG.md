# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Replace the README interface illustration with privacy-safe captures from the real DSH Desktop UI.
- Add browser-level visual regression coverage for animation hand-offs.
- Record a 24-hour renderer/main-process memory and latency run.

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

[Unreleased]: https://github.com/Jimmy0123-ux/dsh-token-pet/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.1.0
