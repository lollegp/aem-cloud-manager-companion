# Repository Guidelines

## Project Structure & Module Organization

This repository contains an unpacked Chrome Manifest V3 extension with no build step or external dependencies. Files live at the repository root:

- `manifest.json` defines extension metadata, permissions, popup, and options page.
- `api.js` centralizes Cloud Manager requests, configuration access, and API link validation.
- `popup.html` and `popup.js` provide pipeline controls, environment status, and runtime variable management.
- `options.html` and `options.js` manage credentials and connection checks.
- `style.css` contains shared styles; `README.md` documents installation and limitations.

There are currently no dedicated test or asset directories.

## Build, Test, and Development Commands

No package manager, build command, or development server is configured. Load the repository directly through **Load unpacked** at `chrome://extensions` with Developer mode enabled. After editing, reload the extension and reopen its popup or options page.

For optional syntax checks with Node.js installed, run:

```sh
node --input-type=module --check < api.js
node --input-type=module --check < popup.js
node --input-type=module --check < options.js
```

These checks validate JavaScript syntax; browser behavior requires Chrome.

## Coding Style & Naming Conventions

Use plain JavaScript ES modules, relative imports, `const` by default, and camelCase identifiers. Follow surrounding formatting: `options.js` uses four-space indentation, while other files use compact formatting. Avoid unrelated reformatting. No formatter or linter is configured.

Keep shared HTTP behavior in `api.js`. Use `textContent` for API-derived text and retain English UI labels. Reuse existing CSS classes where practical.

## Testing Guidelines

No automated test framework or coverage threshold is configured. Manually check settings save and token clearing, missing credentials, API errors, tab switching, environment selection, and empty results. For action changes, verify confirmation dialogs and request payloads against an authorized nonproduction program. Record browser version, scenarios, and results; distinguish syntax checks from live API verification.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout, so no existing commit convention can be confirmed. Use concise imperative subjects, such as `Fix environment selection after refresh`. Keep changes focused.

PRs should explain behavior changes, link relevant issues, list verification performed, and include screenshots for UI changes. Explicitly identify untested API actions.

## Security & Configuration

Keep access tokens in `chrome.storage.session` and configuration identifiers in `chrome.storage.local`. Never commit credentials, persist client secrets, or persist secret variable values. Preserve API origin/path validation, narrow manifest permissions, and confirmation prompts for remote changes.
