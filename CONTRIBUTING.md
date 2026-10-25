# Contributing

## Setup and checks

Use Node.js 22.13 or newer. The extension itself has no runtime dependencies or build step. Development checks use the pinned packages in `package-lock.json`:

```sh
npm ci
npm run check
```

`npm run lint` checks JavaScript correctness and unused code with ESLint flat configuration. `npm run lint:fix` applies available safe fixes; review the resulting diff. Lint covers extension modules, Node scripts, browser fixtures and site JavaScript. It does not enforce indentation or reformat existing files.

`npm test` runs Node regression tests. `npm run site:check` builds the public site and checks internal links, asset paths, anchors and version substitution. Browser fixture exports accept a Playwright `Page` and a source map; run each in a fresh context. These mocks do not prove live Adobe behavior.

## Project layout

- Root JavaScript, HTML and CSS files are the unpacked Chrome extension.
- `api.js` owns HTTP requests, timeouts and connection checks.
- `pipeline.js`, `history.js`, `cache.js` and `variables.js` contain shared data behavior.
- `tests/` contains Node regressions and mocked browser scenarios.
- `site/` contains the presentation website; `scripts/` builds and previews it.
- `privacy.html` is the canonical policy; the website build reuses its content.

Load the repository with **Load unpacked** at `chrome://extensions`. Reload the extension after changes. Keep credentials out of fixtures, screenshots, logs and commits. Never persist runtime variable values or drafts.

## Change and review expectations

Use JavaScript ES modules, camelCase, `const` by default and surrounding formatting. Render API text with `textContent`. Keep relative imports and retain API origin validation, mutation confirmations, abort handling and connection identity checks.

Use focused imperative Conventional Commit subjects, for example `fix: preserve variable drafts on refresh`. Explain user-visible behavior and verification in pull requests. Include screenshots for UI changes, link relevant issues and label any untested live actions. Test remote changes only against an authorized nonproduction integration.

CI runs lint, Node tests and site checks on pushes and pull requests. Before a release, also verify live authentication, update progress, pipeline actions and Chrome layout. See [the Pages guide](docs/GITHUB-PAGES.md) and [Store publication notes](STORE-PUBLISHING.md).
