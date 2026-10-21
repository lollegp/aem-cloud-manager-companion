# Fixed-key Credentials Implementation Plan

**Goal:** Remove vault passwords and renew access tokens automatically after restart using user-supplied saved credentials.

**Architecture:** Version 2 records in vault.js use a fixed bundled key. credentials.js serializes token renewal and preserves v1 records until explicit replacement. api.js requests renewal through background.js at the shared API boundary. Settings exposes Save, Forget, Generate, and Clear token.

**Tech Stack:** Chrome MV3, Web Crypto, JavaScript modules, Node tests and mocked Playwright browser scenarios.

- [x] Replace vault/controller tests with passwordless record and renewal expectations; observe failures first.
- [x] Implement version 2 encryption, consent-based migration, serialized renewal and failure cooldown.
- [x] Add API boundary tests and implement automatic renewal with limited 401 retries and sender restrictions.
- [x] Remove password controls, update disclosure, test actual UI modules with mocked Chrome and Adobe APIs.
- [x] Update current documentation, review security/correctness, run regressions and package version 0.3.0. Preserve AGENTS.md.

## Verification

39 Node tests pass. Chromium 155.0.8059.85 mocked scenarios pass 47 authentication checks and 26 popup checks. Tests use real Web Crypto and the actual worker message handler, but mocked Chrome storage/lifecycle and Adobe responses. An independent review found missing-scope validation; the added regression and fix pass. Real installed Chrome restart/service-worker behavior and live Adobe authentication remain unverified.
