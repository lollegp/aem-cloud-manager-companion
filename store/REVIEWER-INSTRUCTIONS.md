# Reviewer instructions

> Historical preparation notes for version 0.6.1. The [Store listing](https://chromewebstore.google.com/detail/aem-cloud-manager-compani/algghcdmdihlkbkaeeeplmhallhainna) is now available. Pending review items below record preparation findings; their resolution has not been independently verified.

## Purpose and access requirements

This extension manages Adobe AEM Cloud Manager environments, deployment pipelines and runtime variables. It requires an authorized Adobe Cloud Manager program and an integration with the necessary product profiles. It is not useful against an arbitrary public URL and does not grant Adobe access.

The submitted extension starts empty. No credential or token is included in the ZIP or public repository. The publisher must provide any dedicated nonproduction review access through the private Developer Dashboard instructions, never through these files or public issues. Credentials, authorization scope and the exact review program must be agreed before review; do not imply that reviewers can access the publisher's real environments by installing the extension.

## Setup

1. Install the submitted ZIP using Chrome's review process. Open the extension and select Settings.
2. Enter the dedicated test integration's Client ID, Organization ID, Program ID, Client Secret and OAuth scopes in the supplied fields.
3. Leave optional credential saving unchecked for one-time generation. Select Connect to generate a token and verify Cloud Manager access.
4. To test the retained automatic-renewal feature, review the fixed-key storage disclosure, explicitly select the consent checkbox, and Connect. This is obfuscation, not a secure vault. A saved secret enables token generation on demand after restart without a password prompt.
5. Alternatively, open Advanced connection controls and enter a valid, short-lived manual token. The publisher must arrange valid access; expired tokens will not let reviewers verify remote operations.

## Read-only checks

- Open Pipelines, expand a sample environment and inspect pipeline type, current status and last execution outcome. Open history and scroll for additional runs.
- Open Environments to view fresh status. Change an alias or display order; these preferences are local.
- Open Variables, select an environment, search and filter by service, and expand a plain-value row. Secret variables are write-only.
- In Settings → Appearance, select Light, Dark and System. System follows the computer theme; the selection persists locally.

## Changes — dedicated nonproduction targets only

Use only the review program and targets designated by the publisher. Every pipeline start, stop, approval/rejection or variable save changes Adobe resources. Inspect the confirmation's full target list: shared pipelines affect every listed environment. Do not start, stop or alter a production deployment just to demonstrate review behavior.

If authorized for the test environment, stage a disposable variable, save it, observe Updating, and verify that starts/approvals are blocked until ready. Then remove the test variable. Exercise pipeline controls only with an approved test pipeline. If a request times out, inspect remote state before retrying; a timeout does not establish failure.

## Cleanup

In Settings, use Forget saved secret to remove optional saved credentials and clear the token. Clear token alone allows a saved secret to regenerate it. Use Adobe Developer Console to revoke or rotate the dedicated review integration after review. Uninstalling does not revoke credentials at Adobe.

## Known pre-submission review item

The publisher chose to retain fixed-key local Client Secret storage and token generation inside the extension. See `store/READINESS.md`. The source documents the limitation; it does not claim that disclosure establishes compliance or that security review has passed.
