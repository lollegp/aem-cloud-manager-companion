# Credential vault design

The approved design replaces plaintext secret persistence with an optional password-protected vault. No backend, native helper, shared credential, or new host permission is required.

Use Web Crypto AES-256-GCM with fresh 96-bit nonces, 128-bit salts, and PBKDF2-HMAC-SHA-256 (600,000 iterations). Authenticate the record version, ID, client and organization as additional data. Store ciphertext and derivation metadata locally; never persist a password or derived key. Keep unlocked credentials and tokens in trusted-context session storage until Lock, Forget, restart, update, or reload. A strong password protects offline copies, not a compromised running extension.

A module service worker serializes credential operations, rejects messages outside this extension's options page, and initializes storage access restrictions on startup. It moves legacy plaintext credentials to temporary session storage and removes their local record. Users explicitly opt in and choose a password to encrypt the migrated copy before ending the session. Verify encryption before saving; failed writes preserve the temporary copy. No plaintext is returned to the UI.

Settings supports encrypted save, unlock, lock, forget, one-time token generation, and manual token entry. Lock and Forget clear tokens as well as unlocked secrets. Clear token preserves the vault. Wrong passwords, altered records, and mismatched clients fail closed. The popup retains existing API behavior.

Provide a packaged privacy page and publication checklist with actual data flows, retention, deletion, permissions, and Limited Use disclosure. Publishing its public URL and completing Store dashboard declarations remain publisher tasks; code changes do not guarantee review approval.

Validation covers cryptographic round trips and tampering; migration and storage failures; session restart and worker restart; serialized lock/generation; UI opt-in, wrong passwords, reload, forgetting, and manual tokens. Existing pipeline tests must remain green. Live Adobe authorization remains a separate check.
