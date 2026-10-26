# Privacy practices — publisher worksheet

Complete these fields against the actual public build. Local-only handling still counts as handling user data. This worksheet does not make Store certifications on behalf of the publisher.

## Single purpose

Manage Adobe Cloud Manager environments, deployment pipelines and runtime variables through the user's authorized Adobe integration.

## Permissions

- `storage`: save local connection identifiers, environment aliases/order/visibility and appearance; cache display metadata and access tokens in session storage. If the current optional Client Secret persistence feature remains, disclose it explicitly.
- `https://cloudmanager.adobe.io/*`: read environments, pipelines, execution history and variables, and send user-confirmed operational changes.
- `https://ims-na1.adobelogin.com/*`: generate tokens from user-supplied credentials in the current build. Remove this permission if the release no longer generates tokens.
- Remote code: none. Scripts, styles and images are bundled; no eval, remote script imports or content scripts.

## Data categories to review

- Authentication information: handled. Access tokens are used for Adobe API requests. The current credential-generation build also handles Client Secrets. Do not answer "no data handled" because credentials remain local.
- Cloud Manager content/configuration: pipeline and environment metadata, execution details and user-entered variables are handled. Evaluate the dashboard's website-content category against these features.
- Identifying information: integration, organization and program identifiers are handled. Program/environment labels and variable values can contain organization-specific or personal information. Classify supported use accurately; do not infer absence of personal information from the sample data.
- No browsing history, unrelated site activity, ads, analytics, developer telemetry or developer human access is implemented.

## Use, transfer and retention

Data is used only for the single purpose. Requests are sent directly to the necessary Adobe hosts over HTTPS. There is no developer backend or sale of data. Profile settings persist locally. Tokens and display snapshots stay in Chrome session storage. Variables and unsaved drafts remain in popup memory. See the canonical `privacy.html` for exact credential retention and migration behavior.

Before checking dashboard certifications, the publisher must verify that all code and organizational practices match the promises on permitted transfers, unrelated uses, advertising and creditworthiness. Do not claim Store approval or complete compliance from this worksheet alone.

Reference: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
