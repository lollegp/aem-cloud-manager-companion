# Presentation website and GitHub Pages

The website lives in `site/`. It contains the presentation page, an interactive preview using fixed sample data, installation instructions and support. It has no analytics, remote fonts, Adobe requests or credential forms. Runtime extension files are not included in the website deployment.

## Build and preview

With Node.js 22.13 or newer:

```sh
npm run site:check
npm run site:serve
```

Open `http://127.0.0.1:4173`. Set `PORT` to use another port. The server binds only to localhost. Stop it with Ctrl+C.

`npm run site:build` writes `dist/site/`. The build copies static assets, reads the release version from `manifest.json`, and generates the public privacy page from the root `privacy.html`. Edit that canonical policy instead of editing generated files. `dist/` is ignored by Git. Preview the built site rather than opening the source HTML, which contains a version placeholder.

## Publish from this repository

1. Push the source files and `.github/workflows/pages.yml` to `main`.
2. In the GitHub repository, open **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open **Actions → Deploy presentation site → Run workflow** for the first deployment. Later pushes changing website source, policy or version trigger it automatically.
5. Use the deployment URL shown in the workflow. For this repository, the expected default URL is `https://lollegp.github.io/aem-cloud-manager-companion/`.

The workflow validates the site, uploads only `dist/site/`, and deploys that artifact to the `github-pages` environment. It does not submit or publish the Chrome extension. Pages deployment needs the repository's environment policies to allow it.

Do not select the existing `/docs` directory as a branch publishing source: it also contains contributor notes and internal plans. For a separate Pages repository or manual hosting, copy the contents of `dist/site/`, including `.nojekyll`, into that repository's publishing directory instead. All assets and internal links are relative, so repository subpaths and custom domains are supported.

## Store listing URLs

After verifying the live deployment, use the actual public URLs:

- Product: the site root.
- Privacy: `privacy.html` under that root.
- Support: `support.html` under that root.

The page currently links to the source ZIP for unpacked installation. Add a Chrome Web Store install link only after a real listing exists. Keep release version, feature descriptions and privacy disclosures consistent with the extension.

## Validation

`npm run site:check` checks local links, anchors, required metadata, image alternatives and version substitution. Manually check the preview tabs with keyboard arrows/Home/End, mobile layout, installation links, support and generated privacy page. No deployment or repository settings are changed by the local commands.

Reference: [GitHub's Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
