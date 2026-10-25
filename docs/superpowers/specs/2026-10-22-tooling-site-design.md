# Development tooling and presentation site

Approved direction: dark utility styling matching the extension, with a large product preview.

Use ESLint flat configuration for JavaScript correctness without a repository-wide formatting rewrite. Pin development dependencies, provide npm scripts and a lockfile, and run lint plus Node regression tests in CI. Runtime extension code remains dependency-free.

Keep the static website in `site/`, separate from extension runtime files. Include feature details, an interactive sample-data preview, unpacked installation instructions, FAQs, support links and the privacy policy. Build to `dist/site/` with relative asset links so project GitHub Pages paths and a future custom domain both work. Generate the website policy from the packaged policy to prevent drift. No analytics, remote fonts, Adobe requests, credentials, or fake Store installation link.

Provide an optional GitHub Pages workflow, a local preview server and explicit publishing instructions. The user will push and enable Pages. Do not publish or alter repository settings in this task. Validate internal links, desktop/mobile layout, keyboard preview controls and privacy generation.
