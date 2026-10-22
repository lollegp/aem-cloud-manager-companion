# Pipeline and variable usability fixes

> **For agentic workers:** Follow each task in order and keep existing API safeguards.

**Goal:** Always show the latest pipeline outcome and make environment variable edits reliable and batchable.
**Architecture:** Reuse one latest execution request on missing current executions. Isolate variable patch construction and validation in `variables.js`; render all edits in a single form and send one supported PATCH batch.
**Tech Stack:** Chrome MV3, JavaScript modules, Node test runner, Playwright fixtures.

---

### Task 1: Keep pipeline actions inline and always show outcome

**Files:** `popup.js`, `style.css`, `tests/execution-fallback.test.mjs`

- [x] Move group actions out of disclosure into compact inline controls.
- [x] Fetch one latest execution for every environment when current execution is missing.
- [x] Show a neutral no-executions state when neither current nor history has any run.
- [x] Test current missing in production and nonproduction, empty history, and ribbon presence.

### Task 2: Batch variable changes safely

**Files:** Create `variables.js`; modify `popup.js`, `tests/pipeline.test.mjs`; create `tests/variables.test.mjs`

- [x] Build and test minimal PATCH payloads, reject duplicate/invalid names and immutable type changes, and limit `secretString` to 499 characters.
- [x] Render existing values and new rows in one editor with explicit remove checkboxes.
- [x] Confirm one PATCH contains all staged edits, additions, and removals; retain confirmation before deletion.
- [x] Surface actionable HTTP 500 guidance and refresh after completed changes.

### Task 3: Correct variable layout and verify release

**Files:** `style.css`, `manifest.json`, `README.md`, publication documents, browser smoke tests.

- [x] Constrain long displayed values with ellipsis and a multiline hover/focus tooltip; space fields, selects, and buttons.
- [x] Verify ribbon on accordion open, raw-array bulk variable payload, and narrow layout using mocked API fixtures.
- [x] Run unit/syntax checks for version 0.6.1 extension sources.
