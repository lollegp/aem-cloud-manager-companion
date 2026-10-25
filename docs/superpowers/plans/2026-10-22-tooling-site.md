# Tooling and Site Implementation Plan

- [x] Add pinned ESLint dependencies, flat configuration, npm scripts and lockfile. Correct lint findings narrowly.
- [x] Add CI lint and Node tests; preserve dependency-free extension loading.
- [x] Build approved static presentation page with sample-data tabs, setup and support.
- [x] Add site build/check/preview scripts and an optional Pages workflow.
- [x] Update README, contributor guide, site publishing and Store notes; retain existing AGENTS.md.
- [x] Verify lint, unit tests, site links, desktop/mobile layout and keyboard interactions. Leave publication to the user.

Validation: clean npm ci and npm run check passed with ESLint 10.12.0, 86 Node tests, and 3 generated pages / 35 local links and assets. Workflow YAML parsed successfully. Chrome desktop and 375px mobile checks confirmed no horizontal overflow, working preview tabs and keyboard navigation, expandable support FAQ, and generated privacy content. Publishing and CI execution on GitHub remain pending the user push.
