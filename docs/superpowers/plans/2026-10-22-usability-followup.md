# Usability Follow-up Implementation Plan

**Goal:** Implement the approved UX review without changing remote mutation contracts.
**Architecture:** Keep draft state in popup memory, separate cancellable reads from mutations, and retain API checks before remote actions. Use compact expandable variable rows and persistent environment controls.
**Tech stack:** Native JavaScript modules, CSS, Chrome MV3, Node tests and mocked Playwright fixtures.

- [x] Add browser regressions for draft retention, collapsed rows, navigation, request sharing and local preferences.
- [x] Preserve drafts by connection/environment; add change count and explicit discard. Never write drafts to storage.
- [x] Keep navigation available during reads, cancel obsolete views, retain existing content until data arrives.
- [x] Share overlapping environment reads and run independent status requests concurrently. Preserve mutation preflight checks.
- [x] Keep group controls/status outside collapsible rows; add clear current/last execution labels and freshness messages.
- [x] Add compact variable rows, search and service filtering; avoid remote refresh after local preferences.
- [x] Run syntax, Node and browser regressions; document remaining live API limitations.

Validation: 86 Node tests and 269 mocked browser checks across eight fixtures passed. JavaScript syntax and diff checks passed. At 360px width, closed variable rows measured 56px (previously 321px); visual inspection showed no horizontal overflow. Live Adobe API latency and mutations were not tested.
