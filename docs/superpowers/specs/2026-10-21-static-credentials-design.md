# Fixed-key credentials and automatic renewal

User explicitly requests no vault password, no external helper/backend, silent renewal after browser restart, and accepts decryptability across copied profiles. This supersedes the password-vault design for version 0.3.0.

Use AES-256-GCM with a bundled fixed 256-bit key and a fresh random nonce on every save. Store versioned ciphertext with authenticated client/organization metadata. This is obfuscation, not strong protection against profile readers; make the distinction explicit in Settings, README, privacy policy, and publication notes. Never claim this satisfies Chrome's secure-storage requirement merely because AES is used.

Persist only after explicit consent. Keep v1 password records until the user replaces or deletes them. Saving may reuse a matching legacy plaintext/session-unlocked secret after consent; a locked v1 record requires the Adobe secret again. Remove password/unlock/lock controls entirely. Forget deletes the credential and token; Clear token leaves automatic renewal enabled through the saved credential.

Generate tokens on demand before API requests when missing or expiring within 30 seconds, including after restart. Serialize renewal in the service worker and reuse fresh tokens for queued requests; briefly throttle repeated failed automatic renewals. Bind credentials and tokens to client/organization and reject stale connection snapshots. On HTTP 401, renew once; retry reads once, but do not replay mutations automatically. Never renew on permission errors or network failures. Manual tokens remain usable, but cannot renew without a matching saved secret.

Tests cover copied records, tampering, explicit consent, v1 preservation/migration, restart, expiry, concurrent renewal, failure throttling, identity boundaries, restricted worker messages, one-time generation, forgetting, and GET-only retries. Re-run existing pipeline/browser scenarios. Package runtime files only; no real credential is bundled. No live Adobe request is needed for development verification.
