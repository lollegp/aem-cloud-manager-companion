# Popup Cache and Lazy Refresh Implementation Plan

**Goal:** Reopen the popup from session-cached metadata; refresh only expanded environments and never fetch history before its panel opens.

**Architecture:** cache.js projects approved display metadata into a versioned Chrome session snapshot keyed by client, organization, program, and scopes. popup.js separates list loading, local preferences, group rendering, and environment refresh. Group reads update only that group's body. History stays lazy and can supply its already fetched latest record to a row that has no current execution.

**Tech stack:** JavaScript modules, Chrome storage.session, native details controls, Node tests, mocked browser requests.

- [x] Test cache isolation, metadata projection, and lazy browser request counts before implementation.
- [x] Add bounded session snapshot reads/writes and keep settings, mutations, and variables out of the cache.
- [x] Load catalog on a cache miss or explicit Refresh; start groups collapsed and label cached timestamps.
- [x] Deduplicate expansion reads, limit concurrency, update only the affected environment, and preserve stale data on failures.
- [x] Remove automatic history fallback; use cached execution summaries or offer explicit history expansion.
- [x] Revalidate actions, refresh affected open environments after mutations, and prevent aborted/stale writes.
- [x] Verify unit tests, browser behavior and request counts; update documentation and package version.

Approval: user approved the proposed design on October 22, 2026. No commit or push is requested for this change. Preserve the existing untracked .serena directory.
