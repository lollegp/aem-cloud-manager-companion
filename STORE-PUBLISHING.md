# Chrome Web Store publication

The extension listing is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/aem-cloud-manager-compani/algghcdmdihlkbkaeeeplmhallhainna).

## Publication materials

- [Listing description](store/LISTING.md)
- [Copy-ready fields](store/PUBLICATION-FIELDS.md): description, single purpose and permission justifications
- [Privacy declarations](store/PRIVACY-DECLARATIONS.md)
- [Reviewer instructions](store/REVIEWER-INSTRUCTIONS.md): access must be supplied privately
- [Readiness and security review notes](store/READINESS.md)
- [Validation snapshot](store/VALIDATION.json): historical checks, not a current approval report
- [Screenshots](store/screenshots/): three 1280 × 800 PNGs rendered from the extension with synthetic data

## Public pages

- [Presentation website](https://lollegp.github.io/aem-cloud-manager-companion/)
- [Privacy policy](https://lollegp.github.io/aem-cloud-manager-companion/privacy.html)
- [Support](https://lollegp.github.io/aem-cloud-manager-companion/support.html)

## Maintenance

Update listing copy and screenshots when user-facing behavior changes. Keep dashboard declarations consistent with the shipped implementation. Generate runtime ZIPs locally with `npm run package`; generated archives remain ignored. Never include credentials or private reviewer access in this repository.

The readiness notes and validation snapshot describe the pre-submission candidate. Their pending items are not evidence of the Store's current review status. A live listing does not establish that the separate credential architecture review has been completed. Retain the documented fixed-key storage limitation when describing credential handling.
