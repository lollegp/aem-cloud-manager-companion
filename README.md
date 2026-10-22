# AEM Cloud Manager Companion (v0.5.5)

Chrome Manifest V3 extension for Chrome 120 or newer. UI language: English. Independent tool; not an Adobe product.

## Install
1. Unzip the package.
2. Open `chrome://extensions`.
3. Enable Developer mode and click **Load unpacked**.
4. Select the unzipped `aem-cloud-manager-companion` directory.
5. Open **Settings** and configure token generation as described below, or use **Manual access token** with an existing Cloud Manager integration.

## Generate an access token

Use an **OAuth Server-to-Server** credential from your Cloud Manager project in Adobe Developer Console:

1. Reload the extension at `chrome://extensions`, then reopen **Settings**.
2. Enter the Client ID, Organization ID, and Cloud Manager Program ID.
3. Enter your credential's **Client Secret** and copy its scopes into **OAuth scopes**.
4. Click **Generate access token**, then **Test connection**.

The extension sends a form-encoded `client_credentials` POST directly to Adobe IMS over HTTPS. No redirect URL, sign-in window, or local server is needed. Only the supplied scopes are requested. The Client ID and secret must belong to the same integration, with appropriate Cloud Manager product profiles.

**Remember credentials:** review the storage disclosure, select the consent checkbox, and click **Save secret**. Then click **Test connection**. Saving is optional and off by default. No vault password, passkey, external helper, or backend is required.

**Storage limitation:** saved secrets use AES-256-GCM with a fixed key bundled with the extension and a fresh random nonce on every save. This is obfuscation, not a secure vault. Anyone with the extension code and saved data can decrypt the secret, including a copy in another Chrome profile. No Adobe credential is included in the distributed package; each user supplies their own. Do not treat the bundled encryption key as confidential or claim this provides strong protection against profile access.

**Automatic renewal:** before an API request, a missing token or a token expiring within 30 seconds is generated from the saved secret. This works on first use after Chrome restarts or the extension reloads. Concurrent requests share renewal; repeated automatic failures are throttled for 30 seconds while the worker stays active. No polling runs while the extension is idle. A 401 triggers one renewal and one retry for reads; mutations are not automatically replayed and prompt you to retry the action. Permission errors and network failures do not trigger automatic replays.

**Controls:** Clear token removes the session token, but a saved secret regenerates it on the next API request. Forget saved secret deletes the credential and clears the token, disabling renewal until credentials are saved again. Neither control revokes Adobe credentials or cancels requests already sent. Use Adobe Developer Console for revocation.

Without a saved secret, enter it for each generation or use **Manual access token**. Manual tokens cannot renew automatically without a matching saved secret. The secret input clears after credential operations. Tokens remain in trusted-context, memory-backed Chrome session storage. Saved secrets are decrypted internally when needed, not displayed or returned to the Settings page. No credentials are synced through Chrome Sync.

**Upgrade:** a previous password-protected record remains intact until replaced or deleted. Re-enter your Adobe secret once and Save secret to switch to passwordless storage. If its secret is still available from an unlocked session, Settings offers conversion without re-entry after explicit consent. Legacy plaintext records move to temporary session storage and can also be converted with consent before restart. No password-protected record is silently downgraded. Deletion does not erase old disk remnants or backups.

See the [privacy policy](privacy.html) and [Store publication notes](STORE-PUBLISHING.md). The public privacy/support URLs will be provided through the planned GitHub Pages site. This fixed-key design is not a guarantee of Chrome Web Store compliance or approval. Adobe documents Server-to-Server token generation as backend logic; this extension instead performs it locally using each user's supplied credential.

References: [Adobe token API](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ims), [Adobe credential guidance](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/).

## Features
* Pagination stops at the reported total or an empty page, deduplicates overlapping results, and rejects pages that repeat records without progress.
* Pipeline listing, start, execution states, cancel running steps, approve/reject waiting Go Live approval steps.
* Environment status dashboard with browser-local aliases, scoped to organization, program, and environment.
* Collapsible environment sections with individual pipeline rows and Start group / Stop group actions. Each pipeline displays one type: Full-Stack, FE, WebTier, or CDN Config.
* Production Promote waiting / Reject waiting actions apply to all eligible pipelines in an environment, or a single pipeline.
* Execution history loads only when expanded, with one page initially and additional pages on scroll.
* Distinct Full-Stack, WebTier, FE, and CDN Config icons; read-only labels derived from Adobe API metadata.
* List, add, update and delete runtime environment variables, with service selection and secret support. Editing prefills plain values; secrets require a replacement value.
* Optional fixed-key Client Secret storage with automatic token renewal after restart and a Forget control. Secret variable values are never persisted. Access tokens remain in Chrome session storage.

## Environment groups and labels

