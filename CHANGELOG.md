# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.3.2] - 2026-09-18

### Fixed

- **客户端皮肤 ZIP 导入现在真正内联 fflate 的浏览器入口**（重要，分两步修复）：
  1. 上一版把 `fflate` 加入 `dependencies` 后，tsdown 的 DepsPlugin 默认会把生产依赖 externalize 成 `require("fflate")`，而 DSH 的客户端模块加载器不识别该入口，导致 `failed to import loader entry … require("fflate") missed the module table`。在 `tsdown.config.mjs` 增加 `deps.alwaysBundle` 强制内联后，tsdown 默认解析到 fflate 的 **node 入口**（`esm/index.mjs`），其模块顶层含有 Node 专属的 `worker_threads` / `module.createRequire` 代码，在 DSH 浏览器加载器中仍会初始化失败。
  2. 现改为显式导入 **`fflate/browser`**（`esm/browser.js`，Node-free 的独立 inflate/deflate 实现），并把 `fflate/browser` 加入 `deps.alwaysBundle`。最终 `client.js` 中只保留平台种子词 `react` / `react-dom` 两个 `require`，无 `worker_threads`、无 `createRequire`、无任何裸第三方依赖。
- 新增 DSH loader 语义模拟验证：以真实 `__ModuleLoader__.load` 工厂调用 client bundle，证明加载初始化无 missed-module 崩溃。

### Validation

- TypeScript host/client typecheck 通过；`npm test` 208/208 通过；资源审计、构建与打包通过；
- `client.js` require 扫描：仅 `react` / `react-dom`，`worker_threads` / `createRequire` 为 0；
- `scripts/verify-ui-local.mjs` 真实 headless Chrome 验收通过（500/360/180px × 中英 × 三标签布局无溢出；宠物/面板热切换、完成提示音 11 项浏览器调度检查全过）。

## [0.3.1] - 2026-09-18

### Fixed

- **旧宿主兼容降级（重要）**：当前 DSH 运行时（0.1.5-rc.x）的 `sessionPersistence` 未暴露 `listSnapshots`，导致 host 端在每次 `session/event` 时调用不存在的方法并高频抛出 `TypeError: persistence.listSnapshots is not a function`（错误日志每事件刷屏）。现做防御性降级：事件监听器不再抛错，趋势索引维护在缺失该接口的宿主机上被明确标记为 `unsupported`，面板与维护页显示清晰提示而非误报"重建成功"。
- **趋势维护接口新增 `unsupported` 结果态**：`repair` 路由在不受支持的宿主上返回 501（带原因），`status` 返回 `lastResult: 'unsupported'`，设置页维护卡片显示"当前宿主的会话持久化接口不支持趋势索引"。
- 补充回归测试：无 `listSnapshots` 的宿主事件监听不抛错、repair 返回 501、status 返回 unsupported。

### Validation

- TypeScript host/client typecheck 通过；`npm test` 208/208 通过；资源审计、构建与 `npm pack --dry-run` 通过。

## [0.3.0] - 2026-09-18

### Added

- **成本估算（本地价格表）**：按 provider/model 与 Token 分类估算会话、模型、本月与终身成本；设置中可编辑价格表（USD / 1M token，支持 `claude-*` 前缀与 `*` 兜底），可切换 USD / CNY 显示；纯本地计算，不请求任何价格接口。
- **月预算告警**：设置月预算后，当月估算成本超限时宠物播放 `warning` 预警动作（跨限只触发一次，回落后复位）；开启完成提示音时同时发声提醒。
- **趋势范围切换**：本日小时趋势之外新增"近 7 日 / 近 30 日"按日聚合（数据来自账本 model/day 记录）。
- **会话排行**：面板新增"最耗 Token 的会话"（最多 5 条），数据来自持久化用量索引的纯快照读取（新端点 `GET /token-pet/usage/sessions`），不扫描会话日志。
- **导出用量数据**：设置页可导出 JSON（账本 + 趋势 + 会话快照）与 CSV（模型/日期明细）；仅统计数字，不含对话内容。
- **皮肤 ZIP 客户端导入**：`importSkinZip` 改为客户端内 `fflate` 解包（不再需要宿主适配器），含路径校验、manifest 校验与大小上限（24MiB ZIP / 64MiB 解压）；新增稳定错误码 `invalidZip / tooLarge / noManifest / invalidManifest / unsafeEntries`。
- **内置皮肤扩充**：新增蓝冰、紫雾、小橘三套纯配色皮肤；manifest 新增 `palette` 字段，按阶段全色板生效（`styleOverrides` 仍优先）。
- **提示音主题与音量**：完成提示音支持"叮咚 / 气泡 / 轻柔"三种主题与音量调节（默认保持不变）。
- 皮肤规范文档 `docs/SKIN_SCHEMA.zh-CN.md`（ZIP 布局、manifest v1、回退链、安全限制）。

### Changed

- `fflate` 从 devDependencies 移入 dependencies（客户端 bundle 内联，约 +40KiB）；tsdown 配置注释同步更新。
- 设置页新增"成本与预算"卡片；通知卡片新增主题/音量控制；高级卡片新增导出入口。
- 模型 Top5 与模型页新增估算成本列；概览新增成本卡片（本月成本 + 预算进度）。

### Security

- 皮肤导入仍在客户端边界内完成全部路径/大小校验；保留 `isSafeSkinEntryPath` 白名单，禁止穿越、绝对路径与可执行内容。

### Validation

- TypeScript host/client typecheck 通过；`npm test` 207/207 通过（新增 `tests/cost.test.mjs` 与皮肤 ZIP 导入用例）；资源审计 problems 为空；构建与 `npm pack --dry-run` 通过。
- 未执行真实 DSH 页面浏览器验收与 24 小时稳定性记录；旧账迁移与市场备用 tgz 更新仍按 HANDOVER 保留。

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

[Unreleased]: https://github.com/Jimmy0123-ux/dsh-token-pet/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/Jimmy0123-ux/dsh-token-pet/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Jimmy0123-ux/dsh-token-pet/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Jimmy0123-ux/dsh-token-pet/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.2.0
[0.1.1]: https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.1.1
[0.1.0]: https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.1.0
