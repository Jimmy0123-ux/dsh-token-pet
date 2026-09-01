# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added an independent, checksummed Lifetime Ledger with per-session monotonic snapshots, deleted-session retention, atomic persistence, corruption recovery, and irreversible clear watermarks.
- Added a Lifetime-first three-tab panel with the hourly trend embedded in Overview, a persistent high-frequency prompt-enhancement action, desktop right drawer/mobile bottom drawer, and proportional resize behavior.
- Added a two-step “clear history” action with no restore API.
- Added the first formal Token Pet character: approved transparent Q-style Green Sprout artwork, reactive status aura/badge/tool motes/satiation meter, motion-speed controls, and automatic SVG fallback.
- Added authored per-action runtime frame sheets for all twelve PetAction values (unified 480×360 canvas, body-height-normalized, bottom-aligned), a generic `PetActionPlayer`, and a generated `PET_ACTION_SHEET_SPECS` registry with per-frame timing from each `index.json`.
- Added `scripts/prepare-action-sheets.py` to rebuild runtime sheets from the delivered `Review/h3-actions/<action>/sprite.png + index.json` (strict index slicing, no inferred grid, `H3_BYPASS_RTX=1` compatible).

### Changed

- Removed the residual programmatic up/down bob (`dsh-token-pet-bob`) from the pet, which had been left in addition to the authored frame sheets; motion now comes only from the frame assets.
- Anchored every action's character body centre to the shared canvas centre (canvas now 480×400, body height 320) instead of bottom-aligning the union alpha box. This keeps the creature's centre point fixed when switching between idle and the 11 actions, even for poses with glow above the head (evolve/prompt-ready/tool-success) or props below the feet (archive).
- Replaced the legacy static action-decoration bubbles with the authored frame sheets; all twelve actions now play real motion and the single-form manifest/contract report `completedActions = all 12`.
- Reworked the persistent session usage index for real DSH `SessionHeader` records that do not expose `revision`, `updatedAt`, or `eventCount`.
- Corrected DSH home resolution, empty-index readiness, concurrent persistence, incremental refresh, and index status diagnostics.
- Split index lifecycle into missing/building/partial/syncing/ready/cancelled/error; existing partial indexes now synchronize only pending closed sessions instead of reopening the full-build flow.
- Removed the reversible cumulative snapshot from the user-visible ledger surface while preserving it as an internal compatibility cache.
- Localized the visible ledger and ranking headings as “终身用量账本”, “用量最高的 5 个服务商与模型”, and “终身累计”; provider/model identifiers remain unchanged technical names.

### Testing

- Automated host/client validation passes with 117/117 tests, including index-state truth tables, pending-only synchronization, proportional resizing, drawer actions, deleted-session retention, clear-watermark anti-replay, per-bucket monotonicity, concurrency, corruption recovery, and the new authored-frame-sheet mounting/loop-flag assertions.
- Asset audit (`npm run audit:qpet-art`), TypeScript (`npm run typecheck`), test suite (`npm test`), and full build (`npm run build`) all pass; DSH runtime smoke against `http://127.0.0.1:43120` returns index `ready` with `pending === 0`.

### Planned

- Complete release-quality regression coverage for animation, archive, and configuration migration flows.
- Add final artwork and a host-side skin ZIP adapter.

## [0.1.0]

### Added

- Token-driven pet stages and context-pressure state machine.
- Session usage, request/tool, compaction, and archive status integration.
- Usage panel with cross-session totals and hourly trends.
- Explicit, user-triggered prompt enhancement with preview, editing, undo, and send actions.
- Declarative skin manifests with validation, fallbacks, and local storage support.
- Host and DSH Web client build configuration.

[Unreleased]: https://github.com/deepseek-ai/dsh-token-pet/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/deepseek-ai/dsh-token-pet/releases/tag/v0.1.0
