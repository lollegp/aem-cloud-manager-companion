# Release readiness — 0.7.0

Prepared for manual Chrome Web Store submission. This record describes the local candidate, not Store approval.

## Release contents

- Multiple program profiles with isolated credentials, tokens, caches and environment preferences.
- Background pipeline and variable actions that continue after popup closure.
- JSON variable export and merge import with manual Save.
- Session-backed variable drafts, fast inline editing, and a shared Save/Discard/Import/Export toolbar.
- Compact responsive layout, improved connection validation and visible primary actions.
- Updated listing text, privacy worksheet and three synthetic 1280 × 800 screenshots.

## Validation

`npm run release:check` passed: lint, 127 unit tests, three site pages and 34 local links/assets, plus a verified 25-file runtime ZIP. Ten mocked browser UI suites passed during this session; the usability suite passed again after the final toolbar change. Screenshots use the actual extension pages with synthetic data. The ZIP was independently compared with the runtime source and CRC/hash checks passed. See `VALIDATION.json` and `dist/release-manifest.json`.

## Remaining publication checks

- Upload `dist/aem-cloud-manager-companion-0.7.0.zip` manually. Confirm the Store dashboard accepts this version; the live listing version could not be fetched during preparation.
- Verify the packaged extension and upgrade in a separate Chrome profile, then verify authorized nonproduction Adobe operations and supply reviewer access privately.
- Retain the existing credential architecture review item: optional saved Client Secrets use a bundled fixed key. This is obfuscation, not a secure vault. Packaging and disclosures do not establish security or policy approval.
- Verify the website deployment after pushing main, then use the updated listing, privacy declarations and screenshots. Complete final developer/contact and data declarations in the dashboard.
- Reloading or updating the extension clears session drafts; save pending changes first.

No Store submission was performed. No live Adobe mutation was performed.
