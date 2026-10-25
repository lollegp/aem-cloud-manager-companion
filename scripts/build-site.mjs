import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const output = join(root, 'dist/site');

export async function buildSite() {
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    await rm(output, {recursive: true, force: true});
    await mkdir(output, {recursive: true});
    await cp(join(root, 'site'), output, {recursive: true});
    for (const name of await readdir(output)) {
        if (!name.endsWith('.html')) continue;
        const path = join(output, name);
        const html = await readFile(path, 'utf8');
        await writeFile(path, html.replaceAll('__EXTENSION_VERSION__', manifest.version));
    }
    const policy = await readFile(join(root, 'privacy.html'), 'utf8');
    const content = policy.match(/<main>([\s\S]*?)<\/main>/)?.[1];
    if (!content) throw new Error('The packaged privacy policy has no main content.');
    await writeFile(join(output, 'privacy.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Privacy and data handling for AEM Cloud Manager Companion."><title>Privacy · Cloud Manager Companion</title><link rel="icon" href="assets/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/site.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="site-header wrap"><a class="brand" href="index.html"><img src="assets/mark.svg" alt="" width="30" height="30">Cloud Manager <span>Companion</span></a><nav aria-label="Main navigation"><a href="index.html#install">Install</a><a href="support.html">Support</a></nav></header><main id="main" class="wrap document">${content}<h2>Website hosting</h2><p>This presentation site uses no analytics, cookies, remote fonts, or Adobe API requests. It is hosted on GitHub Pages; GitHub processes connection information under its <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">privacy statement</a>. This website cannot access your extension settings or credentials.</p><p><a href="support.html">Support and privacy questions</a> · <a href="index.html">Back to the extension</a></p></main><footer class="site-footer wrap"><span>Independent tool. Not affiliated with Adobe.</span><a href="support.html">Support</a></footer></body></html>`);
    await writeFile(join(output, '.nojekyll'), '');
    console.log(`Built site for extension v${manifest.version} in dist/site`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildSite();
