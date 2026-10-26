# Chrome Web Store listing draft

## Name

AEM Cloud Manager Companion

## Short description

Manage Adobe Cloud Manager pipelines, environment variables, and environment status.

## Detailed description

Keep Adobe AEM Cloud Manager operations close at hand in Chrome.

PIPELINES BY ENVIRONMENT
View Full-Stack, WebTier, Front End and CDN Config pipelines grouped by environment. Start or stop an eligible pipeline, or act on a group. Approve or reject recognized waiting production deployments. Confirmations show affected targets, including shared pipelines.

STATUS WITH CONTEXT
See current pipeline availability and the last execution outcome separately. Expand an environment to refresh its status. Open execution history when needed and load older runs as you scroll.

RUNTIME VARIABLES
Search and filter by service. Stage additions, edits and removals for several variables, then save together. Plain values are prefilled; secret values remain write-only. Drafts stay in memory while the popup is open. Environment updates show progress and block pipeline starts and approvals until ready.

YOUR ENVIRONMENTS, YOUR VIEW
Set browser-local aliases, reorder environments, or hide them from Pipelines. Choose Light, Dark or System appearance; System follows your computer by default.

REQUIREMENTS AND ACCESS
Chrome 120 or newer and an authorized Cloud Manager integration are required. Available actions depend on Adobe roles, deployment state and the actions advertised by the API. This extension does not grant Adobe access or bypass Cloud Manager permissions.

PRIVACY
The extension ships without credentials. Requests go directly to Adobe over HTTPS. There is no developer-operated backend, advertising or analytics. Runtime variable values and drafts are not persisted. Read the privacy policy for credential handling and local storage details.

Independent tool. Not affiliated with or endorsed by Adobe.

## Authentication paragraph — retained build, pending security review

Bring your own Adobe OAuth Server-to-Server credential or use a manual access token. Optional on-device credential saving enables automatic token renewal after restart. Saved secrets use a bundled fixed key; anyone with the extension code and saved data can decrypt them. This is obfuscation, not a secure vault. Saving is off by default and requires explicit consent. Review your organization's credential requirements before use.

Do not submit this paragraph or build as compliance-approved: the credential architecture still needs security review. See `store/READINESS.md`.

## URLs

- Chrome Web Store: https://chromewebstore.google.com/detail/aem-cloud-manager-compani/algghcdmdihlkbkaeeeplmhallhainna

- Homepage: https://lollegp.github.io/aem-cloud-manager-companion/
- Privacy: https://lollegp.github.io/aem-cloud-manager-companion/privacy.html
- Support: https://lollegp.github.io/aem-cloud-manager-companion/support.html
- Existing project support: https://github.com/lollegp/aem-cloud-manager-companion/issues

All three Pages URLs returned HTTP 200 during preparation on October 25, 2026. Verify that the latest policy and documentation are deployed before submission.

## Assets

- Icon: `icons/icon-128.png`.
- Screenshot PNGs: `store/screenshots/`. They use sample data and actual extension UI; no real credentials or program information.
- Select the best-matching developer tools category offered by the current dashboard; primary language is English.

## Copy-ready dashboard fields

See [PUBLICATION-FIELDS.md](PUBLICATION-FIELDS.md) for the full description, Single purpose, Storage rationale, individual/combined host rationales, and exact screenshot filenames. English copy matches the current listing language and UI; Italian section headings match the requested dashboard labels.
