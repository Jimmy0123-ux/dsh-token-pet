# DSH Token Pet

English · [简体中文](README.md)

A floating pet for **DeepSeek Harness (DSH)**, with live runtime status, context usage, a lifetime token ledger, model breakdowns, and hourly trends.

> **Version 0.2.0:** this release includes the complete bilingual interface, revised responsive panel layout, optional completion chime, default Prompt Optimizer rules, and continuous editable prompt enhancement. Enhancing is always user-triggered and never sends automatically.

## Requirements and installation

- Node.js **22.19 or newer**.
- DSH Web or Desktop with its Web UI components enabled (`web` or `desktop` profile).
- This is a DSH plugin, **not a standalone desktop app**. Other agent platforms are not supported.

For the currently published release, open **DSH Settings → Plugin marketplace / Plugin management**, search for `dsh-token-pet`, and install it. Restart DSH or refresh its existing page as required by the host. Do not start another `dsh web` server if your DSH UI is already running.

For local development, use the build commands below and the host's local-plugin installation workflow. Building this repository alone does not update an already installed plugin. Follow the [Chinese installation and troubleshooting guide](README.md#安装) for profile-specific instructions.

## Switch to English

1. Click the pet to open its panel.
2. Open **设置 → 语言与通知 → 语言** and select **English**.
3. Alternatively, use the **用量小宠物** section in DSH Settings.

The pet, panel, prompt drawer, settings, accessibility labels, and maintenance feedback update immediately. Both settings entry points stay synchronized. Chinese remains the default; this setting is manual, not inherited from the host language.

Your drafts, edited enhancement previews, custom templates, provider/model names, and imported skin names are not translated or overwritten. Built-in enhancement templates follow the selected UI language and the English default asks the model to preserve the prompt's original language.

## Panel and controls

- **Overview:** separate current-context/session cards, a cross-session Lifetime Ledger, provider/model rankings, and today's hourly trend.
- **Models:** detailed lifetime usage by provider and model, with date/model filters. Names remain intact and wrap when needed.
- **Settings:** appearance, language and notifications, enhancement preferences, and advanced maintenance.
- Drag the pet and panel independently. Drag the resize grip proportionally, or hold **Shift** to adjust width and height separately.
- Narrow layouts use compact header icons with accessible labels and tooltips. The panel has one main content scroller; editors can scroll internally.
- **Hide** closes the panel without removing the pet. **Enhance** opens a separate drawer without switching tabs.

The pet has twelve authored visual actions. Reduced motion, zero animation speed, and low-performance mode can stop movement without changing its semantic status label.

## Completion sound

Go to **Settings → Language & notifications → Completion sound**.

- **Off by default**, persisted locally.
- When enabled, a short two-note chime plays once after a successfully completed reply in the **current conversation**.
- Individual tool results, cancelled or failed replies, session switches, archived/removed conversations, and loaded historical completions stay silent.
- Turning sound off, switching conversations, losing the live session view, or unloading the plugin stops pending notes. Muted or blocked completions are never replayed later.
- Enabling the switch only unlocks audio; it does not play a test sound. **Preview sound** is an explicit test and does not enable automatic notifications.
- Browsers may require a click or key press after reload. If playback is blocked, try **Preview sound** and check the browser/OS audio settings. An unlocked audio context cannot guarantee that the OS output is unmuted.

Audio is synthesized locally using Web Audio: no downloaded audio files, remote service, system-notification permission, or new credential. Hosts without the required live turn-boundary data remain silent rather than guessing from running/tool status. A reply whose live start was not observed is not replayed as a notification.

## Prompt enhancement

Enable prompt enhancement in Settings, then open **Enhance** in the header. The local MIT `Prompt Optimizer` rules are always applied by default; there is no mode selector. Enhancement happens only on your explicit request. Review and edit the result before replacing/appending to the composer, copying, reverting, or sending it. Your existing custom template remains supplementary guidance and is not discarded.

An empty model preference follows the current DSH route, falling back to the host default model. Custom templates support `{{prompt}}`. Sending uses DSH's real composer actions; switching conversations revokes old actions and ignores late results. Changing UI language does not restart an in-flight request or erase its preview.

## Data and maintenance safety

- Panel reads use persisted snapshots. Opening or refreshing the panel does not trigger a full historical scan.
- Lifetime totals survive source conversation archival/deletion. Context occupancy and lifetime token usage are different measurements.
- Trend/index rebuilding is an explicit maintenance operation with confirmation, not part of ordinary refresh.
- **Clear history (irreversible)** permanently clears the Lifetime Ledger and cannot be undone by ordinary restore/refresh actions. Do not use it as routine troubleshooting.
- Previously persisted model-attribution errors are **not automatically migrated** by this update. Back up and review an explicit migration strategy before upgrading affected installations; rebuilding history alone cannot reliably lower monotonic ledger totals.
- Skin ZIP import still requires a host adapter; this update does not add a ZIP extraction implementation. Built-in palettes remain available.

## Development and checks

```sh
npm ci
npm run typecheck
npm test
npm run audit:qpet-art
npm run build
npm pack --dry-run --json
```

Optional isolated browser verification:

```sh
node scripts/verify-ui-local.mjs
```

This uses an installed Chrome, a temporary `file://` fixture/profile, synthetic data, and a fake AudioContext. Set `CHROME_PATH` if necessary. It checks real component layout, language switching, panel controls, and sound scheduling without accessing a real DSH session or playing through speakers. The 180-pixel case simulates constrained effective width; it is not an actual browser 200% zoom test. It does not install into or replace the running DSH GUI.

See [CHANGELOG](CHANGELOG.md) and the [handover notes](docs/HANDOVER.zh-CN.md) for release boundaries and remaining verification work.

## License

[MIT](LICENSE)
