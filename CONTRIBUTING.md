# Contributing

Thanks for improving DSH Token Pet.

## Development setup

```powershell
git clone https://github.com/Jimmy0123-ux/dsh-token-pet.git
Set-Location dsh-token-pet
npm install
npm run build
```

Node.js `>=22.19` is required.

## Required checks

Before opening a pull request:

```powershell
npm run typecheck
npm test
npm run audit:qpet-art
npm run build
npm pack --dry-run --json
```

If the optional local `Review/h3-actions` production sources exist, also run:

```powershell
python scripts/check-strip-stability.py
```

## Pull requests

- Keep each PR focused on one behavior or maintenance concern.
- Explain user-visible effects and migration impact.
- Add or update tests for behavior changes.
- Do not commit `Review/`, generated videos, ZIP files, local session data, credentials, npm tokens, recovery codes, or build output.
- UI changes should include privacy-safe screenshots from the real DSH interface where possible.
- Animation changes must preserve 32 frames, 100ms timing, feet anchoring, per-cell clipping, and no-canvas playback.

## Commit style

Use short imperative subjects, for example:

```text
Fix prompt action hand-off
Add index timeout regression
Update marketplace screenshots
```

## Reporting bugs

Use GitHub Issues for ordinary bugs and feature requests. Security issues must follow [SECURITY.md](SECURITY.md).
