import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {buildSite, output} from './build-site.mjs';

await buildSite();
let links = 0;
const documents = (await readdir(output)).filter(name => name.endsWith('.html'));
for (const name of documents) {
    const path = join(output, name), html = await readFile(path, 'utf8');
    assert.match(html, /<html lang="en">/, `${name}: missing language`);
    assert.match(html, /name="viewport"/, `${name}: missing viewport`);
    assert.ok(!html.includes('__EXTENSION_VERSION__'), `${name}: unresolved version`);
    for (const match of html.matchAll(/(?:href|src)="([^"\s]+)"/g)) {
        const url = match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(url)) continue;
        assert.ok(!url.startsWith('/'), `${name}: root-relative links break project Pages sites: ${url}`);
        const [file, fragment] = url.split('#');
        const target = resolve(dirname(path), decodeURIComponent(file || name));
        assert.ok(!relative(output, target).startsWith('..'), `${name}: link escapes site: ${url}`);
        assert.ok((await stat(target)).isFile(), `${name}: missing target: ${url}`);
        if (fragment && target.endsWith('.html')) {
            const targetHTML = await readFile(target, 'utf8');
            assert.ok(targetHTML.includes(`id="${fragment}"`), `${name}: missing anchor: ${url}`);
        }
        links++;
    }
    for (const image of html.matchAll(/<img\b[^>]*>/g)) assert.match(image[0], /\balt="[^"]*"/, `${name}: image missing alt`);
}
console.log(`Checked ${documents.length} pages and ${links} local links/assets.`);
