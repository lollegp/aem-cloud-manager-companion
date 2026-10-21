# Credential Vault Implementation Plan

**Goal:** Implement the approved extension-only encrypted credential vault and accurate publication disclosures.

**Architecture:** Pure cryptography in vault.js; serialized credential operations in credentials.js; background.js exposes only guarded internal messages. Options holds no restored secret in its DOM. Session storage survives worker suspension but not browser restart.

**Tech Stack:** JavaScript modules, Chrome MV3 storage/runtime, Web Crypto, Node test runner, mocked Playwright scenarios.

- [x] Add tests/vault.test.mjs for encrypt/decrypt, random salts/nonces, password requirements, metadata/ciphertext tampering; run to confirm missing implementation, then implement vault.js.
- [x] Add tests/credentials.test.mjs with storage fixtures for migration, opt-in, session unlock, failed writes, client scoping, lock/forget and queued generation. Implement credentials.js and background.js; run node --test tests/*.test.mjs.
- [x] Replace plaintext options handlers with internal credential messages. Add explicit encryption consent, password/confirmation, status and lock/unlock/forget controls. Add worker registration and minimum Chrome version for session/access-level APIs.
- [x] Replace auth browser smoke expectations with encrypted vault scenarios; run against real browser Web Crypto and mocked Chrome/Adobe APIs. Re-run popup smoke if shared API changes.
- [x] Add privacy.html and STORE-PUBLISHING.md, update README authentication instructions; preserve AGENTS.md. Scan for stale plaintext claims, run all tests and syntax/manifest checks, report verified scope and publication tasks.

No Git repository is present; no commit, branch, or worktree operations are needed.

## Verification

34 Node tests pass. Chromium 155.0.8059.80 mocked scenarios pass 39 authentication checks (with the declared content security policy) and 26 popup checks. An independent read-only review found a cross-identity manual-token issue; the fix and three additional regressions passed review. Real installed-extension lifecycle and live Adobe requests were not exercised. The public GitHub Pages privacy/support URL will be supplied by the publisher later.
