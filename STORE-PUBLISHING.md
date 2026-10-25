# Chrome Web Store publication

Version 0.6.1 ships without Adobe credentials. Each user may supply and save their own credential for automatic token generation after restart.

**Security limitation:** AES-256-GCM uses a fixed key bundled with the extension. Anyone with the code and saved record can decrypt the secret. This is obfuscation, not strong credential protection, and must not be presented as a secure vault or guaranteed Chrome Web Store compliance. Chrome's secure-handling requirements still apply; transparent disclosure alone does not establish compliance. This package has not been submitted or approved.

## Publisher actions before submission

1. Publish the presentation site using [the GitHub Pages guide](docs/GITHUB-PAGES.md). The build creates `dist/site/privacy.html` from the packaged policy. Verify its live HTTPS URL and enter it in the Developer Dashboard privacy-policy field. The packaged page alone does not satisfy this listing requirement.
2. Link the deployed `support.html` page from the listing and verify the public GitHub support channel linked in the policy. Check that the policy, listing, and dashboard declarations match the submitted version. Do not claim a site URL is live until deployment is verified.
3. Describe the single purpose as: “Manage Adobe Cloud Manager environments, deployment pipelines, and runtime variables using the user's authorized Adobe integration.” Explain that users supply their own Adobe OAuth Server-to-Server credential or manual token, and that optional local storage uses a bundled fixed key and enables automatic token renewal without a password.
4. Disclose handling of authentication information (Client Secret and access tokens), identifiers, and user-supplied/Adobe Cloud Manager configuration data. Do not claim that no data is handled because storage is local. Classify other data against the current dashboard category definitions and the actual content supported by your deployment. Certify Limited Use accurately; there is no sale, advertising, analytics, or unrelated use.
5. Justify `storage` for local settings, optional saved credentials, and session tokens. Justify the IMS host for token generation and the Cloud Manager host for resource operations. No remote code, broad host permissions, native helper, or local OAuth server is required.
6. Supply screenshots, listing assets, and accurate reviewer instructions. Use a dedicated least-privilege test integration through the Store's private reviewer process if requested; never put credentials in the package, public listing, or this repository. Clearly describe any access restrictions.
7. Verify the packaged extension in Chrome 120 or newer with an authorized nonproduction Adobe integration. Check live IMS token generation, Cloud Manager access, silent renewal after browser restart, expiry, concurrent requests, update migration, and Forget, and your organization's policy on handling Server-to-Server secrets in a browser. Adobe states Server-to-Server token generation must run on a secure backend; fixed-key local storage does not resolve that documented requirement.
8. Package only extension runtime files: `manifest.json`, `background.js`, `credentials.js`, `vault.js`, `auth.js`, `api.js`, `options.html`, `options.js`, `popup.html`, `popup.js`, `pipeline.js`, `history.js`, `cache.js`, `variables.js`, `style.css`, and `privacy.html`. Keep tests, internal plans, and any local credentials out of the upload.

## Security behavior to disclose

- Saving is off by default and requires explicit consent to the stated fixed-key limitation.
- AES-256-GCM uses a bundled static 256-bit key and fresh random nonces. Records can be decrypted across profiles; there is no user unlock or meaningful local lock function.
- No Adobe credential is bundled. The bundled encryption key is public implementation material, not an Adobe credential.
- Identifiers, scopes, aliases, and display preferences are ordinary local settings.
- Tokens stay in session storage. Saved credentials persist locally and generate new tokens on demand after restart, expiry, or Clear token. There is no automatic idle polling.
- HTTP 401 responses cause one renewal; only read requests are retried automatically. Mutations require an explicit retry. A repeated renewal failure has a 30-second worker-local cooldown.
- Forget deletes the saved credential and token. It does not revoke Adobe credentials or undo requests already sent.
- Existing password-protected records are retained until the user replaces or deletes them. Session-unlocked or legacy plaintext secrets require explicit consent before conversion.
- Local record deletion does not erase historical disk remnants or backups. A copied profile containing a saved credential remains decryptable by the fixed key.

## References

- [Chrome Web Store user-data policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Chrome storage behavior](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Adobe Server-to-Server authentication guidance](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/)
