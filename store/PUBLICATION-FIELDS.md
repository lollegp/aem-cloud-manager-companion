# Chrome Web Store — copy-ready publication fields

The listing language is English, matching the extension UI. Italian headings below match the dashboard fields. Paste only the field text, not the headings or publisher notes.

## Description — descrizione breve

Manage Adobe Cloud Manager pipelines, environment variables, and environment status.

## Description — descrizione completa

Manage Adobe AEM Cloud Manager pipelines, environments and runtime variables from Chrome.

PIPELINES BY ENVIRONMENT
View Full-Stack, WebTier, Front End and CDN Config pipelines grouped by environment. Start or stop eligible pipelines individually or as an environment group. Approve or reject recognized waiting production deployments. Confirmations show all affected targets, including shared pipelines.

CLEAR EXECUTION STATUS
See current pipeline availability and the last execution outcome separately. Expand an environment to refresh status. Open execution history on demand and load older runs as you scroll.

BATCH VARIABLE EDITING
Search variables, filter by service and stage multiple additions, edits or removals before saving together. Plain values are prefilled; secret values remain write-only. Unsaved drafts stay in memory while the popup is open. Environment updates show progress and block pipeline starts and approvals until ready.

PERSONALIZE YOUR VIEW
Set local environment aliases, reorder environments or hide them from Pipelines. Choose Light, Dark or System appearance. System follows your computer theme by default.

YOUR ADOBE INTEGRATION
Requires Chrome 120 or newer and an authorized Adobe Cloud Manager integration. Supply your own OAuth Server-to-Server credentials or a manual access token. Available actions depend on your Adobe permissions and the actions exposed by the API.

Optional credential saving enables automatic token renewal after restart. Saved Client Secrets use a bundled fixed encryption key. Anyone with the code and saved data can decrypt them; this is obfuscation, not a secure vault. Saving is off by default and requires explicit consent.

Requests go directly to Adobe over HTTPS. No credentials are bundled. There is no developer-operated backend, advertising or analytics. Runtime variable values and drafts are not persisted. Read the privacy policy for data handling, retention and deletion controls.

Independent tool. Not affiliated with or endorsed by Adobe.

## Singolo scopo

Manage Adobe Cloud Manager environments, deployment pipelines and runtime variables through the user's authorized Adobe integration, including viewing status and execution history and sending explicitly confirmed management actions.

## Motivazione Storage

The storage permission saves connection identifiers and scopes, local environment aliases, order and visibility, and appearance preferences. Chrome session storage holds access tokens, expiry information and display metadata to avoid repeated API calls. With explicit consent, local storage also holds an optional Client Secret record for automatic token renewal. This record uses a bundled fixed encryption key and is not a secure vault. Runtime variable values and unsaved drafts are not persisted. Storage is not used for advertising, analytics or Chrome Sync.

## Motivazione autorizzazione host — campo unico

Access to https://cloudmanager.adobe.io/* is required to authenticate API requests, read program environments, pipelines, executions and variables, and send user-confirmed pipeline and variable changes. Access to https://ims-na1.adobelogin.com/* is required to exchange the user's Adobe OAuth Server-to-Server credentials and scopes for an access token, including optional on-demand renewal. Requests use HTTPS and go directly to Adobe. The extension does not inspect unrelated websites, inject content scripts or load remote executable code.

## Motivazione host — se il dashboard richiede campi separati

### https://cloudmanager.adobe.io/*

Required to read the user's authorized Cloud Manager environments, pipelines, execution history and runtime variables, and to send user-confirmed starts, stops, production approval/rejection decisions and variable updates. Requests use the user's integration credentials and remain subject to Adobe authorization.

### https://ims-na1.adobelogin.com/*

Required to generate access tokens by exchanging the user's Client ID, Client Secret and scopes with Adobe IMS over HTTPS. Also used for on-demand token renewal when the user explicitly chooses to save a credential. No developer-operated server receives the credentials.

## Screenshots — 1280 × 800 PNG

Upload these separate image files, in this order:

1. `store/screenshots/01-pipelines-dark.png` — environment groups, current/last execution ribbons and production approval controls.
2. `store/screenshots/02-variables-light.png` — service-scoped variables, search, filters and batch editing controls.
3. `store/screenshots/03-settings-light.png` — appearance selection and connection configuration.

All three are exactly 1280 × 800 pixels. They render the actual extension with synthetic sample data and contain no real credentials. They do not demonstrate live Adobe access. The Store icon is `icons/icon-128.png`.

## Publisher notes — do not paste into a description field

The publisher chose to retain automatic renewal pending credential architecture security review. These texts describe that implementation; they do not establish policy compliance. Complete the remaining items in `store/READINESS.md` before submission. The public website links to the [Chrome Web Store listing](https://chromewebstore.google.com/detail/aem-cloud-manager-compani/algghcdmdihlkbkaeeeplmhallhainna).
