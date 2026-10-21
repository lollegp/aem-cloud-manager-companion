# Environment Pipeline Controls Implementation Plan

**Goal:** Present collapsible environment groups with a single type per pipeline, individual and batch controls, production approval actions, and on-demand execution history.

**Architecture:** Keep grouping and action validation in pipeline.js; popup.js renders environment sections and dispatches freshly validated actions. A dedicated history.js owns one pipeline's paginated execution history. No history requests occur before expansion; scrolling requests at most one page at a time.

**Tech Stack:** Chrome MV3, native JavaScript modules, Node test runner, mocked Playwright browser scenarios.

- [x] Add regression tests for production approval selection, advertised action validation, and history pagination.
- [x] Implement a production approval helper and revalidate current execution/targets for single and group decisions.
- [x] Render collapsible environment sections, compact pipeline rows, and explicit production approval controls.
- [x] Add on-demand history with deduplication, end detection, retry, and scroll loading.
- [x] Verify unit and browser behavior including cancellation, partial failures, stale approvals, no initial history traffic, and scroll paging.
- [x] Update documentation and version; verify the packaged archive. No Git repository is available, so no commits are performed.
