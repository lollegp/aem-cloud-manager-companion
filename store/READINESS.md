# Release readiness — 0.6.1

> Historical preparation notes for version 0.6.1. The [Store listing](https://chromewebstore.google.com/detail/aem-cloud-manager-compani/algghcdmdihlkbkaeeeplmhallhainna) is now available. Pending review items below record preparation findings; their resolution has not been independently verified.

## Prepared locally

- Manifest V3; only storage and the two necessary Adobe host permissions.
- Self-hosted runtime code, restrictive CSP, no content scripts or remote script loading.
- Matching website/extension/Store artwork at 16/32/48/128px; the 128px icon has Store padding.
- System/Light/Dark appearance with local preferences.
- Deterministic upload ZIP, dependency/reference validation, CRC/content verification and SHA-256 report.
- Listing draft, permission and privacy worksheet, private-access reviewer instructions and three 1280×800 screenshots.
- Screenshots render the actual extension HTML/CSS/JavaScript using synthetic data and mocked Adobe responses. They are not evidence of live Adobe verification.
- Homepage, privacy and support URLs returned HTTP 200 on October 25, 2026. Publish the latest website source to keep it aligned with the packaged policy and theme documentation.

## Validation record

Lint and 92 Node tests passed. Nine isolated browser fixtures passed 291 checks with zero failures. Site validation checked three pages and 35 local links/assets. Package hashes matched an independent ZIP audit and repeated builds. See `store/VALIDATION.json` and `dist/release-manifest.json` for the exact candidate digest and scopes of verification.

## Submission remains conditional

### 1. Credential architecture security review

The publisher explicitly chose to retain current automatic renewal and flag it for review. `vault.js` uses AES-GCM with a bundled key; anyone with the code and saved record can decrypt the Client Secret. It is obfuscation, not meaningful protection against profile access. The extension also generates Server-to-Server tokens inside Chrome.

Adobe's Server-to-Server guidance states that Client Secret token generation must be implemented on a secure backend. Chrome Web Store policy requires secure handling and strong encryption of stored user data. The audit does not establish that the bundled-key design satisfies those requirements. A checkbox and a privacy disclosure alone do not resolve this issue.

Do not label the current artifact "compliance approved" or submit it as though this question is settled. Resolve the architecture with an appropriate security review and the relevant platform guidance. If the review requires changes, revise the build, privacy policy, listing, host permissions and screenshots together before submission.

### 2. Authorized live testing and review access

The Cloud Manager functional checks use mocked API responses. A separate Chrome for Testing 153.0.8010.12 clean-profile check loaded the actual candidate ZIP, registered its service worker, confirmed empty credentials/token state, saved appearance across pages, and loaded the packaged privacy page and icon with zero Adobe requests. Before submission, verify the ZIP in Chrome against a designated nonproduction Adobe program, including authentication, role-restricted errors, renewal after restart, timeout handling, variable update completion, shared-target guards, Forget and the intended pipeline actions. Provide working least-privilege reviewer access privately through the dashboard. No real credential is present in this repository or release artifact.

### 3. Publisher dashboard

The account owner must finalize accurate data-category/limited-use declarations, developer contact details, distribution countries and review-access instructions in the Store dashboard. Public support uses GitHub issues; sensitive account data must not be posted there. Verify the final live privacy/support pages, upload the runtime ZIP and listing assets, and submit only after the security and live-test items are resolved. No dashboard changes or submission have been performed by this preparation.

## Reproduce the package

```sh
npm ci
npm run release:check
```

Requires Node.js 22.13+ (or a supported newer release) and Python 3. Outputs:

- `dist/aem-cloud-manager-companion-0.6.1.zip`: candidate upload package, with `manifest.json` at archive root.
- `dist/release-manifest.json`: archive digest and hashes of every runtime file.

The ZIP deliberately excludes source-site files, Store materials, tests, docs, node_modules, Git/editor metadata and local configuration. `store/screenshots/` contains separate listing uploads.

## Policy references checked

- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/images
- https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/