In **Environments**, enter an alias and click **Save alias**. Clear it and save to restore the original name. Aliases appear in pipeline headings and the Variables selector; Adobe environment names remain unchanged.

Pipelines appear under every environment targeted by their deployment phases. A pipeline targeting Stage and Production appears in both groups. Pipelines without a deployment target have a separate group. Group actions operate on entire pipelines, including all targets listed in the confirmation. Collapse an environment heading to hide its rows. Use Move up / Move down in the Environments tab to reorder environments. The browser-local order is scoped to organization and program and also applies to the Variables selector. New environments follow saved ones. In each environment configuration, check Hide from Pipelines to hide its accordion; clear the checkbox to show it again. Visibility is saved per organization/program, and Environments and Variables remain accessible. Shared pipelines still appear under their other visible target environments. Pipelines are ordered Full-Stack, FE, WebTier, CDN Config, then unknown types; names are alphabetical within each type.

**Start group** starts idle pipelines. **Stop group** requests cancellation for running or waiting pipelines using the actions currently available from Adobe. Requests run sequentially, continue after individual failures, and report successes, skips, and errors. Keep the popup open until the batch finishes. Refresh to check subsequent execution progress.

For environments identified by Adobe as production, **Promote waiting** and **Reject waiting** act only on pipelines with a waiting approval step. Individual **Promote** and **Reject** controls are available on the corresponding pipeline row. Confirmations list affected pipelines and targets. Before sending each decision, the extension rechecks the deployment targets, execution ID, waiting approval, and advertised action. Changed executions are skipped. Stop actions also check the displayed execution ID before cancelling.

The popup stores a display snapshot in memory-backed `chrome.storage.session`, scoped to Client ID, organization, program, and OAuth scopes. After the first load, reopening the popup uses that snapshot without Adobe API calls. The cache clears when the browser session ends. Local aliases, order, and visibility settings are always reread. Snapshot timestamps distinguish cached data from refreshed data.

Environment accordions start collapsed. Pipeline rows are created only when needed. Expanding an environment shows its cached data immediately and refreshes only its pipelines and current executions. Production pipelines also fetch the current execution detail record on each expansion to refresh approval status; nonproduction pipelines avoid this extra read when step states are already embedded. Reads run with up to four concurrent pipeline reads and shared requests for pipelines used by multiple environments. Each pipeline card shows its own progress indicator during metadata, execution, mutation, or explicit history requests. Cards update as their responses complete, while slower cards keep loading. Other cards and accordion bodies remain intact. Progress indicators also expose an accessible busy state and respect reduced-motion preferences. **Refresh** reloads the catalog and only expanded environments; use it to discover newly added or removed pipelines. Metadata missing from a list response may require pipeline detail reads during initial catalog loading. Failed reads retain the last known data and show an error. If session storage is unavailable or its snapshot exceeds the size limit, the UI remains usable and reports that the cache is unavailable.

Expand **Execution history** within a pipeline to load its first 20 executions. Scroll within the history panel to fetch one additional page at a time, or use **Load more**. Failed pages offer **Retry history**. For production pipelines, if the current execution is missing, opening the environment accordion fetches one latest execution (`start=0&limit=1`) to update the ribbon. This does not open history or follow pagination. Other history requests remain deferred until history expansion. When a previously active execution disappears from the current-execution endpoint, the row refreshes that known run directly by ID. An idle pipeline whose current execution still appears active also rechecks the run by ID. This updates completion pills on accordion reopen, explicit Refresh, and post-action refresh without fetching history pages. Failed lookups label cached status Last observed. A nonproduction 404 without a known run offers history expansion. Opening history can supply the latest historical summary without another request. The dedicated status ribbon uses Success for FINISHED, Failed for ERROR/FAILED, and readable Running, Cancelled, Cancelling, Pending, and Waiting labels. Waiting approval steps display Waiting, with an approval/rejection explanation in the tooltip. Pipeline BUSY displays as Running. For production environments, a live waiting approval also changes the pipeline header to Waiting even if Adobe reports BUSY. The raw Adobe execution status remains in the tooltip. Pipeline IDLE/BUSY is never treated as the execution outcome. The timestamp uses the latest available execution data. Historical step actions are never offered. Status refreshes preserve already opened history panels and loaded pages. Explicit catalog Refresh resets the pipeline view and its history panels; history remains unopened until requested again.

Mutations bypass the display cache, revalidate pipeline targets/current execution, and verify the captured connection identity before sending. Configuration or tab changes abort pending reads, preventing stale UI or cache writes. Successful group actions refresh affected open environments. Runtime variable values, secrets, access tokens, and arbitrary API fields are excluded from the display snapshot.


Pipeline types come only from Adobe API metadata and cannot be changed in the extension. The ribbon uses a dedicated icon for each type. Missing recognizable metadata triggers a pipeline-detail read; if the type remains unknown, the ribbon shows Type unavailable.

## Development checks

No build or dependency installation is required for the extension. With Node.js 22 or newer, run the regression tests:

```sh
node --test tests/*.test.mjs
node --input-type=module --check < popup.js
node --input-type=module --check < pipeline.js
```

`tests/browser-smoke.mjs` exports a Playwright scenario accepting a `Page` and a filename-to-source map (`popup.html`, `popup.js`, `api.js`, `pipeline.js`, `history.js`, `cache.js`, `style.css`). Run it in a fresh browser context. It intercepts all Adobe requests and supplies Chrome storage fixtures to test aliases, grouping, icons, editing, confirmations, and partial batch failures. This does not validate live credentials, roles, CORS, or actual deployments.

`tests/auth-browser-smoke.mjs` supplies a second Playwright scenario for the options page. Pass a source map containing `options.html`, `options.js`, `auth.js`, `api.js`, `style.css`, `vault.js`, `credentials.js`, `background.js`, `popup.html`, `popup.js`, `pipeline.js`, `history.js`, `cache.js`, and `manifest.json`. It mocks storage, credential exchange, and the API access check, including real Web Crypto, explicit consent, old credential migration, silent renewal after a simulated restart, concurrent renewal, forgetting, message restrictions, and rejection handling; it does not contact a real Adobe account.

`tests/loading-browser-smoke.mjs` reproduces a stalled Cloud Manager response and checks that Settings stays accessible, the request times out, controls recover, and Refresh succeeds afterward. It also checks slow sequential execution reads, an unresponsive background worker, and stalled storage. It uses mocked Chrome APIs and accelerated request deadlines.

## Important limitations
* Cloud Manager requests time out after 30 seconds. A complete popup refresh and each environment refresh have a 45-second deadline, including their reads and token renewal. Loading messages identify the current step; a refresh timeout stops remaining reads and restores controls. Settings remains accessible while the popup loads. After a timed-out mutation, check its remote state before retrying.
* Requires a provisioned Cloud Manager API integration with proper authorization and permissions.
* Automatic renewal requires a matching saved secret and valid Adobe scopes and permissions. Revoked credentials must be replaced in Settings.
* Cloud Manager approval and cancel controls are dependent on the execution response and step action names. Only recognized Go Live approval steps can be approved/rejected; other special manual steps may need an implementation extension.
* Stop depends on advertised cancellation actions. A pipeline with no cancellable step is reported as skipped; it cannot be forcibly stopped by the extension.
* Some production actions are role-restricted and depend on server-side step state.
* API access/CORS and organization policies must be tested against a real program. No production environment was accessed during development.
* Token renewal is automatic on demand. There are no notifications or background polling. The service worker handles credential operations and upgrade migration.
* Use the Adobe API integration appropriate to your team's access policies; do not distribute long-lived tokens or embed client secrets in the extension.

## API documentation
https://developer.adobe.com/experience-cloud/cloud-manager/reference/
https://developer.adobe.com/experience-cloud/cloud-manager/guides/api-usage/advancing-and-cancelling-steps
https://developer.adobe.com/experience-cloud/cloud-manager/guides/getting-started/authentication/

## Temporary API diagnostics

Open the popup, right-click inside it, choose **Inspect**, and open the Console.
Enable **Preserve log**, then run:

```js
sessionStorage.setItem('cmApiDebug', '1');
location.reload();
```

Filter the console by `[CM API]`. Each HTTP attempt has a paired request ID, sanitized URL, status, duration, pagination metadata, collection counts, and pipeline/environment/execution IDs. This helps identify repeated pages or an incorrect total/next link. Headers, request bodies, variable values, raw response bodies, and OAuth exchanges are omitted. Diagnostics stay in the local console and are not uploaded or saved by the extension. IDs may identify your program; review logs before sharing.

Disable diagnostics with `sessionStorage.removeItem('cmApiDebug')`. The setting applies only to that page session. Execution history supports infinite scrolling; these diagnostics also cover its page requests.

`tests/cache-browser-smoke.mjs` verifies cold/warm request counts, lazy row construction, per-environment refresh, zero unopened-history requests, cache scope isolation, shared in-flight reads, failure recovery, and cancellation during view/configuration changes. It uses the popup source map plus `cache.js` and mocked Chrome/Adobe APIs; it does not measure live Adobe latency.

`tests/card-loading-browser-smoke.mjs` holds mocked API responses to verify independent card loaders, immediate status updates, cleanup after failures, history progress, mutation progress, and history retry controls when another pipeline action completes.

`tests/prod-refresh-browser-smoke.mjs` verifies production accordion refreshes across Running, Waiting for approval/rejection, and Success, while nonproduction avoids the additional execution-detail call and history remains unopened.
